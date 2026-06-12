import { test } from "node:test";
import assert from "node:assert/strict";
import { changePct, parseYahooChart, marketSession, freshness } from "./market.ts";

test("changePct computes percent change, null on bad input", () => {
  assert.equal(changePct(110, 100), 10);
  assert.equal(changePct(95, 100), -5);
  assert.equal(changePct(100, 0), null);
  assert.equal(changePct(100, null), null);
  assert.equal(changePct(null, 100), null);
});

test("parseYahooChart extracts price/prevClose/asOf from chart payload", () => {
  const payload = {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: 521.34,
            chartPreviousClose: 518.0,
            regularMarketTime: 1749393600, // seconds
            currency: "USD",
          },
        },
      ],
    },
  };
  const q = parseYahooChart(payload);
  assert.equal(q?.price, 521.34);
  assert.equal(q?.prevClose, 518.0);
  assert.equal(q?.asOf, 1749393600 * 1000); // ms
});

test("parseYahooChart returns null on missing/empty payload", () => {
  assert.equal(parseYahooChart(null), null);
  assert.equal(parseYahooChart({ chart: { result: [] } }), null);
  assert.equal(parseYahooChart({ chart: { result: [{ meta: {} }] } }), null);
});

test("marketSession classifies ET trading windows", () => {
  // 2026-06-08 is a Monday (EDT, UTC-4).
  assert.equal(marketSession(new Date("2026-06-08T13:00:00Z")), "pre");   // 09:00 ET
  assert.equal(marketSession(new Date("2026-06-08T14:00:00Z")), "rth");   // 10:00 ET
  assert.equal(marketSession(new Date("2026-06-08T20:30:00Z")), "post");  // 16:30 ET
  assert.equal(marketSession(new Date("2026-06-08T02:00:00Z")), "closed");// 22:00 ET Sun
  // 2026-06-07 is a Sunday.
  assert.equal(marketSession(new Date("2026-06-07T14:00:00Z")), "closed");
});

test("freshness buckets by age", () => {
  const now = 1_000_000_000_000;
  assert.equal(freshness(now - 30_000, now), "live");      // 30s
  assert.equal(freshness(now - 5 * 60_000, now), "delayed"); // 5min
  assert.equal(freshness(now - 60 * 60_000, now), "stale");  // 1h
  assert.equal(freshness(null, now), "none");
});
