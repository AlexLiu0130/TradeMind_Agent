"""
Strategy Agent — options chain, IV environment, strategy candidates.
"""
import json
import tempfile
from pathlib import Path

from agent.tools import run_script


def suggest(
    ticker: str,
    outlook: str = "neutral",
    risk_profile: str = "moderate",
) -> dict:
    """
    Fetch options chain (cached to tmp), run options_analyzer, return strategy candidates.
    """
    chain = run_script("options_chain.py", ticker)

    chain_file: str | None = None
    if chain:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=f"_chain_{ticker}.json",
            delete=False,
            prefix="trademind_",
        ) as f:
            json.dump(chain, f)
            chain_file = f.name

    analyzer_args = [ticker, "--outlook", outlook, "--risk-profile", risk_profile, "--iv-context"]
    if chain_file:
        analyzer_args += ["--chain-file", chain_file]

    try:
        analysis = run_script("options_analyzer.py", *analyzer_args)
    finally:
        if chain_file:
            Path(chain_file).unlink(missing_ok=True)

    return {
        "ticker": ticker,
        "outlook": outlook,
        "risk_profile": risk_profile,
        "chain_summary": _summarize_chain(chain),
        "analysis": analysis,
    }


def _summarize_chain(chain) -> dict | None:
    if not isinstance(chain, dict):
        return None
    expirations = chain.get("expirations", [])
    return {
        "expiration_count": len(expirations),
        "nearest_expiry": expirations[0].get("expiration") if expirations else None,
        "iv_percentile": chain.get("iv_percentile"),
    }
