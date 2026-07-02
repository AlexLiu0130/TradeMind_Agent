// Gathers unified-timeline inputs (§3.4): intel items + risk-rule fires from
// SQLite, option expirations from the portfolio cache, and held-underlying
// earnings via QVeris (30-min TTL cache). Pure mapping lives in lib/events.ts.
// Failed sources are surfaced in `missing`, not faked.
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { getPortfolioDashboard } from "@/lib/portfolioData";
import {
  intelToEvent, expiryEvents, earningsToEvent, alertToEvent, mergeEvents,
  type DashboardEvent, type IntelRow, type ExpiryPosition, type EarningsRow, type AlertRow,
} from "@/lib/events.ts";

export interface EventsResponse {
  events: DashboardEvent[];
  as_of: number;
  missing: string[];
  stale: string[]; // sources served from an expired cache after a failed refresh
}

const PROJECT_ROOT =
  process.env.TRADEMIND_ROOT ||
  path.join(/* turbopackIgnore: true */ process.env.HOME || "~", "Desktop/TradeMind_Agent");
const QVERIS_TOOL = "finnhub.calendar.earnings.retrieve.v1.0e57aadf";

const EARNINGS_TTL_MS = 30 * 60_000;
let earningsCache: { ts: number; key: string; rows: EarningsRow[] } | null = null;

function localEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [path.join(PROJECT_ROOT, ".env"), path.join(process.cwd(), ".env.local")]) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      out[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}

async function qverisEarnings(symbol: string, start: string, end: string): Promise<EarningsRow[] | null> {
  const env = { ...process.env, ...localEnv() };
  const apiKey = env.QVERIS_API_KEY;
  if (!apiKey) return null;
  const base = (env.QVERIS_BASE_URL || "https://qveris.ai/api/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/tools/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ tool_id: QVERIS_TOOL, parameters: { symbol, from: start, to: end } }),
  });
  if (!res.ok) return null;
  const payload = await res.json();
  if (!payload?.success) return null;
  const events = payload?.result?.data?.earningsCalendar;
  if (!Array.isArray(events)) return [];
  const today = new Date(`${start}T00:00:00Z`).getTime();
  return events
    .filter((ev) => ev?.date)
    .map((ev) => ({
      symbol: String(ev.symbol || symbol),
      next_earnings_date: String(ev.date),
      days_until: Math.round((new Date(`${ev.date}T00:00:00Z`).getTime() - today) / 86_400_000),
    }));
}

async function fetchEarnings(
  underlyings: string[],
): Promise<{ rows: EarningsRow[]; stale: boolean } | null> {
  if (underlyings.length === 0) return { rows: [], stale: false };
  const key = [...underlyings].sort().join(",");
  if (earningsCache && earningsCache.key === key && Date.now() - earningsCache.ts < EARNINGS_TTL_MS) {
    return { rows: earningsCache.rows, stale: false };
  }
  try {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const chunks = await Promise.all(underlyings.map((symbol) => qverisEarnings(symbol, start, end)));
    if (chunks.some((rows) => rows == null)) return earningsCache?.key === key ? { rows: earningsCache.rows, stale: true } : null;
    const rows = chunks.flatMap((rows) => rows ?? []);
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
