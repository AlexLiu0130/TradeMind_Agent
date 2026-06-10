"use client";
import { useEffect, useState, useCallback } from "react";

interface Trade {
  trade_id: string;
  trade_date: string;
  trade_time: string;
  asset_category: string;
  symbol: string;
  underlying: string;
  put_call: string | null;
  strike: number | null;
  expiry: string | null;
  buy_sell: string;
  quantity: number;
  trade_price: number;
  net_cash: number;
  fifo_pnl: number;
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [symbol, setSymbol] = useState("");
  const [asset, setAsset] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    if (asset) params.set("asset", asset);
    fetch(`/api/trades?${params}`)
      .then((r) => r.json())
      .then((d) => setTrades(d.trades));
  }, [symbol, asset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-[#e0a82e]">Trade History</h1>

      <div className="flex gap-3 flex-wrap">
        <input
          className="bg-[#111419] border border-[#232a33] rounded px-3 py-1.5 text-sm text-[#e6e9ef] placeholder-[#5b6472] w-32"
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <select
          className="bg-[#111419] border border-[#232a33] rounded px-3 py-1.5 text-sm text-[#e6e9ef]"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
        >
          <option value="">All</option>
          <option value="STK">STK</option>
          <option value="OPT">OPT</option>
        </select>
      </div>

      <div className="bg-[#111419] border border-[#232a33] rounded overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#232a33] text-[#8b93a3]">
              {["Date", "Time", "Cat", "Symbol", "B/S", "Qty", "Price", "Net Cash", "PnL"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.trade_id} className="border-b border-[#232a33]/50 hover:bg-[#1b2027]/40">
                <td className="px-3 py-1.5 text-[#e6e9ef]">{t.trade_date}</td>
                <td className="px-3 py-1.5 text-[#8b93a3]">{t.trade_time}</td>
                <td className="px-3 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.asset_category === "OPT" ? "bg-[#16202b] text-[#6ea8d8]" : "bg-[#11241b] text-[#3fce8f]"}`}>
                    {t.asset_category}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-medium text-[#e6e9ef]">
                  {t.asset_category === "OPT"
                    ? `${t.underlying} ${t.put_call}${t.strike} ${t.expiry?.slice(2, 10)}`
                    : t.symbol}
                </td>
                <td className={`px-3 py-1.5 font-semibold ${t.buy_sell === "BUY" ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                  {t.buy_sell}
                </td>
                <td className="px-3 py-1.5 text-[#e6e9ef] tabular-nums">{t.quantity}</td>
                <td className="px-3 py-1.5 text-[#e6e9ef] tabular-nums">{t.trade_price.toFixed(2)}</td>
                <td className={`px-3 py-1.5 tabular-nums font-medium ${t.net_cash >= 0 ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                  {t.net_cash >= 0 ? "+" : ""}${Math.abs(t.net_cash).toFixed(0)}
                </td>
                <td className={`px-3 py-1.5 tabular-nums ${t.fifo_pnl > 0 ? "text-[#3fce8f]" : t.fifo_pnl < 0 ? "text-[#ff5d6c]" : "text-[#8b93a3]"}`}>
                  {t.fifo_pnl !== 0 ? `${t.fifo_pnl > 0 ? "+" : ""}$${Math.abs(t.fifo_pnl).toFixed(0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length === 0 && (
          <div className="text-center text-[#8b93a3] py-8 text-sm">No trades found</div>
        )}
      </div>
    </div>
  );
}
