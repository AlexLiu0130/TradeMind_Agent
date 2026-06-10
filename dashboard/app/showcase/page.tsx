const checks = [
  "IV environment",
  "Earnings window",
  "Portfolio Greeks",
  "Concentration",
  "Roll discipline",
  "Daily trade count",
  "FOMO / behavior flags",
];

const tools = [
  ["Research", "quote · technicals · earnings"],
  ["Risk", "positions · Greeks · concentration"],
  ["Strategy", "options chain · IV context"],
  ["Memory", "thesis · decisions · behavior"],
];

export default function ShowcasePage() {
  return (
    <div className="space-y-5 stagger">
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_.9fr] gap-5 items-start">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Agent System Showcase</div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">TradeMind is a trading cockpit with memory and guardrails.</h1>
          <p className="text-sm text-muted leading-relaxed mt-3 max-w-2xl">
            It connects live IBKR data, a SQLite memory layer, tool-calling analysis, and a hard human-confirmation boundary.
            The product is built for short-put / wheel traders who need disciplined decisions, not automatic orders.
          </p>
        </div>
        <div className="panel panel-accent p-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Safety Boundary</div>
          <div className="text-xl font-semibold text-gold mt-2">No autonomous trading path</div>
          <p className="text-xs text-muted leading-relaxed mt-2">
            The Agent can analyze, warn, and stage intent. Actual execution remains behind explicit user confirmation and the IBKR
            `trade.py` double gate.
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-semibold text-ink">Demo Flow</div>
          <div className="text-xs text-muted mt-0.5">The story this project should show in a portfolio review.</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-line/60">
          {[
            ["1", "Ask", "Analyze NVDA, I want a 30-delta short put."],
            ["2", "Plan", "Orchestrator chooses research, strategy, risk, and guardrail tools."],
            ["3", "Check", "Pre-trade checks produce passed, warning, or blocking conclusions."],
            ["4", "Decide", "Recommendation is framed as scenarios, not a deterministic order."],
            ["5", "Remember", "Thesis and decision outcome become future behavior context."],
          ].map(([n, title, body]) => (
            <div key={n} className="p-4 min-h-[150px]">
              <div className="num text-gold text-xs">{n}</div>
              <div className="text-sm font-semibold text-ink mt-2">{title}</div>
              <div className="text-xs text-muted leading-relaxed mt-2">{body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="text-sm font-semibold text-ink mb-3">Architecture</div>
          <div className="space-y-3">
            {tools.map(([name, desc]) => (
              <div key={name} className="grid grid-cols-[90px_1fr] gap-3 items-center">
                <div className="text-xs font-semibold text-gold">{name}</div>
                <div className="bg-raised border border-line rounded px-3 py-2 text-xs text-muted">{desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-xs text-muted leading-relaxed">
            IBKR remains the source of truth for live positions. SQLite stores what IBKR does not: thesis, rules, decisions, snapshots, and trade history.
          </div>
        </div>

        <div className="panel p-4">
          <div className="text-sm font-semibold text-ink mb-3">Guardrail Checklist</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {checks.map((c) => (
              <div key={c} className="flex items-center gap-2 bg-raised border border-line rounded px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gold" />
                <span className="text-xs text-ink">{c}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-xs text-muted leading-relaxed">
            Every trading intent must show its checks. A blocking result explains why the order is not safe to stage.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          ["Memory", "Thesis records and decisions turn one-off chat into longitudinal learning."],
          ["Observability", "Tool calls, checks, alerts, and rules make Agent behavior inspectable."],
          ["Privacy", "LLM calls may transmit portfolio data; README documents this boundary explicitly."],
        ].map(([title, body]) => (
          <div key={title} className="panel p-4">
            <div className="text-sm font-semibold text-gold">{title}</div>
            <div className="text-xs text-muted leading-relaxed mt-2">{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
