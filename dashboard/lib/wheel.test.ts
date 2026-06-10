import assert from "node:assert/strict";
import test from "node:test";
import { buildWheelCardsFromDashboard } from "./wheel.ts";

test("builds wheel cards from option positions and prefers underlying price", () => {
  const cards = buildWheelCardsFromDashboard({
    positions: [
      {
        symbol: "MRVL  260619P00070000",
        sec_type: "OPT",
        position: -1,
        market_price: 3.25,
        und_price: 82.4,
        unrealized_pnl: -120,
        expiration: "20260619",
        strike: 70,
        right: "P",
        greeks: { iv: 0.52, delta: -0.18 },
      },
      {
        symbol: "NVDA",
        sec_type: "STK",
        position: 100,
        market_price: 145,
        unrealized_pnl: 500,
      },
    ],
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].ticker, "MRVL");
  assert.equal(cards[0].phase, "Put Leg");
  assert.equal(cards[0].underlying, 82.4);
  assert.equal(cards[0].iv, 0.52);
  assert.equal(cards[0].delta, -0.18);
});
