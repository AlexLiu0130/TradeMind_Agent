import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// 5-minute server-side cache — FIFO round-trip math is O(n trades) and allocates
// heavily; reusing the result across requests keeps the Node heap flat.
let _cache: { ts: number; data: unknown } | null = null;
const CACHE_MS = 5 * 60 * 1000;

function matchRoundTrips(trades: Record<string, unknown>[]) {
  const bySym: Record<string, Record<string, unknown>[]> = {};
  for (const t of trades) {
    const key = `${t.underlying}::${t.asset_category}`;
    if (!bySym[key]) bySym[key] = [];
    bySym[key].push(t);
  }

  const trips = [];
  for (const [, symTrades] of Object.entries(bySym)) {
    const inventory: { qty: number; price: number; date: string; hour: number }[] = [];
    for (const t of symTrades) {
      const qty = Math.abs(t.quantity as number);
      const price = t.trade_price as number;
      const date = t.trade_date as string;
      const hour = parseInt(((t.trade_time as string) || "00:00").slice(0, 2));
      const mult = (t.multiplier as number) || 1;
      const comm = Math.abs((t.commission as number) || 0);

      if (t.buy_sell === "BUY") {
        inventory.push({ qty, price, date, hour });
      } else if (inventory.length > 0) {
        let remaining = qty;
        while (remaining > 0 && inventory.length > 0) {
          const lot = inventory[0];
          const matched = Math.min(lot.qty, remaining);
          const pnl = (price - lot.price) * matched * mult - (comm / qty) * matched;
          const days = Math.round(
            (new Date(date).getTime() - new Date(lot.date).getTime()) / 86400000
          );
          trips.push({
            symbol: t.underlying,
            asset_category: t.asset_category,
            open_date: lot.date,
            close_date: date,
            holding_days: days,
            open_hour: lot.hour,
            pnl: Math.round(pnl * 100) / 100,
            profitable: pnl > 0,
          });
          lot.qty -= matched;
          remaining -= matched;
          if (lot.qty <= 0) inventory.shift();
        }
      }
    }
  }
  return trips;
}

export async function GET() {
  if (_cache && Date.now() - _cache.ts < CACHE_MS) {
    return NextResponse.json(_cache.data);
  }

  const db = getDb();
  const trades = db
    .prepare("SELECT * FROM trades ORDER BY underlying, trade_date, trade_time")
    .all() as Record<string, unknown>[];

  const trips = matchRoundTrips(trades);

  // by symbol
  const bySym: Record<string, { pnl: number[]; wins: number }> = {};
  for (const t of trips) {
    if (!bySym[t.symbol as string]) bySym[t.symbol as string] = { pnl: [], wins: 0 };
    bySym[t.symbol as string].pnl.push(t.pnl as number);
    if (t.profitable) bySym[t.symbol as string].wins++;
  }
  const bySymbol = Object.entries(bySym)
    .map(([sym, d]) => ({
      symbol: sym,
      trades: d.pnl.length,
      wins: d.wins,
      win_rate: d.wins / d.pnl.length,
      total_pnl: d.pnl.reduce((a, b) => a + b, 0),
      avg_pnl: d.pnl.reduce((a, b) => a + b, 0) / d.pnl.length,
    }))
    .sort((a, b) => b.total_pnl - a.total_pnl);

  // by holding period
  const periods: Record<string, { pnl: number[]; wins: number }> = {};
  const periodBucket = (d: number) =>
    d === 0 ? "intraday" : d <= 3 ? "1-3d" : d <= 10 ? "4-10d" : "10d+";
  for (const t of trips) {
    const b = periodBucket(t.holding_days as number);
    if (!periods[b]) periods[b] = { pnl: [], wins: 0 };
    periods[b].pnl.push(t.pnl as number);
    if (t.profitable) periods[b].wins++;
  }
  const byPeriod = ["intraday", "1-3d", "4-10d", "10d+"]
    .filter((b) => periods[b])
    .map((b) => ({
      period: b,
      trades: periods[b].pnl.length,
      win_rate: periods[b].wins / periods[b].pnl.length,
      avg_pnl: periods[b].pnl.reduce((a, c) => a + c, 0) / periods[b].pnl.length,
    }));

  // by time of day
  const timeBuckets: Record<string, { pnl: number[]; wins: number }> = {};
  const timeBucket = (h: number) =>
    h < 10 ? "Open 9:30-10" : h < 12 ? "Morning 10-12" : h < 14 ? "Midday 12-14" : "Afternoon 14+";
  for (const t of trips) {
    const b = timeBucket(t.open_hour as number);
    if (!timeBuckets[b]) timeBuckets[b] = { pnl: [], wins: 0 };
    timeBuckets[b].pnl.push(t.pnl as number);
    if (t.profitable) timeBuckets[b].wins++;
  }
  const byTime = Object.entries(timeBuckets).map(([period, d]) => ({
    period,
    trades: d.pnl.length,
    win_rate: d.wins / d.pnl.length,
    avg_pnl: d.pnl.reduce((a, b) => a + b, 0) / d.pnl.length,
  }));

  const result = { bySymbol, byPeriod, byTime };
  _cache = { ts: Date.now(), data: result };
  return NextResponse.json(result);
}
