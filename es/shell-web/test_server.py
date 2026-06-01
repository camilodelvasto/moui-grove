"""Tests for grove dev server."""
import sys
from pathlib import Path

# Add exporters to import path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'exporters'))

import pytest
from server import inject_hmr_script

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
