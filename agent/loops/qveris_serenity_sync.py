"""
Sync Serenity X posts through QVeris and import them into intel_items.

Default mode only fetches posts newer than the latest archived post. Use
--full to walk backwards from now until QVeris/X stops returning pages.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db
from agent.serenity_archive import import_posts

BASE_URL = os.environ.get("QVERIS_BASE_URL", "https://qveris.ai/api/v1").rstrip("/")
PROFILE_TOOL = "tikhub.twitter.web.user_profile.retrieve.v1.3027463a"
TWEETS_TOOL = "x_developer.2.users.tweets.retrieve.v2.f0afa131"
WEB_POSTS_TOOL = "tikhub.twitter.web.user_posts.list.v1.a68e5ff5"
DEFAULT_HANDLE = "aleabitoreddit"
STATE_FILE = TRADEMIND_DB.with_name("qveris_serenity_sync_state.json")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_project_env() -> None:
    env = Path(__file__).resolve().parents[2] / ".env"
    if not env.exists():
        return
    for raw in env.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _read_state(path: Path = STATE_FILE) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_state(state: dict[str, Any], path: Path = STATE_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _execute(tool_id: str, parameters: dict[str, Any], session_id: str) -> dict[str, Any]:
    key = os.environ.get("QVERIS_API_KEY")
    if not key:
        raise RuntimeError("QVERIS_API_KEY not set")
    body = json.dumps({"tool_id": tool_id, "parameters": parameters, "session_id": session_id}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/tools/execute",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"QVeris HTTP {exc.code}: {exc.read().decode()[:500]}") from exc
    if not payload.get("success"):
        raise RuntimeError(payload.get("error_message") or f"QVeris execution failed: {payload}")
    return payload


def _result_data(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result", {})
    if result.get("full_content_file_url"):
        with urllib.request.urlopen(result["full_content_file_url"], timeout=60) as res:
            return json.loads(res.read().decode())
    data = result.get("data", {})
    if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
        return data["data"]
    return data if isinstance(data, dict) else {}


def _extract_profile_id(payload: dict[str, Any]) -> str:
    data = payload.get("result", {}).get("data", {}).get("data", {})
    profile = data.get("data", data)
    user_id = profile.get("rest_id") or profile.get("id")
    if not user_id:
        raise RuntimeError("QVeris profile response did not include a user id")
    return str(user_id)


def _tweet_text(tweet: dict[str, Any]) -> str:
    note = tweet.get("note_tweet")
    if isinstance(note, dict) and note.get("text"):
        return str(note["text"]).strip()
    return str(tweet.get("text") or "").strip()


def normalize_tweet(tweet: dict[str, Any], handle: str = DEFAULT_HANDLE) -> dict[str, Any] | None:
    tweet_id = str(tweet.get("id") or "").strip()
    text = _tweet_text(tweet)
    if not tweet_id or not text:
        return None
    return {
        "id": tweet_id,
        "time": tweet.get("created_at"),
        "url": f"https://x.com/{handle.lstrip('@')}/status/{tweet_id}",
        "text": text,
        "raw_payload": tweet,
    }


def normalize_web_post(tweet: dict[str, Any], handle: str = DEFAULT_HANDLE) -> dict[str, Any] | None:
    tweet_id = str(tweet.get("tweet_id") or tweet.get("id") or "").strip()
    text = str(tweet.get("text") or "").strip()
    if not tweet_id or not text:
        return None
    created = tweet.get("created_at")
    if created:
        try:
            created = parsedate_to_datetime(str(created)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError):
            created = str(created)
    return {
        "id": tweet_id,
        "time": created,
        "url": f"https://x.com/{handle.lstrip('@')}/status/{tweet_id}",
        "text": text,
        "raw_payload": tweet,
    }


def _latest_item_ts(source_handle: str) -> str | None:
    import sqlite3

    with sqlite3.connect(TRADEMIND_DB) as con:
        row = con.execute(
            """
            SELECT MAX(item_ts)
            FROM intel_items
            WHERE source_handle=? AND item_ts IS NOT NULL
            """,
            (source_handle.lstrip("@"),),
        ).fetchone()
    return row[0] if row and row[0] else None


def sync(
    *,
    handle: str = DEFAULT_HANDLE,
    user_id: str | None = None,
    since_existing: bool = True,
    start_time: str | None = None,
    end_time: str | None = None,
    max_pages: int = 3,
    page_size: int = 100,
    include_replies: bool = False,
    web_api: bool = True,
    resume: bool = False,
) -> dict[str, Any]:
    init_db(str(TRADEMIND_DB))
    session_id = f"trademind-serenity-{handle.lstrip('@')}"
    if user_id is None:
        user_id = _extract_profile_id(_execute(PROFILE_TOOL, {"screen_name": handle.lstrip("@")}, session_id))

    if since_existing and not start_time:
        start_time = _latest_item_ts(handle)

    if web_api:
        params: dict[str, Any] = {"screen_name": handle.lstrip("@")}
    else:
        params = {
            "id": user_id,
            "max_results": max(5, min(page_size, 100)),
            "tweet.fields": "created_at,text,entities,public_metrics,referenced_tweets,note_tweet",
        }
        if not include_replies:
            params["exclude"] = ["retweets", "replies"]
        if start_time:
            params["start_time"] = start_time
        if end_time:
            params["end_time"] = end_time

    pages = 0
    fetched = 0
    inserted = 0
    duplicates = 0
    rejected = 0
    state = _read_state()
    token = state.get("next_cursor") if resume and state.get("handle") == handle.lstrip("@") else None
    last_cost = 0
    last_error = None
    while True:
        if token:
            params["cursor" if web_api else "pagination_token"] = token
        else:
            params.pop("cursor", None)
            params.pop("pagination_token", None)
        try:
            payload = _execute(WEB_POSTS_TOOL if web_api else TWEETS_TOOL, params, session_id)
        except RuntimeError as exc:
            last_error = str(exc)
            break
        last_cost += float(payload.get("cost") or 0)
        data = _result_data(payload)
        if web_api:
            nested = data.get("data") if isinstance(data.get("data"), dict) else data
            tweets = nested.get("timeline") or []
            posts = [p for t in tweets if (p := normalize_web_post(t, handle))]
            token = nested.get("next_cursor")
        else:
            tweets = data.get("data") or []
            posts = [p for t in tweets if (p := normalize_tweet(t, handle))]
            token = (data.get("meta") or {}).get("next_token")
        stats = import_posts(posts, source_handle=handle, capture_method="qveris-x-api", update_window=False)
        pages += 1
        fetched += len(tweets)
        inserted += stats["inserted"]
        duplicates += stats["skipped_existing_id"] + stats["skipped_existing_text"]
        rejected += stats["rejected"]
        _write_state(
            {
                "handle": handle.lstrip("@"),
                "next_cursor": token,
                "pages": pages,
                "fetched": fetched,
                "inserted": inserted,
                "duplicates": duplicates,
                "rejected": rejected,
                "last_error": last_error,
                "updated_at": _utc_now(),
            }
        )
        if not token or (max_pages and pages >= max_pages):
            break

    return {
        "handle": handle.lstrip("@"),
        "user_id": user_id,
        "start_time": start_time,
        "end_time": end_time,
        "pages": pages,
        "fetched": fetched,
        "inserted": inserted,
        "duplicates": duplicates,
        "rejected": rejected,
        "estimated_cost_charged": last_cost,
        "last_error": last_error,
        "synced_at": _utc_now(),
    }


def main(argv: list[str] | None = None) -> int:
    _load_project_env()
    parser = argparse.ArgumentParser(description="Sync Serenity posts from QVeris into TradeMind.")
    parser.add_argument("--handle", default=DEFAULT_HANDLE)
    parser.add_argument("--user-id")
    parser.add_argument("--start-time")
    parser.add_argument("--end-time")
    parser.add_argument("--max-pages", type=int, default=3, help="0 means unlimited.")
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--full", action="store_true", help="Ignore existing latest item_ts and walk history.")
    parser.add_argument("--include-replies", action="store_true")
    parser.add_argument("--resume", action="store_true", help="Continue from the last stored QVeris cursor.")
    parser.add_argument("--developer-api", action="store_true", help="Use X Developer user-tweets API instead of QVeris web timeline.")
    args = parser.parse_args(argv)
    result = sync(
        handle=args.handle,
        user_id=args.user_id,
        since_existing=not args.full,
        start_time=args.start_time,
        end_time=args.end_time,
        max_pages=args.max_pages,
        page_size=args.page_size,
        include_replies=args.include_replies,
        web_api=not args.developer_api,
        resume=args.resume,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
