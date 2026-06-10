"""
Tests for guardrail.py — each violation type must be caught and explained.
"""
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from agent import journal_store as js
from agent.guardrail import (
    _check_concentration,
    _check_daily_trades,
    _check_earnings,
    _check_fomo,
    _check_greeks,
    _check_iv,
    _check_roll_limit,
    check_trade,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _no_ibkr(*_args, **_kwargs):
    return None


def _make_run(responses: dict):
    """Return a run_script mock that dispatches by script name."""
    def fake(script, *args, **kwargs):
        for key, val in responses.items():
            if key in script:
                return val
        return None
    return fake


# ── IV check ─────────────────────────────────────────────────────────────────

def test_iv_low_blocks_sell(fresh_db):
    low_iv = {"iv_environment": {"iv_ratio": 0.3}}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"options_analyzer": low_iv})):
        check = _check_iv("AAPL", "sell")
    assert check["blocking"] is True
    assert "LOW" in check["conclusion"]


def test_iv_high_blocks_buy(fresh_db):
    high_iv = {"iv_environment": {"iv_ratio": 0.85}}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"options_analyzer": high_iv})):
        check = _check_iv("AAPL", "buy")
    assert check["blocking"] is True
    assert "HIGH" in check["conclusion"]


def test_iv_ok_sell(fresh_db):
    ok_iv = {"iv_environment": {"iv_ratio": 0.6}}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"options_analyzer": ok_iv})):
        check = _check_iv("AAPL", "sell")
    assert check["blocking"] is False
    assert "OK" in check["conclusion"]


def test_iv_unknown_when_ibkr_unavailable(fresh_db):
    with patch("agent.guardrail.run_script", return_value=None):
        check = _check_iv("AAPL", "sell")
    assert check["blocking"] is True
    assert "unknown" in check["conclusion"].lower()


# ── earnings check ────────────────────────────────────────────────────────────

def test_earnings_within_window_blocks(fresh_db):
    earnings_data = [{"date": "2026-06-10", "ticker": "AAPL"}]
    with patch("agent.guardrail.run_script", side_effect=_make_run({"earnings_calendar": earnings_data})):
        check = _check_earnings("AAPL", {"block_earnings_within_days": "2"})
    assert check["blocking"] is True
    assert "2026-06-10" in check["conclusion"]


def test_earnings_outside_window_ok(fresh_db):
    with patch("agent.guardrail.run_script", return_value=[]):
        check = _check_earnings("AAPL", {"block_earnings_within_days": "2"})
    assert check["blocking"] is False


# ── portfolio Greeks check ────────────────────────────────────────────────────

def test_greeks_heavy_short_blocks_sell(fresh_db):
    data = {"portfolio_greeks": {"net_delta": -2500}}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"portfolio_positions": data})):
        check = _check_greeks("sell")
    assert check["blocking"] is True
    assert "-2500" in check["conclusion"]


def test_greeks_ok_passes(fresh_db):
    data = {"portfolio_greeks": {"net_delta": -800}}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"portfolio_positions": data})):
        check = _check_greeks("sell")
    assert check["blocking"] is False


# ── concentration check ───────────────────────────────────────────────────────

def test_concentration_exceeds_limit_blocks(fresh_db):
    data = {"top_holdings": [{"symbol": "AAPL", "pct_of_portfolio": 35.0}]}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"concentration": data})):
        check = _check_concentration("AAPL", {"max_single_pct": "30"})
    assert check["blocking"] is True
    assert "35.0%" in check["conclusion"] or "35.0" in check["conclusion"]


def test_concentration_under_limit_passes(fresh_db):
    data = {"top_holdings": [{"symbol": "AAPL", "pct_of_portfolio": 20.0}]}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"concentration": data})):
        check = _check_concentration("AAPL", {"max_single_pct": "30"})
    assert check["blocking"] is False


# ── roll limit check ──────────────────────────────────────────────────────────

def test_roll_limit_exceeded_blocks(fresh_db):
    tid = js.create_thesis(ticker="AAPL")
    # Log 2 roll decisions as taken (max_rolls=2, so reaching limit blocks)
    for _ in range(2):
        did = js.log_decision(tid, agent="risk", recommendation="Consider rolling the put")
        js.update_decision_outcome(did, user_action="taken", outcome="rolled")

    with patch("agent.guardrail.run_script", return_value=None):
        check = _check_roll_limit("AAPL", {"max_rolls": "2"})
    assert check["blocking"] is True
    assert "2" in check["conclusion"]


def test_roll_limit_under_limit_passes(fresh_db):
    tid = js.create_thesis(ticker="AAPL")
    did = js.log_decision(tid, agent="risk", recommendation="Consider rolling the put")
    js.update_decision_outcome(did, user_action="taken", outcome="rolled")

    with patch("agent.guardrail.run_script", return_value=None):
        check = _check_roll_limit("AAPL", {"max_rolls": "2"})
    assert check["blocking"] is False


# ── daily trade limit ─────────────────────────────────────────────────────────

def test_daily_trade_limit_exceeded_blocks(fresh_db):
    # Record 3 "taken" decisions today
    for _ in range(3):
        did = js.log_decision(None, agent="orchestrator", recommendation="stage order")
        js.update_decision_outcome(did, user_action="taken", outcome="executed")

    check = _check_daily_trades({"max_trades_per_day": "3"})
    assert check["blocking"] is True


def test_daily_trade_limit_ok(fresh_db):
    did = js.log_decision(None, agent="orchestrator", recommendation="stage order")
    js.update_decision_outcome(did, user_action="taken", outcome="executed")

    check = _check_daily_trades({"max_trades_per_day": "3"})
    assert check["blocking"] is False


# ── FOMO check ────────────────────────────────────────────────────────────────

def test_fomo_large_move_no_thesis_blocks(fresh_db):
    quote = {"symbol": "AAPL", "change_pct": 4.5}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"market_quote": quote})):
        check = _check_fomo("AAPL")
    assert check["blocking"] is True
    assert "FOMO" in check["conclusion"]


def test_fomo_large_move_with_exit_conditions_passes(fresh_db):
    js.create_thesis(ticker="AAPL", exit_conditions="Close at 50% profit or DTE<7")
    quote = {"symbol": "AAPL", "change_pct": 4.5}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"market_quote": quote})):
        check = _check_fomo("AAPL")
    assert check["blocking"] is False


def test_fomo_small_move_passes(fresh_db):
    quote = {"symbol": "AAPL", "change_pct": 1.2}
    with patch("agent.guardrail.run_script", side_effect=_make_run({"market_quote": quote})):
        check = _check_fomo("AAPL")
    assert check["blocking"] is False


# ── full check_trade integration ──────────────────────────────────────────────

def test_check_trade_requires_confirmation_always(fresh_db):
    with patch("agent.guardrail.run_script", return_value=None):
        result = check_trade("AAPL", "short put", "sell")
    assert result["requires_confirmation"] is True


def test_check_trade_blocks_when_market_data_unavailable(fresh_db):
    with patch("agent.guardrail.run_script", return_value=None):
        result = check_trade("AAPL", "short put", "sell")

    assert result["passed"] is False
    assert any("unknown" in issue.lower() or "unavailable" in issue.lower() for issue in result["issues"])


def test_check_trade_all_green_passes(fresh_db):
    ok_iv = {"iv_environment": {"iv_ratio": 0.6}}
    ok_pos = {"portfolio_greeks": {"net_delta": -500}}
    ok_conc = {"top_holdings": [{"symbol": "AAPL", "pct_of_portfolio": 15.0}]}
    ok_quote = {"symbol": "AAPL", "change_pct": 0.5}

    def dispatch(script, *args, **kwargs):
        if "options_analyzer" in script:
            return ok_iv
        if "portfolio_positions" in script:
            return ok_pos
        if "concentration" in script:
            return ok_conc
        if "market_quote" in script:
            return ok_quote
        return []  # earnings_calendar returns empty list = no earnings

    with patch("agent.guardrail.run_script", side_effect=dispatch):
        result = check_trade("AAPL", "short put", "sell")

    assert result["passed"] is True
    assert result["issues"] == []


def test_check_trade_concentration_breach_blocks(fresh_db):
    heavy_conc = {"top_holdings": [{"symbol": "AAPL", "pct_of_portfolio": 40.0}]}

    def dispatch(script, *args, **kwargs):
        if "concentration" in script:
            return heavy_conc
        return None

    with patch("agent.guardrail.run_script", side_effect=dispatch):
        result = check_trade("AAPL", "short put", "sell")

    assert result["passed"] is False
    assert any("Concentration" in issue for issue in result["issues"])


def test_check_trade_third_roll_blocked(fresh_db):
    tid = js.create_thesis(ticker="TSLA")
    for _ in range(2):
        did = js.log_decision(tid, agent="risk", recommendation="Consider rolling the put")
        js.update_decision_outcome(did, user_action="taken", outcome="rolled")

    with patch("agent.guardrail.run_script", return_value=None):
        result = check_trade("TSLA", "short put", "sell")

    assert result["passed"] is False
    roll_issues = [i for i in result["issues"] if "roll" in i.lower() or "Roll" in i]
    assert roll_issues, f"Expected roll limit issue, got: {result['issues']}"
