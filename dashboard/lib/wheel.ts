export interface WheelCard {
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

export interface CockpitPositionLike {
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

export interface WheelDashboardLike {
  positions?: CockpitPositionLike[];
}

function formatExpiry(exp?: string): string {
  if (!exp) return "-";
  if (/^\d{8}$/.test(exp)) return `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6)}`;
  return exp.slice(0, 10);
}

function dte(exp?: string, now = new Date()): number | null {
  const iso = formatExpiry(exp);
  if (iso === "-") return null;
  const end = new Date(`${iso}T20:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}

function symbolRoot(symbol: string) {
  return symbol.trim().split(/\s+/)[0];
}

export function wheelStatusFor(pos: Partial<CockpitPositionLike>, days: number | null): WheelCard["status"] {
  if (pos.itm || (days != null && days <= 5)) return "risk";
  if ((pos.greeks?.iv ?? 0) >= 1 || (days != null && days <= 14)) return "watch";
  return "ok";
}

export function wheelNoteFor(pos: Partial<CockpitPositionLike>, days: number | null) {
  if (pos.itm) return "ITM or assignment-sensitive: review before expiry.";
  if (days != null && days <= 5) return "Expiry is close: decide hold, close, or roll.";
  if ((pos.greeks?.iv ?? 0) >= 1) return "High IV leg: monitor skew and liquidity.";
  if (pos.unrealized_pnl != null && pos.unrealized_pnl < 0) return "Unrealized loss: compare against thesis and exit rule.";
  return "No immediate rule breach detected.";
}

export function positionToWheelCard(pos: CockpitPositionLike): WheelCard {
  const days = dte(pos.expiration);
  const status = wheelStatusFor(pos, days);
  return {
    ticker: symbolRoot(pos.symbol),
    phase: pos.right === "P" ? "Put Leg" : pos.right === "C" ? "Call Leg" : "Option Leg",
    right: pos.right,
    strike: pos.strike,
    expiry: formatExpiry(pos.expiration),
    dte: days,
    underlying: pos.und_price ?? pos.market_price ?? null,
    iv: pos.greeks?.iv ?? null,
    delta: pos.greeks?.delta ?? null,
    pnl: pos.unrealized_pnl ?? null,
    status,
    note: wheelNoteFor(pos, days),
  };
}

export function buildWheelCardsFromDashboard(dashboard: WheelDashboardLike | null | undefined): WheelCard[] {
  return (dashboard?.positions ?? [])
    .filter((p) => p.sec_type === "OPT")
    .map(positionToWheelCard);
}
