"""
Replay X UserTweets requests captured in a HAR file and import Serenity posts.

Sensitive request headers are used only in memory for requests to x.com. They
are never written to disk or printed by this module.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db
from agent.serenity_archive import import_posts

SOURCE_HANDLE = "aleabitoreddit"
SOURCE_USER_ID = "1940360837547565056"
REPLAY_ROOT = TRADEMIND_DB.parent / "serenity_api_replay"
BATCH_ROOT = TRADEMIND_DB.parent / "serenity_batches"

HEADER_ALLOWLIST = {
    "accept",
    "accept-language",
    "authorization",
    "cookie",
    "referer",
    "user-agent",
    "x-csrf-token",
    "x-twitter-active-user",
    "x-twitter-auth-type",
    "x-twitter-client-language",
}


def sanitize_har_headers(headers: Iterable[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for header in headers:
        name = str(header.get("name") or "").lower()
        value = str(header.get("value") or "")
        if name in HEADER_ALLOWLIST and value:
            result[name] = value
    return result


def _walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _twitter_time_to_iso(value: str) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y")
    except ValueError:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _author_screen_name(tweet: dict[str, Any]) -> str:
    core = tweet.get("core") or {}
    user_result = ((core.get("user_results") or {}).get("result") or {})
    legacy = user_result.get("legacy") or {}
    return str(legacy.get("screen_name") or "").lower()


def _tweet_text(tweet: dict[str, Any]) -> str:
    note = (((tweet.get("note_tweet") or {}).get("note_tweet_results") or {}).get("result") or {})
    note_text = str(note.get("text") or "").strip()
    if note_text:
        return note_text
    legacy = tweet.get("legacy") or {}
    return str(legacy.get("full_text") or legacy.get("text") or "").strip()


def _is_source_tweet(tweet: dict[str, Any], source_handle: str, source_user_id: str) -> bool:
    legacy = tweet.get("legacy") or {}
    if str(legacy.get("user_id_str") or "") == source_user_id:
        return True
    return _author_screen_name(tweet) == source_handle.lower().lstrip("@")


def extract_posts(
    payload: dict[str, Any],
    *,
    source_handle: str = SOURCE_HANDLE,
    source_user_id: str = SOURCE_USER_ID,
) -> list[dict[str, str]]:
    posts: dict[str, dict[str, str]] = {}
    for node in _walk(payload):
        if node.get("__typename") not in {"Tweet", "TweetWithVisibilityResults"}:
            continue
        tweet = node.get("tweet") if node.get("__typename") == "TweetWithVisibilityResults" else node
        if not isinstance(tweet, dict) or tweet.get("__typename") != "Tweet":
            continue
        if not _is_source_tweet(tweet, source_handle, source_user_id):
            continue
        tweet_id = str(tweet.get("rest_id") or "")
        legacy = tweet.get("legacy") or {}
        item_ts = _twitter_time_to_iso(str(legacy.get("created_at") or ""))
        text = _tweet_text(tweet)
        if not tweet_id or not item_ts or not text:
            continue
        posts[tweet_id] = {
            "id": tweet_id,
            "time": item_ts,
            "url": f"https://x.com/{source_handle.lstrip('@')}/status/{tweet_id}",
            "text": text,
        }
    return sorted(posts.values(), key=lambda post: post["time"], reverse=True)


def extract_bottom_cursor(payload: dict[str, Any]) -> str | None:
    for node in _walk(payload):
        if str(node.get("cursorType") or "").lower() == "bottom" and node.get("value"):
            return str(node["value"])
    return None


def _load_har(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _find_seed_request(har: dict[str, Any]) -> tuple[str, dict[str, str]]:
    for entry in har.get("log", {}).get("entries", []):
        request = entry.get("request") or {}
        url = str(request.get("url") or "")
        if "/UserTweets?" not in url:
            continue
        headers = sanitize_har_headers(request.get("headers") or [])
        if "authorization" in headers and "cookie" in headers:
            return url, headers
    raise RuntimeError("No replayable UserTweets request with auth headers found in HAR")


def url_with_cursor(url: str, cursor: str | None, count: int) -> str:
    parts = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qs(parts.query)
    variables = json.loads(query["variables"][0])
    variables["count"] = count
    if cursor:
        variables["cursor"] = cursor
    query["variables"] = [json.dumps(variables, separators=(",", ":"))]
    encoded = urllib.parse.urlencode({key: values[0] for key, values in query.items()})
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, encoded, parts.fragment))


def _request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def replay_har(
    har_path: Path,
    *,
    max_pages: int,
    count: int,
    sleep_seconds: float,
    start_cursor: str | None = None,
    page_offset: int = 0,
    source_handle: str = SOURCE_HANDLE,
    source_user_id: str = SOURCE_USER_ID,
) -> dict[str, Any]:
    init_db(str(TRADEMIND_DB))
    REPLAY_ROOT.mkdir(parents=True, exist_ok=True)
    BATCH_ROOT.mkdir(parents=True, exist_ok=True)

    seed_url, headers = _find_seed_request(_load_har(har_path))
    cursor: str | None = start_cursor
    seen_cursors: set[str] = set()
    all_posts: dict[str, dict[str, str]] = {}
    page_summaries: list[dict[str, Any]] = []
    stopped_reason = "max_pages"

    for page_number in range(1, max_pages + 1):
        url = url_with_cursor(seed_url, cursor, count)
        try:
            payload = _request_json(url, headers)
        except urllib.error.HTTPError as exc:
            stopped_reason = f"http_{exc.code}"
            break

        raw_path = REPLAY_ROOT / f"user_tweets_page_{page_number + page_offset:04d}.json"
        raw_path.write_text(json.dumps(payload, ensure_ascii=False))

        posts = extract_posts(payload, source_handle=source_handle, source_user_id=source_user_id)
        for post in posts:
            all_posts[post["id"]] = post
        next_cursor = extract_bottom_cursor(payload)
        times = sorted(post["time"] for post in posts)
        page_summaries.append(
            {
                "page": page_number,
                "stored_page": page_number + page_offset,
                "posts": len(posts),
                "earliest": times[0] if times else None,
                "latest": times[-1] if times else None,
                "has_next_cursor": bool(next_cursor),
            }
        )
        if not next_cursor:
            stopped_reason = "no_bottom_cursor"
            break
        if next_cursor in seen_cursors:
            stopped_reason = "repeated_cursor"
            break
        seen_cursors.add(next_cursor)
        cursor = next_cursor
        if sleep_seconds:
            time.sleep(sleep_seconds)

    batch_posts = sorted(all_posts.values(), key=lambda post: post["time"], reverse=True)
    batch_path = BATCH_ROOT / "serenity_har_replay_posts.json"
    if batch_posts:
        batch_path.write_text(json.dumps(batch_posts, ensure_ascii=False, indent=2))
    stats = (
        import_posts(batch_posts, source_handle=source_handle, capture_method="x-api-har-replay", update_window=False)
        if batch_posts
        else {"input": 0, "inserted": 0, "skipped_existing_id": 0, "skipped_existing_text": 0, "rejected": 0}
    )
    times = sorted(post["time"] for post in batch_posts)
    summary = {
        "har": str(har_path),
        "pages": len(page_summaries),
        "unique_posts": len(batch_posts),
        "earliest": times[0] if times else None,
        "latest": times[-1] if times else None,
        "batch": str(batch_path),
        "raw_dir": str(REPLAY_ROOT),
        "stopped_reason": stopped_reason,
        "last_cursor": cursor,
        "import_stats": stats,
        "page_summaries": page_summaries,
    }
    (REPLAY_ROOT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("har", type=Path)
    parser.add_argument("--max-pages", type=int, default=250)
    parser.add_argument("--count", type=int, default=40)
    parser.add_argument("--sleep", type=float, default=0.7)
    parser.add_argument("--start-cursor")
    parser.add_argument("--page-offset", type=int, default=0)
    args = parser.parse_args(argv)

    summary = replay_har(
        args.har,
        max_pages=args.max_pages,
        count=args.count,
        sleep_seconds=args.sleep,
        start_cursor=args.start_cursor,
        page_offset=args.page_offset,
    )
    printable = {key: value for key, value in summary.items() if key != "page_summaries"}
    print(json.dumps(printable, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
