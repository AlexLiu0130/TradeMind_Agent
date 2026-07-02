from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any

from agent.config import _load_dotenv

TOOL_ID = "finnhub.calendar.earnings.retrieve.v1.0e57aadf"


def _execute(parameters: dict[str, Any]) -> dict[str, Any] | None:
    _load_dotenv()
    key = os.environ.get("QVERIS_API_KEY")
    if not key:
        return None
    base = os.environ.get("QVERIS_BASE_URL", "https://qveris.ai/api/v1").rstrip("/")
    body = json.dumps({"tool_id": TOOL_ID, "parameters": parameters}).encode()
    req = urllib.request.Request(
        f"{base}/tools/execute",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    if not payload.get("success"):
        return None
    data = payload.get("result", {}).get("data", {})
    return data if isinstance(data, dict) else None


def fetch_earnings(tickers: list[str], days: int = 45) -> list[dict[str, Any]] | None:
    today = date.today()
    end = today + timedelta(days=days)
    rows: list[dict[str, Any]] = []
    for ticker in sorted({t.strip().upper() for t in tickers if t.strip()}):
        data = _execute({"symbol": ticker, "from": today.isoformat(), "to": end.isoformat()})
        if data is None:
            return None
        for ev in data.get("earningsCalendar") or []:
            ev_date = ev.get("date")
            if not ev_date:
                continue
            try:
                days_until = (datetime.fromisoformat(ev_date).date() - today).days
            except ValueError:
                days_until = None
            rows.append(
                {
                    "symbol": ev.get("symbol") or ticker,
                    "date": ev_date,
                    "next_earnings_date": ev_date,
                    "days_until": days_until,
                    "raw": ev,
                }
            )
    return sorted(rows, key=lambda r: (r.get("date") or "", r.get("symbol") or ""))
