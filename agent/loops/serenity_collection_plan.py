"""
Create pending date windows for the Serenity full archive backfill.

This does not collect browser data. It only records resumable work units so the
Chrome collector can continue from the next pending window after interruptions.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta

from agent.config import TRADEMIND_DB
from agent import journal_store as js
from agent.journal_store import init_db, list_intel_collection_windows, upsert_intel_collection_window


def _parse_day(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def create_windows(start: str, end: str, *, days: int = 7, source_handle: str = "aleabitoreddit") -> dict:
    if days <= 0:
        raise ValueError("days must be positive")
    source_handle = source_handle.lstrip("@")
    start_day = _parse_day(start)
    end_day = _parse_day(end)
    existing = {
        (row["window_start"], row["window_end"]): row
        for row in list_intel_collection_windows(source_handle)
    }
    done = [
        row for row in existing.values()
        if row["status"] == "done"
    ]
    created = 0
    preserved = 0
    cursor = start_day
    while cursor < end_day:
        nxt = min(cursor + timedelta(days=days), end_day)
        key = (cursor.isoformat(), nxt.isoformat())
        current = existing.get(key)
        covered = any(row["window_start"] <= key[0] and row["window_end"] >= key[1] for row in done)
        if current or covered:
            preserved += 1
        else:
            upsert_intel_collection_window(
                source_handle=source_handle,
                window_start=key[0],
                window_end=key[1],
                status="pending",
                notes="scheduled for browser-dom collection",
            )
            created += 1
        cursor = nxt
    return {"created": created, "preserved": preserved, "start": start, "end": end, "days": days}


def prune_covered_pending(source_handle: str = "aleabitoreddit") -> int:
    source_handle = source_handle.lstrip("@")
    with js._conn() as con:
        cur = con.execute(
            """
            DELETE FROM intel_collection_windows AS p
            WHERE p.source_handle=?
              AND p.status='pending'
              AND EXISTS (
                SELECT 1 FROM intel_collection_windows AS d
                WHERE d.source_handle=p.source_handle
                  AND d.status='done'
                  AND d.window_start <= p.window_start
                  AND d.window_end >= p.window_end
              )
            """,
            (source_handle,),
        )
        return cur.rowcount


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--source-handle", default="aleabitoreddit")
    parser.add_argument("--prune-covered", action="store_true")
    args = parser.parse_args(argv)
    init_db(str(TRADEMIND_DB))
    result = create_windows(args.start, args.end, days=args.days, source_handle=args.source_handle)
    if args.prune_covered:
        result["pruned"] = prune_covered_pending(args.source_handle)
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
