"""
cache.py — a tiny TTL file cache for IBKR script results.

Each agent invocation (chat_cli) is a fresh process, so an in-memory cache would
never hit across calls. A file cache lets repeated IBKR reads — within one agent
run (e.g. risk + guardrail both pull portfolio_positions) and across follow-up
questions within the TTL — reuse a recent result instead of re-hitting the Gateway
(status_dashboard alone is ~11s).

Tradeoff: results can be up to TTL seconds stale. Tune with IBKR_CACHE_TTL
(seconds); set 0 to disable.
"""
import hashlib
import json
import os
import tempfile
import time

from agent.config import IBKR_CACHE_DIR, IBKR_CACHE_TTL


def _path(key: str):
    h = hashlib.md5(key.encode("utf-8")).hexdigest()
    return IBKR_CACHE_DIR / f"{h}.json"


def resolve_ttl() -> float:
    """
    Effective TTL: the dashboard-editable `ibkr_cache_ttl` rule wins, falling back
    to the IBKR_CACHE_TTL env default. 0 means real-time (no cache).
    """
    try:
        from agent.journal_store import get_rule
        v = get_rule("ibkr_cache_ttl")
        if v is not None:
            return float(v)
    except Exception:  # noqa: BLE001 — DB may be unset; fall back to env.
        pass
    return IBKR_CACHE_TTL


def get(key: str, ttl: float | None = None):
    """Return cached value if present and fresher than ttl, else None."""
    ttl = resolve_ttl() if ttl is None else ttl
    if ttl <= 0:
        return None
    p = _path(key)
    try:
        if time.time() - p.stat().st_mtime > ttl:
            return None
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def put(key: str, data) -> None:
    """Atomically write data to the cache (temp file + rename)."""
    if resolve_ttl() <= 0:  # caching disabled (real-time) → don't write
        return
    try:
        IBKR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=IBKR_CACHE_DIR, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, default=str)
        os.replace(tmp, _path(key))
    except OSError:
        # Caching is best-effort; never fail the caller because the cache write failed.
        try:
            os.unlink(tmp)  # type: ignore[possibly-undefined]
        except (OSError, NameError):
            pass
