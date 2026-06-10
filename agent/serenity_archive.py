from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Iterable

from agent import journal_store as js

PORTFOLIO = {"AMD", "ARM", "MRVL", "MU", "NBIS", "NOK", "DRAM"}
IGNORE_TICKERS = {"USD", "AI", "CPO", "IP", "MC", "ATM", "MW", "FDN", "NFA"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def extract_tickers(text: str) -> list[str]:
    seen: dict[str, None] = {}
    for match in re.finditer(r"\$([A-Z][A-Z0-9]{1,5}(?:\.[A-Z])?)\b", text):
        ticker = match.group(1).upper()
        if ticker not in IGNORE_TICKERS:
            seen[ticker] = None
    return list(seen)


def is_garbage_text(text: str) -> bool:
    cleaned = (text or "").strip()
    if len(cleaned) < 8:
        return True
    garbage_prefixes = ("debug=true&log=", "category=perftown", "sub_topics=", "log=%5B")
    if cleaned.startswith(garbage_prefixes):
        return True
    return "%22_category_%22" in cleaned or "client_event" in cleaned[:300]


def _summary(text: str) -> str:
    cleaned = " ".join(text.split())
    return cleaned if len(cleaned) <= 180 else cleaned[:177] + "..."


def _impact_direction(text: str) -> str:
    lower = text.lower()
    bearish = bool(re.search(r"\b(shortage|delay|risk|ban|cut|weak|miss|down|problem|constraint)\b", lower))
    bullish = bool(re.search(r"\b(upside|beat|strong|growth|demand|accelerat|breakout|tight|bottleneck)\b", lower))
    if bullish and not bearish:
        return "bullish"
    if bearish and not bullish:
        return "bearish"
    return "uncertain"


def import_posts(
    posts: Iterable[dict],
    *,
    window_start: str | None = None,
    window_end: str | None = None,
    source_handle: str = "aleabitoreddit",
    capture_method: str = "browser-dom",
    update_window: bool = True,
) -> dict:
    rows = list(posts)
    stats = {
        "input": len(rows),
        "inserted": 0,
        "skipped_existing_id": 0,
        "skipped_existing_text": 0,
        "rejected": 0,
    }
    now = _now()
    source_handle = source_handle.lstrip("@")
    with js._conn() as con:
        existing_ids = {
            row["external_id"]
            for row in con.execute("SELECT external_id FROM intel_items WHERE external_id IS NOT NULL AND external_id != ''")
        }
        existing_texts = {row["raw_text"] for row in con.execute("SELECT raw_text FROM intel_items")}
        for post in rows:
            external_id = str(post.get("id") or post.get("external_id") or "").strip()
            text = str(post.get("text") or post.get("raw_text") or "").strip()
            if not external_id or is_garbage_text(text):
                stats["rejected"] += 1
                continue
            if external_id in existing_ids:
                stats["skipped_existing_id"] += 1
                continue
            if text in existing_texts:
                stats["skipped_existing_text"] += 1
                continue

            related = extract_tickers(text)
            overlap = [ticker for ticker in related if ticker in PORTFOLIO]
            urgency = "alert" if len(overlap) >= 2 else "watch" if related else "low"
            ticker_snapshot = {
                ticker: {"baseline": None, "current": None, "since_pct": None, "source": "pending"}
                for ticker in related
            }
            con.execute(
                """
                INSERT INTO intel_items
                  (captured_at, source, source_handle, external_id, capture_method,
                   item_ts, url, raw_text, summary, related_tickers,
                   portfolio_overlap, impact_direction, urgency, rationale,
                   ticker_snapshot, raw_payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now,
                    "Serenity",
                    source_handle,
                    external_id,
                    capture_method,
                    post.get("time") or post.get("item_ts"),
                    post.get("url"),
                    text,
                    _summary(text),
                    json.dumps(related, ensure_ascii=False),
                    json.dumps(overlap, ensure_ascii=False),
                    _impact_direction(text),
                    urgency,
                    "浏览器页面采集；已去除引用推文、互动数字和无效日志。匹配到正文 ticker。" if related else "浏览器页面采集；已去除引用推文、互动数字和无效日志。",
                    json.dumps(ticker_snapshot, ensure_ascii=False),
                    json.dumps(
                        {
                            "submitted_from": "chrome-dom-scrape",
                            "window_start": window_start,
                            "window_end": window_end,
                            "quote_sections_removed": True,
                            "metrics_removed": True,
                        },
                        ensure_ascii=False,
                    ),
                ),
            )
            existing_ids.add(external_id)
            existing_texts.add(text)
            stats["inserted"] += 1

    if update_window and window_start and window_end:
        duplicate_count = stats["skipped_existing_id"] + stats["skipped_existing_text"]
        js.upsert_intel_collection_window(
            source_handle=source_handle,
            window_start=window_start,
            window_end=window_end,
            status="done",
            found_count=stats["input"],
            inserted_count=stats["inserted"],
            duplicate_count=duplicate_count,
            rejected_count=stats["rejected"],
            completed_at=_now(),
            notes=f"browser-dom import inserted={stats['inserted']} duplicates={duplicate_count} rejected={stats['rejected']}",
        )
    return stats
