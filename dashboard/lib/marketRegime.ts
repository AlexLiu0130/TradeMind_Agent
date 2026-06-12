// Market regime scoring — pure functions, no network. Consumed by /api/market/regime.
// Six dimensions (§3.2 right panel): risk appetite, trend, volatility, tech strength,
// rate pressure, breadth — each classified bull/neutral/bear with an explicit state
// label. Missing inputs degrade to "Unknown" and lower the composite confidence;
// we never fake a neutral reading from absent data.

export type Tone = "bull" | "neutral" | "bear";

export interface RegimeDimension {
  key: string;
  label: string;
  state: string; // human-readable, e.g. "Risk-on", "Elevated", "Unknown"
  tone: Tone;
  detail: string; // the number(s) behind the call, e.g. "VIX 13.0"
  hasData: boolean;
}

export interface RegimeInput {
  vix: number | null;
  us10y: number | null; // 10Y yield in %
  us10yChgPct: number | null; // day change of the yield, in %
  spy1m: number | null; // 1-month % return
  qqq1m: number | null;
  smh1m: number | null;
  rsp1m: number | null; // equal-weight S&P — breadth proxy
}

export interface MarketRegime {
  dimensions: RegimeDimension[];
  composite: Tone; // majority tone across dimensions with data
  compositeLabel: string;
  confidencePct: number; // share of dimensions with data, 0–100
}

/** % return from first to last close. Null when the window can't be computed. */
export function windowReturn(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (!first || first <= 0) return null;
  return Math.round(((last / first) - 1) * 100 * 1e6) / 1e6;
}

const fmt = (n: number, d = 1) => n.toFixed(d);

function unknown(key: string, label: string): RegimeDimension {
  return { key, label, state: "Unknown", tone: "neutral", detail: "数据不可用", hasData: false };
}

export function computeRegime(input: RegimeInput): MarketRegime {
  const dims: RegimeDimension[] = [];

  // 1. Risk appetite — VIX level.
  if (input.vix == null) dims.push(unknown("risk_appetite", "风险偏好"));
  else {
    const v = input.vix;
    const [state, tone]: [string, Tone] =
      v < 17 ? ["Risk-on", "bull"] : v <= 24 ? ["Neutral", "neutral"] : ["Risk-off", "bear"];
    dims.push({ key: "risk_appetite", label: "风险偏好", state, tone, detail: `VIX ${fmt(v)}`, hasData: true });
  }

  // 2. Trend strength — SPY 1M return.
  if (input.spy1m == null) dims.push(unknown("trend", "趋势强度"));
  else {
    const r = input.spy1m;
    const [state, tone]: [string, Tone] =
      r > 2 ? ["Uptrend", "bull"] : r >= -2 ? ["Sideways", "neutral"] : ["Downtrend", "bear"];
    dims.push({ key: "trend", label: "趋势强度", state, tone, detail: `SPY 1M ${r >= 0 ? "+" : ""}${fmt(r)}%`, hasData: true });
  }

  // 3. Volatility environment — VIX banding (calm favors premium sellers).
  if (input.vix == null) dims.push(unknown("volatility", "波动率环境"));
  else {
    const v = input.vix;
    const [state, tone]: [string, Tone] =
      v < 15 ? ["Calm", "bull"] : v <= 22 ? ["Normal", "neutral"] : ["Elevated", "bear"];
    dims.push({ key: "volatility", label: "波动率环境", state, tone, detail: `VIX ${fmt(v)}`, hasData: true });
  }

  // 4. Tech relative strength — QQQ minus SPY over 1M.
  if (input.qqq1m == null || input.spy1m == null) dims.push(unknown("tech_strength", "科技相对强弱"));
  else {
    const spread = input.qqq1m - input.spy1m;
    const [state, tone]: [string, Tone] =
      spread > 1 ? ["Tech leading", "bull"] : spread >= -1 ? ["In line", "neutral"] : ["Tech lagging", "bear"];
    dims.push({
      key: "tech_strength", label: "科技相对强弱", state, tone,
      detail: `QQQ−SPY ${spread >= 0 ? "+" : ""}${fmt(spread)}pp`, hasData: true,
    });
  }

  // 5. Rate pressure — yield level direction (rising yields pressure risk assets).
  if (input.us10yChgPct == null) dims.push(unknown("rate_pressure", "利率压力"));
  else {
    const chg = input.us10yChgPct;
    const lvl = input.us10y != null ? ` @ ${fmt(input.us10y, 2)}%` : "";
    const [state, tone]: [string, Tone] =
      chg < -0.5 ? ["Easing", "bull"] : chg <= 0.5 ? ["Stable", "neutral"] : ["Rising", "bear"];
    dims.push({
      key: "rate_pressure", label: "利率压力", state, tone,
      detail: `10Y ${chg >= 0 ? "+" : ""}${fmt(chg)}%${lvl}`, hasData: true,
    });
  }

  // 6. Breadth — equal-weight vs cap-weight S&P over 1M. A modest gap is normal;
  //    a deeply negative spread = narrow leadership (fragile tape).
  if (input.rsp1m == null || input.spy1m == null) dims.push(unknown("breadth", "市场广度"));
  else {
    const spread = input.rsp1m - input.spy1m;
    const [state, tone]: [string, Tone] =
      spread > -2 ? ["Broad", "bull"] : spread > -4 ? ["Narrowing", "neutral"] : ["Narrow", "bear"];
    dims.push({
      key: "breadth", label: "市场广度", state, tone,
      detail: `RSP−SPY ${spread >= 0 ? "+" : ""}${fmt(spread)}pp`, hasData: true,
    });
  }

  const withData = dims.filter((d) => d.hasData);
  const bulls = withData.filter((d) => d.tone === "bull").length;
  const bears = withData.filter((d) => d.tone === "bear").length;
  const composite: Tone = bulls > bears ? "bull" : bears > bulls ? "bear" : "neutral";
  const compositeLabel = composite === "bull" ? "Risk-on" : composite === "bear" ? "Risk-off" : "Neutral";

  return {
    dimensions: dims,
    composite,
    compositeLabel,
    confidencePct: Math.round((withData.length / dims.length) * 100),
  };
}
