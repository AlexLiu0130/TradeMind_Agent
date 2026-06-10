import { execFileSync } from "child_process";
import path from "path";
import { getDb } from "@/lib/db";
import { enrich, type Position } from "@/lib/portfolioMath";

let cache: { ts: number; data: Record<string, unknown> } | null = null;

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

const SCRIPTS = path.join(
  process.env.IBKR_SCRIPTS_DIR ||
    path.join(process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts"),
);

const PYTHONPATH =
  process.env.PYTHONPATH ||
  path.join(process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages");

function runStatusDashboard(): Record<string, unknown> | null {
  try {
    const out = execFileSync("python3", [path.join(SCRIPTS, "status_dashboard.py"), "--output", "json"], {
      env: { ...process.env, PYTHONPATH },
      timeout: 30000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out.toString());
  } catch {
    return null;
  }
}

function buildDashboard(): Record<string, unknown> | null {
  const dashboard = runStatusDashboard();
  if (dashboard && Array.isArray(dashboard.positions)) {
    const e = enrich(dashboard.positions as Position[]);
    dashboard.portfolio_greeks = e.portfolio_greeks;
    dashboard.greeks_estimated = e.greeks_estimated;
    dashboard.greeks_unavailable = e.greeks_unavailable;
    dashboard.exposure = e.exposure;
  }
  return dashboard;
}

export function getPortfolioDashboard(options: { fresh?: boolean } = {}): {
  dashboard: Record<string, unknown> | null;
  cached: boolean;
  stale?: boolean;
} {
  const ttlMs = cacheTtlMs();
  const now = Date.now();

  if (!options.fresh && ttlMs > 0 && cache && now - cache.ts < ttlMs) {
    return { dashboard: cache.data, cached: true };
  }

  const dashboard = buildDashboard();
  if (dashboard) cache = { ts: now, data: dashboard };
  if (!dashboard && cache) {
    return { dashboard: cache.data, cached: true, stale: true };
  }

  return { dashboard, cached: false };
}
