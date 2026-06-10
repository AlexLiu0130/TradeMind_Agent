"""
Orchestrator — uses the OpenAI Responses API (function calling) to plan and coordinate sub-agents.

Flow:
  1. User states intent (natural language).
  2. LLM decides which tools to call and in what order.
  3. Orchestrator executes tools, returns results to LLM.
  4. LLM synthesizes final structured response.
  5. If trade intent detected, guardrail is always run.

Output schema:
  {
    "summary": str,
    "checks": [{"name": str, "conclusion": str, "blocking": bool}],
    "recommendations": [{"action": str, "rationale": str}],
    "requires_confirmation": bool,
    "raw_tool_results": dict,   # for auditability
  }
"""
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import openai

from agent.config import (
    OPENAI_BASE_URL,
    OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_MODEL,
    PROMPTS_DIR,
    TRADEMIND_DB,
)
from agent.journal_store import init_db, log_decision
from agent.tool_registry import dispatch, responses_schema

# Fallback used only if agent/prompts/system.md is missing.
_DEFAULT_SYSTEM_PROMPT = (
    "You are TradeMind, an options trading analysis agent for a short-put / wheel "
    "strategy trader. Gather data with the tools, give a balanced bull/bear/risk "
    "analysis citing specific numbers, ALWAYS run check_guardrail on any trade intent, "
    "never claim certainty, never fabricate data, and never place trades."
)


def _load_system_prompt() -> str:
    """Read the editable system prompt from markdown; fall back to the built-in default."""
    try:
        return (PROMPTS_DIR / "system.md").read_text(encoding="utf-8").strip() or _DEFAULT_SYSTEM_PROMPT
    except OSError:
        return _DEFAULT_SYSTEM_PROMPT


_SYSTEM_PROMPT = _load_system_prompt()
# Tool schema + dispatch both come from the registry (single source of truth).
_RESPONSES_TOOLS = responses_schema()


def _dispatch(tool_name: str, tool_input: dict) -> dict:
    return dispatch(tool_name, tool_input)


def _tool_result_key(results: dict, name: str) -> str:
    if name not in results:
        return name
    i = 2
    while f"{name}#{i}" in results:
        i += 1
    return f"{name}#{i}"


def _has_tool_result(results: dict, name: str) -> bool:
    return any(key == name or key.startswith(f"{name}#") for key in results)


def _looks_like_trade_intent(text: str) -> bool:
    return bool(re.search(
        r"\b(short\s+put|covered\s+call|sell\s+put|sell\s+call|buy\s+call|buy\s+put|stage|order|trade|roll|"
        r"卖|买|下单|开仓|平仓|滚仓)\b",
        text,
        re.IGNORECASE,
    ))


def _missing_guardrail_result(request: str, ticker: str | None) -> dict:
    target = ticker or "UNKNOWN"
    return {
        "passed": False,
        "issues": [
            f"Guardrail was not run for a detected trade intent on {target}; order staging is blocked.",
        ],
        "checks": [
            {
                "name": "guardrail_required",
                "conclusion": "Guardrail was not run; deterministic safety gate blocked this trade intent.",
                "blocking": True,
            }
        ],
        "requires_confirmation": True,
        "request": request,
        "ticker": ticker,
    }


def run(request: str, ticker: str | None = None) -> dict:
    """
    Main entry point. Takes a natural-language request and optionally a primary ticker.
    Returns structured output with summary, checks, recommendations, requires_confirmation.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY not set")

    # journal_store reads/writes (guardrail history, decision log) need the DB ready.
    # init_db is idempotent (CREATE TABLE IF NOT EXISTS), so calling it per run is safe.
    init_db(str(TRADEMIND_DB))

    # api_key + base_url are read from OPENAI_API_KEY / OPENAI_BASE_URL env by the SDK;
    # base_url falls back to the configured default.
    client = openai.OpenAI(base_url=OPENAI_BASE_URL)
    # The dashboard sends a focus ticker separately; surface it to the model.
    user_content = f"{request}\n\n[Primary ticker: {ticker.upper()}]" if ticker else request
    # Responses API conversation state, accumulated statelessly (no previous_response_id,
    # so it works through proxies that don't persist responses server-side).
    conversation: list = [{"role": "user", "content": user_content}]
    tool_results: dict = {}

    # Wall-clock budget: once exceeded we stop gathering and force a final, tool-free
    # synthesis so the user ALWAYS gets a written answer within a bounded time, even
    # if a question fans out across many slow IBKR-backed tools.
    budget_s = float(os.environ.get("AGENT_BUDGET_S", "70"))
    start = time.monotonic()
    max_iterations = 10
    final_text = ""

    for iterations in range(max_iterations):
        over_budget = time.monotonic() - start > budget_s
        # Drop tools on the final budgeted round → the model must answer from what it has.
        offer_tools = not over_budget and iterations < max_iterations - 1
        response = client.responses.create(
            model=OPENAI_MODEL,
            instructions=_SYSTEM_PROMPT,
            tools=_RESPONSES_TOOLS if offer_tools else [],
            input=conversation,
            max_output_tokens=OPENAI_MAX_OUTPUT_TOKENS,
            reasoning={"effort": "low"},  # reasoning models: low effort keeps latency down
        )

        tool_calls = [o for o in response.output if getattr(o, "type", "") == "function_call"]
        if not tool_calls:
            final_text = response.output_text
            break

        # Echo the model's output items back, then append each tool result, and loop.
        for item in response.output:
            conversation.append(item.model_dump())
        parsed_calls = [
            (tc, json.loads(tc.arguments) if tc.arguments else {})
            for tc in tool_calls
        ]
        with ThreadPoolExecutor(max_workers=min(len(parsed_calls), 8)) as pool:
            futures = [
                pool.submit(_dispatch, tc.name, tool_input)
                for tc, tool_input in parsed_calls
            ]
            round_results = [future.result() for future in futures]

        for (tc, _tool_input), result in zip(parsed_calls, round_results, strict=True):
            tool_results[_tool_result_key(tool_results, tc.name)] = result
            conversation.append({
                "type": "function_call_output",
                "call_id": tc.call_id,
                "output": json.dumps(result, ensure_ascii=False, default=str),
            })

    if not final_text:
        final_text = "[分析未能在时限内完成，请缩小问题范围后重试。]"

    if _looks_like_trade_intent(user_content) and not _has_tool_result(tool_results, "check_guardrail"):
        tool_results["check_guardrail"] = _missing_guardrail_result(request, ticker)
        final_text = (
            f"{final_text}\n\n[安全门禁] 检测到交易意图，但模型没有完成 check_guardrail。"
            "系统已阻断任何下单/暂存建议，请重新提供 ticker、结构和方向后再评估。"
        )

    # Parse structured output from final_text
    output = _build_output(final_text, tool_results)

    # Log to decisions table
    log_decision(
        thesis_id=None,
        agent="orchestrator",
        recommendation=json.dumps(output, ensure_ascii=False, default=str),
    )

    return output


def _build_output(final_text: str, tool_results: dict) -> dict:
    guardrail = tool_results.get("check_guardrail", {})
    checks = guardrail.get("checks", [])
    # Default True — only pure read analysis (no guardrail call, no trade intent) would be False.
    # Erring on the side of requiring confirmation is always safe.
    requires_confirmation = True

    recommendations = []
    if guardrail:
        if guardrail.get("passed"):
            recommendations.append({
                "action": "Order may be staged — awaiting user confirmation",
                "rationale": "All pre-trade checks passed",
            })
        else:
            recommendations.append({
                "action": "Order blocked by guardrail",
                "rationale": "; ".join(guardrail.get("issues", [])),
            })

    return {
        "summary": final_text,
        "checks": checks,
        "recommendations": recommendations,
        "requires_confirmation": requires_confirmation,
        "raw_tool_results": tool_results,
    }
