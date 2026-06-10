"""
Comprehensive tests for journal_store.py — all read/write interfaces + transaction rollback.
"""
import time
import pytest
from agent import journal_store as js


# ── init ──────────────────────────────────────────────────────────────────────

def test_init_idempotent(fresh_db):
    js.init_db(fresh_db)  # calling twice must not raise
    assert js.all_rules()  # seeds populated


def test_seed_rules(fresh_db):
    rules = js.all_rules()
    assert rules["max_single_pct"] == "30"
    assert rules["max_rolls"] == "2"
    assert rules["block_earnings_within_days"] == "2"
    assert rules["max_trades_per_day"] == "3"


# ── theses ────────────────────────────────────────────────────────────────────

def test_create_and_get_thesis(fresh_db):
    tid = js.create_thesis(ticker="AAPL", thesis="AAPL will hold 200")
    t = js.get_thesis(tid)
    assert t["ticker"] == "AAPL"
    assert t["thesis"] == "AAPL will hold 200"
    assert t["status"] == "open"
    assert t["opened_at"]  # auto-populated


def test_thesis_json_fields_roundtrip(fresh_db):
    snapshot = {"iv_pct": 45, "iv_rank": 0.6}
    catalysts = ["earnings", "CPI"]
    tid = js.create_thesis(
        ticker="TSLA",
        iv_snapshot=snapshot,
        catalysts=catalysts,
    )
    t = js.get_thesis(tid)
    assert t["iv_snapshot"] == snapshot
    assert t["catalysts"] == catalysts


def test_get_thesis_not_found(fresh_db):
    assert js.get_thesis(9999) is None


def test_list_theses_empty(fresh_db):
    assert js.list_theses() == []


def test_list_theses_status_filter(fresh_db):
    t1 = js.create_thesis(ticker="AAPL")
    t2 = js.create_thesis(ticker="NVDA")
    js.update_thesis_status(t2, "closed")

    open_theses = js.list_theses(status="open")
    closed_theses = js.list_theses(status="closed")
    assert len(open_theses) == 1
    assert open_theses[0]["ticker"] == "AAPL"
    assert len(closed_theses) == 1
    assert closed_theses[0]["ticker"] == "NVDA"


def test_list_theses_ticker_filter(fresh_db):
    js.create_thesis(ticker="AAPL")
    js.create_thesis(ticker="AAPL")
    js.create_thesis(ticker="NVDA")
    assert len(js.list_theses(ticker="AAPL")) == 2
    assert len(js.list_theses(ticker="NVDA")) == 1


def test_update_thesis_status(fresh_db):
    tid = js.create_thesis(ticker="META")
    js.update_thesis_status(tid, "closed")
    assert js.get_thesis(tid)["status"] == "closed"


# ── decisions ─────────────────────────────────────────────────────────────────

def test_log_and_list_decision(fresh_db):
    tid = js.create_thesis(ticker="AAPL")
    did = js.log_decision(tid, agent="research", recommendation="IV looks high")
    decisions = js.list_decisions(thesis_id=tid)
    assert len(decisions) == 1
    assert decisions[0]["id"] == did
    assert decisions[0]["agent"] == "research"
    assert decisions[0]["recommendation"] == "IV looks high"
    assert decisions[0]["user_action"] is None


def test_update_decision_outcome(fresh_db):
    tid = js.create_thesis(ticker="AAPL")
    did = js.log_decision(tid, agent="risk", recommendation="Reduce delta")
    js.update_decision_outcome(did, user_action="taken", outcome="delta reduced, +$120 PnL")
    decisions = js.list_decisions(thesis_id=tid)
    assert decisions[0]["user_action"] == "taken"
    assert decisions[0]["outcome"] == "delta reduced, +$120 PnL"


def test_list_decisions_since_filter(fresh_db):
    tid = js.create_thesis(ticker="AAPL")
    js.log_decision(tid, agent="risk", recommendation="old")
    cutoff = js.list_decisions()[0]["ts"]
    js.log_decision(tid, agent="risk", recommendation="new")
    results = js.list_decisions(since=cutoff)
    # both have ts >= cutoff; ensure at least "new" is included
    recs = [d["recommendation"] for d in results]
    assert "new" in recs


def test_list_decisions_no_filter(fresh_db):
    for i in range(3):
        js.log_decision(None, agent="orchestrator", recommendation=f"rec-{i}")
    assert len(js.list_decisions()) == 3


# ── snapshots ─────────────────────────────────────────────────────────────────

def test_save_and_list_snapshot(fresh_db):
    positions = [{"symbol": "AAPL", "qty": -1}]
    js.save_snapshot(positions, net_delta=-50.0, net_vega=-200.0, realized_pnl=320.0)
    snaps = js.list_snapshots()
    assert len(snaps) == 1
    assert snaps[0]["net_delta"] == -50.0
    assert snaps[0]["positions_json"] == positions


def test_list_snapshots_since_filter(fresh_db):
    js.save_snapshot({}, 0, 0, 0)
    cutoff = js.list_snapshots()[0]["ts"]
    js.save_snapshot({}, 1, 1, 1)
    results = js.list_snapshots(since=cutoff)
    assert all(s["ts"] >= cutoff for s in results)


# ── rules ─────────────────────────────────────────────────────────────────────

def test_get_existing_rule(fresh_db):
    assert js.get_rule("max_single_pct") == "30"


def test_get_missing_rule_default(fresh_db):
    assert js.get_rule("nonexistent", default="99") == "99"
    assert js.get_rule("nonexistent") is None


def test_set_and_get_rule(fresh_db):
    js.set_rule("custom_key", 42)
    assert js.get_rule("custom_key") == "42"


def test_set_rule_upsert(fresh_db):
    js.set_rule("max_single_pct", 25)
    assert js.get_rule("max_single_pct") == "25"


def test_all_rules_returns_dict(fresh_db):
    rules = js.all_rules()
    assert isinstance(rules, dict)
    assert len(rules) >= 4  # seed rules


# ── alert dedup ───────────────────────────────────────────────────────────────

def test_should_fire_first_call(fresh_db):
    assert js.should_fire("iv_breach_AAPL", cooldown_minutes=60) is True


def test_should_fire_within_cooldown(fresh_db):
    js.should_fire("iv_breach_AAPL", cooldown_minutes=60)
    assert js.should_fire("iv_breach_AAPL", cooldown_minutes=60) is False


def test_should_fire_zero_cooldown(fresh_db):
    js.should_fire("alert_x", cooldown_minutes=0)
    # cooldown=0 means always fire
    assert js.should_fire("alert_x", cooldown_minutes=0) is True


def test_should_fire_independent_rules(fresh_db):
    js.should_fire("alert_a", cooldown_minutes=60)
    # different rule key should fire independently
    assert js.should_fire("alert_b", cooldown_minutes=60) is True


# ── transaction rollback ──────────────────────────────────────────────────────

def test_failed_insert_rolls_back(fresh_db):
    """Unknown column name raises ValueError before hitting DB, leaving DB clean."""
    with pytest.raises(ValueError, match="Unknown thesis field"):
        js.create_thesis(ticker="TSLA", nonexistent_column="bad")
    assert js.list_theses() == []


def test_db_still_functional_after_error(fresh_db):
    """After a failed operation, subsequent valid operations succeed."""
    try:
        js.create_thesis(ticker="TSLA", nonexistent_column="bad")
    except ValueError:
        pass
    tid = js.create_thesis(ticker="TSLA")
    assert js.get_thesis(tid)["ticker"] == "TSLA"


def test_loads_raises_on_corrupt_json(fresh_db):
    """Corrupt JSON in DB should raise JSONDecodeError, not silently return raw string."""
    import sqlite3
    con = sqlite3.connect(fresh_db)
    con.execute("INSERT INTO theses (ticker, opened_at, iv_snapshot) VALUES ('X','2026-01-01','not-json')")
    con.commit()
    con.close()
    with pytest.raises(Exception):  # json.JSONDecodeError during list_theses deserialization
        js.list_theses(ticker="X")


# ── intel items ───────────────────────────────────────────────────────────────

def test_create_and_list_intel_item_roundtrip(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        capture_method="manual",
        raw_text="HBM supply remains tight; MU and NVDA matter.",
        url="https://x.com/aleabitoreddit/status/1",
        summary="HBM supply-chain note",
        related_tickers=["MU", "NVDA"],
        portfolio_overlap=["MU"],
        impact_direction="bullish",
        urgency="watch",
        rationale="Mentions memory bottlenecks relevant to AI hardware.",
        raw_payload={"kind": "paste"},
    )

    items = js.list_intel_items()
    assert len(items) == 1
    assert items[0]["id"] == item_id
    assert items[0]["source"] == "Serenity"
    assert items[0]["source_handle"] == "aleabitoreddit"
    assert items[0]["related_tickers"] == ["MU", "NVDA"]
    assert items[0]["portfolio_overlap"] == ["MU"]
    assert items[0]["raw_payload"] == {"kind": "paste"}


def test_intel_items_are_append_only_even_with_same_url(fresh_db):
    kwargs = {
        "source": "Serenity",
        "source_handle": "aleabitoreddit",
        "capture_method": "manual",
        "raw_text": "Same link captured again with extra context.",
        "url": "https://x.com/aleabitoreddit/status/1",
        "related_tickers": ["MRVL"],
    }
    first = js.create_intel_item(**kwargs)
    second = js.create_intel_item(**kwargs)

    items = js.list_intel_items()
    assert [i["id"] for i in items] == [second, first]
    assert len(items) == 2


def test_intel_item_media_and_ticker_snapshot_roundtrip(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        capture_method="screenshot",
        item_ts="2026-06-09T00:06:11+08:00",
        raw_text="Still think this US list from $MRVL to $ARM to $INTC was goated.",
        media_path="agent/db/intel_media/demo.png",
        media_mime="image/png",
        media_name="serenity.png",
        ocr_text="Still think this US list from MRVL to ARM to INTC was goated.",
        related_tickers=["MRVL", "ARM", "INTC"],
        ticker_snapshot={
            "MRVL": {"baseline": 282.04, "current": 282.04, "since_pct": 0.0},
            "INTC": {"baseline": 107.06, "current": 107.06, "since_pct": 0.0},
        },
    )

    item = js.list_intel_items()[0]
    assert item["id"] == item_id
    assert item["item_ts"] == "2026-06-09T00:06:11+08:00"
    assert item["media_path"] == "agent/db/intel_media/demo.png"
    assert item["media_mime"] == "image/png"
    assert item["media_name"] == "serenity.png"
    assert item["ocr_text"].startswith("Still think")
    assert item["ticker_snapshot"]["MRVL"]["baseline"] == 282.04


def test_intel_item_external_id_roundtrip(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        capture_method="browser-import",
        external_id="1800000000000000000",
        item_ts="2026-06-09T00:06:11+08:00",
        url="https://x.com/aleabitoreddit/status/1800000000000000000",
        raw_text="Still think this US list from $MRVL to $ARM to $INTC was goated.",
        raw_payload={"import_format": "har"},
    )

    item = js.list_intel_items()[0]
    assert item["id"] == item_id
    assert item["external_id"] == "1800000000000000000"
    assert item["raw_payload"]["import_format"] == "har"


def test_list_intel_items_orders_by_post_time(fresh_db):
    first = js.create_intel_item(
        captured_at="2026-06-02T00:00:00Z",
        source="Serenity",
        source_handle="aleabitoreddit",
        capture_method="browser-dom",
        external_id="old",
        item_ts="2026-05-01T00:00:00Z",
        raw_text="$MRVL old post",
    )
    second = js.create_intel_item(
        captured_at="2026-05-01T00:00:00Z",
        source="Serenity",
        source_handle="aleabitoreddit",
        capture_method="browser-dom",
        external_id="new",
        item_ts="2026-06-01T00:00:00Z",
        raw_text="$MRVL new post",
    )

    assert [item["id"] for item in js.list_intel_items(limit=10)] == [second, first]
