"""
EOD GEX snapshot — run 3:50 PM ET before close to capture the day's gamma levels.

Saves to agent/db/gex/{TICKER}_eod.json (dashboard falls back to these when market closed).
Sends Telegram notification with key levels if configured.

Usage:
  python3 -m agent.loops.save_gex_snapshot           # default tickers from GEX_TICKERS env
  python3 -m agent.loops.save_gex_snapshot SPY QQQ   # explicit tickers

Cron example (3:50 PM ET = UTC 19:50 summer / 20:50 winter):
  50 19 * * 1-5  cd ~/Desktop/TradeMind_Agent-main && python3 -m agent.loops.save_gex_snapshot
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from agent.config import IBKR_SCRIPTS_DIR, _PROJECT_ROOT
from agent.tools import run_script

_ET = ZoneInfo("America/New_York")
_GEX_DIR = _PROJECT_ROOT / "agent" / "db" / "gex"


def _notify(msg: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat_id):
        print(msg)
        return
    import urllib.request
    payload = json.dumps({"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[notify] Telegram failed: {e}", file=sys.stderr)


def _format_summary(ticker: str, data: dict) -> str:
    env = data.get("gex_env", "?")
    env_emoji = "🟢" if env == "positive" else "🔴"
    spot = data.get("spot", "?")
    cw = data.get("call_wall", "?")
    pw = data.get("put_wall", "?")
    flip = data.get("gamma_flip")
    total = data.get("total_gex", 0)
    gex_str = f"{total/1e9:.2f}B" if abs(total) >= 1e9 else f"{total/1e6:.1f}M"
    flip_str = f"${flip}" if flip else "—"
    return (
        f"{env_emoji} *{ticker} EOD GEX* ({data.get('as_of','?')[:10]})\n"
        f"Spot ${spot} · Env: {env.upper()}\n"
        f"Call Wall ${cw} · Put Wall ${pw} · Flip {flip_str}\n"
        f"Total GEX: {gex_str}"
    )


def save_snapshot(ticker: str) -> bool:
    """Run gamma_exposure.py for ticker, persist to EOD file. Returns True on success."""
    _GEX_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _GEX_DIR / f"{ticker.upper()}_eod.json"

    print(f"[gex_snapshot] Fetching {ticker}...", file=sys.stderr)
    data = run_script(
        "gamma_exposure.py",
        ticker.upper(),
        "--dte-max", "45",
        "--strikes", "20",
        timeout=180,
        ttl=0,  # bypass cache — we always want fresh data at EOD
    )
    if data is None:
        print(f"[gex_snapshot] {ticker}: fetch failed", file=sys.stderr)
        return False

    # Stamp snapshot time in ET
    now_et = datetime.now(_ET)
    data["eod_snapshot"] = True
    data["snapshot_ts"] = now_et.strftime("%Y-%m-%d %H:%M ET")
    data["snapshot_date"] = now_et.strftime("%Y-%m-%d")

    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    tmp.rename(out_path)
    print(f"[gex_snapshot] {ticker}: saved → {out_path}", file=sys.stderr)
    return True


def main() -> None:
    tickers = sys.argv[1:] or os.environ.get("GEX_TICKERS", "SPY,QQQ").split(",")
    tickers = [t.strip().upper() for t in tickers if t.strip()]

    results: list[str] = []
    for ticker in tickers:
        ok = save_snapshot(ticker)
        if ok:
            path = _GEX_DIR / f"{ticker}_eod.json"
            try:
                data = json.loads(path.read_text())
                results.append(_format_summary(ticker, data))
            except Exception:
                results.append(f"✅ {ticker}: saved (format error)")
        else:
            results.append(f"⚠️ {ticker}: snapshot failed — check Gateway / market hours")

    if results:
        _notify("\n\n".join(results))


if __name__ == "__main__":
    main()
