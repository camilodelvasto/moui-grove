"""Tests for grove dev server."""
import sys
from pathlib import Path

# Add exporters to import path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'exporters'))

import pytest
from server import inject_hmr_script, pages_by_route, watch_and_rebuild
from shapes.grove.exporters.chat_config import chat_presentation as _chat_presentation

BASE_URL = "http://localhost:4200"


def _setup_grove(tmp_path):
    grove_yaml = tmp_path / "grove.yaml"
    grove_yaml.write_text("""
id: test-grove
title: "Test Grove"
description: "A test grove."
base_url: https://example.com
lang: en
defaults:
  view: grid
  layout: article
  posts_per_page: 12
og:
  title: "Test"
  description: "Test grove."
  image: og.png
rss:
  enabled: true
  max_items: 20
""")
    posts_dir = tmp_path / "posts"
    posts_dir.mkdir(parents=True)
    (posts_dir / "welcome.md").write_text("""---
title: "Welcome"
slug: welcome
published: true
publish_date: 2026-04-14
excerpt: "Hello world."
tags: [test]
---

# Welcome

Hello world.
""")
    return tmp_path


class TestBuildIntegration:
    def test_builds_dist(self, tmp_path):
        root = _setup_grove(tmp_path)
        from build import build
        dist, _ = build(root, base_url=BASE_URL)
        assert (dist / "index.html").exists()
        assert (dist / "welcome" / "index.html").exists()
        assert (dist / "feed.xml").exists()

    def test_rebuild_picks_up_changes(self, tmp_path):
        root = _setup_grove(tmp_path)
        from build import build
        dist, _ = build(root, base_url=BASE_URL)
        assert "Hello world" in (dist / "welcome" / "index.html").read_text()

        (root / "posts" / "welcome.md").write_text("""---
title: "Updated"
slug: welcome
published: true
publish_date: 2026-04-14
excerpt: "Changed."
tags: [test]
---

# Updated

Changed content.
""")
        dist, _ = build(root, base_url=BASE_URL)
        assert "Changed content" in (dist / "welcome" / "index.html").read_text()


class TestHMRInjection:
    def test_injects_into_html(self):
        html = "<html><body><h1>Hi</h1></body></html>"
        result = inject_hmr_script(html)
        assert "EventSource" in result
        assert "/events" in result
        assert "</body>" in result

    def test_no_op_for_non_html(self):
        css = "body { color: red; }"
        assert inject_hmr_script(css) == css

    def test_no_op_without_body_tag(self):
        fragment = "<div>partial</div>"
        assert inject_hmr_script(fragment) == fragment


class TestPagesByRoute:
    def test_pages_by_route_keys_on_route_normalized(self):
        pages = [
            {"route": "/", "folder": None, "body": ["grid"]},
            {"route": "/landing", "folder": None, "body": ["self"]},
        ]
        by_route = pages_by_route(pages)
        assert set(by_route.keys()) == {"/", "/landing/"}
        assert by_route["/landing/"]["body"] == ["self"]


def _chat_grove(**feature_overrides):
    """A grove dict carrying one chat feature; overrides patch that feature."""
    feature = {"id": "bot", "type": "chat", "ask": "converse"}
    feature.update(feature_overrides)
    return {"features": [feature]}


_CHAT_PAGES = [{"route": "/assistant", "body": [{"feature": "bot"}]}]


class TestChatPresentation:
    def test_avatar_resolves_under_base_path_root(self):
        chats = _chat_presentation(_chat_grove(avatar="/img/bot.png"),
                                   _CHAT_PAGES, {"base_path": ""})
        assert chats["/assistant/"]["avatar"] == "/img/bot.png"

    def test_avatar_resolves_under_base_path_subpath(self):
        chats = _chat_presentation(_chat_grove(avatar="/img/bot.png"),
                                   _CHAT_PAGES, {"base_path": "/grove"})
        assert chats["/assistant/"]["avatar"] == "/grove/img/bot.png"

    def test_relative_avatar_prepends_base_path(self):
        chats = _chat_presentation(_chat_grove(avatar="img/bot.png"),
                                   _CHAT_PAGES, {"base_path": "/grove"})
        assert chats["/assistant/"]["avatar"] == "/grove/img/bot.png"

    def test_absent_intro_and_avatar_omit_keys(self):
        chats = _chat_presentation(_chat_grove(), _CHAT_PAGES, {"base_path": ""})
        entry = chats["/assistant/"]
        assert "intro_html" not in entry
        assert "avatar" not in entry
        assert "name" not in entry

    def test_persist_defaults_to_none(self):
        chats = _chat_presentation(_chat_grove(), _CHAT_PAGES, {"base_path": ""})
        assert chats["/assistant/"]["persist"] == "none"

    def test_intro_rendered_to_html(self):
        chats = _chat_presentation(_chat_grove(intro="**hi**"), _CHAT_PAGES, {"base_path": ""})
        assert "<strong>hi</strong>" in chats["/assistant/"]["intro_html"]


class TestWatchPaths:
    def test_watch_and_rebuild_watches_pages_and_elements(self):
        """watch_and_rebuild must include pages/ and elements/ in its watch set.

        The function builds watch_paths inline; we verify the expected paths
        appear in the constructed list by inspecting the source — the watcher
        thread is not started (threading concern out of scope for unit tests).
        """
        import inspect
        src = inspect.getsource(watch_and_rebuild)
        assert "'pages'" in src, "watch_and_rebuild must watch grove_root/'pages'"
        assert "'elements'" in src, "watch_and_rebuild must watch grove_root/'elements'"
