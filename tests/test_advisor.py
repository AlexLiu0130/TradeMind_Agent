from agent import journal_store as js
from agent.agents import advisor


def _dashboard():
    return {
        "portfolio_greeks": {"net_delta": 4200, "net_theta": -120},
        "positions": [
            {"symbol": "MRVL", "sec_type": "STK", "unrealized_pnl": -9900},
            {"symbol": "AMD", "sec_type": "OPT", "unrealized_pnl": 1200},
        ],
    }


def _insert_intel(text, *, ticker="MRVL", ts="2026-06-01T12:00:00Z", pct=None):
    snapshot = {}
    if pct is not None:
        baseline = 100
        current = 100 * (1 + pct / 100)
        snapshot = {ticker: {"baseline": baseline, "current": current, "since_pct": pct, "source": "quote"}}
    js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        external_id=f"{ticker}-{ts}",
        capture_method="test",
        item_ts=ts,
        url=f"https://x.com/aleabitoreddit/status/{ticker}-{ts}",
        raw_text=text,
        summary=text[:140],
        related_tickers=[ticker],
        portfolio_overlap=[ticker] if ticker in {"MRVL", "AMD"} else [],
        impact_direction="uncertain",
        urgency="watch",
        rationale="test",
        ticker_snapshot=snapshot,
        raw_payload={"test": True},
    )


def test_build_advice_combines_risk_and_intel_without_trade_instruction(fresh_db):
    _insert_intel("$MRVL custom silicon and ethernet optics are a bottleneck for AI clusters.", ts="2026-06-01T12:00:00Z")
    _insert_intel("$MRVL hyperscaler ASIC path still looks interesting.", ts="2026-06-02T12:00:00Z")

    result = advisor.build_advice(dashboard=_dashboard(), intel_limit=20)

    assert result["agent_graph"]["mode"] == "advisory_only"
    assert result["cards"]
    assert any(card["category"] == "风险提醒" for card in result["cards"])
    assert any(card["tickers"] == ["MRVL"] for card in result["cards"])
    rendered = " ".join(card["suggested_action"] for card in result["cards"])
    assert "买入" not in rendered
    assert "卖出" not in rendered
    assert all(card["status"] == "proposal" for card in result["cards"])


def test_price_reaction_card_requires_real_since_pct(fresh_db):
    _insert_intel("$AAOI optical supply chain", ticker="AAOI", pct=18.5)

    result = advisor.build_advice(dashboard={"portfolio_greeks": {}, "positions": []}, intel_limit=20)

    reaction = [card for card in result["cards"] if card["category"] == "价格反馈"]
    assert reaction
    assert reaction[0]["tickers"] == ["AAOI"]
    assert "+18.5%" in reaction[0]["summary"]


def test_agent_graph_documents_handoffs():
    graph = advisor.agent_graph()

    names = {row["name"] for row in graph["agents"]}
    assert {"Intel Agent", "Serenity Lens", "Portfolio Risk Agent", "Decision Advisor"} <= names
    assert any(edge["to"] == "Decision Advisor" for edge in graph["handoffs"])


def test_ignored_cards_are_suppressed(fresh_db):
    _insert_intel("$MRVL custom silicon and ethernet optics are a bottleneck for AI clusters.", ts="2026-06-01T12:00:00Z")
    _insert_intel("$MRVL hyperscaler ASIC path still looks interesting.", ts="2026-06-02T12:00:00Z")
    js.set_rule("advisor_ignored_cards", '["INTEL-MRVL"]')

    result = advisor.build_advice(dashboard={"portfolio_greeks": {}, "positions": []}, intel_limit=20)

    assert all(card["id"] != "intel-MRVL" for card in result["cards"])


def test_due_reminder_resurfaces_as_reminder_card(fresh_db):
    original = {
        "id": "intel-MRVL",
        "category": "持仓情报",
        "priority": "high",
        "title": "MRVL 在近期 Serenity 档案中反复出现",
        "tickers": ["MRVL"],
        "summary": "原始建议摘要",
        "suggested_action": "复盘 MRVL thesis",
        "confidence": "medium",
        "evidence": [{"agent": "Intel Agent", "label": "latest_post", "detail": "demo"}],
        "guardrails": ["这是研究建议，不是交易指令。"],
    }
    js.upsert_advisor_reminder(
        card_id="intel-MRVL",
        due_at="2026-01-01T00:00:00+00:00",
        card=original,
        note="test",
    )
    js.set_rule("advisor_reminder_cards", '["INTEL-MRVL"]')

    result = advisor.build_advice(dashboard={"portfolio_greeks": {}, "positions": []}, intel_limit=20)

    reminder_cards = [card for card in result["cards"] if card["category"] == "提醒"]
    assert reminder_cards
    assert reminder_cards[0]["id"] == "reminder-intel-MRVL"
    assert "你之前选择稍后提醒" in reminder_cards[0]["summary"]
