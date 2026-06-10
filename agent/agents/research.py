"""
Research Agent — market data, technicals, earnings for a ticker.
"""
from agent.tools import run_script, run_scripts_parallel


def gather(ticker: str, earnings_days: int = 45) -> dict:
    """
    Collect market quote, technical indicators, and upcoming earnings for ticker.
    Returns a combined dict; any unavailable data section is None.
    """
    quote, technicals, earnings = run_scripts_parallel(
        [
            ("market_quote.py", (ticker,), {}),
            ("technical_indicators.py", (ticker,), {}),
            ("earnings_calendar.py", (ticker, "--days", str(earnings_days)), {}),
        ],
        runner=run_script,
    )

    # Flatten single-item list responses
    if isinstance(quote, list) and len(quote) == 1:
        quote = quote[0]
    if isinstance(earnings, list) and len(earnings) == 1:
        earnings = earnings[0]

    return {
        "ticker": ticker,
        "quote": quote,
        "technicals": technicals,
        "earnings_within_days": earnings,
    }
