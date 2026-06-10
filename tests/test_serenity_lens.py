from agent import journal_store as js
from agent.agents.serenity_lens import analyze, classify_themes
from agent.loops import serenity_lens_cli


def _insert_intel(text, *, ticker="MRVL", ts="2026-05-01T12:00:00Z", external_id="post-1"):
    js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        external_id=external_id,
        capture_method="test",
        item_ts=ts,
        url=f"https://x.com/aleabitoreddit/status/{external_id}",
        raw_text=text,
        summary=text[:120],
        related_tickers=[ticker],
        portfolio_overlap=[ticker] if ticker in {"AMD", "ARM", "MRVL", "MU", "NBIS", "DRAM"} else [],
        impact_direction="uncertain",
        urgency="watch",
        rationale="test",
        ticker_snapshot={},
        raw_payload={"test": True},
    )


def test_classify_themes_identifies_supply_chain_patterns():
    themes = classify_themes("HBM memory bottleneck plus ethernet optics for custom ASIC clusters.")

    keys = {theme["key"] for theme in themes}
    assert {"memory_bottleneck", "ai_networking", "custom_silicon"} <= keys


def test_analyze_returns_framework_not_copied_posts(fresh_db):
    _insert_intel(
        "$MRVL custom silicon and ethernet optics look like a bottleneck for AI cluster scale-out.",
        external_id="mrvl-1",
    )
    _insert_intel(
        "Hyperscaler ASIC demand creates a path for $MRVL if execution and margins hold.",
        external_id="mrvl-2",
        ts="2026-05-02T12:00:00Z",
    )

    result = analyze("MRVL", ticker="MRVL")

    assert result["query"] == "MRVL"
    assert result["ticker"] == "MRVL"
    assert result["confidence"] in {"medium", "high"}
    assert result["verdict"]["label"] in {"结构性观察", "高契合观察"}
    assert len(result["framework"]) == 6
    assert any(row["dimension"] == "产业链位置" for row in result["framework"])
    assert result["evidence"][0]["external_id"] == "mrvl-2"
    assert "custom silicon and ethernet optics look like" not in result["verdict"]["summary"]
    assert result["counter_signals"]
    assert result["action_fit"]


def test_analyze_low_confidence_when_corpus_is_thin(fresh_db):
    result = analyze("XYZ", ticker="XYZ")

    assert result["confidence"] == "low"
    assert result["evidence"] == []
    assert result["verdict"]["label"] == "样本不足"
    assert "不能硬判定" in result["verdict"]["summary"]


def test_cli_returns_json_without_raising(fresh_db, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", type("Input", (), {"read": lambda self: '{"query":"XYZ","ticker":"XYZ"}'})())

    code = serenity_lens_cli.main()
    out = capsys.readouterr().out

    assert code == 0
    assert '"query": "XYZ"' in out
