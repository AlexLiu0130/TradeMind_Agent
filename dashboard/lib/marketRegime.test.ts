import { test } from "node:test";
import assert from "node:assert/strict";
import { windowReturn, computeRegime } from "./marketRegime.ts";

test("windowReturn = last/first - 1 in %", () => {
  assert.equal(windowReturn([100, 110]), 10);
  assert.equal(windowReturn([100, 90]), -10);
  assert.equal(windowReturn([100]), null);
  assert.equal(windowReturn([]), null);
  assert.equal(windowReturn([0, 50]), null);
});

test("computeRegime classifies a clean risk-on tape", () => {
  const r = computeRegime({
    vix: 13, us10y: 4.2, us10yChgPct: -1.5,
    spy1m: 5, qqq1m: 8, smh1m: 12, rsp1m: 4.5,
  });
  const by = Object.fromEntries(r.dimensions.map((d) => [d.key, d]));
  assert.equal(by.risk_appetite.tone, "bull");      // VIX 13
  assert.equal(by.trend.tone, "bull");              // SPY +5%
  assert.equal(by.volatility.tone, "bull");         // VIX < 15
  assert.equal(by.tech_strength.tone, "bull");      // QQQ−SPY = +3
  assert.equal(by.rate_pressure.tone, "bull");      // yields easing
  assert.equal(by.breadth.tone, "bull");            // RSP−SPY = -0.5 (broad)
  assert.equal(r.confidencePct, 100);               // all 6 dimensions have data
});

test("computeRegime flags a risk-off tape", () => {
  const r = computeRegime({
    vix: 31, us10y: 4.8, us10yChgPct: 2.0,
    spy1m: -6, qqq1m: -9, smh1m: -12, rsp1m: -10,
  });
  const by = Object.fromEntries(r.dimensions.map((d) => [d.key, d]));
  assert.equal(by.risk_appetite.tone, "bear");      // VIX 31
  assert.equal(by.trend.tone, "bear");              // SPY -6%
  assert.equal(by.tech_strength.tone, "bear");      // QQQ−SPY = -3
  assert.equal(by.rate_pressure.tone, "bear");      // yields rising
  assert.equal(by.breadth.tone, "bear");            // RSP−SPY = -4 (narrow)
});

test("computeRegime degrades confidence + marks Unknown when data missing", () => {
  const r = computeRegime({
    vix: null, us10y: null, us10yChgPct: null,
    spy1m: 2, qqq1m: 3, smh1m: 4, rsp1m: 1,
  });
  const by = Object.fromEntries(r.dimensions.map((d) => [d.key, d]));
  assert.equal(by.risk_appetite.state, "Unknown");
  assert.equal(by.risk_appetite.tone, "neutral");
  assert.ok(r.confidencePct < 100);
});
