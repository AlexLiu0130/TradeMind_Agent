import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "";
  const asset = searchParams.get("asset") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "200"), 500);

  const db = getDb();
  let sql = `SELECT trade_id, trade_date, trade_time, asset_category, symbol, underlying,
                    put_call, strike, expiry, buy_sell, quantity, trade_price,
                    proceeds, commission, net_cash, fifo_pnl, notes
             FROM trades WHERE 1=1`;
  const params: (string | number)[] = [];

  if (symbol) { sql += " AND underlying LIKE ?"; params.push(`%${symbol}%`); }
  if (asset)  { sql += " AND asset_category = ?"; params.push(asset.toUpperCase()); }
  sql += " ORDER BY trade_date DESC, trade_time DESC LIMIT ?";
  params.push(limit);

  const trades = db.prepare(sql).all(...params);
  return NextResponse.json({ trades });
}
