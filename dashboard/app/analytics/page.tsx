"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface SymStat {
  symbol: string;
  trades: number;
  wins: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
}

interface PeriodStat {
  period: string;
  trades: number;
  win_rate: number;
  avg_pnl: number;
}

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(0);
const pct = (n: number) => (n * 100).toFixed(0) + "%";

// Shared dark-theme tooltip styling — light text on dark surface (Recharts
// defaults to dark item/label text, which is invisible on this background).
const TT = {
  contentStyle: { background: "#111419", border: "1px solid #232a33", borderRadius: 6, fontSize: 12, color: "#e6e9ef" },
  labelStyle: { color: "#e6e9ef", fontWeight: 600 },
  itemStyle: { color: "#e6e9ef" },
};

export default function AnalyticsPage() {
  const [bySym, setBySym] = useState<SymStat[]>([]);
  const [byPeriod, setByPeriod] = useState<PeriodStat[]>([]);
  const [byTime, setByTime] = useState<PeriodStat[]>([]);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => {
        setBySym(d.bySymbol);
        setByPeriod(d.byPeriod);
        setByTime(d.byTime);
      });
  }, []);

  const top15 = bySym.slice(0, 15);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-[#e0a82e]">Analytics</h1>

      {/* Win rate by holding period */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#111419] border border-[#232a33] rounded p-4">
          <div className="text-[#8b93a3] text-xs mb-3">Win Rate by Holding Period</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byPeriod}>
              <XAxis dataKey="period" tick={{ fill: "#e6e9ef", fontSize: 11 }} />
              <YAxis tickFormatter={(v) => pct(v)} tick={{ fill: "#e6e9ef", fontSize: 11 }} domain={[0, 1]} />
              <Tooltip
                formatter={(v) => pct(Number(v))}
                {...TT}
              />
              <Bar dataKey="win_rate" radius={[3, 3, 0, 0]}>
                {byPeriod.map((d, i) => (
                  <Cell key={i} fill={d.win_rate >= 0.5 ? "#3fce8f" : "#ff5d6c"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Win rate by time of day */}
        <div className="bg-[#111419] border border-[#232a33] rounded p-4">
          <div className="text-[#8b93a3] text-xs mb-3">Win Rate by Time of Day</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byTime}>
              <XAxis dataKey="period" tick={{ fill: "#e6e9ef", fontSize: 10 }} />
              <YAxis tickFormatter={(v) => pct(v)} tick={{ fill: "#e6e9ef", fontSize: 11 }} domain={[0, 1]} />
              <Tooltip
                formatter={(v) => pct(Number(v))}
                {...TT}
              />
              <Bar dataKey="win_rate" radius={[3, 3, 0, 0]}>
                {byTime.map((d, i) => (
                  <Cell key={i} fill={d.win_rate >= 0.5 ? "#3fce8f" : "#ff5d6c"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Total PnL by symbol */}
      <div className="bg-[#111419] border border-[#232a33] rounded p-4">
        <div className="text-[#8b93a3] text-xs mb-3">Total Realized P&L by Symbol (Top 15)</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={top15}>
            <XAxis dataKey="symbol" tick={{ fill: "#e6e9ef", fontSize: 11 }} />
            <YAxis tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} tick={{ fill: "#e6e9ef", fontSize: 11 }} />
            <Tooltip
              formatter={(v) => fmt(Number(v))}
              {...TT}
            />
            <Bar dataKey="total_pnl" radius={[3, 3, 0, 0]}>
              {top15.map((d, i) => (
                <Cell key={i} fill={d.total_pnl >= 0 ? "#3fce8f" : "#ff5d6c"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Symbol table */}
      <div className="bg-[#111419] border border-[#232a33] rounded overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#232a33] text-[#8b93a3]">
              {["Symbol", "Trades", "Wins", "Win Rate", "Total P&L", "Avg P&L"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bySym.map((s) => (
              <tr key={s.symbol} className="border-b border-[#232a33]/50 hover:bg-[#1b2027]/40">
                <td className="px-3 py-1.5 font-medium text-[#e6e9ef]">{s.symbol}</td>
                <td className="px-3 py-1.5 text-[#e6e9ef] tabular-nums">{s.trades}</td>
                <td className="px-3 py-1.5 text-[#e6e9ef] tabular-nums">{s.wins}</td>
                <td className={`px-3 py-1.5 font-semibold ${s.win_rate >= 0.5 ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                  {pct(s.win_rate)}
                </td>
                <td className={`px-3 py-1.5 font-semibold ${s.total_pnl >= 0 ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                  ${fmt(s.total_pnl)}
                </td>
                <td className={`px-3 py-1.5 ${s.avg_pnl >= 0 ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                  ${fmt(s.avg_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
