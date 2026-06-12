// Fetch + cache layer for the market regime matrix. Pure scoring lives in
// lib/marketRegime.ts; this module gathers the inputs (VIX, 10Y, 1M returns
// incl. RSP for breadth) from Yahoo and returns a computed MarketRegime.
import { parseYahooChart, changePct } from "@/lib/market";
import { parseYahooSeries } from "@/lib/marketSeries";
import { computeRegime, windowReturn, type MarketRegime } from "@/lib/marketRegime";

export interface RegimeResponse {
  regime: MarketRegime;
  as_of: number; // ms epoch when inputs were assembled
  missing: string[]; // input names that failed — surfaced, never faked
  cached: boolean;
}

const TTL_MS = 15 * 60_000; // regime inputs are slow-moving (1M windows + VIX level)
let cache: { ts: number; data: RegimeResponse } | null = null;

const UA = { "User-Agent": "TradeMind/1.0" };

async function fetchQuote(yahoo: string): Promise<{ price: number; chgPct: number | null } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1d&interval=1d`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const q = parseYahooChart(await res.json());
    if (!q) return null;
    return { price: q.price, chgPct: changePct(q.price, q.prevClose) };
  } catch {
    return null;
  }
}

async function fetch1mReturn(yahoo: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1mo&interval=1d`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const closes = parseYahooSeries(await res.json()).map((p) => p.close);
    return windowReturn(closes);
  } catch {
    return null;
  }
}

export async function getMarketRegime(fresh = false): Promise<RegimeResponse> {
  const now = Date.now();
  if (!fresh && cache && now - cache.ts < TTL_MS) {
    return { ...cache.data, cached: true };
  }

  const [vix, us10y, spy1m, qqq1m, smh1m, rsp1m] = await Promise.all([
    fetchQuote("^VIX"),
    fetchQuote("^TNX"),
    fetch1mReturn("SPY"),
    fetch1mReturn("QQQ"),
    fetch1mReturn("SMH"),
    fetch1mReturn("RSP"),
  ]);

  const missing: string[] = [];
  if (!vix) missing.push("VIX");
  if (!us10y) missing.push("US10Y");
  if (spy1m == null) missing.push("SPY 1M");
  if (qqq1m == null) missing.push("QQQ 1M");
  if (smh1m == null) missing.push("SMH 1M");
  if (rsp1m == null) missing.push("RSP 1M");

  const regime = computeRegime({
    vix: vix?.price ?? null,
    us10y: us10y?.price ?? null,
    us10yChgPct: us10y?.chgPct ?? null,
    spy1m, qqq1m, smh1m, rsp1m,
  });

  const data: RegimeResponse = { regime, as_of: now, missing, cached: false };

  // Cache only if at least one dimension has data; if all failed, fall back to
  // the last good snapshot (flagged cached) rather than an all-Unknown board.
  if (regime.confidencePct > 0) cache = { ts: now, data };
  else if (cache) return { ...cache.data, cached: true };

  return data;
}
