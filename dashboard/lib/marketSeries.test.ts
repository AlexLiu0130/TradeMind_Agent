import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYahooSeries, buildComparison } from "./marketSeries.ts";

test("parseYahooSeries extracts {date, close}, prefers adjclose, skips nulls", () => {
  const payload = {
    chart: {
      result: [
        {
          timestamp: [1748736000, 1748822400, 1748908800], // 2025-06-01, -02, -03 UTC
          indicators: {
            quote: [{ close: [100, 110, 120] }],
            adjclose: [{ adjclose: [99, null, 121] }],
          },
        },
      ],
    },
  };
  const rows = parseYahooSeries(payload);
  // adjclose preferred; null adjclose falls back to close; date is ISO yyyy-mm-dd
  assert.deepEqual(rows, [
    { date: "2025-06-01", close: 99 },
    { date: "2025-06-02", close: 110 },
    { date: "2025-06-03", close: 121 },
  ]);
});

test("parseYahooSeries returns [] on empty/missing payload", () => {
  assert.deepEqual(parseYahooSeries(null), []);
  assert.deepEqual(parseYahooSeries({ chart: { result: [] } }), []);
});

test("buildComparison normalizes each symbol to % from its first close, aligned by date", () => {
  const points = buildComparison({
    SPY: [
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 110 },
    ],
    QQQ: [
      { date: "2026-06-01", close: 200 },
      { date: "2026-06-02", close: 190 },
    ],
  });
  assert.deepEqual(points, [
    { date: "2026-06-01", SPY: 0, QQQ: 0 },
    { date: "2026-06-02", SPY: 10, QQQ: -5 },
  ]);
});

test("buildComparison aligns missing dates as null", () => {
  const points = buildComparison({
    SPY: [
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 105 },
    ],
    SMH: [{ date: "2026-06-02", close: 50 }], // missing 06-01
  });
  assert.equal(points[0].date, "2026-06-01");
  assert.equal(points[0].SPY, 0);
  assert.equal(points[0].SMH, null);
  assert.equal(points[1].SMH, 0);
});
