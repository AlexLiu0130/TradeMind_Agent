"""
Backfill Serenity ticker snapshots with historical post-date performance.

The script stores daily closes in `market_daily_prices`, then writes each
intel item's `ticker_snapshot` with:
  baseline/current/since_pct, dates, source, and the baseline rule used.
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable
from zoneinfo import ZoneInfo

from agent.config import TRADEMIND_DB
from agent.journal_store import _conn, init_db

PriceRow = dict[str, object]
PriceFetcher = Callable[[str, str, str], list[PriceRow]]
_ET = ZoneInfo("America/New_York")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _parse_item_date(value: str | None) -> date | None:
    dt = _parse_item_datetime(value)
    return dt.date() if dt else None


def _parse_item_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        try:
            return datetime.combine(date.fromisoformat(value[:10]), datetime.min.time(), timezone.utc)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def yahoo_symbol(symbol: str) -> str:
    return normalize_symbol(symbol).replace(".", "-")


def ensure_price_schema() -> None:
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS market_daily_prices (
              symbol              TEXT NOT NULL,
              price_date          TEXT NOT NULL,
              close               REAL NOT NULL,
              currency            TEXT,
              source              TEXT NOT NULL,
              fetched_at          TEXT NOT NULL,
              PRIMARY KEY(symbol, price_date, source)
            );
            CREATE INDEX IF NOT EXISTS market_daily_prices_symbol_date
              ON market_daily_prices(symbol, price_date);
            """
        )


def fetch_yahoo_daily(symbol: str, start_date: str, end_date: str) -> list[PriceRow]:
    """
    Fetch adjusted daily closes from Yahoo's chart endpoint.
    `end_date` is inclusive for callers; Yahoo period2 is exclusive.
    """
    start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    end = (datetime.fromisoformat(end_date) + timedelta(days=1)).replace(tzinfo=timezone.utc)
    params = urllib.parse.urlencode({
        "period1": int(start.timestamp()),
        "period2": int(end.timestamp()),
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    })
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(yahoo_symbol(symbol))}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "TradeMind/1.0"})
    with urllib.request.urlopen(req, timeout=20) as res:  # noqa: S310 - trusted finance endpoint.
        payload = json.loads(res.read().decode("utf-8"))

    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        return []
    currency = result.get("meta", {}).get("currency")
    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    adj = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or []
    closes = quote.get("close") or []
    rows: list[PriceRow] = []
    for i, ts in enumerate(timestamps):
        close = adj[i] if i < len(adj) and adj[i] is not None else closes[i] if i < len(closes) else None
        if close is None or not math.isfinite(float(close)) or float(close) <= 0:
            continue
        rows.append({
            "symbol": normalize_symbol(symbol),
            "price_date": datetime.fromtimestamp(int(ts), timezone.utc).date().isoformat(),
            "close": float(close),
            "currency": currency,
            "source": "yahoo-chart-adjclose",
        })
    return rows


def _store_prices(rows: Iterable[PriceRow]) -> None:
    fetched_at = _now()
    with _conn() as con:
        con.executemany(
            """
            INSERT INTO market_daily_prices
              (symbol, price_date, close, currency, source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, price_date, source) DO UPDATE SET
              close=excluded.close,
              currency=excluded.currency,
              fetched_at=excluded.fetched_at
            """,
            [
                (
                    normalize_symbol(str(row["symbol"])),
                    str(row["price_date"]),
                    float(row["close"]),
                    row.get("currency"),
                    str(row.get("source") or "unknown"),
                    fetched_at,
                )
                for row in rows
            ],
        )


def _load_prices(symbol: str, start_date: str, end_date: str) -> list[PriceRow]:
    with _conn() as con:
        rows = con.execute(
            """
            SELECT symbol, price_date, close, currency, source
            FROM market_daily_prices
            WHERE symbol=? AND price_date BETWEEN ? AND ?
            ORDER BY price_date
            """,
            (normalize_symbol(symbol), start_date, end_date),
        ).fetchall()
    return [dict(row) for row in rows]


def _baseline_cutoff_date(post_dt: datetime) -> date:
    et_dt = post_dt.astimezone(_ET)
    market_close = et_dt.replace(hour=16, minute=0, second=0, microsecond=0)
    return et_dt.date() if et_dt >= market_close else et_dt.date() - timedelta(days=1)


def _choose_baseline(rows: list[PriceRow], post_dt: datetime) -> tuple[PriceRow | None, str]:
    cutoff = _baseline_cutoff_date(post_dt)
    previous = [row for row in rows if date.fromisoformat(str(row["price_date"])) <= cutoff]
    if previous:
        return previous[-1], "previous_close"
    future = [row for row in rows if date.fromisoformat(str(row["price_date"])) > cutoff]
    return (future[0], "next_close") if future else (None, "unavailable")


def _needs_update(snapshot: dict, force: bool) -> bool:
    if force:
        return True
    return snapshot.get("baseline") is None or snapshot.get("current") is None or snapshot.get("since_pct") is None


def _load_items(limit: int | None) -> list[dict]:
    sql = """
        SELECT id, item_ts, related_tickers, ticker_snapshot
        FROM intel_items
        WHERE source='Serenity' OR source_handle='aleabitoreddit'
        ORDER BY COALESCE(item_ts, captured_at) ASC, id ASC
    """
    params: tuple = ()
    if limit:
        sql += " LIMIT ?"
        params = (limit,)
    with _conn() as con:
        return [dict(row) for row in con.execute(sql, params).fetchall()]


def backfill_prices(
    *,
    fetcher: PriceFetcher = fetch_yahoo_daily,
    limit: int | None = None,
    force: bool = False,
) -> dict:
    ensure_price_schema()
    items = _load_items(limit)
    symbol_dates: dict[str, list[date]] = defaultdict(list)
    parsed_items: list[dict] = []

    for item in items:
        post_dt = _parse_item_datetime(item.get("item_ts"))
        if not post_dt:
            continue
        post_date = post_dt.date()
        related = _safe_json(item.get("related_tickers"), [])
        snapshot = _safe_json(item.get("ticker_snapshot"), {})
        tickers = sorted({normalize_symbol(str(t)) for t in related if str(t).strip()} | set(snapshot))
        pending = []
        for ticker in tickers:
            ticker_snapshot = snapshot.get(ticker) if isinstance(snapshot, dict) else {}
            if _needs_update(ticker_snapshot if isinstance(ticker_snapshot, dict) else {}, force):
                pending.append(ticker)
                symbol_dates[ticker].append(post_date)
        if pending:
            parsed_items.append({"id": item["id"], "post_dt": post_dt, "post_date": post_date, "snapshot": snapshot, "tickers": pending})

    price_cache: dict[str, list[PriceRow]] = {}
    fetch_errors: dict[str, str] = {}
    today = date.today()
    for symbol, dates in symbol_dates.items():
        start = (min(dates) - timedelta(days=10)).isoformat()
        end = today.isoformat()
        try:
            fetched = fetcher(symbol, start, end)
            _store_prices(fetched)
        except Exception as exc:  # noqa: BLE001 - keep other symbols moving.
            fetch_errors[symbol] = str(exc)
        price_cache[symbol] = _load_prices(symbol, start, end)

    items_updated = 0
    tickers_updated = 0
    with _conn() as con:
        for item in parsed_items:
            snapshot = item["snapshot"] if isinstance(item["snapshot"], dict) else {}
            changed = False
            for ticker in item["tickers"]:
                rows = price_cache.get(ticker, [])
                baseline, rule = _choose_baseline(rows, item["post_dt"])
                current = rows[-1] if rows else None
                if not baseline or not current:
                    continue
                baseline_close = float(baseline["close"])
                current_close = float(current["close"])
                since_pct = ((current_close - baseline_close) / baseline_close) * 100
                snapshot[ticker] = {
                    **(snapshot.get(ticker) if isinstance(snapshot.get(ticker), dict) else {}),
                    "baseline": round(baseline_close, 4),
                    "baseline_date": str(baseline["price_date"]),
                    "baseline_rule": rule,
                    "current": round(current_close, 4),
                    "current_date": str(current["price_date"]),
                    "since_pct": round(since_pct, 2),
                    "source": str(current.get("source") or baseline.get("source") or "unknown"),
                }
                changed = True
                tickers_updated += 1
            if changed:
                con.execute(
                    "UPDATE intel_items SET ticker_snapshot=? WHERE id=?",
                    (json.dumps(snapshot, ensure_ascii=False), item["id"]),
                )
                items_updated += 1

    return {
        "items_scanned": len(items),
        "items_pending": len(parsed_items),
        "items_updated": items_updated,
        "tickers_updated": tickers_updated,
        "symbols_requested": len(symbol_dates),
        "fetch_errors": fetch_errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill Serenity post-date ticker performance.")
    parser.add_argument("--db", default=str(TRADEMIND_DB), help="TradeMind SQLite path")
    parser.add_argument("--limit", type=int, default=0, help="Limit scanned intel rows; 0 means all")
    parser.add_argument("--force", action="store_true", help="Recompute snapshots even if already populated")
    args = parser.parse_args()

    init_db(args.db)
    stats = backfill_prices(limit=args.limit or None, force=args.force)
    print(json.dumps(stats, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
