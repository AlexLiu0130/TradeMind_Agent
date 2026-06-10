"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { TICKER_META, type TickerMeta } from "@/lib/intel";

interface TickerSnapshot {
  baseline: number | null;
  baseline_date?: string | null;
  baseline_rule?: string | null;
  current: number | null;
  current_date?: string | null;
  since_pct: number | null;
  source: string;
}

interface IntelItem {
  id: number;
  captured_at: string;
  source: string;
  source_handle: string | null;
  external_id: string | null;
  capture_method: string;
  item_ts: string | null;
  url: string | null;
  media_url: string | null;
  media_name: string | null;
  ocr_text: string | null;
  raw_text: string;
  summary: string | null;
  related_tickers: string[];
  portfolio_overlap: string[];
  ticker_snapshot: Record<string, TickerSnapshot>;
  impact_direction: "bullish" | "bearish" | "uncertain";
  urgency: "low" | "watch" | "alert";
  rationale: string | null;
}

interface CollectionWindow {
  id: number;
  window_start: string;
  window_end: string;
  status: "pending" | "running" | "done" | "failed";
  found_count: number;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  updated_at: string;
  notes: string | null;
}

interface CollectionStatus {
  total: number;
  duplicate_external_ids: number;
  garbage_rows: number;
  earliest: string | null;
  latest: string | null;
  windows: CollectionWindow[];
}

interface LensFrameworkRow {
  dimension: string;
  score: number;
  note: string;
}

interface LensEvidence {
  external_id: string | null;
  item_ts: string | null;
  url: string | null;
  themes: string[];
  tickers: string[];
  summary: string;
}

interface SerenityLensResult {
  query: string;
  ticker: string | null;
  source: string;
  confidence: "low" | "medium" | "high";
  sample_size: number;
  verdict: { label: string; summary: string };
  framework: LensFrameworkRow[];
  evidence: LensEvidence[];
  counter_signals: string[];
  action_fit: string[];
  disclaimer: string;
  error?: string;
}

const urgencyLabel: Record<IntelItem["urgency"], string> = {
  low: "归档",
  watch: "观察",
  alert: "重点",
};

const directionLabel: Record<IntelItem["impact_direction"], string> = {
  bullish: "偏多",
  bearish: "偏空",
  uncertain: "待判断",
};

const directionTone: Record<IntelItem["impact_direction"], string> = {
  bullish: "text-up",
  bearish: "text-down",
  uncertain: "text-muted",
};

const confidenceLabel: Record<SerenityLensResult["confidence"], string> = {
  low: "低置信",
  medium: "中置信",
  high: "高置信",
};

const confidenceTone: Record<SerenityLensResult["confidence"], string> = {
  low: "text-muted border-line",
  medium: "text-gold border-gold/35",
  high: "text-up border-up/35",
};

function zhTime(ts: string | null) {
  if (!ts) return "时间未知";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(n: number | null | undefined) {
  if (n == null) return "待更新";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function money(n: number | null | undefined) {
  if (n == null) return "待更新";
  return `$${n.toFixed(2)}`;
}

function metaFor(ticker: string): TickerMeta {
  return TICKER_META[ticker] || { ticker, nameZh: ticker, sectorZh: "未分类", subsectorZh: "待补充" };
}

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    manual: "手动",
    screenshot: "截图",
    "browser-import": "浏览器导入",
    file: "文件",
    clipboard: "剪贴板",
  };
  return labels[method] || method;
}

const SIGNAL_PATTERNS: Array<{ re: RegExp; label: string; implication: string }> = [
  {
    re: /\b(silicon photonics|siph|cpo|lpo|optics|optical|laser|pluggable|1\.6t|nvlink|lightmatter|celestial)\b/i,
    label: "光通信 / CPO",
    implication: "看点在 AI 集群互连升级、客户验证节奏和光器件供应链弹性。",
  },
  {
    re: /\b(hbm|dram|memory|nand|sk hynix|samsung|bandwidth)\b/i,
    label: "存储周期",
    implication: "看点在 HBM/DRAM 供需、价格周期和 AI 服务器带宽瓶颈。",
  },
  {
    re: /\b(foundry|fab|wafer|substrate|inp|gaas|soi|epitaxy|semicap|lithography)\b/i,
    label: "制造 / 材料",
    implication: "看点在晶圆代工、材料约束和先进封装/测试资本开支。",
  },
  {
    re: /\b(gpu|accelerator|asic|custom silicon|tpu|xpu|cuda|blackwell|rubin)\b/i,
    label: "AI 芯片路线",
    implication: "看点在云厂商自研芯片、GPU 供给和系统级 BOM 变化。",
  },
  {
    re: /\b(power|grid|utility|transformer|switchgear|energy|datacenter|data center|hpc)\b/i,
    label: "AI 电力 / 数据中心",
    implication: "看点在算力扩张带来的供电、散热和数据中心基础设施瓶颈。",
  },
  {
    re: /\b(export control|tariff|china|taiwan|national security|rare earth|made in america)\b/i,
    label: "政策 / 国家安全",
    implication: "看点在供应链本土化、出口管制和战略资源重估。",
  },
  {
    re: /\b(retail|cramer|short seller|consensus|bank of america|bubble|media)\b/i,
    label: "叙事错位",
    implication: "看点在市场共识、卖方叙事和散户资金流之间的错位。",
  },
];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function themeSignals(item: IntelItem) {
  const text = `${item.raw_text}\n${item.summary || ""}\n${item.rationale || ""}`;
  return SIGNAL_PATTERNS.filter((signal) => signal.re.test(text));
}

function performanceLabel(snap: TickerSnapshot | undefined) {
  if (!snap) return "待更新";
  if (snap.since_pct != null) return pct(snap.since_pct);
  if (snap.current != null && snap.baseline == null) return "待补历史价";
  return "待更新";
}

function performanceTone(snap: TickerSnapshot | undefined) {
  if (!snap || snap.since_pct == null) return "text-muted";
  return snap.since_pct >= 0 ? "text-up" : "text-down";
}

function postInterpretation(item: IntelItem) {
  const tickers = item.related_tickers;
  const metas = tickers.map(metaFor);
  const subsectors = unique(metas.map((m) => m.subsectorZh).filter((v) => v !== "待补充")).slice(0, 4);
  const signals = themeSignals(item);
  const themes = unique(signals.map((s) => s.label)).slice(0, 3);
  const implications = unique(signals.map((s) => s.implication)).slice(0, 2);
  const overlap = item.portfolio_overlap.length > 0 ? `和当前组合重叠：${item.portfolio_overlap.join("、")}。` : "当前组合没有直接重叠。";

  if (tickers.length === 0) {
    return "这条记录暂时没有匹配到可交易 ticker，先作为背景线索归档；后续如果同一主题反复出现，再进入标的映射。";
  }

  const sectorLine = subsectors.length > 0 ? `细分方向集中在 ${subsectors.join("、")}` : "细分行业仍需补充映射";
  const themeLine = themes.length > 0 ? `主题上更像是 ${themes.join("、")}` : "主题暂不集中，先按明确 ticker 跟踪";
  const implicationLine = implications.length > 0 ? implications.join(" ") : "下一步重点看后续帖子是否持续强化同一产业链逻辑。";
  return `${sectorLine}，相关标的为 ${tickers.join("、")}。${themeLine}；${implicationLine} ${overlap}`;
}

function sortTime(item: IntelItem) {
  return new Date(item.item_ts || item.captured_at).getTime() || 0;
}

export default function IntelPage() {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [rawText, setRawText] = useState("");
  const [url, setUrl] = useState("");
  const [itemTs, setItemTs] = useState("");
  const [media, setMedia] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [lensQuery, setLensQuery] = useState("MRVL");
  const [lensResult, setLensResult] = useState<SerenityLensResult | null>(null);
  const [lensLoading, setLensLoading] = useState(false);
  const mediaRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetch("/api/intel")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []));
    fetch("/api/intel/collection")
      .then((r) => r.json())
      .then((d) => setCollection(d));
  };

  useEffect(() => { load(); }, []);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => sortTime(b) - sortTime(a) || b.id - a.id),
    [items],
  );

  const tickerRail = useMemo(() => {
    const map = new Map<string, { ticker: string; meta: TickerMeta; overlap: boolean; refs: number; latest: TickerSnapshot | null; lastTs: number }>();
    for (const item of sortedItems) {
      for (const ticker of item.related_tickers) {
        const current = map.get(ticker) || { ticker, meta: metaFor(ticker), overlap: false, refs: 0, latest: null, lastTs: 0 };
        current.refs += 1;
        current.overlap = current.overlap || item.portfolio_overlap.includes(ticker);
        if (sortTime(item) >= current.lastTs) {
          current.latest = item.ticker_snapshot?.[ticker] || current.latest;
          current.lastTs = sortTime(item);
        }
        map.set(ticker, current);
      }
    }
    return [...map.values()].sort((a, b) => Number(b.overlap) - Number(a.overlap) || b.refs - a.refs || a.ticker.localeCompare(b.ticker));
  }, [sortedItems]);

  const submitManual = async () => {
    if ((!rawText.trim() && !media) || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("source", "Serenity");
      fd.set("source_handle", "aleabitoreddit");
      fd.set("capture_method", media ? "screenshot" : "manual");
      fd.set("url", url);
      fd.set("item_ts", itemTs ? new Date(itemTs).toISOString() : "");
      fd.set("raw_text", rawText);
      if (media) fd.set("media", media);
      const res = await fetch("/api/intel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败。");
        return;
      }
      setRawText("");
      setUrl("");
      setItemTs("");
      setMedia(null);
      if (mediaRef.current) mediaRef.current.value = "";
      setNotice("已保存 1 条记录。");
      load();
    } finally {
      setSaving(false);
    }
  };

  const submitImport = async () => {
    if ((!importText.trim() && !importFile) || importing) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("payload", importText);
      if (importFile) fd.set("file", importFile);
      const res = await fetch("/api/intel/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "导入失败。");
        return;
      }
      setImportText("");
      setImportFile(null);
      if (importRef.current) importRef.current.value = "";
      setNotice(`已导入 ${data.inserted || 0} 条 Serenity 记录。`);
      load();
    } finally {
      setImporting(false);
    }
  };

  const runLens = async (queryOverride?: string) => {
    const query = (queryOverride || lensQuery).trim().toUpperCase();
    if (!query || lensLoading) return;
    setLensQuery(query);
    setLensLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intel/lens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, ticker: /^[A-Z]{1,6}$/.test(query) ? query : null }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Serenity Lens 分析失败。");
        return;
      }
      setLensResult(data);
    } finally {
      setLensLoading(false);
    }
  };

  return (
    <div className="space-y-5 stagger">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gold">Serenity 档案</h1>
          <div className="text-xs text-muted mt-1">
            @{sortedItems[0]?.source_handle || "aleabitoreddit"} · 按发帖时间排序 · 全量 append-only 入库
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <div className="panel px-3 py-2">
            <div className="num text-base text-ink">{collection?.total ?? items.length}</div>
            <div className="text-[10px] text-faint">帖子</div>
          </div>
          <div className="panel px-3 py-2">
            <div className="num text-base text-gold">{tickerRail.length}</div>
            <div className="text-[10px] text-faint">标的</div>
          </div>
          <div className="panel px-3 py-2">
            <div className="num text-base text-up">{tickerRail.filter((t) => t.overlap).length}</div>
            <div className="text-[10px] text-faint">组合重叠</div>
          </div>
        </div>
      </div>

      <section className="panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">全量采集账本</div>
            <div className="text-[10px] text-muted mt-0.5">
              {collection?.earliest && collection?.latest
                ? `已覆盖 ${zhTime(collection.earliest)} 至 ${zhTime(collection.latest)}`
                : "等待采集窗口写入"}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-right">
            <div className="bg-raised border border-line rounded px-3 py-2">
              <div className="num text-sm text-ink">{collection?.total ?? items.length}</div>
              <div className="text-[9px] text-faint">总记录</div>
            </div>
            <div className="bg-raised border border-line rounded px-3 py-2">
              <div className="num text-sm text-up">{collection?.windows?.filter((w) => w.status === "done").length ?? 0}</div>
              <div className="text-[9px] text-faint">完成窗口</div>
            </div>
            <div className="bg-raised border border-line rounded px-3 py-2">
              <div className="num text-sm text-gold">{collection?.duplicate_external_ids ?? 0}</div>
              <div className="text-[9px] text-faint">重复 ID</div>
            </div>
            <div className="bg-raised border border-line rounded px-3 py-2">
              <div className="num text-sm text-down">{collection?.garbage_rows ?? 0}</div>
              <div className="text-[9px] text-faint">垃圾行</div>
            </div>
          </div>
        </div>
        {collection?.windows?.length ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {collection.windows.slice(0, 12).map((w) => (
              <div key={w.id} className="bg-base border border-line rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted">{w.window_start} → {w.window_end}</span>
                  <span className={`text-[9px] font-semibold ${
                    w.status === "done" ? "text-up" : w.status === "failed" ? "text-down" : "text-gold"
                  }`}>{w.status}</span>
                </div>
                <div className="mt-1 text-[10px] text-faint">
                  找到 {w.found_count} · 新增 {w.inserted_count} · 重复 {w.duplicate_count} · 拒绝 {w.rejected_count}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <SerenityLensPanel
        query={lensQuery}
        setQuery={setLensQuery}
        result={lensResult}
        loading={lensLoading}
        runLens={runLens}
        tickerRail={tickerRail.slice(0, 8).map((r) => r.ticker)}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="space-y-4">
          <section className="panel p-4">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)] gap-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">批量导入</div>
                    <div className="text-[10px] text-muted mt-0.5">支持 HAR / JSON / TXT，每条识别到的帖子都会单独入库。</div>
                  </div>
                  <button
                    onClick={submitImport}
                    disabled={importing || (!importText.trim() && !importFile)}
                    className="bg-gold text-base text-sm font-semibold rounded px-4 py-2 hover:bg-[#c9952a] disabled:opacity-40"
                  >
                    {importing ? "导入中" : "导入"}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2 mt-3">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={4}
                    placeholder="也可以直接粘贴 JSON、HAR 内容，或用 --- 分隔多条文本帖子。"
                    className="w-full resize-none border border-line rounded px-3 py-2 text-xs text-ink placeholder-faint bg-transparent focus:outline-none focus:border-gold"
                  />
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted block mb-1">导入文件</span>
                    <input
                      ref={importRef}
                      type="file"
                      accept=".har,.json,.txt,application/json,text/plain"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-muted file:mr-3 file:rounded file:border file:border-line file:bg-raised file:px-3 file:py-2 file:text-xs file:text-ink"
                    />
                    {importFile && <div className="text-[10px] text-muted mt-2">{importFile.name}</div>}
                  </label>
                </div>
              </div>

              <div className="bg-base border border-line rounded p-3">
                <div className="text-sm font-semibold text-ink">浏览器导出方法</div>
                <ol className="mt-2 space-y-1.5 text-xs text-muted list-decimal list-inside">
                  <li>在 Chrome 打开 Serenity 的 X 页面并保持登录。</li>
                  <li>打开开发者工具，进入 Network，勾选 Preserve log。</li>
                  <li>刷新页面并向下滚动，让帖子请求加载出来。</li>
                  <li>在请求列表空白处右键，选择 Save all as HAR。</li>
                  <li>把导出的 `.har` 上传到这里。</li>
                </ol>
              </div>
            </div>

            <details className="mt-4 border-t border-line pt-3">
              <summary className="text-xs text-muted cursor-pointer">手动补录截图或单条文本</summary>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_.8fr_auto] gap-2 items-end mt-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted block mb-1">正文</span>
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    rows={2}
                    placeholder="粘贴 Serenity 原文；截图会保存，OCR 可用时自动补充。"
                    className="w-full resize-none border border-line rounded px-3 py-2 text-xs text-ink placeholder-faint bg-transparent focus:outline-none focus:border-gold"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted block mb-1">链接</span>
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://x.com/..."
                      className="w-full border border-line rounded px-3 py-2 text-xs text-ink placeholder-faint bg-transparent focus:outline-none focus:border-gold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted block mb-1">发帖时间</span>
                    <input
                      type="datetime-local"
                      value={itemTs}
                      onChange={(e) => setItemTs(e.target.value)}
                      className="w-full border border-line rounded px-3 py-2 text-xs text-ink bg-transparent focus:outline-none focus:border-gold"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted block mb-1">截图</span>
                  <input
                    ref={mediaRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setMedia(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-muted file:mr-3 file:rounded file:border file:border-line file:bg-raised file:px-3 file:py-2 file:text-xs file:text-ink"
                  />
                </label>
                <button
                  onClick={submitManual}
                  disabled={saving || (!rawText.trim() && !media)}
                  className="bg-gold text-base text-sm font-semibold rounded px-4 py-2.5 hover:bg-[#c9952a] disabled:opacity-40"
                >
                  {saving ? "保存中" : "保存"}
                </button>
              </div>
            </details>

            {notice && <div className="text-xs text-up mt-3">{notice}</div>}
            {error && <div className="text-xs text-down mt-3">{error}</div>}
          </section>

          {sortedItems.length === 0 && (
            <div className="panel p-8 text-center text-sm text-muted">
              还没有 Serenity 记录。先上传 HAR/JSON，或手动补录一条截图。
            </div>
          )}
          {sortedItems.map((item) => <PostCard key={item.id} item={item} />)}
        </div>

        <aside className="panel p-4 xl:sticky xl:top-20">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <div className="text-sm font-semibold text-ink">标的表现</div>
              <div className="text-[10px] text-muted mt-0.5">按档案出现频次与组合重叠排序</div>
            </div>
            <div className="num text-sm text-gold">{tickerRail.length}</div>
          </div>
          <div className="divide-y divide-line/60">
            {tickerRail.length === 0 && <div className="py-5 text-xs text-muted">尚未识别到标的。</div>}
            {tickerRail.map((r) => (
              <div key={r.ticker} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`num text-sm font-semibold ${r.overlap ? "text-gold" : "text-ink"}`}>{r.ticker}</span>
                      {r.overlap && <span className="text-[9px] border border-gold/35 text-gold rounded px-1.5 py-0.5">持仓</span>}
                    </div>
                    <div className="text-xs text-ink mt-1">{r.meta.nameZh}</div>
                  <div className="text-[10px] text-muted mt-0.5">{r.meta.sectorZh} · {r.meta.subsectorZh}</div>
                </div>
                  <span className={`num text-xs font-semibold ${performanceTone(r.latest || undefined)}`}>
                    {performanceLabel(r.latest || undefined)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-muted">
                  <div>基准 <span className="num text-ink">{money(r.latest?.baseline)}</span></div>
                  <div>最新 <span className="num text-ink">{money(r.latest?.current)}</span></div>
                </div>
                {(r.latest?.baseline_date || r.latest?.current_date) && (
                  <div className="text-[10px] text-faint mt-1">
                    {r.latest?.baseline_date || "-"} → {r.latest?.current_date || "-"}
                  </div>
                )}
                <div className="text-[10px] text-faint mt-1">出现 {r.refs} 次</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SerenityLensPanel({
  query,
  setQuery,
  result,
  loading,
  runLens,
  tickerRail,
}: {
  query: string;
  setQuery: (value: string) => void;
  result: SerenityLensResult | null;
  loading: boolean;
  runLens: (queryOverride?: string) => void;
  tickerRail: string[];
}) {
  const framework = result?.framework || [];
  const maxScore = 5;
  return (
    <section className="panel panel-accent overflow-hidden">
      <div className="grid grid-cols-1 2xl:grid-cols-[360px_minmax(0,1fr)_380px]">
        <div className="p-4 border-b 2xl:border-b-0 2xl:border-r border-line">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-gold">Serenity Lens</div>
              <h2 className="text-base font-semibold text-ink mt-1">思维框架研究台</h2>
            </div>
            {result && (
              <span className={`shrink-0 border rounded px-2 py-1 text-[10px] font-semibold ${confidenceTone[result.confidence]}`}>
                {confidenceLabel[result.confidence]}
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-muted leading-relaxed">
            以档案中的重复研究模式为样本，评估产业链位置、瓶颈、催化剂、叙事强度、赔率和反证条件。
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") runLens(); }}
              placeholder="MRVL / AI NETWORKING"
              className="min-w-0 border border-line rounded bg-base px-3 py-2 text-sm text-ink placeholder-faint focus:outline-none focus:border-gold"
            />
            <button
              onClick={() => runLens()}
              disabled={loading || !query.trim()}
              className="rounded bg-gold px-3 py-2 text-sm font-semibold text-base hover:bg-[#c9952a] disabled:opacity-40"
            >
              {loading ? "运行中" : "运行"}
            </button>
          </div>
          {tickerRail.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tickerRail.map((ticker) => (
                <button
                  key={ticker}
                  onClick={() => runLens(ticker)}
                  className="rounded border border-line bg-raised px-2 py-1 text-[10px] num text-muted hover:border-gold/50 hover:text-gold"
                >
                  {ticker}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-faint">Verdict</div>
            <div className="mt-1 text-xl font-semibold text-ink">{result?.verdict.label || "等待分析"}</div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {result?.verdict.summary || "输入 ticker 或主题后，Lens 会生成中文结构化研究框架。"}
            </p>
            {result && <div className="num mt-3 text-xs text-gold">样本 {result.sample_size}</div>}
          </div>
        </div>

        <div className="p-4 border-b 2xl:border-b-0 2xl:border-r border-line">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">六维框架</div>
              <div className="text-[10px] text-muted mt-0.5">评分来自档案主题密度，不是价格预测。</div>
            </div>
            <div className="num text-sm text-gold">
              {framework.length ? framework.reduce((sum, row) => sum + row.score, 0) : "--"}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {(framework.length ? framework : [
              "产业链位置", "供需/瓶颈", "催化剂", "叙事强度", "赔率质量", "反证条件",
            ].map((dimension) => ({ dimension, score: 0, note: "等待运行 Lens。" }))).map((row) => (
              <div key={row.dimension} className="bg-base border border-line rounded p-3 min-h-[106px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-ink">{row.dimension}</span>
                  <span className="num text-xs text-gold">{row.score}/{maxScore}</span>
                </div>
                <div className="mt-2 h-1.5 rounded bg-raised overflow-hidden">
                  <div
                    className="h-full bg-gold"
                    style={{ width: `${Math.max(4, (row.score / maxScore) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-muted">{row.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">证据与反证</div>
              <div className="text-[10px] text-muted mt-0.5">只引用档案索引和主题，不复制原帖作为结论。</div>
            </div>
            <div className="num text-sm text-gold">{result?.evidence.length ?? 0}</div>
          </div>

          <div className="mt-3 space-y-2 max-h-[280px] overflow-auto pr-1">
            {result?.evidence.length ? result.evidence.map((item) => (
              <div key={item.external_id || `${item.item_ts}-${item.summary}`} className="border border-line rounded bg-base p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] text-muted">{zhTime(item.item_ts)}</div>
                  {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-[10px] text-gold underline">原帖</a>}
                </div>
                <div className="mt-1 text-xs text-ink line-clamp-2">{item.summary}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.tickers.slice(0, 4).map((ticker) => (
                    <span key={ticker} className="num rounded border border-gold/30 px-1.5 py-0.5 text-[9px] text-gold">{ticker}</span>
                  ))}
                  {item.themes.slice(0, 3).map((theme) => (
                    <span key={theme} className="rounded border border-line px-1.5 py-0.5 text-[9px] text-muted">{theme}</span>
                  ))}
                </div>
              </div>
            )) : (
              <div className="border border-line rounded bg-base p-4 text-xs text-muted">暂无证据。运行 Lens 后会显示匹配到的档案样本。</div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2">
            <div className="bg-raised border border-line rounded p-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-faint">反证条件</div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted">
                {(result?.counter_signals || ["等待 Lens 输出反证条件。"]).slice(0, 4).map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>
            <div className="bg-raised border border-line rounded p-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-faint">适合动作</div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted">
                {(result?.action_fit || ["等待 Lens 输出动作适配。"]).slice(0, 3).map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </div>
          {result?.disclaimer && <div className="mt-3 text-[10px] leading-relaxed text-faint">{result.disclaimer}</div>}
        </div>
      </div>
    </section>
  );
}

function PostCard({ item }: { item: IntelItem }) {
  return (
    <article className={`panel overflow-hidden ${item.urgency !== "low" ? "panel-accent" : ""}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#f4d7e8] via-[#d2d9ff] to-[#222938] border border-line shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">Serenity</span>
                  <span className="text-[10px] text-gold border border-gold/30 rounded px-1.5 py-0.5">已认证</span>
                  <span className="text-xs text-muted">@{item.source_handle || "aleabitoreddit"}</span>
                  <span className="text-xs text-faint">·</span>
                  <span className="text-xs text-muted">{zhTime(item.item_ts || item.captured_at)}</span>
                </div>
                <div className="text-[10px] text-faint mt-0.5">
                  入库 {zhTime(item.captured_at)} · {methodLabel(item.capture_method)}
                  {item.external_id && <> · ID {item.external_id}</>}
                  {item.url && (
                    <>
                      {" · "}
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-gold underline">原帖</a>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`border rounded px-2 py-1 text-[10px] font-semibold ${
                  item.urgency === "alert" ? "text-down border-down/35 bg-down/[0.04]" :
                  item.urgency === "watch" ? "text-gold border-gold/35 bg-gold/[0.04]" :
                  "text-muted border-line bg-panel"
                }`}>
                  {urgencyLabel[item.urgency]}
                </span>
                <span className={`text-[10px] font-semibold ${directionTone[item.impact_direction]}`}>{directionLabel[item.impact_direction]}</span>
              </div>
            </div>

            <div className="text-[15px] text-ink leading-relaxed mt-3 whitespace-pre-wrap">{item.raw_text}</div>

            {item.media_url && (
              <div className="mt-3 overflow-hidden rounded-lg border border-line bg-base">
                <Image
                  src={item.media_url}
                  alt={item.media_name || "Serenity 截图"}
                  width={960}
                  height={540}
                  unoptimized
                  className="w-full max-h-[560px] object-contain bg-black"
                />
              </div>
            )}

            <div className="mt-4 border-t border-line pt-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-xs font-semibold text-ink">标的表现</div>
                  <div className="text-[10px] text-muted mt-0.5">按发帖基准价计算；旧采集缺基准时会标记为待补历史价。</div>
                </div>
                <div className="text-[10px] text-faint">共 {item.related_tickers.length} 个 ticker</div>
              </div>

              {item.related_tickers.length > 0 ? (
                <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {item.related_tickers.map((t) => {
                    const meta = metaFor(t);
                    const snap = item.ticker_snapshot?.[t];
                    const overlap = item.portfolio_overlap.includes(t);
                    return (
                      <div key={t} className={`rounded border p-3 ${
                        overlap ? "border-gold/35 bg-gold/[0.035]" : "border-line bg-base"
                      }`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`num text-sm font-semibold ${overlap ? "text-gold" : "text-ink"}`}>{t}</span>
                              {overlap && <span className="rounded border border-gold/35 px-1.5 py-0.5 text-[9px] text-gold">持仓</span>}
                            </div>
                            <div className="mt-1 text-xs text-ink truncate">{meta.nameZh}</div>
                            <div className="mt-0.5 text-[10px] text-faint">{meta.sectorZh}</div>
                          </div>
                          <div className={`num text-sm font-semibold shrink-0 ${performanceTone(snap)}`}>{performanceLabel(snap)}</div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="min-w-0">
                            <div className="text-[9px] uppercase tracking-[0.1em] text-faint">细分行业</div>
                            <div className="mt-1 text-[11px] leading-snug text-muted">{meta.subsectorZh}</div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-[0.1em] text-faint">至今涨幅</div>
                            <div className={`num mt-1 text-xs font-semibold ${performanceTone(snap)}`}>{performanceLabel(snap)}</div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-[0.1em] text-faint">发帖基准</div>
                            <div className="num mt-1 text-xs text-ink">{money(snap?.baseline)}</div>
                          </div>
                          <div>
                            <div className="text-[9px] uppercase tracking-[0.1em] text-faint">最新价格</div>
                            <div className="num mt-1 text-xs text-ink">{money(snap?.current)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 rounded border border-line bg-base px-3 py-2 text-xs text-muted">未识别到标的。</div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-2 mt-3">
              <div className="bg-raised border border-line rounded p-3">
                <div className="text-[9px] uppercase tracking-[0.1em] text-faint">中文解读</div>
                <div className="text-xs text-muted leading-relaxed mt-1">{postInterpretation(item)}</div>
              </div>
              <div className="bg-raised border border-line rounded p-3">
                <div className="text-[9px] uppercase tracking-[0.1em] text-faint">组合重叠</div>
                <div className="text-xs text-ink mt-1">{item.portfolio_overlap.length > 0 ? item.portfolio_overlap.join(" · ") : "无"}</div>
                <div className={`mt-2 text-[10px] font-semibold ${directionTone[item.impact_direction]}`}>{directionLabel[item.impact_direction]}</div>
              </div>
            </div>

            {item.ocr_text && (
              <details className="mt-3">
                <summary className="text-[10px] text-muted cursor-pointer">OCR 文本</summary>
                <div className="mt-2 text-[11px] text-muted leading-relaxed whitespace-pre-wrap bg-base border border-line rounded p-3">{item.ocr_text}</div>
              </details>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
