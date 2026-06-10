"use client";
import { useEffect, useState } from "react";

interface AlertItem {
  key: string;
  label: string;
  value: string;
  unit: string;
  severity: "risk" | "watch" | "info";
  action: string;
  last_fired_at: string | null;
  state: "active" | "recent" | "quiet";
}

const stateTone: Record<AlertItem["state"], string> = {
  active: "text-down border-down/35 bg-down/[0.04]",
  recent: "text-gold border-gold/35 bg-gold/[0.04]",
  quiet: "text-muted border-line bg-panel",
};

const severityTone: Record<AlertItem["severity"], string> = {
  risk: "text-down",
  watch: "text-gold",
  info: "text-muted",
};

function when(ts: string | null) {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts || []))
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    active: alerts.filter((a) => a.state === "active").length,
    recent: alerts.filter((a) => a.state === "recent").length,
    quiet: alerts.filter((a) => a.state === "quiet").length,
  };
  const ordered = [...alerts].sort((a, b) => {
    const rank = { active: 0, recent: 1, quiet: 2 };
    return rank[a.state] - rank[b.state] || a.label.localeCompare(b.label);
  });

  return (
    <div className="space-y-5 stagger">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gold">Alert Console</h1>
          <div className="text-xs text-muted mt-1">
            Guardrail and monitor state from SQLite. Telegram tells you something fired; this page tells you what remains live.
          </div>
        </div>
        <div className="text-right text-[10px] text-faint">
          <div className="num text-sm text-ink">{alerts.length} rules</div>
          audit view
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active", value: counts.active, cls: "text-down" },
          { label: "Recent", value: counts.recent, cls: "text-gold" },
          { label: "Quiet", value: counts.quiet, cls: "text-muted" },
        ].map((s) => (
          <div key={s.label} className="panel p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{s.label}</div>
            <div className={`num text-2xl font-semibold mt-1 ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading && <div className="text-sm text-muted">Loading alerts...</div>}

      {!loading && ordered.length === 0 && (
        <div className="panel p-8 text-center text-sm text-muted">No alert state is available yet.</div>
      )}

      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[1.1fr_.7fr_.7fr_1.4fr] gap-3 px-4 py-2.5 border-b border-line bg-raised text-[10px] uppercase tracking-[0.1em] text-muted">
          <div>Rule</div>
          <div>Status</div>
          <div>Last Fired</div>
          <div>Operator Action</div>
        </div>
        <div className="divide-y divide-line/60">
          {ordered.map((a) => (
            <div key={a.key} className="grid grid-cols-1 md:grid-cols-[1.1fr_.7fr_.7fr_1.4fr] gap-3 px-4 py-3 hover:bg-hover/60">
              <div>
                <div className={`text-sm font-semibold ${severityTone[a.severity]}`}>{a.label}</div>
                <div className="text-[10px] text-faint mt-0.5">
                  <code>{a.key}</code>
                  {a.value !== "" && (
                    <span className="num ml-2 text-muted">
                      {a.value} {a.unit}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className={`inline-flex border rounded px-2 py-1 text-[10px] font-semibold uppercase ${stateTone[a.state]}`}>
                  {a.state}
                </span>
              </div>
              <div className="num text-xs text-muted">{when(a.last_fired_at)}</div>
              <div className="text-xs text-muted leading-relaxed">{a.action}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
