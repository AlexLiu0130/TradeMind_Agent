// Risk-history pure math — no network, no DB. Persistence lives in
// lib/riskHistoryData.ts; this module computes trend deltas (§3.3.3:
// Greeks 当前值及 7/30 日变化) and single-name concentration.

export interface RiskPoint {
  ts: number; // ms epoch
  value: number | null;
}

/**
 * Change over a trailing window: latest value minus the value as of
 * (now − windowDays). Baseline = latest point at-or-before the window start.
 * Null when history doesn't reach back far enough — never a fake 0.
 */
export function trendDelta(points: RiskPoint[], nowMs: number, windowDays: number): number | null {
  const valid = points.filter((p) => p.value != null).sort((a, b) => a.ts - b.ts);
  if (valid.length < 2) return null;
  const start = nowMs - windowDays * 86_400_000;
  let baseline: RiskPoint | null = null;
  for (const p of valid) {
    if (p.ts <= start) baseline = p;
    else break;
  }
  if (!baseline) return null;
  const latest = valid[valid.length - 1];
  return Math.round((latest.value! - baseline.value!) * 1e6) / 1e6;
}

/** Max single-underlying share of gross book value, in %. Null when gross is 0. */
export function maxUnderlyingPct(positions: { symbol: string; market_value: number }[]): number | null {
  const byUnd = new Map<string, number>();
  let gross = 0;
  for (const p of positions) {
    const und = p.symbol.trim().split(/\s+/)[0];
    if (!und) continue;
    const abs = Math.abs(p.market_value || 0);
    byUnd.set(und, (byUnd.get(und) || 0) + abs);
    gross += abs;
  }
  if (gross <= 0) return null;
  const max = Math.max(...byUnd.values());
  return Math.round((max / gross) * 1000) / 10;
}
