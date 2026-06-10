import assert from "node:assert/strict";
import test from "node:test";
import { extractSerenityPostsFromPayload } from "./intelImport.ts";

test("extracts tweet-like objects from HAR browser exports", () => {
  const har = {
    log: {
      entries: [
        {
          response: {
            content: {
              text: JSON.stringify({
                data: {
                  user: {
                    result: {
                      timeline: {
                        instructions: [
                          {
                            entries: [
                              {
                                content: {
                                  itemContent: {
                                    tweet_results: {
                                      result: {
                                        rest_id: "1800000000000000000",
                                        legacy: {
                                          full_text: "Still think this US list from $MRVL to $ARM to $INTC was goated.",
                                          created_at: "Mon Jun 08 16:06:11 +0000 2026",
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            },
          },
        },
      ],
    },
  };

  const posts = extractSerenityPostsFromPayload(JSON.stringify(har));

  assert.equal(posts.length, 1);
  assert.equal(posts[0].external_id, "1800000000000000000");
  assert.equal(posts[0].text, "Still think this US list from $MRVL to $ARM to $INTC was goated.");
  assert.equal(posts[0].item_ts, "2026-06-08T16:06:11.000Z");
});

test("splits plain text exports into post blocks", () => {
  const posts = extractSerenityPostsFromPayload(
    "First post about $MRVL and $ARM.\n\n---\n\nSecond post about $INTC.",
  );

  assert.deepEqual(posts.map((p) => p.text), [
    "First post about $MRVL and $ARM.",
    "Second post about $INTC.",
  ]);
});

test("does not treat encoded telemetry payloads as posts", () => {
  const har = {
    log: {
      entries: [
        {
          request: { url: "https://x.com/i/api/1.1/jot/client_event.json" },
          response: {
            content: {
              text: "debug=true&log=%5B%7B%22_category_%22%3A%22client_event%22%2C%22event_namespace%22%3A%7B%22page%22%3A%22app%22%7D%7D%5D",
            },
          },
        },
      ],
    },
  };

  assert.deepEqual(extractSerenityPostsFromPayload(JSON.stringify(har)), []);
});
