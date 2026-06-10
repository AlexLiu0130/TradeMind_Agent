"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

interface Snap {
  ts: string;
  net_delta: number | null;
  net_vega: number | null;
  realized_pnl: number | null;
}

const CARD = "bg-[#111419] border border-[#232a33] rounded-lg p-4 shadow-sm";
const RANGES = [7, 30, 90];

export default function PnlHistory() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [days, setDays] = useState(30);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/snapshots?days=${days}`)
      .then((r) => r.json())
      .then((d) => setSnaps(d.snapshots || []))
      .finally(() => setLoaded(true));
  }, [days]);

  const data = snaps.map((s) => ({
    date: s.ts?.slice(5, 10),
    pnl: s.realized_pnl == null ? 0 : Math.round(s.realized_pnl),
  }));

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[#e6e9ef] text-xs font-semibold">Realized P&L History (USD)</div>
        <div className="flex gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                days === d ? "bg-[#e0a82e] text-white" : "text-[#8b93a3] border border-[#232a33] hover:bg-[#1b2027]"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loaded && data.length === 0 ? (
        <div className="text-center text-[#8b93a3] text-xs py-10">
          暂无历史快照。每日收盘后 <code className="text-[#e0a82e]">daily_review.py</code> 会自动记录。
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1f26" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#8b93a3", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fill: "#8b93a3", fontSize: 10 }}
              tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: "#111419", border: "1px solid #232a33", borderRadius: 6, fontSize: 12, color: "#e6e9ef" }}
              labelStyle={{ color: "#e6e9ef" }}
              itemStyle={{ color: "#e6e9ef" }}
              formatter={(v) => ["$" + Number(v).toLocaleString(), "Realized P&L"]}
            />
            <ReferenceLine y={0} stroke="#232a33" />
            <Line type="monotone" dataKey="pnl" stroke="#e0a82e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
