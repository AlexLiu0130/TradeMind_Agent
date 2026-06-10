/**
 * portfolioMath — option Greeks fallback + market-exposure math, computed in the
 * dashboard layer.
 *
 * Why this exists: IBKR only streams option model-Greeks (delta/gamma/vega/theta)
 * when the account holds the relevant options market-data subscription. Without it,
 * `portfolio_positions.py` reports Error 10091 and the per-option Greeks come back
 * empty — so net gamma/vega/theta read 0 even though the math upstream is correct.
 *
 * When IBKR Greeks are missing, we back out implied volatility from the option's
 * market price (Black-Scholes, Newton-Raphson) and derive Greeks ourselves. These
 * are clearly flagged `estimated: true` so the UI never passes a model number off
 * as exchange data. American-style early exercise and dividends are ignored — a
 * standard, documented approximation for liquid single-name equity options.
 */

export interface PositionGreeks {
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  iv?: number;
}

export interface Position {
  symbol: string;
  sec_type: string; // STK | OPT
  position: number; // signed quantity (short < 0)
  market_price: number; // option's own price (per share) for OPT; share price for STK
  market_value: number;
  und_price?: number;
  strike?: number;
  right?: string; // C | P
  expiration?: string; // YYYYMMDD
  multiplier?: number;
  greeks?: PositionGreeks;
}

const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE ?? "0.045");

// ── Black-Scholes primitives ──────────────────────────────────────────────────

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF.
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number) {
  const vsqrt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / vsqrt;
  return { d1, d2: d1 - vsqrt };
}

function bsPrice(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const disc = Math.exp(-r * T);
  return isCall
    ? S * normCdf(d1) - K * disc * normCdf(d2)
    : K * disc * normCdf(-d2) - S * normCdf(-d1);
}

/** Implied vol from price via Newton-Raphson with a bisection fallback. Returns null if it can't converge. */
export function impliedVol(
  price: number,
  S: number,
  K: number,
  T: number,
  isCall: boolean,
  r = RISK_FREE_RATE,
): number | null {
  if (price <= 0 || S <= 0 || K <= 0 || T <= 0) return null;
  // Intrinsic-value floor: a price below intrinsic has no real IV.
  const intrinsic = Math.max(0, isCall ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S);
  if (price < intrinsic - 1e-6) return null;

  let sigma = 0.5;
  for (let i = 0; i < 50; i++) {
    const { d1 } = d1d2(S, K, T, r, sigma);
    const vega = S * normPdf(d1) * Math.sqrt(T);
    const diff = bsPrice(S, K, T, r, sigma, isCall) - price;
    if (Math.abs(diff) < 1e-5) return sigma;
    if (vega < 1e-8) break; // too flat for Newton — fall through to bisection
    sigma -= diff / vega;
    if (sigma <= 0 || sigma > 5) break;
  }
  // Bisection fallback over a wide vol range. bsPrice is monotonic increasing in
  // sigma, so the root only exists when price sits between the model min (at lo)
  // and max (at hi). If it doesn't bracket, there is no real IV — return null
  // rather than converging to a meaningless midpoint.
  let lo = 1e-4;
  let hi = 5;
  if (bsPrice(S, K, T, r, lo, isCall) - price > 0 || bsPrice(S, K, T, r, hi, isCall) - price < 0) {
    return null;
  }
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const diff = bsPrice(S, K, T, r, mid, isCall) - price;
    if (Math.abs(diff) < 1e-5) return mid;
    if (diff > 0) hi = mid;
    else lo = mid;
  }
  return null;
}

/** Per-contract Greeks (delta, gamma, vega-per-1%-IV, theta-per-day). */
export function bsGreeks(S: number, K: number, T: number, sigma: number, isCall: boolean, r = RISK_FREE_RATE) {
  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const pdf = normPdf(d1);
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * Math.sqrt(T));
  const vega = (S * pdf * Math.sqrt(T)) / 100; // per 1 vol point
  const thetaYear = isCall
    ? -(S * pdf * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2)
    : -(S * pdf * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2);
  return { delta, gamma, vega, theta: thetaYear / 365 };
}

// ── Enrichment ────────────────────────────────────────────────────────────────

function yearsToExpiry(expiration?: string): number | null {
  if (!expiration || expiration.length !== 8) return null;
  const y = +expiration.slice(0, 4);
  const m = +expiration.slice(4, 6);
  const d = +expiration.slice(6, 8);
  // Expire at 16:00 ET on the expiry date; approximate with UTC midday.
  const exp = Date.UTC(y, m - 1, d, 20, 0, 0);
  const days = (exp - Date.now()) / 86_400_000;
  return days <= 0 ? null : days / 365;
}

function hasIbkrGreeks(g?: PositionGreeks): boolean {
  return !!g && [g.delta, g.gamma, g.vega, g.theta].some((v) => v != null && v !== 0);
}

export interface EnrichedDashboard {
  portfolio_greeks: { net_delta: number; net_gamma: number; net_vega: number; net_theta: number };
  greeks_estimated: boolean; // true if any option Greek was modeled locally (BS)
  greeks_unavailable: boolean; // options exist but NONE produced Greeks (no IBKR data, no underlying to model from)
  exposure: MarketExposure;
}

export interface MarketExposure {
  long_usd: number; // delta-adjusted $ long
  short_usd: number; // delta-adjusted $ short (negative)
  net_usd: number;
  gross_usd: number;
  net_pct_of_equity: number | null; // net exposure / |total market value|
  stock_usd: number;
  option_delta_usd: number;
}

/**
 * Recompute portfolio Greeks (filling estimated option Greeks where IBKR's are
 * missing) and derive delta-adjusted market exposure. Pure function over a
 * positions array; safe to call on whatever status_dashboard.py returned.
 */
export function enrich(positions: Position[]): EnrichedDashboard {
  let netDelta = 0;
  let netGamma = 0;
  let netVega = 0;
  let netTheta = 0;
  let estimated = false;
  let optionCount = 0;
  let optionsWithGreeks = 0;

  let longUsd = 0;
  let shortUsd = 0;
  let stockUsd = 0;
  let optionDeltaUsd = 0;

  for (const p of positions) {
    const qty = p.position || 0;

    if (p.sec_type === "STK") {
      netDelta += qty; // 1 delta per share
      const usd = qty * (p.und_price ?? p.market_price ?? 0);
      stockUsd += usd;
      if (usd >= 0) longUsd += usd;
      else shortUsd += usd;
      continue;
    }

    if (p.sec_type !== "OPT") continue;
    optionCount++;

    const mult = p.multiplier || 100;
    const S = p.und_price ?? 0;
    const K = p.strike ?? 0;
    const T = yearsToExpiry(p.expiration);
    const isCall = (p.right || "C").toUpperCase().startsWith("C");

    let g = p.greeks;
    if (!hasIbkrGreeks(g) && S > 0 && K > 0 && T) {
      // market_price is per-share option premium; solve IV then derive Greeks.
      const iv = impliedVol(p.market_price, S, K, T, isCall);
      if (iv != null) {
        const bg = bsGreeks(S, K, T, iv, isCall);
        g = { ...bg, iv };
        estimated = true;
      }
    }

    if (g && g.delta != null) {
      optionsWithGreeks++;
      netDelta += g.delta * qty * mult;
      netGamma += (g.gamma ?? 0) * qty * mult;
      netVega += (g.vega ?? 0) * qty * mult;
      netTheta += (g.theta ?? 0) * qty * mult;

      const deltaUsd = g.delta * qty * mult * S;
      optionDeltaUsd += deltaUsd;
      if (deltaUsd >= 0) longUsd += deltaUsd;
      else shortUsd += deltaUsd;
    }
  }

  const grossUsd = longUsd - shortUsd; // shortUsd is negative
  const netUsd = longUsd + shortUsd;
  const equity = positions.reduce((s, p) => s + Math.abs(p.market_value || 0), 0);

  return {
    portfolio_greeks: {
      net_delta: round(netDelta, 2),
      net_gamma: round(netGamma, 4),
      net_vega: round(netVega, 2),
      net_theta: round(netTheta, 2),
    },
    greeks_estimated: estimated,
    greeks_unavailable: optionCount > 0 && optionsWithGreeks === 0,
    exposure: {
      long_usd: round(longUsd, 0),
      short_usd: round(shortUsd, 0),
      net_usd: round(netUsd, 0),
      gross_usd: round(grossUsd, 0),
      net_pct_of_equity: equity > 0 ? round((netUsd / equity) * 100, 1) : null,
      stock_usd: round(stockUsd, 0),
      option_delta_usd: round(optionDeltaUsd, 0),
    },
  };
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
