"use client";
import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine,
} from "recharts";
import { MotionConfig, AnimatePresence, motion } from "motion/react";
import PnlHistory from "@/components/PnlHistory";
import AnimatedValue from "@/components/AnimatedValue";
import MarketTrendChart from "@/components/MarketTrendChart";
import RegimeMatrix from "@/components/RegimeMatrix";
import GreeksTrend from "@/components/GreeksTrend";
import EventTimeline from "@/components/EventTimeline";
import { buildAttentionSignals } from "@/lib/cockpit";

interface Greeks { net_delta: number; net_gamma: number; net_vega: number; net_theta: number; }
interface Exposure {
  long_usd: number; short_usd: number; net_usd: number; gross_usd: number;
  net_pct_of_equity: number | null; stock_usd: number; option_delta_usd: number;
}
interface Position {
  symbol: string; sec_type: string; position: number; avg_cost: number;
  market_price: number; market_value: number; unrealized_pnl: number;
  expiration?: string; strike?: number; right?: string; multiplier?: number;
  und_price?: number; itm?: boolean;
  greeks?: { iv?: number; delta?: number; gamma?: number; vega?: number; theta?: number; };
}
interface Dashboard {
  generated_at: string; et_time: string; session: string;
  portfolio_greeks: Greeks; positions: Position[];
  greeks_estimated?: boolean; greeks_unavailable?: boolean; exposure?: Exposure;
}
interface AdvisorEvidence {
  agent: string;
  label: string;
  detail: string;
  url?: string | null;
}
interface AdvisorCard {
  id: string;
  category: string;
  priority: "high" | "medium" | "low";
  title: string;
  tickers: string[];
  summary: string;
  suggested_action: string;
  confidence: "high" | "medium" | "low" | string;
  evidence: AdvisorEvidence[];
  guardrails: string[];
  status: "proposal";
}
interface AgentGraph {
  mode: string;
  permission_boundary: string;
  agents: { name: string; role: string }[];
  handoffs: { from: string; to: string; trigger: string }[];
}
interface AdvisorBoard {
  generated_at: string;
  cards: AdvisorCard[];
  agent_graph: AgentGraph;
  stats: {
    cards: number;
    intel_items_scanned: number;
    tracked_clusters: number;
    portfolio_symbols: string[];
    due_reminders?: number;
  };
}
type AdvisorAction = "create_thesis" | "watchlist" | "remind" | "ignore";

const usd = (n: number, d = 0) =>
  (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const num = (n: number | null | undefined, d = 2) => n == null ? "—" : n.toFixed(d);
// Long share of long+|short| for the composition bar (0–100, defaults to 50 when flat).
const expoPct = (long: number, short: number) => {
  const denom = long + Math.abs(short);
  return denom <= 0 ? 50 : Math.round((long / denom) * 100);
};

const TT = {
  contentStyle: { background: "#111419", border: "1px solid #232a33", borderRadius: 6, fontSize: 12, color: "#e6e9ef" },
  labelStyle: { color: "#e6e9ef", fontWeight: 600 },
  itemStyle: { color: "#e6e9ef" },
};

const CARD = "panel p-4";

const priorityTone: Record<AdvisorCard["priority"], string> = {
  high: "text-down border-down/35 bg-down/[0.04]",
  medium: "text-gold border-gold/35 bg-gold/[0.04]",
  low: "text-muted border-line bg-panel",
};

const confidenceLabel: Record<string, string> = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
};
const priorityLabel: Record<AdvisorCard["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function AdvisorCenter({
  board,
  loading,
  error,
  onAction,
  actionState,
}: {
  board: AdvisorBoard | null;
  loading: boolean;
  error: string | null;
  onAction: (action: AdvisorAction, card: AdvisorCard) => void;
  actionState: Record<string, { loading?: boolean; label?: string; error?: string }>;
}) {
  const cards = board?.cards || [];
  return (
    <section className="panel panel-accent overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="p-4 border-b xl:border-b-0 xl:border-r border-line">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-gold">Agent Committee</div>
              <h2 className="text-base font-semibold text-ink mt-1">建议中心</h2>
            </div>
            <span className="rounded border border-gold/35 px-2 py-1 text-[10px] font-semibold text-gold">建议模式</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {board?.agent_graph.permission_boundary || "Agent 可以主动建议、排序和准备证据；只有用户可以交易或改变仓位。"}
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2 text-right">
            <div className="bg-base border border-line rounded p-2">
              <div className="num text-sm text-ink">{board?.stats.cards ?? cards.length}</div>
              <div className="text-[9px] text-faint">建议</div>
            </div>
            <div className="bg-base border border-line rounded p-2">
              <div className="num text-sm text-gold">{board?.stats.tracked_clusters ?? 0}</div>
              <div className="text-[9px] text-faint">主题簇</div>
            </div>
            <div className="bg-base border border-line rounded p-2">
              <div className="num text-sm text-down">{board?.stats.due_reminders ?? 0}</div>
              <div className="text-[9px] text-faint">提醒</div>
            </div>
            <div className="bg-base border border-line rounded p-2">
              <div className="num text-sm text-up">{board?.agent_graph.agents.length ?? 5}</div>
              <div className="text-[9px] text-faint">Agents</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(board?.agent_graph.handoffs || []).slice(0, 4).map((edge) => (
              <div key={`${edge.from}-${edge.to}-${edge.trigger}`} className="rounded border border-line bg-base p-2">
                <div className="text-[10px] text-ink">{edge.from} → {edge.to}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-muted">{edge.trigger}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <div className="text-sm font-semibold text-ink">主动建议</div>
              <div className="text-[10px] text-muted mt-0.5">
                {loading ? "Agent 正在整理风险、情报和 Lens 输出" : error ? error : `扫描 ${board?.stats.intel_items_scanned ?? 0} 条情报`}
              </div>
            </div>
            <div className="num text-xs text-muted">{board?.generated_at ? new Date(board.generated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</div>
          </div>

          <div className="mt-3 grid grid-cols-1 2xl:grid-cols-2 gap-3">
            {loading && cards.length === 0 && (
              <div className="rounded border border-line bg-base p-4 text-xs text-muted">整理中...</div>
            )}
            {!loading && cards.length === 0 && (
              <div className="rounded border border-line bg-base p-4 text-xs text-muted">暂无建议。</div>
            )}
            <AnimatePresence initial={false}>
            {cards.map((card) => (
              <motion.article
                key={card.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="rounded border border-line bg-base p-3 min-h-[220px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded border px-2 py-0.5 text-[9px] font-semibold ${priorityTone[card.priority]}`}>{priorityLabel[card.priority]}</span>
                      <span className="rounded border border-line px-2 py-0.5 text-[9px] text-muted">{card.category}</span>
                      <span className="rounded border border-line px-2 py-0.5 text-[9px] text-muted">{confidenceLabel[card.confidence] || card.confidence}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold leading-snug text-ink">{card.title}</h3>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {card.tickers.slice(0, 3).map((ticker) => (
                      <span key={ticker} className="num rounded border border-gold/35 px-1.5 py-0.5 text-[10px] text-gold">{ticker}</span>
                    ))}
                  </div>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-muted">{card.summary}</p>
                <div className="mt-3 rounded border border-gold/20 bg-gold/[0.035] p-2">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-gold">建议动作</div>
                  <div className="mt-1 text-xs leading-relaxed text-ink">{card.suggested_action}</div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {card.evidence.slice(0, 2).map((item) => (
                    <div key={`${card.id}-${item.agent}-${item.label}`} className="rounded border border-line bg-raised p-2">
                      <div className="text-[9px] uppercase tracking-[0.1em] text-faint">{item.agent}</div>
                      <div className="mt-1 text-[10px] font-semibold text-ink">{item.label}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted">{item.detail}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
                  {(card.guardrails || []).slice(0, 2).join(" · ")}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {([
                    ["create_thesis", "生成 thesis"],
                    ["watchlist", "加入 watchlist"],
                    ["remind", "稍后提醒"],
                    ["ignore", "忽略"],
                  ] as Array<[AdvisorAction, string]>).map(([action, label]) => {
                    const state = actionState[`${card.id}:${action}`] || actionState[card.id];
                    return (
                      <button
                        key={action}
                        onClick={() => onAction(action, card)}
                        disabled={Boolean(state?.loading)}
                        className={`rounded border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                          action === "create_thesis" ? "border-gold/35 text-gold hover:bg-gold/10" :
                          action === "ignore" ? "border-line text-faint hover:bg-hover" :
                          "border-line text-muted hover:text-ink hover:bg-hover"
                        }`}
                      >
                        {state?.loading ? "处理中" : label}
                      </button>
                    );
                  })}
                  {actionState[card.id]?.label && (
                    <span className="text-[10px] text-up">{actionState[card.id].label}</span>
                  )}
                  {actionState[card.id]?.error && (
                    <span className="text-[10px] text-down">{actionState[card.id].error}</span>
                  )}
                </div>
              </motion.article>
            ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function PortfolioPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [advisor, setAdvisor] = useState<AdvisorBoard | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [advisorActionState, setAdvisorActionState] = useState<Record<string, { loading?: boolean; label?: string; error?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAdvisor = useCallback((nextDashboard: Dashboard) => {
    setAdvisorLoading(true);
    return fetch("/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard: nextDashboard, intel_limit: 120 }),
    })
      .then((r) => r.json())
      .then((d: AdvisorBoard & { error?: string }) => {
        if (d.error) {
          setAdvisorError(d.error);
          return;
        }
        setAdvisor(d);
        setAdvisorError(null);
      })
      .catch(() => setAdvisorError("Agent advice unavailable"))
      .finally(() => setAdvisorLoading(false));
  }, []);

  // Fetch + apply are split so the mount effect only touches state in async
  // continuations (never synchronously in the effect body), while the Refresh
  // button can still flip the spinner immediately.
  // fresh=true (the Refresh button) bypasses the server-side cache for live data;
  // the mount load uses the cache so repeat visits within the TTL are instant.
  const fetchDashboard = useCallback((fresh = false) => {
    return fetch(`/api/positions${fresh ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((d: { dashboard?: Dashboard }) => {
        if (d.dashboard) {
          setDashboard(d.dashboard);
          setError(null);
          fetchAdvisor(d.dashboard);
        }
        else setError("IBKR Gateway offline");
      })
      .catch(() => setError("Connection failed"))
      .finally(() => setLoading(false));
  }, [fetchAdvisor]);

  const load = useCallback(() => {
    setLoading(true);
    return fetchDashboard(true);
  }, [fetchDashboard]);

  const runAdvisorAction = useCallback(async (action: AdvisorAction, card: AdvisorCard) => {
    const actionKey = `${card.id}:${action}`;
    setAdvisorActionState((s) => ({ ...s, [actionKey]: { loading: true }, [card.id]: { loading: true } }));
    try {
      const res = await fetch("/api/advisor/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, card }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdvisorActionState((s) => ({
          ...s,
          [actionKey]: {},
          [card.id]: { error: data.error || "操作失败" },
        }));
        return;
      }
      const label =
        action === "create_thesis" ? `已生成 thesis #${data.thesis_id}` :
        action === "watchlist" ? "已加入 watchlist" :
        action === "remind" ? "已记录稍后提醒" :
        "已忽略";
      setAdvisorActionState((s) => ({
        ...s,
        [actionKey]: {},
        [card.id]: { label },
      }));
    } catch {
      setAdvisorActionState((s) => ({
        ...s,
        [actionKey]: {},
        [card.id]: { error: "操作失败" },
      }));
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  if (loading) return <div className="text-[#8b93a3] text-sm p-8">Connecting to IBKR Gateway...</div>;
  if (error || !dashboard) return (
    <div className="p-8">
      <div className="text-[#ff5d6c] text-sm mb-3">{error || "No data"}</div>
      <button onClick={load} className="text-[#e0a82e] text-xs border border-[#232a33] px-3 py-1.5 rounded-md hover:bg-[#1b2027]">↻ Retry</button>
    </div>
  );

  const { portfolio_greeks: g, positions, et_time, session, greeks_estimated, greeks_unavailable, exposure } = dashboard;
  const attention = buildAttentionSignals(dashboard);
  const totalMV = positions.reduce((s, p) => s + (p.market_value || 0), 0);
  const totalUPnL = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
  const stk = positions.filter(p => p.sec_type === "STK");
  const opts = positions.filter(p => p.sec_type === "OPT");

  const pnlData = [...positions]
    .sort((a, b) => a.unrealized_pnl - b.unrealized_pnl)
    .map(p => ({
      symbol: p.sec_type === "OPT" ? `${p.symbol} ${p.right}${p.strike}` : p.symbol,
      pnl: Math.round(p.unrealized_pnl),
    }));

  const greeksDefs = [
    { name: "Δ Delta", desc: "标的每涨$1，组合盈亏变化", value: Math.round(g.net_delta), color: "#e0a82e" },
    { name: "Γ Gamma", desc: "Delta 变化加速度", value: +g.net_gamma.toFixed(2), color: "#6ea8d8" },
    { name: "V Vega",  desc: "IV 每升1%，组合盈亏变化", value: Math.round(g.net_vega), color: "#a78bfa" },
    { name: "Θ Theta", desc: "每日时间损耗（卖方收）", value: Math.round(g.net_theta), color: g.net_theta >= 0 ? "#3fce8f" : "#ff5d6c" },
  ];
  const maxAbs = Math.max(...greeksDefs.map(x => Math.abs(x.value)), 1);

  return (
    <MotionConfig reducedMotion="user">
    <div className="space-y-5 stagger">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-ink tracking-tight">Live Portfolio</h1>
          <div className="text-xs text-muted mt-1 flex items-center gap-2">
            <span className="num">{et_time}</span>
            <span className="text-faint">·</span>
            <span className="inline-flex items-center gap-1.5 text-up font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-up pulse" />
              {session}
            </span>
          </div>
        </div>
        <button onClick={load} className="text-xs text-gold border border-gold/25 px-3 py-1.5 rounded-md hover:bg-gold/10 transition-colors">
          ↻ Refresh
        </button>
      </div>

      {/* Attention strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {attention.map((s) => {
          const tone =
            s.tone === "gold" ? "border-gold/35 bg-gold/[0.04]" :
            s.tone === "up" ? "border-up/25 bg-up/[0.035]" :
            s.tone === "down" ? "border-down/30 bg-down/[0.035]" :
            "border-line bg-panel";
          const valueColor =
            s.tone === "gold" ? "#e0a82e" :
            s.tone === "up" ? "#3fce8f" :
            s.tone === "down" ? "#ff5d6c" :
            "#e6e9ef";
          return (
            <div key={s.label} className={`panel p-3 min-h-[88px] ${tone}`}>
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-1.5">{s.label}</div>
              <div className="num text-lg font-semibold" style={{ color: valueColor }}>{s.value}</div>
              <div className="text-[11px] text-muted leading-snug mt-1">{s.detail}</div>
            </div>
          );
        })}
      </div>

      {/* Event timeline + advisor center (§3.4) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 items-start">
        <EventTimeline />
        <AdvisorCenter
          board={advisor}
          loading={advisorLoading}
          error={advisorError}
          onAction={runAdvisorAction}
          actionState={advisorActionState}
        />
      </div>

      {/* Market trends + regime matrix (65/35, §3.2) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,13fr)_minmax(0,7fr)] gap-4">
        <MarketTrendChart />
        <RegimeMatrix />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Market Value", value: "$" + Math.abs(totalMV).toLocaleString("en-US", { maximumFractionDigits: 0 }), color: "#e6e9ef", accent: false },
          { label: "Unrealized P&L", value: usd(totalUPnL), color: totalUPnL >= 0 ? "#3fce8f" : "#ff5d6c", accent: true },
          { label: "Net Delta (Δ)", value: g.net_delta.toFixed(0), color: "#e0a82e", accent: false },
          { label: "Theta / day (Θ)", value: usd(g.net_theta, 2), color: g.net_theta >= 0 ? "#3fce8f" : "#ff5d6c", accent: false },
        ].map(c => (
          <div key={c.label} className={`panel p-4 ${c.accent ? "panel-accent" : ""}`}>
            <div className="text-muted text-[10px] uppercase tracking-[0.12em] mb-2">{c.label}</div>
            <div className="num text-2xl font-semibold" style={{ color: c.color }}>
              <AnimatedValue value={c.value} />
            </div>
          </div>
        ))}
      </div>

      {/* Market exposure */}
      {exposure && (
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-ink text-xs font-semibold">Market Exposure</span>
            <span className="text-muted text-[10px]">Delta 调整后的美元市场敞口（股票 + 期权 delta 等效）</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Net Exposure", value: usd(exposure.net_usd), sub: exposure.net_pct_of_equity != null ? `${exposure.net_pct_of_equity >= 0 ? "+" : ""}${exposure.net_pct_of_equity}% of equity` : null, color: exposure.net_usd >= 0 ? "#3fce8f" : "#ff5d6c" },
              { label: "Gross Exposure", value: "$" + Math.round(exposure.gross_usd).toLocaleString(), sub: "long + |short|", color: "#e6e9ef" },
              { label: "Long", value: "$" + Math.round(exposure.long_usd).toLocaleString(), sub: "delta-adj $", color: "#3fce8f" },
              { label: "Short", value: usd(exposure.short_usd), sub: "delta-adj $", color: "#ff5d6c" },
            ].map(c => (
              <div key={c.label} className="bg-raised border border-line rounded-lg p-3">
                <div className="text-muted text-[10px] uppercase tracking-[0.1em] mb-1.5">{c.label}</div>
                <div className="num text-base font-semibold" style={{ color: c.color }}>{c.value}</div>
                {c.sub && <div className="num text-[10px] text-faint mt-0.5">{c.sub}</div>}
              </div>
            ))}
          </div>
          {/* Long / short composition bar */}
          <div className="mt-3">
            <div className="flex h-2 rounded-full overflow-hidden bg-raised">
              <div className="bg-up/80" style={{ width: `${expoPct(exposure.long_usd, exposure.short_usd)}%` }} />
              <div className="bg-down/80" style={{ width: `${100 - expoPct(exposure.long_usd, exposure.short_usd)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-faint mt-1">
              <span className="text-up">■ Long stock {stk.length} · opt delta</span>
              <span className="text-down">Short ■</span>
            </div>
          </div>
        </div>
      )}

      {/* Greeks + P&L chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Greeks */}
        <div className={CARD}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-ink text-xs font-semibold">Greeks Exposure</span>
            {greeks_estimated && (
              <span
                title="IBKR 未提供期权 Greeks；以下为本地 Black-Scholes 估算值"
                className="text-[9px] font-semibold uppercase tracking-wider text-gold border border-gold/40 rounded px-1 py-px"
              >
                est · BS
              </span>
            )}
            {greeks_unavailable && (
              <span
                title="IBKR 未返回期权行情（缺订阅或盘前数据未到），且无标的价可供本地估算"
                className="text-[9px] font-semibold uppercase tracking-wider text-down border border-down/40 rounded px-1 py-px"
              >
                opt n/a
              </span>
            )}
          </div>
          <div className="text-muted text-[10px] mb-4">
            各希腊字母衡量组合对不同风险的敞口大小
            {greeks_estimated && "（期权 Greeks 为本地估算，非 IBKR 实时）"}
            {greeks_unavailable && "（期权行情暂不可用，Γ/V/Θ 仅含股票部分）"}
          </div>
          <div className="space-y-4">
            {greeksDefs.map(item => (
              <div key={item.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: item.color }}>{item.name}</span>
                    <span className="text-[10px] text-[#8b93a3]">{item.desc}</span>
                  </div>
                  <span className="num text-xs font-semibold" style={{ color: item.color }}>
                    {item.value >= 0 ? "+" : ""}{item.value}
                  </span>
                </div>
                <div className="h-2 bg-[#1b2027] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(Math.abs(item.value) / maxAbs * 100, 100)}%`,
                    background: item.color, opacity: 0.85,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Unrealized P&L chart */}
        <div className={CARD}>
          <div className="text-[#e6e9ef] text-xs font-semibold mb-3">Unrealized P&L by Position (USD)</div>
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={pnlData} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#8b93a3", fontSize: 10 }}
                tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"}
                tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="symbol" width={90}
                tick={{ fill: "#e6e9ef", fontSize: 11, fontWeight: 500 }}
                tickLine={false} axisLine={false} />
              <Tooltip {...TT} formatter={(v) => [usd(Number(v)), "Unreal. P&L"]} />
              <ReferenceLine x={0} stroke="#232a33" />
              <Bar dataKey="pnl" radius={[0, 3, 3, 0]} barSize={14}>
                {pnlData.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "#3fce8f" : "#ff5d6c"} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Greeks trend — current + 7/30d change (§3.3.3) */}
      <GreeksTrend current={g} />

      {/* Positions table */}
      <div className="bg-[#111419] border border-[#232a33] rounded-lg overflow-auto shadow-sm">
        <div className="px-4 py-2.5 border-b border-[#232a33] flex items-center gap-4">
          <span className="text-[#e6e9ef] text-xs font-semibold">Positions ({positions.length})</span>
          <span className="text-[#8b93a3] text-xs">STK {stk.length} · OPT {opts.length}</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#161a21] border-b border-[#232a33]">
              {["Symbol","Type","Qty","Avg Cost","Last","Mkt Value","Unreal. P&L","Strike","Expiry","Δ Delta","IV"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[#8b93a3] font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const isOpt = p.sec_type === "OPT";
              const iv = p.greeks?.iv ? (p.greeks.iv * 100).toFixed(0) + "%" : "—";
              const delta = p.greeks?.delta ? p.greeks.delta.toFixed(3) : "—";
              return (
                <tr key={i} className="border-b border-[#232a33]/60 hover:bg-[#161a21]">
                  <td className="px-3 py-2 font-semibold text-[#e6e9ef]">{p.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${isOpt ? "bg-[#16202b] text-[#6ea8d8]" : "bg-[#11241b] text-[#3fce8f]"}`}>
                      {isOpt ? p.right : "STK"}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[#e6e9ef]">{p.position}</td>
                  <td className="px-3 py-2 tabular-nums text-[#8b93a3]">${num(p.avg_cost, 2)}</td>
                  <td className="px-3 py-2 tabular-nums text-[#e6e9ef]">${num(p.market_price, 2)}</td>
                  <td className="px-3 py-2 tabular-nums text-[#e6e9ef]">${Math.round(p.market_value).toLocaleString()}</td>
                  <td className={`px-3 py-2 tabular-nums font-semibold ${p.unrealized_pnl >= 0 ? "text-[#3fce8f]" : "text-[#ff5d6c]"}`}>
                    {usd(p.unrealized_pnl)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[#8b93a3]">{isOpt ? `$${p.strike}` : "—"}</td>
                  <td className="px-3 py-2 text-[#8b93a3]">
                    {isOpt && p.expiration ? `${p.expiration.slice(0,4)}-${p.expiration.slice(4,6)}-${p.expiration.slice(6)}` : "—"}
                  </td>
                  <td className={`px-3 py-2 tabular-nums font-medium ${isOpt ? "text-[#e0a82e]" : "text-[#8b93a3]"}`}>{delta}</td>
                  <td className="px-3 py-2 tabular-nums text-[#8b93a3]">{iv}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* P&L history */}
      <PnlHistory />
    </div>
    </MotionConfig>
  );
}
