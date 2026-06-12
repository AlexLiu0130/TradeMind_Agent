"use client";
import { useEffect, useState } from "react";
import { freshness, type Freshness, type MarketKind, type MarketTicker, type Session } from "@/lib/market";

interface Overview {
  tickers: MarketTicker[];
  session: Session;
  as_of: number | null;
  stale?: boolean;
}

// Display values that depend on "now" are computed at fetch time (in the effect),
// not during render, to keep render pure.
interface View {
  data: Overview;
  fresh: Freshness;
  updated: string;
}

const SESSION: Record<Session, { text: string; color: string }> = {
  pre: { text: "Pre-Market", color: "var(--color-gold)" },
  rth: { text: "Market Open", color: "var(--color-up)" },
  post: { text: "After-Hours", color: "var(--color-gold)" },
  closed: { text: "Closed", color: "var(--color-faint)" },
};

const FRESH_COLOR: Record<string, string> = {
  live: "var(--color-up)",
  delayed: "var(--color-gold)",
  stale: "var(--color-down)",
  none: "var(--color-faint)",
};

// kind-aware value formatting; never invents a value (null → "—").
function fmtPrice(t: MarketTicker): string {
  if (t.price == null) return "—";
  if (t.kind === "rate") return `${t.price.toFixed(2)}%`;
  return t.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const labelColor: Record<MarketKind, string> = {
  index: "var(--color-muted)",
  vol: "var(--color-muted)",
  rate: "var(--color-muted)",
  dollar: "var(--color-muted)",
};

export default function MarketStatusBar() {
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/market")
        .then((r) => r.json())
        .then((d: Overview) => {
          if (!alive) return;
          const updated = d.as_of
            ? new Date(d.as_of).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })
            : "—";
          setView({ data: d, fresh: freshness(d.as_of, Date.now()), updated });
          setFailed(false);
        })
        .catch(() => { if (alive) setFailed(true); });
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const data = view?.data ?? null;
  const sess = data ? SESSION[data.session] : null;
  const fresh = view?.fresh ?? "none";
  const updated = view?.updated ?? "—";

  return (
    <div className="border-b border-line bg-base/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center gap-x-5 gap-y-1 px-4 py-1.5 overflow-x-auto text-[12px]">
        {/* Session */}
        {sess && (
          <span className="shrink-0 flex items-center gap-1.5 font-medium" style={{ color: sess.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sess.color }} />
            {sess.text}
          </span>
        )}

        {/* Tickers */}
        {(data?.tickers ?? []).map((t) => {
          const up = (t.changePct ?? 0) >= 0;
          const chColor = t.changePct == null ? "var(--color-faint)" : up ? "var(--color-up)" : "var(--color-down)";
          return (
            <span key={t.key} className="shrink-0 flex items-baseline gap-1.5">
              <span style={{ color: labelColor[t.kind] }}>{t.label}</span>
              <span className="num text-ink">{fmtPrice(t)}</span>
              <span className="num text-[11px]" style={{ color: chColor }}>
                {t.changePct == null ? "—" : `${up ? "+" : ""}${t.changePct.toFixed(2)}%`}
              </span>
            </span>
          );
        })}

        {!data && !failed && <span className="text-faint">Loading market…</span>}
        {failed && <span className="text-down">Market data unavailable</span>}

        {/* Freshness + updated time (right aligned) */}
        {data && (
          <span className="shrink-0 ml-auto flex items-center gap-1.5 text-faint">
            {data.stale && <span className="text-down">stale</span>}
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: FRESH_COLOR[fresh] }} />
            <span className="num">{updated} ET</span>
          </span>
        )}
      </div>
    </div>
  );
}
