import { test } from "node:test";
import assert from "node:assert/strict";
import { trendDelta, maxUnderlyingPct } from "./riskHistory.ts";

const DAY = 86_400_000;

test("trendDelta = current minus value N days ago", () => {
  const now = 100 * DAY;
  const pts = [
    { ts: now - 30 * DAY, value: 10 },
    { ts: now - 7 * DAY, value: 25 },
    { ts: now - 1 * DAY, value: 40 },
    { ts: now, value: 50 },
  ];
  assert.equal(trendDelta(pts, now, 7), 25); // 50 - 25
  assert.equal(trendDelta(pts, now, 30), 40); // 50 - 10
});

test("trendDelta picks the latest point at-or-before the window start", () => {
  const now = 100 * DAY;
  const pts = [
    { ts: now - 9 * DAY, value: 5 },
    { ts: now - 8 * DAY, value: 8 },
    { ts: now, value: 10 },
  ];
  // window start = now-7d; baseline = point at now-8d (latest ≤ start)
  assert.equal(trendDelta(pts, now, 7), 2);
});

test("trendDelta returns null when history is too short — never fakes 0", () => {
  const now = 100 * DAY;
  assert.equal(trendDelta([], now, 7), null);
  assert.equal(trendDelta([{ ts: now, value: 50 }], now, 7), null);
  // all points inside the window → no baseline
  assert.equal(trendDelta([{ ts: now - 2 * DAY, value: 1 }, { ts: now, value: 3 }], now, 7), null);
});

test("trendDelta ignores null values", () => {
  const now = 100 * DAY;
  const pts = [
    { ts: now - 8 * DAY, value: null },
    { ts: now - 7 * DAY, value: 20 },
    { ts: now, value: 30 },
  ];
  assert.equal(trendDelta(pts, now, 7), 10);
});

test("maxUnderlyingPct groups options under their underlying", () => {
  const pct = maxUnderlyingPct([
    { symbol: "AAPL", market_value: 6000 },
    { symbol: "AAPL  260515P00145000", market_value: -2000 },
    { symbol: "TSLA", market_value: 2000 },
  ]);
  // AAPL gross = 8000 of 10000 total
  assert.equal(pct, 80);
});

test("maxUnderlyingPct returns null on empty book", () => {
  assert.equal(maxUnderlyingPct([]), null);
  assert.equal(maxUnderlyingPct([{ symbol: "X", market_value: 0 }]), null);
});
