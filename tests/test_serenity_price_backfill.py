import json

from agent import journal_store as js
from agent.loops import backfill_serenity_prices as backfill


def _item_snapshot(item_id: int):
    with js._conn() as con:
        row = con.execute("SELECT ticker_snapshot FROM intel_items WHERE id=?", (item_id,)).fetchone()
    return json.loads(row["ticker_snapshot"])


def test_backfill_updates_baseline_current_and_since_pct(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        external_id="price-1",
        capture_method="test",
        item_ts="2026-06-08T16:06:11Z",
        raw_text="Still like $MRVL from here.",
        summary="Still like MRVL",
        related_tickers=["MRVL"],
        portfolio_overlap=["MRVL"],
        impact_direction="bullish",
        urgency="watch",
        rationale="test",
        ticker_snapshot={"MRVL": {"baseline": None, "current": None, "since_pct": None, "source": "pending"}},
        raw_payload={"test": True},
    )

    def fake_fetch(symbol, start_date, end_date):
        assert symbol == "MRVL"
        return [
            {"symbol": symbol, "price_date": "2026-06-05", "close": 98.0, "source": "test"},
            {"symbol": symbol, "price_date": "2026-06-08", "close": 100.0, "source": "test"},
            {"symbol": symbol, "price_date": "2026-06-09", "close": 115.0, "source": "test"},
        ]

    stats = backfill.backfill_prices(fetcher=fake_fetch)

    assert stats["items_updated"] == 1
    snap = _item_snapshot(item_id)
    assert snap["MRVL"]["baseline"] == 98.0
    assert snap["MRVL"]["baseline_date"] == "2026-06-05"
    assert snap["MRVL"]["current"] == 115.0
    assert snap["MRVL"]["current_date"] == "2026-06-09"
    assert snap["MRVL"]["since_pct"] == 17.35
    assert snap["MRVL"]["source"] == "test"


def test_backfill_uses_previous_close_for_weekend_posts(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        external_id="price-2",
        capture_method="test",
        item_ts="2026-06-07T12:00:00Z",
        raw_text="Weekend thought on $ARM.",
        summary="Weekend ARM",
        related_tickers=["ARM"],
        portfolio_overlap=["ARM"],
        impact_direction="uncertain",
        urgency="watch",
        rationale="test",
        ticker_snapshot={"ARM": {"baseline": None, "current": None, "since_pct": None, "source": "pending"}},
        raw_payload={"test": True},
    )

    def fake_fetch(symbol, start_date, end_date):
        return [
            {"symbol": symbol, "price_date": "2026-06-05", "close": 50.0, "source": "test"},
            {"symbol": symbol, "price_date": "2026-06-08", "close": 55.0, "source": "test"},
        ]

    backfill.backfill_prices(fetcher=fake_fetch)

    snap = _item_snapshot(item_id)
    assert snap["ARM"]["baseline"] == 50.0
    assert snap["ARM"]["baseline_rule"] == "previous_close"
    assert snap["ARM"]["current"] == 55.0


def test_backfill_uses_previous_close_for_intraday_posts(fresh_db):
    item_id = js.create_intel_item(
        source="Serenity",
        source_handle="aleabitoreddit",
        external_id="price-3",
        capture_method="test",
        item_ts="2026-06-09T15:00:00Z",
        raw_text="Intraday note on $NVDA.",
        summary="Intraday NVDA",
        related_tickers=["NVDA"],
        portfolio_overlap=[],
        impact_direction="uncertain",
        urgency="watch",
        rationale="test",
        ticker_snapshot={"NVDA": {"baseline": None, "current": None, "since_pct": None, "source": "pending"}},
        raw_payload={"test": True},
    )

    def fake_fetch(symbol, start_date, end_date):
        return [
            {"symbol": symbol, "price_date": "2026-06-08", "close": 140.0, "source": "test"},
            {"symbol": symbol, "price_date": "2026-06-09", "close": 150.0, "source": "test"},
        ]

    backfill.backfill_prices(fetcher=fake_fetch)

    snap = _item_snapshot(item_id)
    assert snap["NVDA"]["baseline"] == 140.0
    assert snap["NVDA"]["baseline_date"] == "2026-06-08"
