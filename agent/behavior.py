"""
Behavior profile — aggregated from decisions + snapshots + trades table.
P3: adds win-rate analysis by symbol, holding period, and time-of-day.
"""
import json
from collections import defaultdict
from datetime import datetime

from agent.journal_store import _conn, all_rules, list_decisions, list_snapshots


def profile() -> dict:
    """Return behavioral metrics aggregated from all data sources."""
    decisions = list_decisions()
    snapshots = list_snapshots()
    rules = all_rules()
    trades = _load_trades()

    return {
        "confidence_calibration": _confidence_calibration(decisions),
        "roll_discipline": _roll_discipline(decisions, rules),
        "overtrading": _overtrading(decisions, rules),
        "snapshot_count": len(snapshots),
        # P3 additions
        "win_rate_by_symbol": _win_rate_by_symbol(trades),
        "win_rate_by_holding_period": _win_rate_by_holding_period(trades),
        "win_rate_by_time_of_day": _win_rate_by_time_of_day(trades),
    }


# ── data loader ────────────────────────────────────────────────────────────────

def _load_trades() -> list[dict]:
    try:
        with _conn() as con:
            rows = con.execute(
                "SELECT * FROM trades ORDER BY underlying, trade_date, trade_time"
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


# ── P3 analysis helpers ────────────────────────────────────────────────────────

def _match_round_trips(trades: list[dict]) -> list[dict]:
    """
    Match BUY executions against subsequent SELL executions per symbol
    to compute realized P&L per round trip.
    Returns list of {symbol, open_date, close_date, holding_days, pnl, asset_category, open_hour}.
    """
    # Group by underlying + asset_category
    by_sym: dict[tuple, list] = defaultdict(list)
    for t in trades:
        key = (t["underlying"], t["asset_category"])
        by_sym[key].append(t)

    round_trips = []
    for key, sym_trades in by_sym.items():
        underlying, asset_cat = key
        # Simple FIFO queue
        inventory: list[dict] = []  # list of {qty, price, date, time, commission}
        for t in sym_trades:
            qty = abs(t["quantity"])
            price = t["trade_price"]
            commission = abs(t.get("commission") or 0)
            date = t["trade_date"]
            hour = int((t.get("trade_time") or "00:00:00")[:2])
            direction = t["buy_sell"]

            if direction == "BUY":
                inventory.append({
                    "qty": qty, "price": price,
                    "date": date, "hour": hour,
                    "commission": commission / qty if qty else 0,
                })
            elif direction == "SELL" and inventory:
                remaining_sell = qty
                while remaining_sell > 0 and inventory:
                    lot = inventory[0]
                    matched = min(lot["qty"], remaining_sell)
                    multiplier = t.get("multiplier") or 1
                    pnl = (price - lot["price"]) * matched * multiplier
                    pnl -= (commission / qty + lot["commission"]) * matched

                    # holding days
                    try:
                        d0 = datetime.strptime(lot["date"], "%Y-%m-%d")
                        d1 = datetime.strptime(date, "%Y-%m-%d")
                        holding_days = (d1 - d0).days
                    except ValueError:
                        holding_days = 0

                    round_trips.append({
                        "symbol": underlying,
                        "asset_category": asset_cat,
                        "open_date": lot["date"],
                        "close_date": date,
                        "holding_days": holding_days,
                        "open_hour": lot["hour"],
                        "pnl": round(pnl, 2),
                        "profitable": pnl > 0,
                    })

                    lot["qty"] -= matched
                    remaining_sell -= matched
                    if lot["qty"] <= 0:
                        inventory.pop(0)

    return round_trips


def _win_rate_by_symbol(trades: list[dict]) -> dict:
    if not trades:
        return {}
    trips = _match_round_trips(trades)
    if not trips:
        return {}

    by_sym: dict[str, list] = defaultdict(list)
    for t in trips:
        by_sym[t["symbol"]].append(t)

    result = {}
    for sym, ts in sorted(by_sym.items()):
        wins = sum(1 for t in ts if t["profitable"])
        total_pnl = sum(t["pnl"] for t in ts)
        result[sym] = {
            "trades": len(ts),
            "wins": wins,
            "win_rate": round(wins / len(ts), 3),
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(total_pnl / len(ts), 2),
        }
    return result


def _win_rate_by_holding_period(trades: list[dict]) -> dict:
    trips = _match_round_trips(trades)
    if not trips:
        return {}

    def bucket(days: int) -> str:
        if days == 0:
            return "intraday"
        if days <= 3:
            return "1-3d"
        if days <= 10:
            return "4-10d"
        return "10d+"

    by_bucket: dict[str, list] = defaultdict(list)
    for t in trips:
        by_bucket[bucket(t["holding_days"])].append(t)

    order = ["intraday", "1-3d", "4-10d", "10d+"]
    return {
        b: {
            "trades": len(ts),
            "win_rate": round(sum(1 for t in ts if t["profitable"]) / len(ts), 3),
            "avg_pnl": round(sum(t["pnl"] for t in ts) / len(ts), 2),
        }
        for b in order
        if (ts := by_bucket.get(b))
    }


def _win_rate_by_time_of_day(trades: list[dict]) -> dict:
    trips = _match_round_trips(trades)
    if not trips:
        return {}

    def bucket(hour: int) -> str:
        if hour < 10:
            return "open(9:30-10)"
        if hour < 12:
            return "morning(10-12)"
        if hour < 14:
            return "midday(12-14)"
        return "afternoon(14+)"

    by_bucket: dict[str, list] = defaultdict(list)
    for t in trips:
        by_bucket[bucket(t["open_hour"])].append(t)

    return {
        b: {
            "trades": len(ts),
            "win_rate": round(sum(1 for t in ts if t["profitable"]) / len(ts), 3),
            "avg_pnl": round(sum(t["pnl"] for t in ts) / len(ts), 2),
        }
        for b, ts in sorted(by_bucket.items())
    }


# ── P0 helpers (unchanged) ─────────────────────────────────────────────────────

def _confidence_calibration(decisions: list) -> dict:
    rated = []
    for d in decisions:
        if not d.get("outcome"):
            continue
        try:
            rec = json.loads(d["recommendation"]) if isinstance(d["recommendation"], str) else d["recommendation"]
            conf = rec.get("confidence") if isinstance(rec, dict) else None
        except (json.JSONDecodeError, AttributeError):
            conf = None
        if conf is None:
            continue
        profitable = "profit" in (d.get("outcome") or "").lower() or "win" in (d.get("outcome") or "").lower()
        rated.append({"confidence": conf, "profitable": profitable})

    if not rated:
        return {"note": "insufficient data"}

    by_conf: dict[int, list] = {}
    for r in rated:
        by_conf.setdefault(r["confidence"], []).append(r["profitable"])

    return {
        str(k): {"trades": len(v), "win_rate": sum(v) / len(v)}
        for k, v in sorted(by_conf.items())
    }


def _roll_discipline(decisions: list, rules: dict) -> dict:
    try:
        max_rolls = int(rules.get("max_rolls") or 2)
    except (TypeError, ValueError):
        max_rolls = 2
    roll_decisions = [d for d in decisions if "roll" in (d.get("recommendation") or "").lower()]
    taken = sum(1 for d in roll_decisions if d.get("user_action") == "taken")
    return {
        "max_rolls_rule": max_rolls,
        "roll_decisions_logged": len(roll_decisions),
        "rolls_taken": taken,
    }


def _overtrading(decisions: list, rules: dict) -> dict:
    try:
        max_per_day = int(rules.get("max_trades_per_day") or 3)
    except (TypeError, ValueError):
        max_per_day = 3
    by_date: dict[str, int] = {}
    for d in decisions:
        day = (d.get("ts") or "")[:10]
        if d.get("user_action") == "taken":
            by_date[day] = by_date.get(day, 0) + 1
    over_days = [day for day, count in by_date.items() if count > max_per_day]
    return {
        "max_trades_per_day_rule": max_per_day,
        "days_over_limit": len(over_days),
        "over_limit_dates": over_days,
    }
