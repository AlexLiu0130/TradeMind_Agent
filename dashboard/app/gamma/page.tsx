"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── types ────────────────────────────────────────────────────────────────────

interface StrikeRow {
  strike: number;
  call_oi: number;
  put_oi: number;
  call_gex: number;
  put_gex: number;
  gex: number;
  cumulative_gex: number;
}

interface GexData {
  ticker: string;
  spot: number;
  data_type: string;
  as_of: string;
  gex_env: "positive" | "negative";
  total_gex: number;
  call_wall: number;
  put_wall: number;
  gamma_flip: number | null;
  by_strike: StrikeRow[];
  missing_strikes: number[];
  cached?: boolean;
  stale?: boolean;
  eod_snapshot?: boolean;
  snapshot_date?: string;
  snapshot_ts?: string;
  cache_age_s?: number;
  error?: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const TT = {
  contentStyle: {
    background: "#111419",
    border: "1px solid #232a33",
    borderRadius: 6,
    fontSize: 12,
    color: "#e6e9ef",
  },
  labelStyle: { color: "#e6e9ef", fontWeight: 600 },
  itemStyle: { color: "#e6e9ef" },
};

function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

// ── component ────────────────────────────────────────────────────────────────

const DEFAULT_TICKERS = ["SPY", "QQQ", "SPX", "NVDA", "AAPL", "TSLA"];

export default function GammaPage() {
  const [ticker, setTicker] = useState("SPY");
  const [input, setInput] = useState("SPY");
  const [data, setData] = useState<GexData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchGex = useCallback(
    async (sym: string, fresh = false) => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      try {
        const url = `/api/gamma?ticker=${encodeURIComponent(sym)}&dte_max=45&strikes=20${fresh ? "&fresh=1" : ""}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const json: GexData = await res.json();
        if (json.error) {
          setError(json.error);
          setData(null);
        } else {
          setData(json);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchGex(ticker);
  }, [ticker, fetchGex]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setTicker(sym);
  };

  // Prepare chart data: net GEX bar + cumulative GEX line
  const chartData = (data?.by_strike ?? []).map((r) => ({
    strike: r.strike,
    gex: r.gex,
    cum: r.cumulative_gex,
    call_gex: r.call_gex,
    put_gex: r.put_gex,
  }));

  const isPositive = data?.gex_env === "positive";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gold">Gamma Exposure</h1>
          <p className="text-xs text-muted mt-0.5">
            Dealer GEX by strike · Call Wall / Put Wall / Gamma Flip
          </p>
        </div>

        {/* Ticker selector */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="flex gap-1">
            {DEFAULT_TICKERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setInput(t); setTicker(t); }}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  ticker === t
                    ? "bg-gold/20 text-gold border border-gold/40"
                    : "text-muted hover:text-ink border border-transparent"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="Ticker"
            className="w-20 px-2.5 py-1 text-xs rounded border border-line bg-card text-ink placeholder:text-muted focus:outline-none focus:border-gold/50"
          />
          <button
            type="submit"
            className="px-3 py-1 text-xs rounded border border-line text-ink hover:border-gold/50 transition-colors"
          >
            Load
          </button>
          {data && (
            <button
              type="button"
              onClick={() => fetchGex(ticker, true)}
              disabled={loading}
              className="px-3 py-1 text-xs rounded border border-line text-muted hover:text-ink transition-colors disabled:opacity-40"
            >
              Refresh
            </button>
          )}
        </form>
      </div>

      {/* Loading state */}
      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
          <span className="inline-block w-2 h-2 rounded-full bg-gold pulse" />
          Fetching {ticker} GEX from Gateway…
          <span className="text-xs">(requires market hours)</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-sm text-red-300">
          <span className="font-medium">Failed to load GEX data</span>
          <p className="text-xs mt-1 text-red-300/70">{error}</p>
          <p className="text-xs mt-2 text-muted">
            GEX requires IBKR Gateway online + market hours (ET 09:30–16:00).
          </p>
        </div>
      )}

      {/* Stale banner */}
      {data?.stale && !data.eod_snapshot && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2 text-xs text-yellow-300 flex items-center gap-2">
          <span>⚠</span>
          Showing cached data ({Math.round((data.cache_age_s ?? 0) / 60)}m old) —
          live fetch failed. Refresh when market is open.
        </div>
      )}
      {data?.eod_snapshot && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2 text-xs text-blue-300 flex items-center gap-2">
          <span>📸</span>
          EOD snapshot from {data.snapshot_ts ?? data.snapshot_date} — market closed.
          Live data resumes at ET 09:30 on next trading day.
        </div>
      )}

      {/* Main content */}
      {data && !error && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Gamma Environment */}
            <div
              className={`rounded border p-3 ${
                isPositive
                  ? "border-green-500/30 bg-green-500/10"
                  : "border-red-500/30 bg-red-500/10"
              }`}
            >
              <div className="text-xs text-muted mb-1">Gamma Env</div>
              <div
                className={`text-lg font-bold ${
                  isPositive ? "text-green-400" : "text-red-400"
                }`}
              >
                {isPositive ? "Positive ↑" : "Negative ↓"}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {isPositive ? "Dealers long gamma — dampens vol" : "Dealers short gamma — amplifies vol"}
              </div>
            </div>

            {/* Call Wall */}
            <div className="rounded border border-line bg-card p-3">
              <div className="text-xs text-muted mb-1">Call Wall</div>
              <div className="text-xl font-bold text-ink">${data.call_wall}</div>
              <div className="text-xs text-muted mt-0.5">Resistance · max call GEX</div>
            </div>

            {/* Put Wall */}
            <div className="rounded border border-line bg-card p-3">
              <div className="text-xs text-muted mb-1">Put Wall</div>
              <div className="text-xl font-bold text-ink">${data.put_wall}</div>
              <div className="text-xs text-muted mt-0.5">Support · max put GEX</div>
            </div>

            {/* Gamma Flip */}
            <div className="rounded border border-line bg-card p-3">
              <div className="text-xs text-muted mb-1">Gamma Flip</div>
              <div className="text-xl font-bold text-ink">
                {data.gamma_flip != null ? `$${data.gamma_flip}` : "—"}
              </div>
              <div className="text-xs text-muted mt-0.5">Regime switch · GEX = 0</div>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>{data.ticker} · spot ${data.spot}</span>
            <span>Total GEX: {fmtGex(data.total_gex)}</span>
            <span>As of: {data.as_of}</span>
            {data.cached && <span className="text-yellow-500/60">cached</span>}
            {data.missing_strikes.length > 0 && (
              <span className="text-red-400/60">{data.missing_strikes.length} strikes missing</span>
            )}
          </div>

          {/* Net GEX bar chart */}
          <div className="bg-card border border-line rounded p-4">
            <div className="text-xs text-muted mb-3">
              Net GEX by Strike (positive = dealers long gamma at that strike)
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <XAxis
                  dataKey="strike"
                  tick={{ fill: "#8b93a3", fontSize: 10 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <YAxis
                  tick={{ fill: "#8b93a3", fontSize: 10 }}
                  tickFormatter={fmtGex}
                  width={56}
                />
                <Tooltip
                  {...TT}
                  formatter={(v, name) => [fmtGex(Number(v)), String(name)]}
                  labelFormatter={(l) => `Strike $${l}`}
                />
                {/* Spot price */}
                <ReferenceLine
                  x={data.spot}
                  stroke="#e0a82e"
                  strokeDasharray="4 2"
                  label={{ value: "Spot", fill: "#e0a82e", fontSize: 10, position: "top" }}
                />
                {/* Call Wall */}
                <ReferenceLine
                  x={data.call_wall}
                  stroke="#3fce8f"
                  strokeDasharray="3 3"
                  label={{ value: "CW", fill: "#3fce8f", fontSize: 10, position: "insideTopLeft" }}
                />
                {/* Put Wall */}
                <ReferenceLine
                  x={data.put_wall}
                  stroke="#ff5d6c"
                  strokeDasharray="3 3"
                  label={{ value: "PW", fill: "#ff5d6c", fontSize: 10, position: "insideTopLeft" }}
                />
                {/* Gamma Flip */}
                {data.gamma_flip != null && (
                  <ReferenceLine
                    x={data.gamma_flip}
                    stroke="#8b93a3"
                    strokeDasharray="2 4"
                    label={{ value: "Flip", fill: "#8b93a3", fontSize: 10, position: "insideTopRight" }}
                  />
                )}
                {/* Zero line */}
                <ReferenceLine y={0} stroke="#232a33" />
                <Bar dataKey="gex" radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.gex >= 0 ? "#3fce8f" : "#ff5d6c"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cumulative GEX chart */}
          <div className="bg-card border border-line rounded p-4">
            <div className="text-xs text-muted mb-3">
              Cumulative GEX (crosses zero = Gamma Flip level)
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <XAxis
                  dataKey="strike"
                  tick={{ fill: "#8b93a3", fontSize: 10 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <YAxis
                  tick={{ fill: "#8b93a3", fontSize: 10 }}
                  tickFormatter={fmtGex}
                  width={56}
                />
                <Tooltip
                  {...TT}
                  formatter={(v) => [fmtGex(Number(v)), "Cumulative GEX"]}
                  labelFormatter={(l) => `Strike $${l}`}
                />
                <ReferenceLine y={0} stroke="#e0a82e" strokeDasharray="4 2" />
                <ReferenceLine x={data.spot} stroke="#e0a82e" strokeDasharray="4 2" />
                <Bar dataKey="cum" radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.cum >= 0 ? "#3b82f6" : "#f59e0b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-gold inline-block" />
              Spot price
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-green-400 inline-block" />
              Call Wall (CW) — resistance
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-red-400 inline-block" />
              Put Wall (PW) — support
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-muted inline-block" />
              Gamma Flip — regime switch
            </span>
          </div>
        </>
      )}
    </div>
  );
}
