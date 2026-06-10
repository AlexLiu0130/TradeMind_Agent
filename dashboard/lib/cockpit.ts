export interface CockpitGreeks {
  net_delta: number;
  net_gamma: number;
  net_vega: number;
  net_theta: number;
}

export interface CockpitExposure {
  net_usd: number;
  net_pct_of_equity: number | null;
}

export interface CockpitPosition {
  symbol: string;
  sec_type: string;
  position: number;
  market_price: number;
  und_price?: number;
  unrealized_pnl: number;
  expiration?: string;
  strike?: number;
  right?: string;
  itm?: boolean;
  greeks?: { iv?: number; delta?: number };
}

export interface CockpitDashboard {
  et_time: string;
  session: string;
  portfolio_greeks: CockpitGreeks;
  positions: CockpitPosition[];
  exposure?: CockpitExposure;
  greeks_estimated?: boolean;
  greeks_unavailable?: boolean;
}

export interface AttentionSignal {
  label: string;
  value: string;
  detail: string;
  tone: "gold" | "up" | "down" | "muted";
}

const compactUsd = (n: number) => {
  const sign = n >= 0 ? "+" : "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

export function formatExpiry(exp?: string): string {
  if (!exp) return "-";
  if (/^\d{8}$/.test(exp)) return `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6)}`;
  return exp.slice(0, 10);
}

export function dte(exp?: string, now = new Date()): number | null {
  const iso = formatExpiry(exp);
  if (iso === "-") return null;
  const end = new Date(`${iso}T20:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

export function topLosers(positions: CockpitPosition[], limit = 3): CockpitPosition[] {
  return [...positions]
    .filter((p) => Number.isFinite(p.unrealized_pnl))
    .sort((a, b) => a.unrealized_pnl - b.unrealized_pnl)
    .slice(0, limit);
}

export function optionWatch(positions: CockpitPosition[], limit = 2): CockpitPosition[] {
  return [...positions]
    .filter((p) => p.sec_type === "OPT")
    .sort((a, b) => {
      const aIv = a.greeks?.iv ?? 0;
      const bIv = b.greeks?.iv ?? 0;
      const aDte = dte(a.expiration) ?? 999;
      const bDte = dte(b.expiration) ?? 999;
      return Number(Boolean(b.itm)) - Number(Boolean(a.itm)) || bIv - aIv || aDte - bDte;
    })
    .slice(0, limit);
}

export function buildAttentionSignals(dashboard: CockpitDashboard): AttentionSignal[] {
  const exposurePct = dashboard.exposure?.net_pct_of_equity;
  const exposureValue =
    exposurePct == null ? compactUsd(dashboard.exposure?.net_usd ?? 0) : `${exposurePct > 0 ? "+" : ""}${exposurePct}% equity`;
  const exposureTone = exposurePct != null && Math.abs(exposurePct) >= 100 ? "gold" : "muted";

  const losers = topLosers(dashboard.positions);
  const largest = losers[0];
  const loserDetail = losers.map((p) => `${p.symbol} ${compactUsd(p.unrealized_pnl)}`).join(" · ");

  const watched = optionWatch(dashboard.positions);
  const optionDetail =
    watched.length > 0
      ? watched
          .map((p) => {
            const iv = p.greeks?.iv == null ? "IV -" : `IV ${(p.greeks.iv * 100).toFixed(0)}%`;
            const days = dte(p.expiration);
            return `${p.symbol} ${p.right ?? ""}${p.strike ?? ""} ${iv}${days == null ? "" : ` · ${days}d`}`;
          })
          .join(" · ")
      : "No open option legs";

  const dataBits = [
    dashboard.session,
    dashboard.greeks_estimated ? "BS Greeks" : null,
    dashboard.greeks_unavailable ? "opt n/a" : null,
  ].filter(Boolean);

  return [
    {
      label: "Today Focus",
      value: exposureValue,
      detail: `Net delta ${dashboard.portfolio_greeks.net_delta.toFixed(0)} · net exposure`,
      tone: exposureTone,
    },
    {
      label: "Largest Drag",
      value: largest ? `${largest.symbol} ${compactUsd(largest.unrealized_pnl)}` : "Flat",
      detail: loserDetail || "No unrealized losses",
      tone: largest && largest.unrealized_pnl < 0 ? "down" : "muted",
    },
    {
      label: "Options Watch",
      value: watched.length > 0 ? `${watched.length} live legs` : "No option legs",
      detail: optionDetail,
      tone: watched.some((p) => p.itm || (p.greeks?.iv ?? 0) >= 1) ? "gold" : "muted",
    },
    {
      label: "Data State",
      value: dataBits.join(" · ") || "Ready",
      detail: dashboard.et_time,
      tone: dashboard.greeks_unavailable ? "down" : "up",
    },
  ];
}
