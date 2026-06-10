"use client";
import { useEffect, useState, useCallback } from "react";

interface Thesis {
  id: number;
  ticker: string;
  structure: string | null;
  direction: string | null;
  opened_at: string;
  thesis: string | null;
  bull_case: string | null;
  bear_case: string | null;
  exit_conditions: string | null;
  confidence: number | null;
  status: string;
}

const statusColor: Record<string, string> = {
  open: "bg-[#11241b] text-[#3fce8f]",
  closed: "bg-[#5b6472]/20 text-[#8b93a3]",
  invalidated: "bg-[#241316] text-[#ff5d6c]",
};

const empty = {
  ticker: "",
  structure: "",
  direction: "",
  thesis: "",
  bull_case: "",
  bear_case: "",
  exit_conditions: "",
  confidence: "3",
};

export default function ThesisPage() {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/thesis")
      .then((r) => r.json())
      .then((d) => setTheses(d.theses || []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.ticker.trim()) { setErr("Ticker 必填"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/thesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { setErr((await res.json()).error || "保存失败"); return; }
      setForm({ ...empty });
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    await fetch("/api/thesis", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    load();
  };

  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#e0a82e]">Thesis Journal</h1>
        <button
          onClick={() => { setShowForm((v) => !v); setErr(null); }}
          className="text-sm font-medium bg-[#e0a82e] text-white px-3 py-1.5 rounded hover:bg-[#c9952a]"
        >
          {showForm ? "× 取消" : "+ New Thesis"}
        </button>
      </div>

      {showForm && (
        <div className="bg-[#111419] border border-[#232a33] rounded-lg p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Ticker *">
              <input value={form.ticker} onChange={(e) => upd("ticker", e.target.value.toUpperCase())}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm tabular-nums" />
            </Field>
            <Field label="Structure">
              <select value={form.structure} onChange={(e) => upd("structure", e.target.value)}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                <option>short put</option>
                <option>covered call</option>
                <option>cash-secured put</option>
                <option>stock</option>
              </select>
            </Field>
            <Field label="Direction">
              <select value={form.direction} onChange={(e) => upd("direction", e.target.value)}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                <option value="sell">sell</option>
                <option value="buy">buy</option>
              </select>
            </Field>
            <Field label="Confidence (1-5)">
              <select value={form.confidence} onChange={(e) => upd("confidence", e.target.value)}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Thesis（核心假设）">
            <textarea value={form.thesis} onChange={(e) => upd("thesis", e.target.value)} rows={2}
              className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm resize-none" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bull Case">
              <textarea value={form.bull_case} onChange={(e) => upd("bull_case", e.target.value)} rows={2}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm resize-none" />
            </Field>
            <Field label="Bear Case">
              <textarea value={form.bear_case} onChange={(e) => upd("bear_case", e.target.value)} rows={2}
                className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm resize-none" />
            </Field>
          </div>
          <Field label="Exit Conditions（平仓条件）">
            <input value={form.exit_conditions} onChange={(e) => upd("exit_conditions", e.target.value)}
              className="w-full border border-[#232a33] rounded px-2 py-1.5 text-sm" />
          </Field>
          {err && <div className="text-[#ff5d6c] text-xs">{err}</div>}
          <div className="flex justify-end">
            <button onClick={create} disabled={saving}
              className="text-sm font-medium bg-[#3fce8f] text-white px-4 py-1.5 rounded hover:bg-[#34b87d] disabled:opacity-50">
              {saving ? "保存中..." : "保存 Thesis"}
            </button>
          </div>
        </div>
      )}

      {theses.length === 0 && !showForm && (
        <div className="bg-[#111419] border border-[#232a33] rounded p-8 text-center text-[#8b93a3] text-sm">
          暂无 thesis 记录。点击右上「+ New Thesis」添加，或让 Agent 在分析后写入。
        </div>
      )}

      <div className="grid gap-3">
        {theses.map((t) => (
          <div key={t.id} className="bg-[#111419] border border-[#232a33] rounded p-4 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-[#e6e9ef]">{t.ticker}</span>
              {t.structure && (
                <span className="text-xs bg-[#16202b] text-[#e0a82e] px-2 py-0.5 rounded">{t.structure}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded ${statusColor[t.status] || statusColor.open}`}>
                {t.status}
              </span>
              {t.confidence && (
                <span className="text-xs text-[#8b93a3]">信心 {t.confidence}/5</span>
              )}
              <span className="text-xs text-[#8b93a3] ml-auto">{t.opened_at?.slice(0, 10)}</span>
            </div>
            {t.thesis && <p className="text-sm text-[#e6e9ef]">{t.thesis}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {t.bull_case && (
                <div className="bg-[#11241b]/50 border border-[#3fce8f]/20 rounded p-2">
                  <span className="text-[#3fce8f] font-medium">↑ Bull</span>
                  <p className="text-[#8b93a3] mt-1">{t.bull_case}</p>
                </div>
              )}
              {t.bear_case && (
                <div className="bg-[#241316]/50 border border-[#ff5d6c]/20 rounded p-2">
                  <span className="text-[#ff5d6c] font-medium">↓ Bear</span>
                  <p className="text-[#8b93a3] mt-1">{t.bear_case}</p>
                </div>
              )}
            </div>
            {t.exit_conditions && (
              <div className="text-xs text-[#8b93a3] border-t border-[#232a33] pt-2">
                <span className="text-[#e6e9ef]">Exit: </span>{t.exit_conditions}
              </div>
            )}
            {t.status === "open" && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => setStatus(t.id, "closed")}
                  className="text-xs border border-[#232a33] text-[#8b93a3] px-2.5 py-1 rounded hover:bg-[#1b2027]">
                  ✓ 平仓 (Close)
                </button>
                <button onClick={() => setStatus(t.id, "invalidated")}
                  className="text-xs border border-[#5c2a2a] text-[#ff5d6c] px-2.5 py-1 rounded hover:bg-[#241316]">
                  ✗ 推翻 (Invalidate)
                </button>
              </div>
            )}
            {t.status !== "open" && (
              <div className="pt-1">
                <button onClick={() => setStatus(t.id, "open")}
                  className="text-xs border border-[#232a33] text-[#8b93a3] px-2.5 py-1 rounded hover:bg-[#1b2027]">
                  ↻ 重新打开 (Reopen)
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-[#8b93a3] font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}
