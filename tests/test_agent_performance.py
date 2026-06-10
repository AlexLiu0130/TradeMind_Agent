import time
from unittest.mock import patch

from agent import guardrail
from agent.agents import research, risk


def test_research_runs_independent_scripts_concurrently(monkeypatch):
    calls = []

    def fake_run(script, *args, **kwargs):
        calls.append(script)
        time.sleep(0.05)
        return {"script": script}

    monkeypatch.setattr("agent.agents.research.run_script", fake_run)

    start = time.perf_counter()
    out = research.gather("MRVL")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.12
    assert set(calls) == {"market_quote.py", "technical_indicators.py", "earnings_calendar.py"}
    assert out["quote"]["script"] == "market_quote.py"


def test_risk_runs_independent_scripts_concurrently(monkeypatch):
    calls = []

    def fake_run(script, *args, **kwargs):
        calls.append(script)
        time.sleep(0.05)
        return {"script": script, "top_holdings": [{"symbol": "MRVL", "pct_of_portfolio": 12.5}]}

    monkeypatch.setattr("agent.agents.risk.run_script", fake_run)

    start = time.perf_counter()
    out = risk.assess("MRVL")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.12
    assert set(calls) == {"status_dashboard.py", "portfolio_positions.py", "concentration.py"}
    assert out["ticker_concentration"]["pct_of_portfolio"] == 12.5


def test_check_trade_parallel_preserves_order_and_blocking(fresh_db, monkeypatch):
    order = []

    def make_check(name, blocking=False):
        def check(*_args, **_kwargs):
            time.sleep(0.03)
            order.append(name)
            return {"name": name, "conclusion": f"{name} conclusion", "blocking": blocking}

        return check

    monkeypatch.setattr(guardrail, "_check_iv", make_check("iv_environment"))
    monkeypatch.setattr(guardrail, "_check_earnings", make_check("earnings_window"))
    monkeypatch.setattr(guardrail, "_check_greeks", make_check("portfolio_greeks", blocking=True))
    monkeypatch.setattr(guardrail, "_check_concentration", make_check("concentration"))
    monkeypatch.setattr(guardrail, "_check_roll_limit", make_check("roll_limit"))
    monkeypatch.setattr(guardrail, "_check_daily_trades", make_check("daily_trade_limit"))
    monkeypatch.setattr(guardrail, "_check_fomo", make_check("fomo_flag"))

    start = time.perf_counter()
    result = guardrail.check_trade("MRVL", "short put", "sell")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.14
    assert result["passed"] is False
    assert result["issues"] == ["portfolio_greeks conclusion"]
    assert [c["name"] for c in result["checks"]] == [
        "iv_environment",
        "earnings_window",
        "portfolio_greeks",
        "concentration",
        "roll_limit",
        "daily_trade_limit",
        "fomo_flag",
    ]
    assert set(order) == set(result_check["name"] for result_check in result["checks"])


def test_run_script_singleflight_prevents_duplicate_same_key(monkeypatch):
    from agent import cache, tools

    monkeypatch.setattr(cache, "get", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cache, "put", lambda *_args, **_kwargs: None)
    call_count = 0

    class FakeResult:
        returncode = 0
        stdout = '{"ok": true}'

    def fake_subprocess_run(*_args, **_kwargs):
        nonlocal call_count
        call_count += 1
        time.sleep(0.05)
        return FakeResult()

    with patch("agent.tools.subprocess.run", side_effect=fake_subprocess_run):
        start = time.perf_counter()
        outputs = tools.run_scripts_parallel([
            ("market_quote.py", ("MRVL",), {}),
            ("market_quote.py", ("MRVL",), {}),
        ])
        elapsed = time.perf_counter() - start

    assert elapsed < 0.10
    assert call_count == 1
    assert outputs == [{"ok": True}, {"ok": True}]
