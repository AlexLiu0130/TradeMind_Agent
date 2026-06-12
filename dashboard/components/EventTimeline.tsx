"use client";
import { useEffect, useState } from "react";
import type { DashboardEvent, EventType, EventSeverity } from "@/lib/events.ts";

interface EventsResponse {
  events: DashboardEvent[];
  as_of: number;
  missing: string[];
  stale: string[];
}

const TYPE_META: Record<EventType, { label: string; color: string }> = {
  earnings: { label: "财报", color: "var(--color-gold)" },
  expiry: { label: "到期", color: "#a78bfa" },
  intel: { label: "情报", color: "#6ea8d8" },
  risk: { label: "风险", color: "var(--color-down)" },
  reminder: { label: "提醒", color: "var(--color-up)" },
};

const SEV_DOT: Record<EventSeverity, string> = {
  alert: "var(--color-down)",
  watch: "var(--color-gold)",
  info: "var(--color-faint)",
};

function fmtTs(ts: string, nowMs: number): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts.slice(0, 10);
  const days = Math.round((t - nowMs) / 86_400_000);
  const date = ts.slice(5, 10).replace("-", "/");
  if (days > 0) return `${date} · ${days}天后`;
  if (days === 0) return `${date} · 今天`;
  return `${date} · ${-days}天前`;
}

export default function EventTimeline() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<EventType | "all">("all");

  useEffect(() => {
    let alive = true;
    fetch("/api/events")
      .then((r) => r.json())
      .then((d: EventsResponse) => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const now = data?.as_of ?? 0; // server-assembled timestamp keeps render pure
  const events = (data?.events ?? []).filter((e) => filter === "all" || e.type === filter);
  const upcoming = events.filter((e) => Date.parse(e.ts) >= now);
  const past = events.filter((e) => Date.parse(e.ts) < now).slice(0, 12);

  const renderEvent = (e: DashboardEvent) => (
    <div key={e.id} className="flex gap-2.5 items-start">
      <span
        className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: SEV_DOT[e.severity] }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[9px] font-semibold uppercase tracking-wider shrink-0"
            style={{ color: TYPE_META[e.type].color }}
          >
            {TYPE_META[e.type].label}
          </span>
          <span className="text-[11px] text-ink truncate">{e.title}</span>
        </div>
        <div className="text-[10px] text-faint num">
          {fmtTs(e.ts, now)}
          {e.tickers.length > 0 && <span className="ml-2 text-muted">{e.tickers.slice(0, 3).join(" ")}</span>}
          {e.detail && <span className="ml-2 truncate">{e.detail.slice(0, 60)}</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="panel p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-ink text-xs font-semibold">Event Timeline</span>
        <div className="flex gap-1">
          {(["all", "earnings", "expiry", "intel", "risk"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                filter === f ? "border-gold/50 text-gold" : "border-line text-faint hover:text-muted"
              }`}
            >
              {f === "all" ? "全部" : TYPE_META[f].label}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="text-muted text-xs py-10 text-center">加载中…</div>
      ) : !data || data.events.length === 0 ? (
        <div className="text-muted text-xs py-10 text-center">暂无事件</div>
      ) : (
        <div className="flex-1 overflow-auto space-y-4">
          {upcoming.length > 0 && (
            <div>
              <div className="text-[10px] text-faint uppercase tracking-[0.12em] mb-2">即将到来</div>
              <div className="space-y-2">{[...upcoming].reverse().map(renderEvent)}</div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <div className="text-[10px] text-faint uppercase tracking-[0.12em] mb-2">最近</div>
              <div className="space-y-2">{past.map(renderEvent)}</div>
            </div>
          )}
        </div>
      )}

      {data && (data.missing.length > 0 || data.stale.length > 0) && (
        <div className="mt-2 pt-2 border-t border-line text-[10px] space-x-2">
          {data.missing.length > 0 && (
            <span className="text-down">{data.missing.join("/")} 数据源不可用</span>
          )}
          {data.stale.length > 0 && (
            <span className="text-gold">{data.stale.join("/")} 为过期缓存</span>
          )}
        </div>
      )}
    </div>
  );
}
