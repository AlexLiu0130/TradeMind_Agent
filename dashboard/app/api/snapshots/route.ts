import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Daily portfolio snapshots written by agent/loops/daily_review.py.
export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") || "30");
  const db = getDb();
  let rows: unknown[] = [];
  try {
    rows = db
      .prepare(
        `SELECT ts, net_delta, net_vega, realized_pnl
         FROM snapshots
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(Number.isFinite(days) && days > 0 ? days : 30);
  } catch {
    // snapshots table may be empty
  }
  // Return chronological (oldest first) for charting.
  return NextResponse.json({ snapshots: (rows as unknown[]).reverse() });
}
