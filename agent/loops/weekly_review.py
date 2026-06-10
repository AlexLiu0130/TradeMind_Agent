"""
Weekly Review — runs Saturday, sends behavioral insights report.

Cron example (Saturday ET 08:00):
  0 12 * * 6  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.weekly_review
"""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from agent.behavior import profile
from agent.config import TRADEMIND_DB
from agent.journal_store import init_db, should_fire

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


def _format_profile(p: dict) -> str:
    now_et = datetime.now(_ET).strftime("%Y-%m-%d")
    lines = [f"🧠 *周度行为复盘* — {now_et}", ""]

    # Confidence calibration
    calib = p.get("confidence_calibration", {})
    if isinstance(calib, dict) and "note" not in calib:
        lines.append("📊 *信心校准*")
        for conf_level, stats in sorted(calib.items()):
            trades = stats.get("trades", 0)
            wr = stats.get("win_rate", 0)
            lines.append(f"  信心 {conf_level}/5: {trades} 笔, 胜率 {wr:.0%}")
        lines.append("")
    else:
        lines.append("📊 *信心校准*: 数据不足\n")

    # Roll discipline
    roll = p.get("roll_discipline", {})
    if roll:
        max_r = roll.get("max_rolls_rule", "?")
        logged = roll.get("roll_decisions_logged", 0)
        taken = roll.get("rolls_taken", 0)
        try:
            icon = "✅" if taken < int(max_r) else "⚠️"
        except (TypeError, ValueError):
            icon = "ℹ️"
        lines.append(f"🔄 *Roll 纪律* {icon}")
        lines.append(f"  规则: 最多 roll {max_r} 次 | 实际: {logged} 次建议, {taken} 次执行")
        lines.append("")

    # Overtrading
    over = p.get("overtrading", {})
    if over:
        max_pd = over.get("max_trades_per_day_rule", "?")
        days_over = over.get("days_over_limit", 0)
        icon = "✅" if days_over == 0 else "⚠️"
        lines.append(f"📈 *过度交易* {icon}")
        lines.append(f"  规则: 每日 ≤{max_pd} 笔 | 超限天数: {days_over}")
        if over.get("over_limit_dates"):
            lines.append(f"  超限日期: {', '.join(over['over_limit_dates'][:5])}")
        lines.append("")

    snap_count = p.get("snapshot_count", 0)
    lines.append(f"📁 历史快照: {snap_count} 条")

    return "\n".join(lines)


def main() -> None:
    init_db(str(TRADEMIND_DB))

    if not should_fire("weekly_review", cooldown_minutes=6 * 24 * 60):
        print("[weekly_review] already fired within cooldown, skipping")
        return

    p = profile()
    message = _format_profile(p)
    _notify(message)
    print("[weekly_review] sent")


if __name__ == "__main__":
    main()
