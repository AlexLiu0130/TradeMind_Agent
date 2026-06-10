"""TTL file-cache tests."""
import time

import pytest

from agent import cache


@pytest.fixture
def _cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "IBKR_CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache, "resolve_ttl", lambda: 60.0)
    return tmp_path


def test_put_then_get_roundtrip(_cache_dir):
    cache.put("status_dashboard.py", {"net_delta": 6600})
    assert cache.get("status_dashboard.py") == {"net_delta": 6600}


def test_miss_returns_none(_cache_dir):
    assert cache.get("never_written.py") is None


def test_ttl_zero_disables_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "IBKR_CACHE_DIR", tmp_path)
    monkeypatch.setattr(cache, "resolve_ttl", lambda: 0.0)  # real-time
    cache.put("x.py", {"a": 1})  # no-op when disabled
    assert cache.get("x.py") is None


def test_per_call_ttl_override(_cache_dir):
    cache.put("x.py", {"a": 1})
    time.sleep(0.05)
    assert cache.get("x.py", ttl=0.01) is None   # overridden short TTL → stale
    assert cache.get("x.py", ttl=60) == {"a": 1}  # generous TTL → hit


def test_resolve_ttl_prefers_rule(tmp_path, monkeypatch):
    # With a fresh conftest DB, the seeded ibkr_cache_ttl rule (60) should win.
    monkeypatch.setattr(cache, "IBKR_CACHE_TTL", 999.0)  # env fallback, should be ignored
    from agent.journal_store import set_rule
    set_rule("ibkr_cache_ttl", "30")
    assert cache.resolve_ttl() == 30.0
