import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// FIFO round-trip P&L per symbol
function calcPnlBySymbol(
  trades: Record<string, unknown>[]
): Record<string, { total_pnl: number; trades: number; wins: number; commissions: number }> {
  const bySym: Record<string, Record<string, unknown>[]> = {};
  for (const t of trades) {
    const key = `${t.underlying}::${t.asset_category}`;
    if (!bySym[key]) bySym[key] = [];
    bySym[key].push(t);
  }

  const result: Record<string, { total_pnl: number; trades: number; wins: number; commissions: number }> = {};

  for (const [, symTrades] of Object.entries(bySym)) {
    const underlying = (symTrades[0].underlying as string);
    const inventory: { qty: number; price: number; commission_per_share: number }[] = [];

    for (const t of symTrades) {
      const qty = Math.abs(t.quantity as number);
      const price = t.trade_price as number;
      const commission = Math.abs((t.commission as number) || 0);
      const mult = (t.multiplier as number) || 1;

      if (t.buy_sell === "BUY") {
        inventory.push({ qty, price, commission_per_share: qty > 0 ? commission / qty : 0 });
      } else if (inventory.length > 0) {
        let remaining = qty;
        const sell_comm_per = qty > 0 ? commission / qty : 0;
        while (remaining > 0 && inventory.length > 0) {
          const lot = inventory[0];
          const matched = Math.min(lot.qty, remaining);
          const pnl = (price - lot.price) * matched * mult
            - (sell_comm_per + lot.commission_per_share) * matched;

          if (!result[underlying]) result[underlying] = { total_pnl: 0, trades: 0, wins: 0, commissions: 0 };
          result[underlying].total_pnl += pnl;
          result[underlying].trades += 1;
          result[underlying].commissions += (sell_comm_per + lot.commission_per_share) * matched;
          if (pnl > 0) result[underlying].wins += 1;

          lot.qty -= matched;
          remaining -= matched;
          if (lot.qty <= 0) inventory.shift();
        }
      }
    }
  }
  return result;
}

export async function GET() {
  const db = getDb();

  const trades = db
    .prepare("SELECT * FROM trades ORDER BY underlying, trade_date, trade_time")
    .all() as Record<string, unknown>[];

  const pnlBySymbol = calcPnlBySymbol(trades);

  // Top symbols by total P&L
  const topSymbols = Object.entries(pnlBySymbol)
    .map(([symbol, d]) => ({
      symbol,
      total_pnl: Math.round(d.total_pnl),
      trades: d.trades,
      win_rate: d.trades > 0 ? d.wins / d.trades : 0,
      commissions: Math.round(d.commissions),
    }))
    .sort((a, b) => b.total_pnl - a.total_pnl)
    .slice(0, 15);

  // Overall stats
  const totalRealized = Object.values(pnlBySymbol).reduce((s, d) => s + d.total_pnl, 0);
  const totalRoundTrips = Object.values(pnlBySymbol).reduce((s, d) => s + d.trades, 0);
  const winningRoundTrips = Object.values(pnlBySymbol).reduce((s, d) => s + d.wins, 0);

  // Daily P&L from trades (net_cash sum per day)
  const dailyRaw = db
    .prepare(
      `SELECT trade_date AS date,
              SUM(net_cash) AS daily_cash
       FROM trades
       GROUP BY trade_date
       ORDER BY trade_date`
    )
    .all() as { date: string; daily_cash: number }[];

  // Cumulative P&L
  let cumulative = 0;
  const dailyPnl = dailyRaw.map((d) => {
    cumulative += d.daily_cash;
    return {
      date: d.date.slice(5), // MM-DD
      daily: Math.round(d.daily_cash),
      cumulative: Math.round(cumulative),
    };
  });

  // P&L by asset category
  const byAsset = db
    .prepare(
      `SELECT asset_category,
              SUM(net_cash) AS total_cash,
              COUNT(*) AS executions
       FROM trades
       GROUP BY asset_category`
    )
    .all();

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS total_executions,
              SUM(CASE WHEN asset_category='OPT' THEN 1 ELSE 0 END) AS opt_executions,
              SUM(CASE WHEN asset_category='STK' THEN 1 ELSE 0 END) AS stk_executions,
              MIN(trade_date) AS from_date,
              MAX(trade_date) AS to_date,
              COUNT(DISTINCT underlying) AS unique_symbols
       FROM trades`
    )
    .get() as Record<string, unknown> | null;

  // Commission alias fix — use commission column
  const totalComm = db
    .prepare("SELECT SUM(ABS(commission)) AS c FROM trades")
    .get() as { c: number };

  return NextResponse.json({
    summary: {
      ...(summary || {}),
      total_commissions: Math.round(totalComm?.c || 0),
      total_realized_pnl: Math.round(totalRealized),
      total_round_trips: totalRoundTrips,
      overall_win_rate: totalRoundTrips > 0 ? winningRoundTrips / totalRoundTrips : 0,
    },
    topSymbols,
    dailyPnl,
    byAsset,
  });
}
