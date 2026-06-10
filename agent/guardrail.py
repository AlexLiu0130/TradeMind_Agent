"""
Safety guardrail — pre-trade checks before any order can be staged.

Levels:
  1. Read-only analysis → always pass through (not handled here).
  2. Suggestions/alerts → always pass through.
  3. Stage an order → must pass ALL checks below.
  4. Execute → user must explicitly confirm (trade.py double gate).

check_trade() implements level 3.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor

from agent.journal_store import all_rules, list_decisions, list_theses
from agent.tools import run_script

_ET = ZoneInfo("America/New_York")


def _safe_int(rules: dict, key: str, default: int) -> int:
    try:
        return int(rules.get(key) or default)
    except (TypeError, ValueError):
        return default


def _safe_float(rules: dict, key: str, default: float) -> float:
    try:
        return float(rules.get(key) or default)
    except (TypeError, ValueError):
        return default


# ── public API ────────────────────────────────────────────────────────────────

def check_trade(
    ticker: str,
    structure: str,
    direction: str,
) -> dict:
    """
    Run all pre-trade checks. Returns:
    {
        "passed": bool,
        "issues": [str],          # blocking problems
        "checks": [check_dict],   # all checks with explicit conclusions
        "requires_confirmation": True,  # always True
    }
    """
    rules = all_rules()
    tasks = [
        ("iv_environment", lambda: _check_iv(ticker, direction)),
        ("earnings_window", lambda: _check_earnings(ticker, rules)),
        ("portfolio_greeks", lambda: _check_greeks(direction)),
        ("concentration", lambda: _check_concentration(ticker, rules)),
        ("roll_limit", lambda: _check_roll_limit(ticker, rules)),
        ("daily_trade_limit", lambda: _check_daily_trades(rules)),
        ("fomo_flag", lambda: _check_fomo(ticker)),
    ]
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        checks = [future.result() for future in [pool.submit(fn) for _, fn in tasks]]

    issues = [c["conclusion"] for c in checks if c.get("blocking")]

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "checks": checks,
        "requires_confirmation": True,
    }


# ── individual checks ─────────────────────────────────────────────────────────

def _check_iv(ticker: str, direction: str) -> dict:
    data = run_script("options_analyzer.py", ticker, "--iv-context", "--outlook", "neutral")
    iv_ratio = None
    conclusion = "IV environment: unknown (IBKR unavailable) — cannot safely stage trade"
    blocking = True

    if isinstance(data, dict):
        blocking = False
        iv_env = data.get("iv_environment") or data.get("iv_context", {})
        iv_ratio = iv_env.get("iv_ratio") or iv_env.get("iv_percentile_ratio")
        if iv_ratio is not None:
            if direction == "sell" and iv_ratio < 0.4:
                conclusion = f"IV environment: LOW (ratio {iv_ratio:.2f}) — selling premium in low-IV is unfavorable"
                blocking = True
            elif direction == "buy" and iv_ratio > 0.7:
                conclusion = f"IV environment: HIGH (ratio {iv_ratio:.2f}) — buying premium in high-IV is expensive"
                blocking = True
            else:
                conclusion = f"IV environment: OK (ratio {iv_ratio:.2f})"
        else:
            conclusion = "IV environment: unknown (missing IV ratio) — cannot safely stage trade"
            blocking = True

    return {"name": "iv_environment", "iv_ratio": iv_ratio, "conclusion": conclusion, "blocking": blocking}


def _check_earnings(ticker: str, rules: dict) -> dict:
    block_days = _safe_int(rules, "block_earnings_within_days", 2)
    data = run_script("earnings_calendar.py", ticker, "--days", str(block_days))
    blocking = data is None
    conclusion = f"Earnings: none within {block_days} days"
    if data is None:
        conclusion = f"Earnings: unknown (calendar unavailable) — cannot safely stage trade"

    if isinstance(data, list) and data:
        nearest = data[0]
        date_str = nearest.get("date", "unknown")
        conclusion = f"Earnings: {ticker} reports on {date_str} — within {block_days}-day window, IV crush risk"
        blocking = True
    elif isinstance(data, dict) and data.get("earnings"):
        date_str = data["earnings"][0].get("date", "unknown")
        conclusion = f"Earnings: {ticker} reports on {date_str} — IV crush risk"
        blocking = True

    return {"name": "earnings_window", "block_days": block_days, "conclusion": conclusion, "blocking": blocking}


def _check_greeks(direction: str) -> dict:
    data = run_script("portfolio_positions.py")
    net_delta = None
    conclusion = "Portfolio Greeks: unknown (IBKR unavailable) — cannot safely stage trade"
    blocking = True

    if isinstance(data, dict):
        blocking = False
        greeks = data.get("portfolio_greeks", {})
        net_delta = greeks.get("net_delta")
        if net_delta is not None:
            if direction == "sell" and net_delta < -2000:
                conclusion = f"Portfolio Greeks: net delta {net_delta:+.0f} — already heavily short, adding more short increases risk"
                blocking = True
            elif direction == "buy" and net_delta > 2000:
                conclusion = f"Portfolio Greeks: net delta {net_delta:+.0f} — already heavily long delta"
                blocking = True
            else:
                conclusion = f"Portfolio Greeks: net delta {net_delta:+.0f} — within acceptable range"
        else:
            conclusion = "Portfolio Greeks: unknown (missing net delta) — cannot safely stage trade"
            blocking = True

    return {"name": "portfolio_greeks", "net_delta": net_delta, "conclusion": conclusion, "blocking": blocking}


def _check_concentration(ticker: str, rules: dict) -> dict:
    max_pct = _safe_float(rules, "max_single_pct", 30)
    data = run_script("concentration.py")
    blocking = True
    ticker_pct = None
    conclusion = f"Concentration: {ticker} data unavailable — cannot safely stage trade"

    if isinstance(data, dict):
        blocking = False
        for h in data.get("top_holdings", []):
            if h.get("symbol", "").upper() == ticker.upper():
                ticker_pct = h.get("pct_of_portfolio")
                break
        if ticker_pct is not None:
            if ticker_pct >= max_pct:
                conclusion = (
                    f"Concentration: {ticker} is {ticker_pct:.1f}% of portfolio "
                    f"(limit {max_pct:.0f}%) — exceeds single-name limit"
                )
                blocking = True
            else:
                conclusion = (
                    f"Concentration: {ticker} is {ticker_pct:.1f}% of portfolio "
                    f"(limit {max_pct:.0f}%) — OK"
                )
        else:
            if ticker_pct is None:
                conclusion = f"Concentration: {ticker} not found in concentration report — OK"
                blocking = False

    return {
        "name": "concentration",
        "ticker_pct": ticker_pct,
        "max_pct": max_pct,
        "conclusion": conclusion,
        "blocking": blocking,
    }


def _check_roll_limit(ticker: str, rules: dict) -> dict:
    max_rolls = _safe_int(rules, "max_rolls", 2)
    # Count decisions logged as roll suggestions that were taken for this ticker
    theses = list_theses(ticker=ticker, status="open")
    roll_count = 0
    for t in theses:
        decisions = list_decisions(thesis_id=t["id"])
        roll_count += sum(
            1 for d in decisions
            if "roll" in (d.get("recommendation") or "").lower()
            and d.get("user_action") == "taken"
        )

    blocking = roll_count >= max_rolls
    if blocking:
        conclusion = (
            f"Roll limit: {ticker} has been rolled {roll_count} time(s) "
            f"(limit {max_rolls}) — stop rolling, close or accept assignment"
        )
    else:
        conclusion = f"Roll limit: {ticker} rolled {roll_count}/{max_rolls} — OK"

    return {"name": "roll_limit", "roll_count": roll_count, "max_rolls": max_rolls, "conclusion": conclusion, "blocking": blocking}


def _check_daily_trades(rules: dict) -> dict:
    max_per_day = _safe_int(rules, "max_trades_per_day", 3)
    # Use ET date so daily limit resets at ET midnight, not UTC midnight (CLAUDE.md constraint)
    et_today = datetime.now(_ET).date()
    since_utc = (
        datetime.combine(et_today, datetime.min.time(), _ET)
        .astimezone(timezone.utc)
        .isoformat()
    )
    decisions_today = list_decisions(since=since_utc)
    taken_today = sum(1 for d in decisions_today if d.get("user_action") == "taken")

    blocking = taken_today >= max_per_day
    if blocking:
        conclusion = (
            f"Daily trade limit: {taken_today} trades taken today "
            f"(limit {max_per_day}) — stop trading for today"
        )
    else:
        conclusion = f"Daily trade limit: {taken_today}/{max_per_day} today — OK"

    return {
        "name": "daily_trade_limit",
        "taken_today": taken_today,
        "max_per_day": max_per_day,
        "conclusion": conclusion,
        "blocking": blocking,
    }


def _check_fomo(ticker: str) -> dict:
    """
    FOMO flag: warn if ticker has moved significantly today without an open thesis
    that has exit conditions defined.
    """
    quote = run_script("market_quote.py", ticker)
    blocking = True
    conclusion = f"FOMO check: {ticker} — quote unavailable, cannot safely stage trade"

    if isinstance(quote, dict) or (isinstance(quote, list) and quote):
        blocking = False
        q = quote[0] if isinstance(quote, list) else quote
        change_pct = q.get("change_pct") or q.get("pct_change") or 0
        try:
            change_pct = float(change_pct)
        except (TypeError, ValueError):
            change_pct = 0

        theses = list_theses(ticker=ticker, status="open")
        has_exit = any(t.get("exit_conditions") for t in theses)

        if abs(change_pct) >= 3.0 and not has_exit:
            conclusion = (
                f"FOMO flag: {ticker} moved {change_pct:+.1f}% today with no exit conditions defined "
                "— potential FOMO trade, add thesis with exit plan first"
            )
            blocking = True
        else:
            conclusion = f"FOMO check: {ticker} {change_pct:+.1f}% today — OK"

    return {"name": "fomo_flag", "conclusion": conclusion, "blocking": blocking}
