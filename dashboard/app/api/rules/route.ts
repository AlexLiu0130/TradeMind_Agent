import { getDb, getWriteDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Keys the dashboard is allowed to edit, with display metadata.
// Mirrors the seeded rules in agent/db/schema.sql.
const EDITABLE: Record<string, { label: string; unit: string }> = {
  max_single_pct: { label: "单一持仓上限", unit: "%" },
  max_rolls: { label: "单 thesis 最大滚动次数", unit: "次" },
  block_earnings_within_days: { label: "财报临近阻断窗口", unit: "天" },
  max_trades_per_day: { label: "每日最大交易数", unit: "笔" },
  // Data cache TTL (0 = real-time). Edited via its own card, not the rules list.
  ibkr_cache_ttl: { label: "数据缓存时间", unit: "秒" },
};

export async function GET() {
  const db = getDb();
  let rows: { key: string; value: string }[] = [];
  try {
    rows = db.prepare("SELECT key, value FROM rules").all() as typeof rows;
  } catch {
    // rules table may be missing
  }
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const rules = Object.entries(EDITABLE).map(([key, meta]) => ({
    key,
    value: map[key] ?? "",
    ...meta,
  }));
  return NextResponse.json({ rules });
}

export async function PATCH(req: NextRequest) {
  let b: { key?: string; value?: string | number };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!b.key || !(b.key in EDITABLE)) {
    return NextResponse.json({ error: "unknown rule key" }, { status: 400 });
  }
  const num = Number(b.value);
  if (b.value === "" || b.value == null || Number.isNaN(num) || num < 0) {
    return NextResponse.json({ error: "value must be a non-negative number" }, { status: 400 });
  }

  try {
    const db = getWriteDb();
    // Upsert mirrors journal_store.set_rule.
    db.prepare(
      "INSERT INTO rules (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(b.key, String(num));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
