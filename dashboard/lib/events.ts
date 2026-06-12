// Unified event timeline (§3.4) — pure normalizers, no network/DB.
// Each source (intel, option expiry, earnings, risk-rule fires) maps into the
// DashboardEvent contract (§4.2); lib/eventsData.ts gathers the inputs.
import { formatExpiry, dte } from "./cockpit.ts";

export type EventType = "intel" | "expiry" | "earnings" | "risk" | "reminder";
export type EventSeverity = "info" | "watch" | "alert";

export interface DashboardEvent {
  id: string;
  type: EventType;
  ts: string; // ISO — past events: when it happened; future: when it's due
  title: string;
  detail?: string;
  tickers: string[];
  severity: EventSeverity;
  source: string;
}

export interface IntelRow {
  id: number;
  captured_at: string;
  item_ts: string | null;
  source: string;
  title: string | null;
  summary: string | null;
  related_tickers: string | null;
  impact_direction: string | null;
  urgency: string | null;
}

export function intelToEvent(row: IntelRow): DashboardEvent {
  let tickers: string[] = [];
  try {
    const parsed = JSON.parse(row.related_tickers || "[]");
    if (Array.isArray(parsed)) tickers = parsed.filter((t) => typeof t === "string");
  } catch { /* tolerate bad JSON — tickers stay empty */ }
  const severity: EventSeverity =
    row.urgency === "alert" ? "alert" : row.urgency === "watch" ? "watch" : "info";
  return {
    id: `intel-${row.id}`,
    type: "intel",
    ts: row.item_ts || row.captured_at,
    title: row.title || row.summary?.slice(0, 80) || "Intel item",
    detail: [row.impact_direction, row.summary].filter(Boolean).join(" · ") || undefined,
    tickers,
    severity,
    source: row.source,
  };
}

export interface ExpiryPosition {
  symbol: string;
  sec_type: string;
  expiration?: string;
  strike?: number;
  right?: string;
  position: number;
}

export function expiryEvents(positions: ExpiryPosition[], now = new Date()): DashboardEvent[] {
  const evs: DashboardEvent[] = [];
  for (const p of positions) {
    if (p.sec_type !== "OPT" || !p.expiration) continue;
    const days = dte(p.expiration, now);
    if (days == null || days < 0) continue;
    const iso = formatExpiry(p.expiration);
    const severity: EventSeverity = days <= 5 ? "alert" : days <= 14 ? "watch" : "info";
    const leg = `${p.right ?? ""}${p.strike ?? ""}`;
    evs.push({
      id: `expiry-${p.symbol}-${p.expiration}-${leg}`,
      type: "expiry",
      ts: `${iso}T20:00:00Z`,
      title: `${p.symbol} ${leg} 到期`,
      detail: `${days} DTE · ${p.position > 0 ? "long" : "short"} ${Math.abs(p.position)}`,
      tickers: [p.symbol.trim().split(/\s+/)[0]],
      severity,
      source: "ibkr",
    });
  }
  return evs.sort((a, b) => a.ts.localeCompare(b.ts));
}

export interface EarningsRow {
  symbol: string;
  next_earnings_date: string | null;
  days_until: number | null;
}

export function earningsToEvent(row: EarningsRow): DashboardEvent | null {
  if (!row.next_earnings_date) return null;
  const days = row.days_until;
  const severity: EventSeverity = days != null && days <= 5 ? "alert" : days != null && days <= 14 ? "watch" : "info";
  return {
    id: `earnings-${row.symbol}-${row.next_earnings_date}`,
    type: "earnings",
    ts: `${row.next_earnings_date}T12:00:00Z`,
    title: `${row.symbol} 财报`,
    detail: days != null ? `${days} 天后` : undefined,
    tickers: [row.symbol],
    severity,
    source: "earnings_calendar",
  };
}

export interface AlertRow {
  rule: string;
  last_fired_at: string | null;
}

export function alertToEvent(row: AlertRow): DashboardEvent | null {
  if (!row.last_fired_at) return null;
  return {
    id: `risk-${row.rule}-${row.last_fired_at}`,
    type: "risk",
    ts: row.last_fired_at,
    title: `风险规则触发：${row.rule}`,
    tickers: [],
    severity: "alert",
    source: "guardrail",
  };
}

/** Merge event lists, dedupe by id (first occurrence wins), newest first. */
export function mergeEvents(lists: DashboardEvent[][]): DashboardEvent[] {
  const seen = new Set<string>();
  const out: DashboardEvent[] = [];
  for (const list of lists) {
    for (const ev of list) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}
