"""
Risk Agent — current portfolio positions, Greeks, and concentration.
"""
from agent.tools import run_script, run_scripts_parallel


def assess(ticker: str | None = None) -> dict:
    """
    Pull portfolio-level risk data.
    If ticker is given, includes concentration check for that symbol.
    """
    # status_dashboard only emits stdout JSON with --output json; without it the
    # call returns nothing (and wastes ~10s). The other two emit JSON by default.
    dashboard, positions, concentration = run_scripts_parallel(
        [
            ("status_dashboard.py", ("--output", "json"), {}),
            ("portfolio_positions.py", (), {}),
            ("concentration.py", (), {}),
        ],
        runner=run_script,
    )

    result = {
        "dashboard": dashboard,
        "positions": positions,
        "concentration": concentration,
    }

    if ticker and concentration and isinstance(concentration, dict):
        top = concentration.get("top_holdings", [])
        ticker_conc = next(
            (h for h in top if h.get("symbol", "").upper() == ticker.upper()),
            None,
        )
        result["ticker_concentration"] = ticker_conc

    return result


def net_delta(positions_data: dict | None) -> float | None:
    """Extract net portfolio delta from portfolio_positions output."""
    if not positions_data:
        return None
    greeks = positions_data.get("portfolio_greeks", {})
    return greeks.get("net_delta")
