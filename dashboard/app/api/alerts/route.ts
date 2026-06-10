import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface RuleRow {
  key: string;
  value: string;
}

interface AlertRow {
  rule: string;
  last_fired_at: string | null;
}

const LABELS: Record<string, { label: string; unit: string; severity: "risk" | "watch" | "info"; action: string }> = {
  max_single_pct: {
    label: "Single-position concentration",
    unit: "%",
    severity: "risk",
    action: "Ask Agent to assess concentration before adding exposure.",
  },
  max_rolls: {
    label: "Roll discipline",
    unit: "rolls",
    severity: "watch",
    action: "Review thesis before rolling again.",
  },
  block_earnings_within_days: {
    label: "Earnings window",
    unit: "days",
    severity: "risk",
    action: "Avoid new premium sale unless explicitly approved.",
  },
  max_trades_per_day: {
    label: "Overtrading guard",
    unit: "trades",
    severity: "watch",
    action: "Slow down and log the decision rationale.",
  },
  ibkr_cache_ttl: {
    label: "IBKR cache TTL",
    unit: "sec",
    severity: "info",
    action: "Use Refresh or real-time mode for trade-sensitive checks.",
  },
};

function stateFor(last: string | null): "active" | "recent" | "quiet" {
  if (!last) return "quiet";
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return "recent";
  const ageHours = (Date.now() - ts) / 3_600_000;
  if (ageHours <= 24) return "active";
  if (ageHours <= 168) return "recent";
  return "quiet";
}

export async function GET() {
  const db = getDb();
  let rules: RuleRow[] = [];
  let fired: AlertRow[] = [];
  try {
    rules = db.prepare("SELECT key, value FROM rules ORDER BY key").all() as RuleRow[];
    fired = db.prepare("SELECT rule, last_fired_at FROM alert_state ORDER BY last_fired_at DESC").all() as AlertRow[];
  } catch {
    return NextResponse.json({ alerts: [] });
  }

  const firedMap = new Map(fired.map((r) => [r.rule, r.last_fired_at]));
  const ruleAlerts = rules.map((r) => {
    const meta = LABELS[r.key] || { label: r.key, unit: "", severity: "info" as const, action: "Review this rule." };
    const last = firedMap.get(r.key) || null;
    return {
      key: r.key,
      label: meta.label,
      value: r.value,
      unit: meta.unit,
      severity: meta.severity,
      action: meta.action,
      last_fired_at: last,
      state: stateFor(last),
    };
  });

  const adHoc = fired
    .filter((r) => !rules.some((rule) => rule.key === r.rule))
    .map((r) => ({
      key: r.rule,
      label: r.rule,
      value: "",
      unit: "",
      severity: "watch",
      action: "Review the source monitor and decide whether to add a rule.",
      last_fired_at: r.last_fired_at,
      state: stateFor(r.last_fired_at),
    }));

  return NextResponse.json({ alerts: [...ruleAlerts, ...adHoc] });
}
