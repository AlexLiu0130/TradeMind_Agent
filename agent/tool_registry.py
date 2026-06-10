"""
tool_registry.py — the single source of truth for the Agent's callable tools.

Each Tool bundles its name, description, JSON-schema parameters, and the handler
that runs it. The orchestrator builds the Responses-API tool list and dispatches
calls straight from this registry, so adding a capability means appending one Tool
here — schema and behavior stay together and can't drift apart.
"""
from dataclasses import dataclass
from typing import Callable

from agent import behavior, knowledge
from agent.agents import advisor, research, risk, serenity_lens, strategy
from agent.guardrail import check_trade
from agent.journal_store import list_theses


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict  # JSON schema
    handler: Callable[[dict], dict]


# ── handlers ──────────────────────────────────────────────────────────────────

def _gather_research(inp: dict) -> dict:
    return research.gather(inp["ticker"], earnings_days=inp.get("earnings_days", 45))


def _assess_risk(inp: dict) -> dict:
    return risk.assess(ticker=inp.get("ticker"))


def _suggest_strategy(inp: dict) -> dict:
    return strategy.suggest(
        inp["ticker"],
        outlook=inp.get("outlook", "neutral"),
        risk_profile=inp.get("risk_profile", "moderate"),
    )


def _check_guardrail(inp: dict) -> dict:
    return check_trade(inp["ticker"], inp["structure"], inp["direction"])


def _get_thesis_history(inp: dict) -> dict:
    ticker = inp["ticker"]
    status = inp.get("status", "all")
    theses = list_theses(ticker=ticker) if status == "all" else list_theses(ticker=ticker, status=status)
    return {"ticker": ticker, "theses": theses}


def _search_knowledge(inp: dict) -> dict:
    return knowledge.search(inp["query"], max_results=inp.get("max_results", 4))


def _get_behavior_profile(inp: dict) -> dict:
    return behavior.profile()


def _analyze_serenity_lens(inp: dict) -> dict:
    return serenity_lens.analyze(
        query=inp.get("query") or inp.get("ticker") or "",
        ticker=inp.get("ticker"),
        limit=inp.get("limit", 80),
    )


def _get_agent_advice(inp: dict) -> dict:
    return advisor.build_advice(intel_limit=inp.get("intel_limit", 120))


# ── registry ──────────────────────────────────────────────────────────────────

TOOLS: list[Tool] = [
    Tool(
        name="gather_research",
        description="Get market quote, technical indicators (RSI/MA/BB/ATR), and upcoming earnings for a ticker.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string", "description": "Stock/ETF ticker symbol"},
                "earnings_days": {"type": "integer", "description": "Look-ahead window for earnings in days (default 45)"},
            },
            "required": ["ticker"],
        },
        handler=_gather_research,
    ),
    Tool(
        name="assess_risk",
        description="Pull current portfolio positions, Greeks (net delta/vega/theta), and HHI concentration metrics.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string", "description": "Optional: specific ticker to highlight in concentration check"},
            },
        },
        handler=_assess_risk,
    ),
    Tool(
        name="suggest_strategy",
        description="Fetch the options chain and run McMillan/Overby strategy analysis given an outlook.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "outlook": {"type": "string", "enum": ["bullish", "bearish", "neutral"], "description": "Market outlook"},
                "risk_profile": {"type": "string", "enum": ["conservative", "moderate", "aggressive"]},
            },
            "required": ["ticker"],
        },
        handler=_suggest_strategy,
    ),
    Tool(
        name="check_guardrail",
        description="Run ALL pre-trade safety checks (IV, earnings, portfolio Greeks, concentration, roll limit, daily limit, FOMO). MUST be called before staging any order.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "structure": {"type": "string", "description": "e.g. 'short put', 'covered call', 'stock'"},
                "direction": {"type": "string", "enum": ["buy", "sell"]},
            },
            "required": ["ticker", "structure", "direction"],
        },
        handler=_check_guardrail,
    ),
    Tool(
        name="get_thesis_history",
        description="Retrieve open/closed thesis records and recent decisions for a ticker from the memory store.",
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "status": {"type": "string", "enum": ["open", "closed", "all"], "description": "Filter by thesis status (default: all)"},
            },
            "required": ["ticker"],
        },
        handler=_get_thesis_history,
    ),
    Tool(
        name="search_knowledge",
        description="Search the trading knowledge base (strategy method, greeks primer, wheel mechanics, the trader's own discipline notes) for grounding. Use for conceptual questions or to justify a recommendation with method.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to look up, e.g. 'when to roll a short put' or 'IV rank vs IV percentile'"},
                "max_results": {"type": "integer", "description": "Max sections to return (default 4)"},
            },
            "required": ["query"],
        },
        handler=_search_knowledge,
    ),
    Tool(
        name="get_behavior_profile",
        description="Get the trader's behavioral metrics from their own history: win-rate by symbol/holding-period/time-of-day, confidence calibration, roll discipline, overtrading. Use to keep advice consistent with how this trader actually performs.",
        parameters={"type": "object", "properties": {}},
        handler=_get_behavior_profile,
    ),
    Tool(
        name="analyze_serenity_lens",
        description=(
            "Apply TradeMind's Serenity-inspired research framework to a ticker or theme. "
            "Use this for structural opportunity analysis, narrative clusters, supply-chain bottlenecks, "
            "counter-signals, and Chinese research notes. This does not impersonate Serenity."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Ticker or theme to analyze, e.g. MRVL or AI networking"},
                "ticker": {"type": "string", "description": "Optional primary ticker symbol"},
                "limit": {"type": "integer", "description": "Max matching archive items to inspect (default 80)"},
            },
            "required": ["query"],
        },
        handler=_analyze_serenity_lens,
    ),
    Tool(
        name="get_agent_advice",
        description=(
            "Coordinate portfolio risk, recent intel, Serenity Lens, and price reaction signals "
            "into advisory-only recommendation cards. This tool never places trades and never "
            "changes position size."
        ),
        parameters={
            "type": "object",
            "properties": {
                "intel_limit": {"type": "integer", "description": "Recent intel records to scan (default 120)"},
            },
        },
        handler=_get_agent_advice,
    ),
]


def responses_schema() -> list[dict]:
    """Tool list in OpenAI Responses-API shape."""
    return [
        {"type": "function", "name": t.name, "description": t.description, "parameters": t.parameters}
        for t in TOOLS
    ]


def dispatch(name: str, tool_input: dict) -> dict:
    """Run a tool by name. Returns {'error': ...} for an unknown tool."""
    for t in TOOLS:
        if t.name == name:
            return t.handler(tool_input)
    return {"error": f"Unknown tool: {name}"}
