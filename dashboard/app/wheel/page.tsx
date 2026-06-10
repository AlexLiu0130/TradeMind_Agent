"use client";
import { useEffect, useState } from "react";

interface WheelCard {
  ticker: string;
  phase: string;
  right?: string;
  strike?: number;
  expiry?: string;
  dte?: number | null;
  underlying?: number | null;
  iv?: number | null;
  delta?: number | null;
  pnl?: number | null;
  status: "ok" | "watch" | "risk";
  note: string;
}

const usd = (n: number | null | undefined, d = 0) => {
  if (n == null) return "-";
  return (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d });
};

const tone: Record<WheelCard["status"], { label: string; cls: string; dot: string }> = {
  ok: { label: "OK", cls: "text-up border-up/25 bg-up/[0.035]", dot: "bg-up" },
  watch: { label: "WATCH", cls: "text-gold border-gold/35 bg-gold/[0.04]", dot: "bg-gold" },
  risk: { label: "RISK", cls: "text-down border-down/35 bg-down/[0.04]", dot: "bg-down" },
};

export default function WheelPage() {
  const [wheels, setWheels] = useState<WheelCard[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/wheel")
      .then((r) => r.json())
      .then((d) => {
        setWheels(d.wheels || []);
        setSource(d.source || "");
      })
      .finally(() => setLoading(false));
  }, []);

  const riskCount = wheels.filter((w) => w.status === "risk").length;
  const watchCount = wheels.filter((w) => w.status === "watch").length;

  return (
    <div className="space-y-5 stagger">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gold">Wheel Monitor</h1>
          <div className="text-xs text-muted mt-1">
            Short-put / covered-call legs that deserve expiry, IV, and roll attention.
          </div>
        </div>
        <div className="text-right">
          <div className="num text-sm text-ink">{wheels.length} legs</div>
          <div className="text-[10px] text-faint">{source || "loading"}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Risk", value: riskCount, cls: "text-down" },
          { label: "Watch", value: watchCount, cls: "text-gold" },
          { label: "Stable", value: Math.max(wheels.length - riskCount - watchCount, 0), cls: "text-up" },
        ].map((s) => (
          <div key={s.label} className="panel p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{s.label}</div>
            <div className={`num text-2xl font-semibold mt-1 ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading && <div className="text-sm text-muted">Loading wheel state...</div>}

      {!loading && wheels.length === 0 && (
        <div className="panel p-8 text-center text-sm text-muted">
          No wheel or option legs detected. When open short puts, covered calls, or tracked wheel cycles exist, they will appear here.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {wheels.map((w, i) => {
          const t = tone[w.status];
          return (
            <div key={`${w.ticker}-${w.expiry}-${w.strike}-${i}`} className={`panel p-4 ${w.status !== "ok" ? "panel-accent" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold text-ink">{w.ticker}</span>
                    <span className="text-xs text-gold border border-gold/30 rounded px-2 py-0.5">{w.phase}</span>
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {w.right || "-"} {w.strike ? `$${w.strike}` : ""} · {w.expiry || "no expiry"}
                  </div>
                </div>
                <div className={`inline-flex items-center gap-1.5 border rounded px-2 py-1 text-[10px] font-semibold ${t.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                  {t.label}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 mt-4">
                {[
                  { label: "DTE", value: w.dte == null ? "-" : `${w.dte}d`, cls: w.dte != null && w.dte <= 5 ? "text-down" : "text-ink" },
                  { label: "IV", value: w.iv == null ? "-" : `${(w.iv * 100).toFixed(0)}%`, cls: w.iv != null && w.iv >= 1 ? "text-gold" : "text-ink" },
                  { label: "Delta", value: w.delta == null ? "-" : w.delta.toFixed(3), cls: "text-gold" },
                  { label: "P&L", value: usd(w.pnl), cls: w.pnl != null && w.pnl < 0 ? "text-down" : "text-up" },
                ].map((m) => (
                  <div key={m.label} className="bg-raised border border-line rounded-lg p-2">
                    <div className="text-[9px] uppercase tracking-[0.1em] text-faint">{m.label}</div>
                    <div className={`num text-sm font-semibold mt-1 ${m.cls}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-line pt-3 text-xs text-muted leading-relaxed">
                {w.note}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
