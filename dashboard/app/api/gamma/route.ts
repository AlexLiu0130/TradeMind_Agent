import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const SCRIPTS =
  process.env.IBKR_SCRIPTS_DIR ||
  path.join(process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts");

const PYTHONPATH =
  process.env.IBKR_PYTHONPATH ||
  path.join(
    process.env.HOME || "~",
    "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages"
  );

const TRADEMIND_ROOT =
  process.env.TRADEMIND_ROOT ||
  path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent-main");

// In-process cache: keyed by ticker, stores { ts, data }
const _cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") || "SPY").toUpperCase();
  const fresh = sp.get("fresh") === "1";
  const dteMax = sp.get("dte_max") || "45";
  const strikes = sp.get("strikes") || "20";

  const cacheKey = `${ticker}:${dteMax}:${strikes}`;
  const cached = _cache.get(cacheKey);
  const now = Date.now();

  if (!fresh && cached && now - cached.ts < CACHE_TTL_MS) {
    const d = typeof cached.data === "object" && cached.data !== null ? cached.data as Record<string, unknown> : {};
    return NextResponse.json({ ...d, cached: true, cache_age_s: Math.round((now - cached.ts) / 1000) });
  }

  try {
    const out = execFileSync(
      "python3",
      [
        path.join(SCRIPTS, "gamma_exposure.py"),
        ticker,
        "--dte-max", dteMax,
        "--strikes", strikes,
      ],
      {
        env: { ...process.env, PYTHONPATH },
        timeout: 180_000,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const data = JSON.parse(out.toString());
    _cache.set(cacheKey, { ts: now, data });
    return NextResponse.json({ ...data, cached: false });
  } catch (err: unknown) {
    const stale = cached?.data ?? null;
    const msg = err instanceof Error ? err.message : String(err);
    if (stale && typeof stale === "object" && stale !== null) {
      return NextResponse.json({
        ...(stale as Record<string, unknown>),
        cached: true,
        stale: true,
        cache_age_s: Math.round((now - cached!.ts) / 1000),
        refresh_error: msg.slice(0, 200),
      });
    }

    // Fall back to EOD snapshot saved by save_gex_snapshot.py
    const eodPath = path.join(TRADEMIND_ROOT, "agent", "db", "gex", `${ticker}_eod.json`);
    try {
      const raw = fs.readFileSync(eodPath, "utf8");
      const eod = JSON.parse(raw) as Record<string, unknown>;
      return NextResponse.json({
        ...eod,
        cached: false,
        stale: true,
        eod_snapshot: true,
        snapshot_date: eod.snapshot_date ?? eod.as_of,
        refresh_error: msg.slice(0, 200),
      });
    } catch {
      // EOD file doesn't exist or is unreadable — return original error
    }

    return NextResponse.json(
      { error: "GEX fetch failed", detail: msg.slice(0, 300) },
      { status: 503 }
    );
  }
}
