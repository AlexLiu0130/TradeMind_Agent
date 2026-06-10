"""
Orchestrator loop tests — verify the OpenAI Responses tool-use loop wiring without
hitting the network or any real IBKR data. We inject a fake OpenAI client and stub
_dispatch, so nothing leaves the machine.

These tests exist specifically because the orchestrator's tool loop had no coverage,
which let a control-flow bug (tool results never fed back) hide indefinitely.
"""
import json
import time
from types import SimpleNamespace

import pytest

from agent import orchestrator


# ── fake OpenAI Responses objects ─────────────────────────────────────────────

def _function_call(name, args, call_id="call_1"):
    return SimpleNamespace(
        type="function_call",
        name=name,
        arguments=json.dumps(args),
        call_id=call_id,
        model_dump=lambda: {"type": "function_call", "name": name, "call_id": call_id},
    )


def _response(output, output_text=""):
    return SimpleNamespace(output=output, output_text=output_text)


class _FakeResponses:
    """Returns a queued list of responses, one per .create() call."""
    def __init__(self, queue):
        self._queue = queue
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._queue.pop(0)


class _FakeClient:
    def __init__(self, queue):
        self.responses = _FakeResponses(queue)


@pytest.fixture
def _env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    # _dispatch must never touch IBKR scripts in tests.
    monkeypatch.setattr(orchestrator, "_dispatch", lambda name, inp: {"stub": name, "input": inp})
    # Stub init_db to a no-op so run() keeps the conftest tmp DB instead of repointing
    # journal_store at the real production database during tests.
    monkeypatch.setattr(orchestrator, "init_db", lambda p: None)


def _install_client(monkeypatch, queue):
    fake = _FakeClient(queue)
    monkeypatch.setattr(orchestrator.openai, "OpenAI", lambda **kw: fake)
    return fake


def test_tool_results_are_fed_back(_env, monkeypatch):
    """Turn 1 emits a tool call; turn 2 must run with the tool output appended, then finish."""
    queue = [
        _response([_function_call("assess_risk", {"ticker": "NVDA"})]),
        _response([], output_text="Net delta is balanced; concentration OK."),
    ]
    fake = _install_client(monkeypatch, queue)

    out = orchestrator.run("评估我的组合风险")

    # The loop made exactly two model calls (tool round + synthesis).
    assert len(fake.responses.calls) == 2
    # Second call's input must contain the function_call_output we fed back.
    second_input = fake.responses.calls[1]["input"]
    assert any(item.get("type") == "function_call_output" for item in second_input)
    # Tool was dispatched and recorded.
    assert "assess_risk" in out["raw_tool_results"]
    assert out["summary"] == "Net delta is balanced; concentration OK."


def test_no_tool_call_returns_text_immediately(_env, monkeypatch):
    queue = [_response([], output_text="No tools needed.")]
    fake = _install_client(monkeypatch, queue)

    out = orchestrator.run("随便聊聊")

    assert len(fake.responses.calls) == 1
    assert out["summary"] == "No tools needed."
    assert out["requires_confirmation"] is True  # always safe-default True


def test_trade_intent_without_model_guardrail_is_blocked(_env, monkeypatch):
    queue = [_response([], output_text="You can stage that short put.")]
    _install_client(monkeypatch, queue)

    out = orchestrator.run("I want to sell an AAPL short put", ticker="AAPL")

    assert out["raw_tool_results"]["check_guardrail"]["passed"] is False
    assert any("Guardrail was not run" in issue for issue in out["raw_tool_results"]["check_guardrail"]["issues"])
    assert out["recommendations"][0]["action"] == "Order blocked by guardrail"


def test_missing_api_key_raises(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        orchestrator.run("test")


def test_responses_tools_have_flat_shape():
    """Responses API needs {type, name, description, parameters} — not Anthropic's input_schema."""
    for t in orchestrator._RESPONSES_TOOLS:
        assert t["type"] == "function"
        assert "name" in t and "description" in t and "parameters" in t
        assert "input_schema" not in t


def test_same_round_tool_calls_are_dispatched_concurrently(_env, monkeypatch):
    def slow_dispatch(name, inp):
        time.sleep(0.05)
        return {"stub": name, "input": inp}

    monkeypatch.setattr(orchestrator, "_dispatch", slow_dispatch)
    queue = [
        _response([
            _function_call("gather_research", {"ticker": "MRVL"}, call_id="call_1"),
            _function_call("assess_risk", {"ticker": "MRVL"}, call_id="call_2"),
        ]),
        _response([], output_text="MRVL research and risk synthesized."),
    ]
    fake = _install_client(monkeypatch, queue)

    start = time.perf_counter()
    out = orchestrator.run("分析 MRVL")
    elapsed = time.perf_counter() - start

    assert elapsed < 0.09
    assert len(fake.responses.calls) == 2
    second_input = fake.responses.calls[1]["input"]
    outputs = [item for item in second_input if item.get("type") == "function_call_output"]
    assert [item["call_id"] for item in outputs] == ["call_1", "call_2"]
    assert out["raw_tool_results"]["gather_research"]["stub"] == "gather_research"
    assert out["raw_tool_results"]["assess_risk"]["stub"] == "assess_risk"
