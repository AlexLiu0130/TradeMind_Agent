// Pure market-data transforms + symbol config for the top market status bar.
// No network here — fetching/caching lives in lib/marketData.ts so this stays testable.

export type MarketKind = "index" | "vol" | "rate" | "dollar";

export interface MarketSymbol {
  key: string;
  label: string;
  yahoo: string;
  kind: MarketKind;
}

// The status bar's six anchors: broad market, tech, semis, vol, rates, dollar.
export const MARKET_SYMBOLS: MarketSymbol[] = [
  { key: "SPY", label: "SPY", yahoo: "SPY", kind: "index" },
  { key: "QQQ", label: "QQQ", yahoo: "QQQ", kind: "index" },
  { key: "SMH", label: "SMH", yahoo: "SMH", kind: "index" },
  { key: "VIX", label: "VIX", yahoo: "^VIX", kind: "vol" },
  { key: "US10Y", label: "US 10Y", yahoo: "^TNX", kind: "rate" },
  { key: "DXY", label: "DXY", yahoo: "DX-Y.NYB", kind: "dollar" },
];

export interface MarketTicker {
  key: string;
  label: string;
  kind: MarketKind;
  price: number | null;
  changePct: number | null;
  asOf: number | null; // ms epoch of the quote
  ok: boolean;
}

export type Session = "pre" | "rth" | "post" | "closed";
export type Freshness = "live" | "delayed" | "stale" | "none";

export function changePct(price: number | null, prevClose: number | null): number | null {
  if (price == null || prevClose == null || prevClose === 0) return null;
  return ((price - prevClose) / prevClose) * 100;
}

interface YahooQuote {
  price: number;
  prevClose: number;
  asOf: number;
}

export function parseYahooChart(payload: unknown): YahooQuote | null {
  const meta = (payload as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } })
    ?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (typeof price !== "number" || typeof prevClose !== "number") return null;
  const asOf = typeof meta.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : Date.now();
  return { price, prevClose, asOf };
}

// US equity session in ET: pre 04:00–09:30, rth 09:30–16:00, post 16:00–20:00.
export function marketSession(d: Date): Session {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  let hh = Number(get("hour"));
  if (hh === 24) hh = 0; // Intl emits "24" at midnight in some runtimes
  const mins = hh * 60 + Number(get("minute"));
  if (mins >= 240 && mins < 570) return "pre";
  if (mins >= 570 && mins < 960) return "rth";
  if (mins >= 960 && mins < 1200) return "post";
  return "closed";
}

export function freshness(asOfMs: number | null, nowMs: number): Freshness {
  if (asOfMs == null) return "none";
  const age = nowMs - asOfMs;
  if (age < 2 * 60_000) return "live";
  if (age < 15 * 60_000) return "delayed";
  return "stale";
}
