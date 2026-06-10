"""
Tests for review agent — mocks subprocess to verify correct CLI args and parsing.
"""
import json
from unittest.mock import MagicMock, patch

import pytest

from agent import journal_store as js
from agent.agents.review import (
    _cost_basis,
    _pnl_for_ticker,
    _wheel_status,
    review_thesis,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _mock_run(stdout: str, returncode: int = 0):
    result = MagicMock()
    result.stdout = stdout
    result.returncode = returncode
    return result


PNL_RESPONSE = {
    "by_group": {
        "AAPL": {
            "trades": 3,
            "closed_trades": 3,
            "total_realized_pnl": 420.0,
            "win_rate": 0.667,
            "avg_gain": 280.0,
            "avg_loss": -120.0,
        }
    }
}

WHEEL_RESPONSE = {
    "wheels": [
        {"symbol": "AAPL", "total_premium": 300.0, "annualized_return_pct": 18.5, "current_stage": "short_put", "entries_count": 2},
        {"symbol": "TSLA", "total_premium": 150.0, "annualized_return_pct": 12.0, "current_stage": "short_put", "entries_count": 1},
    ]
}

COST_BASIS_RESPONSE = {
    "symbols": [
        {"symbol": "AAPL", "effective_cost_basis": 187.50, "premium_collected": 12.50}
    ]
}


# ── pnl_for_ticker ────────────────────────────────────────────────────────────

def test_pnl_correct_argv():
    """_pnl_for_ticker must call pnl_analytics.py --by symbol --days 365 (no --output)."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(PNL_RESPONSE))
        _pnl_for_ticker("AAPL")
        args = mock_run.call_args[0][0]
        assert "pnl_analytics.py" in args[-4] or any("pnl_analytics.py" in a for a in args)
        assert "--by" in args
        assert "symbol" in args
        assert "--days" in args
        assert "365" in args
        assert "--output" not in args  # must NOT pass --output


def test_pnl_parses_by_group():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(PNL_RESPONSE))
        result = _pnl_for_ticker("AAPL")
    assert result is not None
    assert result["realized_pnl"] == 420.0
    assert result["trade_count"] == 3
    assert abs(result["win_rate"] - 0.667) < 0.001


def test_pnl_ticker_not_found_returns_none():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(PNL_RESPONSE))
        assert _pnl_for_ticker("NVDA") is None


def test_pnl_script_error_returns_none():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run("", returncode=1)
        assert _pnl_for_ticker("AAPL") is None


# ── wheel_status ──────────────────────────────────────────────────────────────

def test_wheel_correct_argv():
    """_wheel_status must call wheel_tracker.py summary (no --output, no --ticker)."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(WHEEL_RESPONSE))
        _wheel_status("AAPL")
        args = mock_run.call_args[0][0]
        assert any("wheel_tracker.py" in a for a in args)
        assert "summary" in args
        assert "--output" not in args
        assert "--ticker" not in args


def test_wheel_filters_by_symbol():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(WHEEL_RESPONSE))
        result = _wheel_status("AAPL")
    assert result is not None
    assert result["symbol"] == "AAPL"
    assert result["total_premium"] == 300.0


def test_wheel_case_insensitive():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(WHEEL_RESPONSE))
        result = _wheel_status("aapl")
    assert result is not None


def test_wheel_not_found_returns_none():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(WHEEL_RESPONSE))
        assert _wheel_status("MSFT") is None


# ── cost_basis ────────────────────────────────────────────────────────────────

def test_cost_basis_correct_argv():
    """_cost_basis must call cost_basis.py TICKER (positional, no --output)."""
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(COST_BASIS_RESPONSE))
        _cost_basis("AAPL")
        args = mock_run.call_args[0][0]
        assert any("cost_basis.py" in a for a in args)
        assert "AAPL" in args
        assert "--output" not in args


def test_cost_basis_parses_symbols():
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run(json.dumps(COST_BASIS_RESPONSE))
        result = _cost_basis("AAPL")
    assert result is not None
    assert result["effective_cost_basis"] == 187.50


# ── review_thesis end-to-end ──────────────────────────────────────────────────

def test_review_thesis_logs_decision(fresh_db):
    tid = js.create_thesis(ticker="AAPL", thesis="AAPL holds 200")

    full_pnl = {"by_group": {"AAPL": {"trades": 2, "closed_trades": 2, "total_realized_pnl": 210.0, "win_rate": 1.0}}}

    def fake_run(cmd, **kwargs):
        r = MagicMock()
        r.returncode = 0
        if "pnl_analytics" in cmd[1]:
            r.stdout = json.dumps(full_pnl)
        elif "wheel_tracker" in cmd[1]:
            r.stdout = json.dumps(WHEEL_RESPONSE)
        elif "cost_basis" in cmd[1]:
            r.stdout = json.dumps(COST_BASIS_RESPONSE)
        else:
            r.stdout = ""
        return r

    with patch("subprocess.run", side_effect=fake_run):
        report = review_thesis(tid)

    assert report["ticker"] == "AAPL"
    assert report["thesis_accuracy"]["outcome"] == "profitable"
    decisions = js.list_decisions(thesis_id=tid)
    assert len(decisions) == 1
    assert decisions[0]["agent"] == "review"


def test_review_thesis_not_found(fresh_db):
    report = review_thesis(9999)
    assert "error" in report


def test_review_thesis_ibkr_unavailable(fresh_db):
    """When IBKR is unreachable, report still returns with 'unavailable' attribution."""
    tid = js.create_thesis(ticker="AAPL")

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = _mock_run("", returncode=1)
        report = review_thesis(tid)

    assert report["pnl_attribution"]["sources"][0]["source"] == "unavailable"
    assert report["thesis_accuracy"]["outcome"] == "unknown"
