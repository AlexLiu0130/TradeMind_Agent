from agent.loops.serenity_har_replay import (
    extract_bottom_cursor,
    extract_posts,
    sanitize_har_headers,
    url_with_cursor,
)


def test_extract_posts_filters_to_source_author_and_keeps_long_text():
    payload = {
        "data": {
            "user": {
                "result": {
                    "timeline_v2": {
                        "timeline": {
                            "instructions": [
                                {
                                    "entries": [
                                        {
                                            "content": {
                                                "itemContent": {
                                                    "tweet_results": {
                                                        "result": {
                                                            "__typename": "Tweet",
                                                            "rest_id": "111",
                                                            "core": {
                                                                "user_results": {
                                                                    "result": {"legacy": {"screen_name": "aleabitoreddit"}}
                                                                }
                                                            },
                                                            "legacy": {
                                                                "created_at": "Sun Mar 08 13:14:15 +0000 2026",
                                                                "full_text": "Short text",
                                                                "user_id_str": "1940360837547565056",
                                                            },
                                                            "note_tweet": {
                                                                "note_tweet_results": {
                                                                    "result": {
                                                                        "text": "Long note text about $MRVL and $ARM"
                                                                    }
                                                                }
                                                            },
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            "content": {
                                                "itemContent": {
                                                    "tweet_results": {
                                                        "result": {
                                                            "__typename": "Tweet",
                                                            "rest_id": "222",
                                                            "core": {
                                                                "user_results": {
                                                                    "result": {"legacy": {"screen_name": "other_user"}}
                                                                }
                                                            },
                                                            "legacy": {
                                                                "created_at": "Sun Mar 08 13:14:15 +0000 2026",
                                                                "full_text": "Quoted outsider $NVDA",
                                                                "user_id_str": "999",
                                                            },
                                                        }
                                                    }
                                                }
                                            }
                                        },
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        }
    }

    posts = extract_posts(payload, source_handle="aleabitoreddit", source_user_id="1940360837547565056")

    assert posts == [
        {
            "id": "111",
            "time": "2026-03-08T13:14:15.000Z",
            "url": "https://x.com/aleabitoreddit/status/111",
            "text": "Long note text about $MRVL and $ARM",
        }
    ]


def test_extract_bottom_cursor_uses_bottom_value():
    payload = {
        "instructions": [
            {
                "entries": [
                    {"content": {"cursorType": "Top", "value": "top-cursor"}},
                    {"content": {"cursorType": "Bottom", "value": "bottom-cursor"}},
                ]
            }
        ]
    }

    assert extract_bottom_cursor(payload) == "bottom-cursor"


def test_sanitize_har_headers_keeps_request_headers_but_omits_internal_fields():
    headers = sanitize_har_headers(
        [
            {"name": "authorization", "value": "Bearer secret"},
            {"name": "cookie", "value": "auth_token=secret"},
            {"name": "x-csrf-token", "value": "csrf"},
            {"name": ":authority", "value": "x.com"},
            {"name": "content-length", "value": "100"},
            {"name": "user-agent", "value": "Chrome"},
        ]
    )

    assert headers["authorization"] == "Bearer secret"
    assert headers["cookie"] == "auth_token=secret"
    assert headers["x-csrf-token"] == "csrf"
    assert headers["user-agent"] == "Chrome"
    assert ":authority" not in headers
    assert "content-length" not in headers


def test_url_with_cursor_replaces_cursor_and_count():
    url = (
        "https://x.com/i/api/graphql/op/UserTweets?"
        "variables=%7B%22userId%22%3A%221%22%2C%22count%22%3A20%2C%22cursor%22%3A%22old%22%7D"
        "&features=%7B%22flag%22%3Atrue%7D"
    )

    updated = url_with_cursor(url, "new-cursor", 40)

    assert "%22cursor%22%3A%22new-cursor%22" in updated
    assert "%22count%22%3A40" in updated
    assert "features=%7B%22flag%22%3Atrue%7D" in updated
