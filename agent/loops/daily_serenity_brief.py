"""
Daily Serenity brief ingestion.

First version is manual-first because the user currently has a free X account and
no official X API bearer token. It still writes every capture to SQLite through
the same append-only intel_items table used by the dashboard.

Examples:
  python3 -m agent.loops.daily_serenity_brief --text "HBM supply remains tight..."
  python3 -m agent.loops.daily_serenity_brief --file /tmp/serenity.txt --url https://x.com/...
  pbpaste | python3 -m agent.loops.daily_serenity_brief --stdin
"""
from __future__ import annotations

import argparse
import re
import sys

from agent.config import TRADEMIND_DB
from agent.journal_store import create_intel_item, init_db

WATCHLIST = {"NVDA", "AMD", "ARM", "MRVL", "MU", "NBIS", "DRAM", "AVGO", "TSM", "SMH", "QQQ", "AAOI", "INTC"}
PORTFOLIO = {"AMD", "ARM", "MRVL", "MU", "NBIS", "NOK", "DRAM"}

KEYWORDS = [
    (re.compile(r"\b(hbm|dram|memory|bandwidth)\b", re.I), {"MU", "DRAM", "NVDA", "AVGO"}, "memory / HBM bottleneck"),
    (re.compile(r"\b(blackwell|rubin|cuda|gpu|ai accelerator|ai chip)\b", re.I), {"NVDA", "AMD", "SMH"}, "AI accelerator roadmap"),
    (re.compile(r"\b(ethernet|switch|networking|optics|optical|dsp)\b", re.I), {"MRVL", "AVGO", "AAOI"}, "AI networking / optics supply chain"),
    (re.compile(r"\b(custom silicon|asic|xpu|hyperscaler)\b", re.I), {"AVGO", "MRVL", "NVDA", "AMD"}, "custom silicon / hyperscaler capex"),
    (re.compile(r"\b(export control|china|tariff|taiwan)\b", re.I), {"NVDA", "AMD", "MU", "SMH", "QQQ"}, "policy-sensitive semiconductor exposure"),
    (re.compile(r"\b(risc-v|arm)\b", re.I), {"ARM"}, "ARM / CPU ecosystem mention"),
]


def _uniq(values):
    return sorted(set(v.upper() for v in values if v))


def _summary(text: str) -> str:
    cleaned = " ".join(text.split())
    return cleaned if len(cleaned) <= 180 else cleaned[:177] + "..."


def analyze(text: str) -> dict:
    explicit = [m.group(1) for m in re.finditer(r"\$?\b([A-Z]{2,5})\b", text) if m.group(1) in WATCHLIST]
    mapped = []
    reasons = []
    for pattern, tickers, reason in KEYWORDS:
        if pattern.search(text):
            mapped.extend(tickers)
            reasons.append(reason)
    related = _uniq([*explicit, *mapped])
    overlap = [t for t in related if t in PORTFOLIO]
    lower = text.lower()
    bearish = bool(re.search(r"\b(shortage|delay|risk|ban|cut|weak|miss|down|problem|constraint)\b", lower))
    bullish = bool(re.search(r"\b(upside|beat|strong|growth|demand|accelerat|breakout|tight|bottleneck)\b", lower))
    urgency = "alert" if len(overlap) >= 2 or re.search(r"\b(alert|urgent|breaking|major)\b", text, re.I) else "watch" if overlap or related else "low"
    return {
        "summary": _summary(text),
        "related_tickers": related,
        "portfolio_overlap": overlap,
        "impact_direction": "bullish" if bullish and not bearish else "bearish" if bearish and not bullish else "uncertain",
        "urgency": urgency,
        "rationale": f"Matched {', '.join(_uniq(reasons))}." if reasons else "Matched explicit ticker mentions." if related else "No configured ticker or supply-chain keyword matched yet.",
    }


def read_text(args) -> str:
    if args.text:
        return args.text
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            return f.read()
    if args.stdin:
        return sys.stdin.read()
    raise SystemExit("Provide --text, --file, or --stdin. Browser/X automatic capture is not enabled without a provider.")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--text")
    p.add_argument("--file")
    p.add_argument("--stdin", action="store_true")
    p.add_argument("--url")
    p.add_argument("--source", default="Serenity")
    p.add_argument("--source-handle", default="aleabitoreddit")
    args = p.parse_args(argv)

    text = read_text(args).strip()
    if not text:
        raise SystemExit("No text captured; nothing was written.")
    analysis = analyze(text)

    init_db(str(TRADEMIND_DB))
    item_id = create_intel_item(
        source=args.source,
        source_handle=args.source_handle.lstrip("@"),
        capture_method="daily_loop",
        raw_text=text,
        url=args.url,
        summary=analysis["summary"],
        related_tickers=analysis["related_tickers"],
        portfolio_overlap=analysis["portfolio_overlap"],
        impact_direction=analysis["impact_direction"],
        urgency=analysis["urgency"],
        rationale=analysis["rationale"],
        raw_payload={"submitted_from": "daily_serenity_brief"},
    )
    print(f"saved intel_item {item_id}: {analysis['urgency']} {', '.join(analysis['related_tickers']) or 'no tickers'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
