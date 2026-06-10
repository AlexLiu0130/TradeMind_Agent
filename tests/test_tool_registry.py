"""Tool registry tests — schema shape, dispatch routing, and tool coverage."""
from agent import tool_registry as tr


def test_responses_schema_is_flat_and_complete():
    schema = tr.responses_schema()
    names = {t["name"] for t in schema}
    # All Agent capabilities are registered.
    assert names == {
        "gather_research", "assess_risk", "suggest_strategy", "check_guardrail",
        "get_thesis_history", "search_knowledge", "get_behavior_profile",
        "analyze_serenity_lens", "get_agent_advice",
    }
    for t in schema:
        assert t["type"] == "function"
        assert "name" in t and "description" in t and "parameters" in t
        assert "input_schema" not in t  # Responses API uses 'parameters'


def test_dispatch_routes_to_handler():
    # search_knowledge is pure-local (no IBKR/network), safe to actually run.
    out = tr.dispatch("search_knowledge", {"query": "wheel assignment"})
    assert "results" in out or "available_topics" in out


def test_dispatch_unknown_tool_returns_error():
    out = tr.dispatch("does_not_exist", {})
    assert "error" in out
