"""
Intraday Monitor — checks for breaches and sends alerts. Run every N minutes via cron.

Cron example (every 15 min during market hours, ET 09:30-16:00 = UTC 13:30-20:00):
  */15 13-20 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.intraday_monitor
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db, should_fire
from agent.tools import run_script

_ET = ZoneInfo("America/New_York")

# Cooldown per alert type (minutes)
_COOLDOWNS = {
    "iv_breach": 120,
    "assignment_risk": 60,
    "delta_drift": 90,
    "concentration_breach": 240,
    "earnings_entering_dte": 360,
}

# Thresholds
_IV_BREACH_PCT = 80       # IV percentile above this → alert
_DELTA_DRIFT_ABS = 1500   # net delta beyond ±1500 → alert
_ASSIGNMENT_DTE = 3       # DTE ≤ this with high delta → assignment risk
_ASSIGNMENT_DELTA = 0.5   # absolute option delta above this → assignment risk


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


def _check_iv(dashboard) -> list[str]:
    alerts = []
    if not isinstance(dashboard, dict):
        return alerts
    positions = dashboard.get("positions", [])
    for pos in positions:
        if pos.get("sec_type") != "OPT":
            continue
        iv_pct = pos.get("iv_percentile") or pos.get("iv_pct")
        if iv_pct and float(iv_pct) > _IV_BREACH_PCT:
            ticker = pos.get("symbol") or pos.get("ticker", "?")
            key = f"iv_breach_{ticker}"
            if should_fire(key, _COOLDOWNS["iv_breach"]):
                alerts.append(
                    f"⚠️ *IV 越界*: {ticker} IV 百分位 {iv_pct:.0f}% > {_IV_BREACH_PCT}%"
                )
    return alerts


def _check_assignment_risk(dashboard) -> list[str]:
    alerts = []
    if not isinstance(dashboard, dict):
        return alerts
    for pos in dashboard.get("positions", []):
        if pos.get("sec_type") != "OPT":
            continue
        dte = pos.get("dte")
        delta = pos.get("delta")
        ticker = pos.get("symbol") or pos.get("ticker", "?")
        if dte is None or delta is None:
            continue
        try:
            dte_val = int(dte)
            delta_val = abs(float(delta))
        except (TypeError, ValueError):
            continue
        if dte_val <= _ASSIGNMENT_DTE and delta_val >= _ASSIGNMENT_DELTA:
            key = f"assignment_risk_{ticker}"
            if should_fire(key, _COOLDOWNS["assignment_risk"]):
                alerts.append(
                    f"🚨 *Assignment 风险*: {ticker} DTE={dte_val} delta={delta_val:.2f} — 临近到期深度 ITM"
                )
    return alerts


def _check_delta_drift(positions_data) -> list[str]:
    alerts = []
    if not isinstance(positions_data, dict):
        return alerts
    greeks = positions_data.get("portfolio_greeks", {})
    net_delta = greeks.get("net_delta")
    if net_delta is None:
        return alerts
    try:
        net_delta = float(net_delta)
    except (TypeError, ValueError):
        return alerts
    if abs(net_delta) > _DELTA_DRIFT_ABS:
        if should_fire("delta_drift", _COOLDOWNS["delta_drift"]):
            direction = "long" if net_delta > 0 else "short"
            alerts.append(
                f"📉 *Delta 漂移*: 净 delta {net_delta:+.0f} ({direction})，超过 ±{_DELTA_DRIFT_ABS} 阈值"
            )
    return alerts


def _check_concentration(concentration_data) -> list[str]:
    alerts = []
    if not isinstance(concentration_data, dict):
        return alerts
    for h in concentration_data.get("top_holdings", []):
        pct = h.get("pct_of_portfolio")
        sym = h.get("symbol", "?")
        if pct and float(pct) > 30:
            key = f"concentration_{sym}"
            if should_fire(key, _COOLDOWNS["concentration_breach"]):
                alerts.append(
                    f"⚠️ *集中度越界*: {sym} 占组合 {pct:.1f}% > 30%"
                )
    return alerts


def _check_earnings_entering_dte(dashboard) -> list[str]:
    alerts = []
    if not isinstance(dashboard, dict):
        return alerts
    for pos in dashboard.get("positions", []):
        if pos.get("sec_type") != "OPT":
            continue
        dte = pos.get("dte")
        has_earnings = pos.get("earnings_within_dte") or pos.get("upcoming_earnings")
        ticker = pos.get("symbol") or pos.get("ticker", "?")
        if dte is not None and has_earnings:
            key = f"earnings_dte_{ticker}"
            if should_fire(key, _COOLDOWNS["earnings_entering_dte"]):
                alerts.append(
                    f"📅 *财报进入 DTE*: {ticker} DTE={dte}，财报即将来临，注意 IV crush"
                )
    return alerts


def main() -> None:
    init_db(str(TRADEMIND_DB))

    dashboard = run_script("status_dashboard.py")
    positions_data = run_script("portfolio_positions.py")
    concentration_data = run_script("concentration.py")

    alerts: list[str] = []
    alerts.extend(_check_iv(dashboard))
    alerts.extend(_check_assignment_risk(dashboard))
    alerts.extend(_check_delta_drift(positions_data))
    alerts.extend(_check_concentration(concentration_data))
    alerts.extend(_check_earnings_entering_dte(dashboard))

    if alerts:
        now_et = datetime.now(_ET).strftime("%H:%M ET")
        message = f"🔔 *盘中监控* [{now_et}]\n\n" + "\n".join(alerts)
        _notify(message)
        print(f"[intraday_monitor] {len(alerts)} alert(s) sent")
    else:
        print("[intraday_monitor] no alerts")


if __name__ == "__main__":
    main()
