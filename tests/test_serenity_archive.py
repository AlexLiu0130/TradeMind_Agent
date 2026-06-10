from agent import journal_store as js
from agent.serenity_archive import import_posts


def test_import_posts_dedupes_by_external_id_and_text(fresh_db):
    posts = [
        {
            "id": "2061704502076747781",
            "time": "2026-06-02T07:00:32.000Z",
            "url": "https://x.com/aleabitoreddit/status/2061704502076747781",
            "text": "For companies like $NVDA, $AVGO, $AMD, to $MRVL using the foundry.",
        },
        {
            "id": "2061704502076747781",
            "time": "2026-06-02T07:00:32.000Z",
            "url": "https://x.com/aleabitoreddit/status/2061704502076747781",
            "text": "For companies like $NVDA, $AVGO, $AMD, to $MRVL using the foundry.",
        },
        {
            "id": "different-id-same-text",
            "time": "2026-06-02T07:00:32.000Z",
            "url": "https://x.com/aleabitoreddit/status/different-id-same-text",
            "text": "For companies like $NVDA, $AVGO, $AMD, to $MRVL using the foundry.",
        },
    ]

    stats = import_posts(posts, window_start="2026-06-02", window_end="2026-06-03")

    assert stats["input"] == 3
    assert stats["inserted"] == 1
    assert stats["skipped_existing_id"] == 1
    assert stats["skipped_existing_text"] == 1
    item = js.list_intel_items(limit=10)[0]
    assert item["external_id"] == "2061704502076747781"
    assert item["related_tickers"] == ["NVDA", "AVGO", "AMD", "MRVL"]
    assert item["portfolio_overlap"] == ["AMD", "MRVL"]


def test_import_posts_rejects_telemetry_and_empty_posts(fresh_db):
    stats = import_posts(
        [
            {"id": "bad-1", "time": "2026-06-02T00:00:00Z", "text": "debug=true&log=%5B%7B%22_category_%22%3A%22client_event%22%7D%5D"},
            {"id": "bad-2", "time": "2026-06-02T00:00:00Z", "text": "sub_topics=%2Flive_content%2F1686936948022427648"},
            {"id": "bad-3", "time": "2026-06-02T00:00:00Z", "text": ""},
        ],
        window_start="2026-06-02",
        window_end="2026-06-03",
    )

    assert stats["input"] == 3
    assert stats["inserted"] == 0
    assert stats["rejected"] == 3
    assert js.list_intel_items(limit=10) == []


def test_collection_window_roundtrip(fresh_db):
    js.upsert_intel_collection_window(
        source_handle="aleabitoreddit",
        window_start="2026-06-01",
        window_end="2026-06-02",
        status="running",
        found_count=12,
        inserted_count=10,
        duplicate_count=2,
        notes="first pass",
    )
    js.upsert_intel_collection_window(
        source_handle="aleabitoreddit",
        window_start="2026-06-01",
        window_end="2026-06-02",
        status="done",
        found_count=14,
        inserted_count=12,
        duplicate_count=2,
        notes="complete",
    )

    windows = js.list_intel_collection_windows()
    assert len(windows) == 1
    assert windows[0]["status"] == "done"
    assert windows[0]["found_count"] == 14
    assert windows[0]["inserted_count"] == 12
    assert windows[0]["notes"] == "complete"


def test_import_posts_can_skip_window_update(fresh_db):
    stats = import_posts(
        [
            {
                "id": "profile-scroll-1",
                "time": "2026-03-20T00:00:00Z",
                "url": "https://x.com/aleabitoreddit/status/profile-scroll-1",
                "text": "Watching $MRVL and $ARM supply chain setup.",
            }
        ],
        window_start="2026-03-17",
        window_end="2026-03-24",
        capture_method="browser-profile",
        update_window=False,
    )

    assert stats["inserted"] == 1
    assert js.list_intel_items(limit=10)[0]["external_id"] == "profile-scroll-1"
    assert js.list_intel_collection_windows() == []
