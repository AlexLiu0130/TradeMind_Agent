"use client";
import { useEffect, useState, useCallback } from "react";

interface Rule {
  key: string;
  value: string;
  label: string;
  unit: string;
}

const CACHE_KEY = "ibkr_cache_ttl";

export default function SettingsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/rules")
      .then((r) => r.json())
      .then((d) => {
        setRules(d.rules || []);
        setDraft(Object.fromEntries((d.rules || []).map((r: Rule) => [r.key, r.value])));
      });
  }, []);
  useEffect(() => { load(); }, [load]);

  const persist = async (key: string, value: string) => {
    const res = await fetch("/api/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) {
      setSaved(key);
      setTimeout(() => setSaved(null), 1500);
      load();
    }
  };

  const guardrailRules = rules.filter((r) => r.key !== CACHE_KEY);
  const cacheRule = rules.find((r) => r.key === CACHE_KEY);
  const cacheVal = draft[CACHE_KEY] ?? cacheRule?.value ?? "60";
  const realtime = cacheVal === "0" || cacheVal === "";

  const toggleRealtime = (on: boolean) => {
    // ON → 0 (no cache); OFF → restore a sensible default.
    const next = on ? "0" : "60";
    setDraft((d) => ({ ...d, [CACHE_KEY]: next }));
    persist(CACHE_KEY, next);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-lg font-semibold text-gold">Settings</h1>

      {/* Data freshness / cache */}
      <div className="panel">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-semibold text-ink">Data Freshness（数据刷新）</div>
          <div className="text-xs text-muted mt-0.5">
            控制 IBKR 行情/持仓的缓存。缓存能让面板与 Agent 秒回，但数据最多滞后所设秒数。
          </div>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-b border-line/60">
          <div className="flex-1">
            <div className="text-sm text-ink">实时数据（Real-time）</div>
            <div className="text-[11px] text-muted mt-0.5">
              开启后每次都直接拉 IBKR（最新但较慢）；关闭则使用下方缓存时长。
            </div>
          </div>
          <button
            role="switch"
            aria-checked={realtime}
            onClick={() => toggleRealtime(!realtime)}
            className={`relative w-11 h-6 rounded-full transition-colors ${realtime ? "bg-up" : "bg-[#1b2027] border border-line"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#e6e9ef] transition-transform ${realtime ? "translate-x-5" : ""}`} />
          </button>
        </div>

        <div className={`flex items-center gap-3 px-4 py-3 ${realtime ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex-1">
            <div className="text-sm text-ink">缓存时长</div>
            <code className="text-[10px] text-faint">{CACHE_KEY}</code>
          </div>
          <input
            type="number"
            min={0}
            disabled={realtime}
            value={cacheVal === "0" ? "" : cacheVal}
            placeholder="60"
            onChange={(e) => setDraft((d) => ({ ...d, [CACHE_KEY]: e.target.value }))}
            className="num w-24 border border-line rounded px-2 py-1.5 text-sm text-right"
          />
          <span className="text-xs text-muted w-6">秒</span>
          <button
            onClick={() => persist(CACHE_KEY, cacheVal || "60")}
            disabled={cacheVal === cacheRule?.value}
            className={`text-xs px-3 py-1.5 rounded font-medium ${
              cacheVal !== cacheRule?.value ? "bg-up text-base hover:bg-[#34b87d]" : "bg-[#1b2027] text-faint cursor-default"
            }`}
          >
            {saved === CACHE_KEY ? "✓ 已保存" : "保存"}
          </button>
        </div>
      </div>

      {/* Guardrail rules */}
      <div className="panel">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-semibold text-ink">Guardrail Rules</div>
          <div className="text-xs text-muted mt-0.5">
            预交易风控参数。Agent 在每次交易意图分析时强制执行这些限制。
          </div>
        </div>
        <div className="divide-y divide-line/60">
          {guardrailRules.map((r) => {
            const dirty = draft[r.key] !== r.value;
            return (
              <div key={r.key} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="text-sm text-ink">{r.label}</div>
                  <code className="text-[10px] text-faint">{r.key}</code>
                </div>
                <input
                  type="number"
                  min={0}
                  value={draft[r.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                  className="num w-24 border border-line rounded px-2 py-1.5 text-sm text-right"
                />
                <span className="text-xs text-muted w-6">{r.unit}</span>
                <button
                  onClick={() => persist(r.key, draft[r.key])}
                  disabled={!dirty}
                  className={`text-xs px-3 py-1.5 rounded font-medium ${
                    dirty ? "bg-up text-base hover:bg-[#34b87d]" : "bg-[#1b2027] text-faint cursor-default"
                  }`}
                >
                  {saved === r.key ? "✓ 已保存" : "保存"}
                </button>
              </div>
            );
          })}
          {guardrailRules.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">规则加载中或不可用</div>
          )}
        </div>
      </div>

      {/* LLM provider */}
      <div className="panel p-4">
        <div className="text-sm font-semibold text-ink mb-1">LLM Provider</div>
        <div className="text-xs text-muted">
          模型与 API key 配置在项目根目录的 <code className="text-gold">.env</code> 文件中
          （<code>OPENAI_MODEL</code> / <code>OPENAI_API_KEY</code> / <code>OPENAI_BASE_URL</code>）。
          该文件已被 git 忽略且权限受限，修改后重启 dashboard 生效。
        </div>
      </div>
    </div>
  );
}
