// SQLite persistence for portfolio risk snapshots (§4.1). Pure trend math
// lives in lib/riskHistory.ts. Writes are throttled so repeated dashboard
// builds don't flood the table; reads return raw points + 7/30d trend deltas.
import { getDb, getWriteDb } from "@/lib/db";
import { trendDelta, maxUnderlyingPct } from "@/lib/riskHistory";

const MIN_INTERVAL_MS = 10 * 60_000;

export interface RiskHistoryRow {
  ts: string;
  net_delta: number | null;
  net_gamma: number | null;
  net_vega: number | null;
  net_theta: number | null;
  net_usd: number | null;
  gross_usd: number | null;
  max_single_pct: number | null;
  greeks_estimated: number;
}

let tableReady = false;
function ensureTable(): void {
  if (tableReady) return;
  getWriteDb().exec(`
    CREATE TABLE IF NOT EXISTS risk_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts              TEXT NOT NULL,
      net_delta       REAL,
      net_gamma       REAL,
      net_vega        REAL,
      net_theta       REAL,
      net_usd         REAL,
      gross_usd       REAL,
      max_single_pct  REAL,
      greeks_estimated INTEGER DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'dashboard'
    );
    CREATE INDEX IF NOT EXISTS risk_history_ts ON risk_history(ts);
  `);
  tableReady = true;
}

/**
 * Record a risk snapshot from a freshly built (non-cached) dashboard.
 * No-op when the last row is younger than 10 minutes or inputs are absent.
 * Never throws — persistence must not break the portfolio endpoint.
 */
export function recordRiskSnapshot(dashboard: Record<string, unknown>): void {
  try {
    const greeks = dashboard.portfolio_greeks as
      | { net_delta?: number; net_gamma?: number; net_vega?: number; net_theta?: number }
      | undefined;
    const exposure = dashboard.exposure as { net_usd?: number; gross_usd?: number } | undefined;
    const positions = dashboard.positions as { symbol: string; market_value: number }[] | undefined;
    if (!greeks || !Array.isArray(positions) || positions.length === 0) return;

    ensureTable();
    const db = getWriteDb();
    const last = db
      .prepare("SELECT ts FROM risk_history ORDER BY ts DESC LIMIT 1")
      .get() as { ts: string } | undefined;
    if (last && Date.now() - Date.parse(last.ts) < MIN_INTERVAL_MS) return;

    db.prepare(
      `INSERT INTO risk_history
         (ts, net_delta, net_gamma, net_vega, net_theta, net_usd, gross_usd, max_single_pct, greeks_estimated, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dashboard')`,
    ).run(
      new Date().toISOString(),
      greeks.net_delta ?? null,
      greeks.net_gamma ?? null,
      greeks.net_vega ?? null,
      greeks.net_theta ?? null,
      exposure?.net_usd ?? null,
      exposure?.gross_usd ?? null,
      maxUnderlyingPct(positions),
      dashboard.greeks_estimated ? 1 : 0,
    );
  } catch {
    // snapshot persistence is best-effort by design
  }
}

export interface RiskTrends {
  d7: Record<string, number | null>;
  d30: Record<string, number | null>;
}

const TREND_FIELDS = ["net_delta", "net_gamma", "net_vega", "net_theta", "net_usd", "gross_usd", "max_single_pct"] as const;

export function getRiskHistory(days = 30): { points: RiskHistoryRow[]; trends: RiskTrends } {
  const now = Date.now();
  let rows: RiskHistoryRow[] = [];
  try {
    // Fetch past the view window so the 30d trend baseline (a point ≤ now−30d) exists.
    const since = new Date(now - Math.max(days, 31) * 86_400_000 - 86_400_000).toISOString();
    rows = getDb()
      .prepare(
        `SELECT ts, net_delta, net_gamma, net_vega, net_theta, net_usd, gross_usd, max_single_pct, greeks_estimated
         FROM risk_history WHERE ts >= ? ORDER BY ts ASC`,
      )
      .all(since) as RiskHistoryRow[];
  } catch {
    rows = []; // table may not exist yet on a fresh DB
  }

  const trends: RiskTrends = { d7: {}, d30: {} };
  for (const f of TREND_FIELDS) {
    const pts = rows.map((r) => ({ ts: Date.parse(r.ts), value: r[f] }));
    trends.d7[f] = trendDelta(pts, now, 7);
    trends.d30[f] = trendDelta(pts, now, 30);
  }
  const viewStart = now - days * 86_400_000;
  return { points: rows.filter((r) => Date.parse(r.ts) >= viewStart), trends };
}
