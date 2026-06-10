"""
Daily Review — runs after market close, saves snapshot, sends summary.

Cron example (ET 16:30 = ~UTC 20:30 standard, 21:30 summer):
  30 20 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.daily_review
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from agent.config import TRADEMIND_DB
from agent.journal_store import (
    init_db,
    list_theses,
    log_decision,
    save_snapshot,
    should_fire,
)
from agent.tools import run_script

_ET = ZoneInfo("America/New_York")


def _notify(message: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if token and chat_id:
        import urllib.request
        payload = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            print(f"[notify] Telegram send failed: {e}", file=sys.stderr)
    else:
        print(message)


def _extract_greeks(positions_data: dict | None) -> tuple[float, float]:
    """Return (net_delta, net_vega) from portfolio_positions output."""
    if not isinstance(positions_data, dict):
        return 0.0, 0.0
    greeks = positions_data.get("portfolio_greeks", {})
    try:
        nd = float(greeks.get("net_delta") or 0)
        nv = float(greeks.get("net_vega") or 0)
        return nd, nv
    except (TypeError, ValueError):
        return 0.0, 0.0


def _extract_pnl(pnl_data: dict | None) -> float:
    if not isinstance(pnl_data, dict):
        return 0.0
    try:
        return float(pnl_data.get("total_realized_pnl") or 0)
    except (TypeError, ValueError):
        return 0.0


def _detect_falsified_theses(open_theses: list, dashboard) -> list[str]:
    """
    Basic heuristic: if a thesis has exit_conditions text and status_dashboard
    shows the position is deeply ITM (itm=True), flag it as potentially falsified.
    """
    flagged = []
    if not isinstance(dashboard, dict):
        return flagged
    positions = dashboard.get("positions", [])
    for thesis in open_theses:
        if not thesis.get("exit_conditions"):
            continue
        ticker = thesis["ticker"]

        def _underlying(p):
            # OPT symbols are like "AAPL  240119P00150000"; extract root via underlying field or split
            if p.get("sec_type") == "OPT":
                return p.get("underlying") or p.get("und_symbol") or p.get("symbol", "").split()[0]
            return p.get("symbol") or p.get("ticker", "")

        matching = [p for p in positions if _underlying(p) == ticker]
        for pos in matching:
            if pos.get("itm") is True and pos.get("sec_type") == "OPT":
                flagged.append(
                    f"⚠️ {ticker}: 假设可能失效 — short option 已 ITM (exit: {thesis['exit_conditions'][:60]}…)"
                )
                log_decision(
                    thesis_id=thesis["id"],
                    agent="daily_review",
                    recommendation=f"Position ITM — review thesis validity. Exit conditions: {thesis['exit_conditions']}",
                )
    return flagged


def main() -> None:
    init_db(str(TRADEMIND_DB))

    if not should_fire("daily_review", cooldown_minutes=12 * 60):
        print("[daily_review] already fired within cooldown, skipping")
        return

    pnl_data = run_script("pnl_analytics.py", "--days", "1", "--by", "symbol")
    positions_data = run_script("portfolio_positions.py")
    dashboard = run_script("status_dashboard.py")
    open_theses = list_theses(status="open")

    net_delta, net_vega = _extract_greeks(positions_data)
    realized_pnl = _extract_pnl(pnl_data)

    save_snapshot(
        positions_json=positions_data,
        net_delta=net_delta,
        net_vega=net_vega,
        realized_pnl=realized_pnl,
    )

    falsified = _detect_falsified_theses(open_theses, dashboard)

    now_et = datetime.now(_ET).strftime("%Y-%m-%d")
    lines = [f"📊 *日报* — {now_et}", ""]
    lines.append(f"💰 今日实现 P&L: ${realized_pnl:+.2f}")
    lines.append(f"📐 净 delta: {net_delta:+.0f}  净 vega: {net_vega:+.0f}")
    lines.append(f"📌 未平假设: {len(open_theses)} 个")
    if falsified:
        lines.append("")
        lines.append("⚠️ *需关注*")
        lines.extend(falsified)
    lines.append("")
    lines.append("✅ 快照已落库")

    _notify("\n".join(lines))
    print(f"[daily_review] done — PnL {realized_pnl:+.2f}, {len(falsified)} flagged")


if __name__ == "__main__":
    main()
