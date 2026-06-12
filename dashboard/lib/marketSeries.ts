// Pure transforms + config for the market comparison chart (SPY/QQQ/SMH normalized).
// No network here — fetching/caching lives in lib/marketSeriesData.ts.

export interface RangeOption {
  key: string;
  label: string;
  range: string; // Yahoo `range` param
  interval: string; // Yahoo `interval` param
}

export const SERIES_RANGES: RangeOption[] = [
  { key: "1mo", label: "1M", range: "1mo", interval: "1d" },
  { key: "3mo", label: "3M", range: "3mo", interval: "1d" },
  { key: "6mo", label: "6M", range: "6mo", interval: "1d" },
  { key: "1y", label: "1Y", range: "1y", interval: "1wk" },
];

// The three market anchors the comparison chart plots.
export const SERIES_SYMBOLS = [
  { key: "SPY", yahoo: "SPY", color: "#e6e9ef" },
  { key: "QQQ", yahoo: "QQQ", color: "#6ea8d8" },
  { key: "SMH", yahoo: "SMH", color: "#a78bfa" },
];

export interface ClosePoint {
  date: string; // yyyy-mm-dd
  close: number;
}

export type ComparisonPoint = { date: string } & Record<string, number | null | string>;

export function parseYahooSeries(payload: unknown): ClosePoint[] {
  const result = (payload as {
    chart?: { result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }>; adjclose?: Array<{ adjclose?: (number | null)[] }> };
    }> };
  })?.chart?.result?.[0];
  if (!result?.timestamp) return [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const rows: ClosePoint[] = [];
  result.timestamp.forEach((ts, i) => {
    const raw = adj[i] != null ? adj[i] : closes[i];
    if (raw == null || !Number.isFinite(raw) || raw <= 0) return;
    rows.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: raw });
  });
  return rows;
}

// Normalize each symbol to % change from its first close in the window, aligned by date.
export function buildComparison(perSymbol: Record<string, ClosePoint[]>): ComparisonPoint[] {
  const dates = new Set<string>();
  const bySymbol: Record<string, { base: number; map: Map<string, number> }> = {};

  for (const [sym, rows] of Object.entries(perSymbol)) {
    if (!rows.length) continue;
    const base = rows[0].close;
    const map = new Map<string, number>();
    for (const r of rows) {
      dates.add(r.date);
      map.set(r.date, base ? (r.close / base - 1) * 100 : 0);
    }
    bySymbol[sym] = { base, map };
  }

  return [...dates]
    .sort()
    .map((date) => {
      const point: ComparisonPoint = { date };
      for (const sym of Object.keys(perSymbol)) {
        const v = bySymbol[sym]?.map.get(date);
        point[sym] = v == null ? null : Math.round(v * 100) / 100;
      }
      return point;
    });
}
