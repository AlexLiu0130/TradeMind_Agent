"""
Review Agent — compares thesis assumptions vs actual P&L, writes to decisions.
"""
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from agent.journal_store import get_thesis, list_decisions, log_decision

SCRIPTS_DIR = Path(
    os.environ.get("IBKR_SCRIPTS_DIR", "~/Desktop/ibkr-options-assistant/scripts")
).expanduser()


def _run(script: str, *args) -> dict | list | None:
    """Call an IBKR script and parse its stdout as JSON. Logs go to stderr (not captured)."""
    cmd = ["python3", str(SCRIPTS_DIR / script), *args]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def _pnl_for_ticker(ticker: str) -> dict | None:
    """Fetch P&L stats for ticker from pnl_analytics --by symbol."""
    data = _run("pnl_analytics.py", "--by", "symbol", "--days", "365")
    if not isinstance(data, dict):
        return None
    by_group: dict = data.get("by_group", {})
    stats = by_group.get(ticker)
    if not stats:
        # options symbols may carry the underlying root (e.g. "AAPL  240119P00200000")
        for key, val in by_group.items():
            if key.upper().startswith(ticker.upper()):
                stats = val
                break
    if not stats:
        return None
    return {
        "realized_pnl": stats.get("total_realized_pnl", 0),
        "trade_count": stats.get("trades", 0),
        "win_rate": stats.get("win_rate") or 0,
    }


def _wheel_status(ticker: str) -> dict | None:
    """Fetch wheel summary for ticker from wheel_tracker summary."""
    data = _run("wheel_tracker.py", "summary")
    if not isinstance(data, dict):
        return None
    for wheel in data.get("wheels", []):
        if wheel.get("symbol", "").upper() == ticker.upper():
            return wheel
    return None


def _cost_basis(ticker: str) -> dict | None:
    """Fetch premium-adjusted cost basis for ticker."""
    data = _run("cost_basis.py", ticker)
    if not isinstance(data, dict):
        return None
    for report in data.get("symbols", []):
        if report.get("symbol", "").upper() == ticker.upper():
            return report
    return None


# ── public API ────────────────────────────────────────────────────────────────

def review_thesis(thesis_id: int) -> dict:
    """
    Pull live P&L data for a thesis's ticker, compare against recorded assumptions,
    produce an attribution report, and log it as a decision.
    """
    thesis = get_thesis(thesis_id)
    if not thesis:
        return {"error": f"Thesis {thesis_id} not found"}

    ticker = thesis["ticker"]
    pnl = _pnl_for_ticker(ticker)
    wheel = _wheel_status(ticker)
    basis = _cost_basis(ticker)
    prior_decisions = list_decisions(thesis_id=thesis_id)

    report = _build_report(thesis, pnl, wheel, basis, prior_decisions)
    log_decision(
        thesis_id=thesis_id,
        agent="review",
        recommendation=json.dumps(report, ensure_ascii=False),
    )
    return report


def _build_report(thesis: dict, pnl, wheel, basis, prior_decisions: list) -> dict:
    thesis_accuracy = _assess_thesis_accuracy(thesis, pnl)
    execution = _assess_execution(thesis, prior_decisions)
    attribution = _pnl_attribution(pnl, basis)
    lesson = _synthesize_lesson(thesis, accuracy=thesis_accuracy, execution=execution)

    return {
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "thesis_id": thesis["id"],
        "ticker": thesis["ticker"],
        "structure": thesis.get("structure"),
        "direction": thesis.get("direction"),
        "opened_at": thesis.get("opened_at"),
        "original_thesis": thesis.get("thesis"),
        "exit_conditions": thesis.get("exit_conditions"),
        "thesis_accuracy": thesis_accuracy,
        "execution_discipline": execution,
        "pnl_attribution": attribution,
        "lesson": lesson,
    }


def _assess_thesis_accuracy(thesis: dict, pnl) -> dict:
    notes = []
    outcome = "unknown"
    if pnl:
        realized = pnl.get("realized_pnl", 0)
        outcome = "profitable" if realized > 0 else "loss"
        notes.append(f"Realized P&L: {realized:+.2f}")
        notes.append(f"Win rate on {pnl['trade_count']} trades: {pnl['win_rate']:.0%}")
    if thesis.get("catalysts"):
        notes.append(f"Catalysts noted: {thesis['catalysts']}")
    return {"outcome": outcome, "notes": notes}


def _assess_execution(thesis: dict, prior_decisions: list) -> dict:
    roll_count = sum(
        1 for d in prior_decisions
        if "roll" in (d.get("recommendation") or "").lower()
    )
    ignored_count = sum(
        1 for d in prior_decisions if d.get("user_action") == "ignored"
    )
    return {
        "roll_count": roll_count,
        "ignored_count": ignored_count,
        "exit_conditions_defined": bool(thesis.get("exit_conditions")),
        "total_decisions": len(prior_decisions),
    }


def _pnl_attribution(pnl, basis) -> dict:
    sources = []
    if pnl and pnl.get("realized_pnl") is not None:
        sources.append({
            "source": "stock_specific",
            "realized_pnl": pnl["realized_pnl"],
        })
    if basis and basis.get("effective_cost_basis") is not None:
        sources.append({
            "source": "premium_collected",
            "effective_cost_basis": basis["effective_cost_basis"],
        })
    if not sources:
        sources.append({"source": "unavailable", "note": "IBKR data not accessible"})
    return {"sources": sources}


def _synthesize_lesson(thesis: dict, accuracy: dict, execution: dict) -> str:
    parts = [f"Outcome: {accuracy.get('outcome', 'unknown')}."]
    if not execution["exit_conditions_defined"]:
        parts.append("No exit conditions were defined at open — add them next time.")
    if execution["roll_count"] > 0:
        parts.append(f"Position was rolled {execution['roll_count']} time(s).")
    if execution["ignored_count"] > 0:
        parts.append(
            f"{execution['ignored_count']} agent suggestion(s) were ignored "
            "— review if outcome differed from expectation."
        )
    return " ".join(parts)
