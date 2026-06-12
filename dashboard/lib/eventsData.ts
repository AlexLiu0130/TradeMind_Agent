// Gathers unified-timeline inputs (§3.4): intel items + risk-rule fires from
// SQLite, option expirations from the portfolio cache, and held-underlying
// earnings via earnings_calendar.py (slow → 30-min TTL cache). Pure mapping
// lives in lib/events.ts. Failed sources are surfaced in `missing`, not faked.
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { getDb } from "@/lib/db";
import { getPortfolioDashboard } from "@/lib/portfolioData";
import {
  intelToEvent, expiryEvents, earningsToEvent, alertToEvent, mergeEvents,
  type DashboardEvent, type IntelRow, type ExpiryPosition, type EarningsRow, type AlertRow,
} from "@/lib/events.ts";

const execFileAsync = promisify(execFile);

export interface EventsResponse {
  events: DashboardEvent[];
  as_of: number;
  missing: string[];
  stale: string[]; // sources served from an expired cache after a failed refresh
}

const SCRIPTS = path.join(
  process.env.IBKR_SCRIPTS_DIR ||
    path.join(process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts"),
);
const PYTHONPATH =
  process.env.PYTHONPATH ||
  path.join(process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages");

const EARNINGS_TTL_MS = 30 * 60_000;
let earningsCache: { ts: number; key: string; rows: EarningsRow[] } | null = null;

async function fetchEarnings(
  underlyings: string[],
): Promise<{ rows: EarningsRow[]; stale: boolean } | null> {
  if (underlyings.length === 0) return { rows: [], stale: false };
  const key = [...underlyings].sort().join(",");
  if (earningsCache && earningsCache.key === key && Date.now() - earningsCache.ts < EARNINGS_TTL_MS) {
    return { rows: earningsCache.rows, stale: false };
  }
  try {
    const { stdout } = await execFileAsync(
      "python3",
      [path.join(SCRIPTS, "earnings_calendar.py"), ...underlyings, "--days", "45"],
      // Nasdaq calendar fetch alone can take >60s; result is cached for 30 min.
      { env: { ...process.env, PYTHONPATH }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as { symbols?: EarningsRow[] };
    const rows = Array.isArray(parsed.symbols) ? parsed.symbols : [];
    earningsCache = { ts: Date.now(), key, rows };
    return { rows, stale: false };
  } catch {
    // Expired cache after a failed refresh is served but flagged stale (§4.1).
    return earningsCache?.key === key ? { rows: earningsCache.rows, stale: true } : null;
  }
}

function intelEvents(days: number): DashboardEvent[] | null {
  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = getDb()
      .prepare(
        `SELECT id, captured_at, item_ts, source, title, summary, related_tickers, impact_direction, urgency
         FROM intel_items
         WHERE captured_at >= ? AND urgency IN ('watch','alert')
         ORDER BY captured_at DESC LIMIT 30`,
      )
      .all(since) as IntelRow[];
    return rows.map(intelToEvent);
  } catch {
    return null;
  }
}

function riskEvents(): DashboardEvent[] | null {
  try {
    const rows = getDb()
      .prepare("SELECT rule, last_fired_at FROM alert_state WHERE last_fired_at IS NOT NULL")
      .all() as AlertRow[];
    return rows.map(alertToEvent).filter((e): e is DashboardEvent => e != null);
  } catch {
    return null;
  }
}

export async function getDashboardEvents(days = 14): Promise<EventsResponse> {
  const missing: string[] = [];
  const stale: string[] = [];

  const intel = intelEvents(days);
  if (intel == null) missing.push("intel");

  const risk = riskEvents();
  if (risk == null) missing.push("risk");

  // Portfolio (cached is fine — expirations don't move intraday)
  const { dashboard } = getPortfolioDashboard();
  const positions = (dashboard?.positions as ExpiryPosition[] | undefined) ?? null;
  const expiry = positions ? expiryEvents(positions) : null;
  if (expiry == null) missing.push("positions");

  const underlyings = positions
    ? [...new Set(positions.map((p) => p.symbol.trim().split(/\s+/)[0]).filter(Boolean))]
    : [];
  const earningsRes = await fetchEarnings(underlyings);
  if (earningsRes == null) missing.push("earnings");
  else if (earningsRes.stale) stale.push("earnings");
  const earnings = (earningsRes?.rows ?? [])
    .map(earningsToEvent)
    .filter((e): e is DashboardEvent => e != null);

  return {
    events: mergeEvents([earnings, expiry ?? [], risk ?? [], intel ?? []]),
    as_of: Date.now(),
    missing,
    stale,
  };
}
