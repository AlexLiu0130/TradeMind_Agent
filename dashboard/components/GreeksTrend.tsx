"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

interface RiskHistoryRow {
  ts: string;
  net_delta: number | null;
  net_gamma: number | null;
  net_vega: number | null;
  net_theta: number | null;
}
interface RiskHistoryResponse {
  points: RiskHistoryRow[];
  trends: { d7: Record<string, number | null>; d30: Record<string, number | null> };
}
interface CurrentGreeks { net_delta: number; net_gamma: number; net_vega: number; net_theta: number; }

const GREEKS = [
  { field: "net_delta" as const, name: "Δ Delta", color: "#e0a82e", digits: 0 },
  { field: "net_gamma" as const, name: "Γ Gamma", color: "#6ea8d8", digits: 2 },
  { field: "net_vega" as const, name: "V Vega", color: "#a78bfa", digits: 0 },
  { field: "net_theta" as const, name: "Θ Theta", color: "#3fce8f", digits: 0 },
];

function fmtDelta(v: number | null, digits: number): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export default function GreeksTrend({ current }: { current: CurrentGreeks }) {
  const [data, setData] = useState<RiskHistoryResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/risk/history?days=30")
      .then((r) => r.json())
      .then((d: RiskHistoryResponse) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const points = data?.points ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-ink text-xs font-semibold">Greeks Trend</span>
        <span className="text-[10px] text-faint">当前值 + 7/30 日变化（快照每 ≥10 分钟落库）</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {GREEKS.map((gk) => {
          const cur = current[gk.field];
          const d7 = data?.trends.d7[gk.field] ?? null;
          const d30 = data?.trends.d30[gk.field] ?? null;
          const series = points
            .filter((p) => p[gk.field] != null)
            .map((p) => ({ v: p[gk.field] as number }));
          return (
            <div key={gk.field} className="bg-raised border border-line rounded p-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] font-semibold" style={{ color: gk.color }}>{gk.name}</span>
                <span className="num text-sm font-semibold text-ink">
                  {cur >= 0 ? "+" : ""}{cur.toFixed(gk.digits)}
                </span>
              </div>
              <div className="h-8">
                {series.length >= 2 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                      <YAxis domain={["dataMin", "dataMax"]} hide />
                      <Line type="monotone" dataKey="v" stroke={gk.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center text-[10px] text-faint">历史积累中</div>
                )}
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px]">
                <span className="text-faint">7D <span className="num text-muted">{fmtDelta(d7, gk.digits)}</span></span>
                <span className="text-faint">30D <span className="num text-muted">{fmtDelta(d30, gk.digits)}</span></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
