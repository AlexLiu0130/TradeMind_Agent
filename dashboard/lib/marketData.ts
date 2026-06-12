import { getDb } from "@/lib/db";
import {
  MARKET_SYMBOLS,
  changePct,
  marketSession,
  parseYahooChart,
  type MarketTicker,
  type Session,
} from "@/lib/market";

export interface MarketOverview {
  tickers: MarketTicker[];
  session: Session;
  as_of: number | null; // newest quote time across tickers (ms)
  cached: boolean;
  stale?: boolean;
}

let cache: { ts: number; data: MarketOverview } | null = null;

// Reuse the same dashboard-editable freshness knob as the portfolio data
// (Settings → Data Freshness). 0 = always fresh.
function cacheTtlMs(): number {
  try {
    const row = getDb().prepare("SELECT value FROM rules WHERE key='ibkr_cache_ttl'").get() as
      | { value: string }
      | undefined;
    const secs = row ? Number(row.value) : 60;
    return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : 60_000;
  } catch {
    return 60_000;
  }
}

async function fetchTicker(sym: (typeof MARKET_SYMBOLS)[number]): Promise<MarketTicker> {
  const base: MarketTicker = {
    key: sym.key,
    label: sym.label,
    kind: sym.kind,
    price: null,
    changePct: null,
    asOf: null,
    ok: false,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.yahoo)}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "TradeMind/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return base;
    const quote = parseYahooChart(await res.json());
    if (!quote) return base;
    return {
      ...base,
      price: quote.price,
      changePct: changePct(quote.price, quote.prevClose),
      asOf: quote.asOf,
      ok: true,
    };
  } catch {
    return base; // never fake a zero — leave nulls and ok:false
  }
}

async function build(): Promise<MarketOverview> {
  const tickers = await Promise.all(MARKET_SYMBOLS.map(fetchTicker));
  const times = tickers.map((t) => t.asOf).filter((t): t is number => t != null);
  return {
    tickers,
    session: marketSession(new Date()),
    as_of: times.length ? Math.max(...times) : null,
    cached: false,
  };
}

export async function getMarketOverview(options: { fresh?: boolean } = {}): Promise<MarketOverview> {
  const ttlMs = cacheTtlMs();
  const now = Date.now();

  if (!options.fresh && ttlMs > 0 && cache && now - cache.ts < ttlMs) {
    return { ...cache.data, cached: true };
  }

  const data = await build();
  const anyOk = data.tickers.some((t) => t.ok);

  // All fetches failed but we have a prior good snapshot → serve it, flagged stale.
  if (!anyOk && cache) {
    return { ...cache.data, cached: true, stale: true };
  }

  if (anyOk) cache = { ts: now, data };
  return data;
}
