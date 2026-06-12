import { test } from "node:test";
import assert from "node:assert/strict";
import {
  intelToEvent, expiryEvents, earningsToEvent, alertToEvent, mergeEvents,
} from "./events.ts";

test("intelToEvent maps urgency to severity and parses tickers", () => {
  const ev = intelToEvent({
    id: 7, captured_at: "2026-06-08T12:00:00Z", item_ts: "2026-06-08T10:00:00Z",
    source: "serenity", title: "NVDA supply chain note", summary: "sum",
    related_tickers: '["NVDA","TSM"]', impact_direction: "bearish", urgency: "alert",
  });
  assert.equal(ev.type, "intel");
  assert.equal(ev.ts, "2026-06-08T10:00:00Z"); // prefers item_ts
  assert.deepEqual(ev.tickers, ["NVDA", "TSM"]);
  assert.equal(ev.severity, "alert");
  assert.equal(ev.source, "serenity");
});

test("intelToEvent falls back to captured_at and tolerates bad ticker JSON", () => {
  const ev = intelToEvent({
    id: 8, captured_at: "2026-06-08T12:00:00Z", item_ts: null,
    source: "news", title: null, summary: null,
    related_tickers: "not-json", impact_direction: null, urgency: "watch",
  });
  assert.equal(ev.ts, "2026-06-08T12:00:00Z");
  assert.deepEqual(ev.tickers, []);
  assert.equal(ev.severity, "watch");
});

test("expiryEvents builds one event per option leg with DTE-based severity", () => {
  const now = new Date("2026-06-08T00:00:00Z");
  const evs = expiryEvents(
    [
      { symbol: "AAPL", sec_type: "OPT", expiration: "20260610", strike: 200, right: "P", position: -1 },
      { symbol: "TSLA", sec_type: "OPT", expiration: "20260710", strike: 300, right: "C", position: -2 },
      { symbol: "NVDA", sec_type: "STK", position: 100 },
    ],
    now,
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].severity, "alert"); // 2 DTE ≤ 5
  assert.equal(evs[0].tickers[0], "AAPL");
  assert.ok(evs[0].title.includes("P200"));
  assert.equal(evs[1].severity, "info"); // 32 DTE
});

test("earningsToEvent returns null without a date — never fabricates", () => {
  assert.equal(earningsToEvent({ symbol: "AAPL", next_earnings_date: null, days_until: null }), null);
  const ev = earningsToEvent({ symbol: "TSLA", next_earnings_date: "2026-07-22", days_until: 40 });
  assert.ok(ev);
  assert.equal(ev!.type, "earnings");
  assert.equal(ev!.severity, "info");
  const soon = earningsToEvent({ symbol: "NVDA", next_earnings_date: "2026-06-10", days_until: 2 });
  assert.equal(soon!.severity, "alert");
});

test("alertToEvent only emits for fired rules", () => {
  assert.equal(alertToEvent({ rule: "max_single_pct", last_fired_at: null }), null);
  const ev = alertToEvent({ rule: "max_single_pct", last_fired_at: "2026-06-07T15:00:00Z" });
  assert.equal(ev!.type, "risk");
  assert.equal(ev!.severity, "alert");
});

test("mergeEvents sorts by time descending and dedupes by id", () => {
  const a = { id: "x", type: "intel" as const, ts: "2026-06-08T10:00:00Z", title: "A", tickers: [], severity: "info" as const, source: "s" };
  const b = { id: "y", type: "risk" as const, ts: "2026-06-08T12:00:00Z", title: "B", tickers: [], severity: "alert" as const, source: "s" };
  const merged = mergeEvents([[a], [b, { ...a, title: "dup" }]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "y"); // newest first
});
