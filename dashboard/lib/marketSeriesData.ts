import {
  SERIES_RANGES,
  SERIES_SYMBOLS,
  buildComparison,
  parseYahooSeries,
  type ClosePoint,
  type ComparisonPoint,
} from "@/lib/marketSeries";

export interface SeriesResponse {
  range: string;
  symbols: { key: string; color: string }[];
  points: ComparisonPoint[];
  missing: string[]; // symbols Yahoo failed to return — surfaced, never faked
  cached: boolean;
}

// Daily closes change once per trading day, so a longer TTL is plenty.
const TTL_MS = 15 * 60_000;
const cache = new Map<string, { ts: number; data: SeriesResponse }>();

async function fetchSeries(yahoo: string, range: string, interval: string): Promise<ClosePoint[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${range}&interval=${interval}`;
    const res = await fetch(url, { headers: { "User-Agent": "TradeMind/1.0" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return parseYahooSeries(await res.json());
  } catch {
    return [];
  }
}

export async function getMarketSeries(rangeKey: string, fresh = false): Promise<SeriesResponse> {
  const opt = SERIES_RANGES.find((r) => r.key === rangeKey) ?? SERIES_RANGES[0];
  const now = Date.now();
  const hit = cache.get(opt.key);
  if (!fresh && hit && now - hit.ts < TTL_MS) {
    return { ...hit.data, cached: true };
  }

  const results = await Promise.all(SERIES_SYMBOLS.map((s) => fetchSeries(s.yahoo, opt.range, opt.interval)));
  const perSymbol: Record<string, ClosePoint[]> = {};
  const missing: string[] = [];
  SERIES_SYMBOLS.forEach((s, i) => {
    if (results[i].length) perSymbol[s.key] = results[i];
    else missing.push(s.key);
  });

  const data: SeriesResponse = {
    range: opt.key,
    symbols: SERIES_SYMBOLS.map((s) => ({ key: s.key, color: s.color })),
    points: buildComparison(perSymbol),
    missing,
    cached: false,
  };

  // Cache only a usable result; if everything failed, serve last good snapshot.
  if (data.points.length) cache.set(opt.key, { ts: now, data });
  else if (hit) return { ...hit.data, cached: true };

  return data;
}
