"""
Premarket Brief — runs before market open, sends daily focus summary via Telegram.

Cron example (ET 09:00 = ~UTC 13:00 standard, 14:00 summer):
  0 13 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.premarket_brief
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from agent.config import TRADEMIND_DB
from agent.journal_store import init_db, list_theses, should_fire
from agent.tools import run_script

_ET = ZoneInfo("America/New_York")
_COOLDOWN_HOURS = 12


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


def _format_brief(daily, dashboard, earnings, open_theses: list) -> str:
    now_et = datetime.now(_ET).strftime("%Y-%m-%d %H:%M ET")
    lines = [f"📋 *盘前简报* — {now_et}", ""]

    # Today's key events from earnings
    if earnings and isinstance(earnings, list):
        lines.append("📅 *今日财报/关键事件*")
        for e in earnings[:5]:
            sym = e.get("symbol") or e.get("ticker", "?")
            date = e.get("date", "?")
            lines.append(f"  • {sym} — {date}")
        lines.append("")

    # Open theses status
    if open_theses:
        lines.append(f"📌 *未平持仓假设* ({len(open_theses)} 个)")
        for t in open_theses[:5]:
            ticker = t.get("ticker", "?")
            structure = t.get("structure", "")
            confidence = t.get("confidence", "?")
            lines.append(f"  • {ticker} {structure} (信心: {confidence}/5)")
        lines.append("")

    # Portfolio snapshot
    if dashboard and isinstance(dashboard, dict):
        summary = dashboard.get("summary") or dashboard
        net_delta = summary.get("net_delta") if isinstance(summary, dict) else None
        if net_delta is not None:
            lines.append(f"📊 *组合状态*: net delta {net_delta:+.0f}")
        assignments = dashboard.get("assignments_this_week", [])
        if assignments:
            lines.append(f"⚠️ 本周到期风险: {', '.join(str(a) for a in assignments[:3])}")
        lines.append("")

    # 3 things to watch today
    lines.append("🎯 *今日关注*")
    count = 0
    if open_theses and count < 3:
        lines.append(f"  1. 检查持仓 {open_theses[0]['ticker']} 的 IV 和 theta 消耗")
        count += 1
    if earnings and isinstance(earnings, list) and earnings and count < 3:
        lines.append(f"  {count + 1}. {earnings[0].get('symbol', '?')} 财报日，注意 IV crush")
        count += 1
    if count < 3:
        lines.append(f"  {count + 1}. 确认组合净 delta 在可接受范围")

    return "\n".join(lines)


def main() -> None:
    init_db(str(TRADEMIND_DB))

    if not should_fire("premarket_brief", cooldown_minutes=_COOLDOWN_HOURS * 60):
        print("[premarket_brief] already fired within cooldown, skipping")
        return

    daily = run_script("options_daily.py")
    dashboard = run_script("status_dashboard.py")
    earnings = run_script("earnings_calendar.py", "--days", "1")
    open_theses = list_theses(status="open")

    message = _format_brief(daily, dashboard, earnings, open_theses)
    _notify(message)
    print("[premarket_brief] sent")


if __name__ == "__main__":
    main()
