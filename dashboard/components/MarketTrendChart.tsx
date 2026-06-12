"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { SERIES_RANGES, type ComparisonPoint } from "@/lib/marketSeries";

interface Series {
  range: string;
  symbols: { key: string; color: string }[];
  points: ComparisonPoint[];
  missing: string[];
}

const TT = {
  contentStyle: { background: "#111419", border: "1px solid #232a33", borderRadius: 6, fontSize: 12, color: "#e6e9ef" },
  labelStyle: { color: "#e6e9ef", fontWeight: 600 },
  itemStyle: { color: "#e6e9ef" },
};

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function MarketTrendChart() {
  const [range, setRange] = useState("3mo");
  const [data, setData] = useState<Series | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/market/series?range=${range}`)
      .then((r) => r.json())
      .then((d: Series) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [range]);

  const points = data?.points ?? [];
  const symbols = data?.symbols ?? [];

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-ink text-xs font-semibold">Market Trends</span>
          <span className="text-muted text-[10px]">SPY · QQQ · SMH 归一化涨跌（窗口起点 = 0）</span>
        </div>
        <div className="flex gap-1">
          {SERIES_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                range === r.key ? "bg-gold text-base" : "text-muted border border-line hover:bg-hover"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* legend */}
      <div className="flex gap-4 mb-2">
        {symbols.map((s) => {
          const last = [...points].reverse().find((p) => p[s.key] != null)?.[s.key];
          const v = typeof last === "number" ? last : null;
          return (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-2.5 h-0.5 rounded" style={{ background: s.color }} />
              <span className="text-muted">{s.key}</span>
              <span className="num" style={{ color: v == null ? "var(--color-faint)" : v >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                {v == null ? "—" : pct(v)}
              </span>
            </span>
          );
        })}
        {data?.missing?.length ? (
          <span className="text-down text-[10px] self-center">{data.missing.join("/")} 数据不可用</span>
        ) : null}
      </div>

      {loaded && points.length === 0 ? (
        <div className="text-center text-muted text-xs py-16">市场数据暂不可用</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={points} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1f26" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#8b93a3", fontSize: 10 }} tickLine={false} axisLine={false}
              minTickGap={40} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fill: "#8b93a3", fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} width={42} />
            <Tooltip {...TT} formatter={(v, name) => [pct(Number(v)), name]} />
            <ReferenceLine y={0} stroke="#232a33" />
            {symbols.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.key}
                stroke={s.color} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
