"use client";
import { useEffect, useState } from "react";
import type { MarketRegime, Tone } from "@/lib/marketRegime";

interface RegimeResponse {
  regime: MarketRegime;
  as_of: number;
  missing: string[];
  cached: boolean;
}

const toneColor: Record<Tone, string> = {
  bull: "var(--color-up)",
  neutral: "var(--color-gold)",
  bear: "var(--color-down)",
};

// Horizontal 3-stop scale: marker sits left (bear) / center (neutral) / right (bull).
const tonePos: Record<Tone, string> = { bear: "12%", neutral: "50%", bull: "88%" };

export default function RegimeMatrix() {
  const [data, setData] = useState<RegimeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/market/regime")
      .then((r) => r.json())
      .then((d: RegimeResponse) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const regime = data?.regime;

  return (
    <div className="panel p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-ink text-xs font-semibold">Market Regime</span>
        {regime && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded border"
            style={{
              color: toneColor[regime.composite],
              borderColor: `color-mix(in srgb, ${toneColor[regime.composite]} 40%, transparent)`,
              background: `color-mix(in srgb, ${toneColor[regime.composite]} 8%, transparent)`,
            }}
          >
            {regime.compositeLabel}
          </span>
        )}
      </div>

      {!loaded ? (
        <div className="text-muted text-xs py-10 text-center">加载中…</div>
      ) : !regime ? (
        <div className="text-muted text-xs py-10 text-center">市场环境数据不可用</div>
      ) : (
        <>
          <div className="space-y-3 flex-1">
            {regime.dimensions.map((d) => (
              <div key={d.key}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11px] text-muted">{d.label}</span>
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: d.hasData ? toneColor[d.tone] : "var(--color-faint)" }}
                  >
                    {d.state}
                  </span>
                </div>
                <div className="relative h-1 rounded-full bg-raised overflow-visible">
                  {/* three-zone track */}
                  <div className="absolute inset-y-0 left-0 w-1/3 rounded-l-full" style={{ background: "color-mix(in srgb, var(--color-down) 18%, transparent)" }} />
                  <div className="absolute inset-y-0 left-1/3 w-1/3" style={{ background: "color-mix(in srgb, var(--color-gold) 14%, transparent)" }} />
                  <div className="absolute inset-y-0 right-0 w-1/3 rounded-r-full" style={{ background: "color-mix(in srgb, var(--color-up) 18%, transparent)" }} />
                  {/* marker */}
                  {d.hasData && (
                    <span
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border border-base"
                      style={{ left: tonePos[d.tone], background: toneColor[d.tone] }}
                    />
                  )}
                </div>
                <div className="text-[10px] text-faint mt-0.5 num">{d.detail}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t border-line flex items-center justify-between text-[10px] text-faint">
            <span>Agent 置信度 <span className="num text-muted">{regime.confidencePct}%</span></span>
            {data?.missing.length ? (
              <span className="text-down">{data.missing.join("/")} 缺失</span>
            ) : (
              <span>6/6 维度有数据</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
