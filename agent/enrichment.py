"""
enrichment.py — Import IBKR Flex XML trade history into local SQLite.

Usage:
  python3 -m agent.enrichment import /path/to/flex.xml
  python3 -m agent.enrichment stats
"""
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db, _conn


def _parse_date(v: str) -> str:
    """20260423 → 2026-04-23"""
    if not v or len(v) < 8:
        return v
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}"


def _parse_time(v: str) -> str:
    """20260423;101913 → 10:19:13"""
    if not v or ";" not in v:
        return ""
    t = v.split(";")[1]
    if len(t) == 6:
        return f"{t[:2]}:{t[2:4]}:{t[4:6]}"
    return t


def _parse_trade(elem) -> dict | None:
    a = elem.attrib
    asset = a.get("assetCategory", "")
    if asset not in ("STK", "OPT"):
        return None

    trade_id = a.get("tradeID", "")
    if not trade_id:
        return None

    dt_raw = a.get("dateTime", "")
    trade_date = _parse_date(a.get("tradeDate", dt_raw[:8] if dt_raw else ""))
    trade_time = _parse_time(dt_raw)

    return {
        "trade_id": trade_id,
        "order_id": a.get("ibOrderID", ""),
        "asset_category": asset,
        "symbol": a.get("symbol", ""),
        "underlying": a.get("underlyingSymbol") or a.get("symbol", ""),
        "put_call": a.get("putCall") or None,
        "strike": float(a["strike"]) if a.get("strike") else None,
        "expiry": _parse_date(a.get("expiry", "")),
        "multiplier": int(float(a.get("multiplier", 1))),
        "trade_date": trade_date,
        "trade_time": trade_time,
        "buy_sell": a.get("buySell", ""),
        "quantity": float(a.get("quantity", 0)),
        "trade_price": float(a.get("tradePrice", 0)),
        "proceeds": float(a.get("proceeds", 0)),
        "commission": float(a.get("ibCommission", 0)),
        "net_cash": float(a.get("netCash", 0)),
        "fifo_pnl": float(a.get("fifoPnlRealized", 0)),
        "mtm_pnl": float(a.get("mtmPnl", 0)),
        "notes": a.get("notes", ""),
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }


def import_flex(xml_path: str) -> dict:
    """Parse Flex XML and insert new trades into SQLite. Returns summary."""
    path = Path(xml_path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    tree = ET.parse(path)
    root = tree.getroot()

    trades = []
    for elem in root.iter("Trade"):
        t = _parse_trade(elem)
        if t:
            trades.append(t)

    if not trades:
        return {"parsed": 0, "inserted": 0, "skipped": 0}

    inserted = 0
    skipped = 0
    with _conn() as con:
        for t in trades:
            cur = con.execute(
                """
                INSERT OR IGNORE INTO trades
                  (trade_id, order_id, asset_category, symbol, underlying,
                   put_call, strike, expiry, multiplier, trade_date, trade_time,
                   buy_sell, quantity, trade_price, proceeds, commission,
                   net_cash, fifo_pnl, mtm_pnl, notes, imported_at)
                VALUES
                  (:trade_id,:order_id,:asset_category,:symbol,:underlying,
                   :put_call,:strike,:expiry,:multiplier,:trade_date,:trade_time,
                   :buy_sell,:quantity,:trade_price,:proceeds,:commission,
                   :net_cash,:fifo_pnl,:mtm_pnl,:notes,:imported_at)
                """,
                t,
            )
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1

    return {"parsed": len(trades), "inserted": inserted, "skipped": skipped}


def stats() -> dict:
    """Return summary stats from the trades table."""
    with _conn() as con:
        total = con.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
        stk = con.execute("SELECT COUNT(*) FROM trades WHERE asset_category='STK'").fetchone()[0]
        opt = con.execute("SELECT COUNT(*) FROM trades WHERE asset_category='OPT'").fetchone()[0]
        date_range = con.execute(
            "SELECT MIN(trade_date), MAX(trade_date) FROM trades"
        ).fetchone()
        symbols = con.execute(
            "SELECT COUNT(DISTINCT underlying) FROM trades"
        ).fetchone()[0]
    return {
        "total_trades": total,
        "stk_trades": stk,
        "opt_trades": opt,
        "date_from": date_range[0],
        "date_to": date_range[1],
        "unique_symbols": symbols,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 -m agent.enrichment import <file.xml>")
        print("       python3 -m agent.enrichment stats")
        sys.exit(1)

    init_db(str(TRADEMIND_DB))
    cmd = sys.argv[1]

    if cmd == "import":
        if len(sys.argv) < 3:
            print("Provide XML file path")
            sys.exit(1)
        result = import_flex(sys.argv[2])
        print(f"Parsed: {result['parsed']}  Inserted: {result['inserted']}  Skipped(dup): {result['skipped']}")

    elif cmd == "stats":
        s = stats()
        print(f"Total: {s['total_trades']}  STK: {s['stk_trades']}  OPT: {s['opt_trades']}")
        print(f"Period: {s['date_from']} → {s['date_to']}")
        print(f"Unique symbols: {s['unique_symbols']}")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
