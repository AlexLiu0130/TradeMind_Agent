"""
Import a cleaned Serenity browser batch into the durable intel archive.

The browser collector writes JSON arrays like:
  [{"id": "...", "time": "...", "url": "...", "text": "..."}]
This importer is idempotent: duplicate X status ids or duplicate text are skipped.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db
from agent.serenity_archive import import_posts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("batch", help="Path to a JSON array of cleaned Serenity posts")
    parser.add_argument("--window-start")
    parser.add_argument("--window-end")
    parser.add_argument("--source-handle", default="aleabitoreddit")
    parser.add_argument(
        "--no-window-update",
        action="store_true",
        help="Import posts without marking a collection window done.",
    )
    args = parser.parse_args(argv)

    init_db(str(TRADEMIND_DB))
    posts = json.loads(Path(args.batch).read_text())
    stats = import_posts(
        posts,
        window_start=args.window_start,
        window_end=args.window_end,
        source_handle=args.source_handle,
        update_window=not args.no_window_update,
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
