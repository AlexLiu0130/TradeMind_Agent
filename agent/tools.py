"""
Shared subprocess runner for IBKR CLI scripts.
All scripts write logs to stderr; stdout is clean JSON.

Results are cached with a short TTL (see agent.cache) so repeated reads — within
one agent run and across follow-up questions — reuse a recent result instead of
re-hitting the IBKR Gateway. Pass ttl=0 to force a fresh fetch for a given call.
"""
import json
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

from agent import cache
from agent.config import IBKR_SCRIPTS_DIR

_INFLIGHT: dict[str, dict] = {}
_INFLIGHT_LOCK = threading.Lock()


def run_script(script: str, *args, timeout: int = 60, ttl: float | None = None) -> dict | list | None:
    """
    Run an IBKR script and return parsed JSON from stdout.
    Returns None if the script fails or stdout is empty/invalid.
    Reuses a cached result when one is fresher than the TTL (ttl=0 bypasses cache).
    """
    key = " ".join([script, *args])
    cached = cache.get(key, ttl)
    if cached is not None:
        return cached

    with _INFLIGHT_LOCK:
        entry = _INFLIGHT.get(key)
        if entry is None:
            entry = {"event": threading.Event(), "result": None}
            _INFLIGHT[key] = entry
            owner = True
        else:
            owner = False

    if not owner:
        entry["event"].wait()
        return entry["result"]

    cmd = ["python3", str(IBKR_SCRIPTS_DIR / script), *args]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0 or not result.stdout.strip():
            parsed = None
        else:
            try:
                parsed = json.loads(result.stdout)
            except json.JSONDecodeError:
                parsed = None
        if parsed is not None:
            cache.put(key, parsed)
        return parsed
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    finally:
        with _INFLIGHT_LOCK:
            entry["result"] = locals().get("parsed")
            entry["event"].set()
            _INFLIGHT.pop(key, None)


def run_scripts_parallel(
    tasks: list[tuple[str, tuple, dict]],
    *,
    runner=run_script,
    max_workers: int | None = None,
) -> list[dict | list | None]:
    """
    Run independent IBKR script reads concurrently and preserve task order.
    Each task is `(script, args_tuple, kwargs_dict)`.
    """
    if not tasks:
        return []
    workers = max_workers or min(len(tasks), 8)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(runner, script, *args, **kwargs)
            for script, args, kwargs in tasks
        ]
        return [future.result() for future in futures]
