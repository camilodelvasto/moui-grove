# Copyright (C) 2026 Sensata Research GmbH
# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util, json, re, yaml
from pathlib import Path

_SERVER = Path(__file__).parent / "server.py"
_spec = importlib.util.spec_from_file_location("grove_server_under_test", _SERVER)
_mod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_mod)

def _chat_grove(tmp_path):
    (tmp_path / "grove.yaml").write_text(yaml.safe_dump({
        "id": "t", "title": "T", "description": "d", "lang": "en",
        "defaults": {"view": "grid", "layout": "article", "posts_per_page": 12},
        "og": {"title": "T", "description": "d", "image": "og.png"},
        "header": {"actions": []},
        "rss": {"enabled": True, "max_items": 20},
        "features": [{"type": "chat", "id": "ghost", "ask": "write", "persist": "local"}],
        "pages": {"/ghost": "pages/ghost"}}))
    (tmp_path / "posts").mkdir()
    pg = tmp_path / "pages" / "ghost"; pg.mkdir(parents=True)
    (pg / "page.yaml").write_text(
        'title: "Ghost"\nmount: subtree\nlayout: minimal\nbody:\n  - feature: ghost\n')
    return tmp_path

def test_dev_build_threads_gate_into_island(tmp_path):
    root = _chat_grove(tmp_path)
    cfg = {"endpoint": "https://api.local.test/api",
           "gate": {"scheme": "access-code", "check": "https://api.local.test/api/check"}}
    dist, _ = _mod._dev_build(root, None, base_url="http://localhost:4200", chat_config=cfg)
    html = (Path(dist) / "ghost" / "index.html").read_text()
    blob = json.loads(re.search(r'id="chat-config">(\{.*?\})</script>', html, re.S).group(1))
    assert blob["gate"] == {"scheme": "access-code", "check": "https://api.local.test/api/check"}
    assert blob["endpoint"] == "https://api.local.test/api"

def test_dev_build_csp_connect_src_is_origin_not_path(tmp_path):
    """feature_endpoints feeds CSP connect-src; the value must be the ORIGIN
    (scheme+host, no path). A path-bearing connect-src source matches by exact
    path only, so it would BLOCK the runtime fetches to /api/ask and /api/check."""
    root = _chat_grove(tmp_path)
    cfg = {"endpoint": "https://api.local.test/api",
           "gate": {"scheme": "access-code", "check": "https://api.local.test/api/check"}}
    dist, _ = _mod._dev_build(root, None, base_url="http://localhost:4200", chat_config=cfg)
    html = (Path(dist) / "ghost" / "index.html").read_text()
    token = re.search(r"connect-src[^;]*", html).group(0)
    assert token == "connect-src 'self' https://api.local.test"
    assert "https://api.local.test/api" not in token  # no path in the connect-src source
