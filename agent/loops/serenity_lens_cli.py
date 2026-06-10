"""JSON stdin/stdout bridge for the Serenity Lens dashboard API."""
from __future__ import annotations

import json
import sys

from agent.config import TRADEMIND_DB
from agent.agents.serenity_lens import analyze
from agent.journal_store import init_db


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON on stdin"}))
        return 0

    query = str(payload.get("query") or payload.get("ticker") or "").strip()
    ticker = payload.get("ticker")
    ticker = str(ticker).strip().upper() if ticker else None
    limit = int(payload.get("limit") or 80)
    init_db(str(TRADEMIND_DB))
    result = analyze(query=query, ticker=ticker, limit=limit)
    print(json.dumps(result, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
