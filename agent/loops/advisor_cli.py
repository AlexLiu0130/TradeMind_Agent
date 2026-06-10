from __future__ import annotations

import json
import sys

from agent.agents.advisor import build_advice
from agent.config import TRADEMIND_DB
from agent.journal_store import init_db


def main() -> int:
    payload = {}
    raw = sys.stdin.read().strip()
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(json.dumps({"error": f"invalid json: {exc}"}, ensure_ascii=False))
            return 2

    init_db(str(TRADEMIND_DB))
    result = build_advice(
        dashboard=payload.get("dashboard"),
        intel_limit=int(payload.get("intel_limit", 120)),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
