from agent.loops.qveris_serenity_sync import normalize_tweet


def test_normalize_tweet_prefers_note_tweet_text():
    post = normalize_tweet(
        {
            "id": "2072574465763111166",
            "created_at": "2026-07-02T06:53:53.000Z",
            "text": "truncated https://t.co/x",
            "note_tweet": {"text": "full $META note"},
        }
    )

    assert post["id"] == "2072574465763111166"
    assert post["text"] == "full $META note"
    assert post["url"].endswith("/2072574465763111166")


def test_normalize_tweet_rejects_missing_text():
    assert normalize_tweet({"id": "1", "text": ""}) is None
