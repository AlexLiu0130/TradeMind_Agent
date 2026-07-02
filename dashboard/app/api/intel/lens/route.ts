import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RULES = [
  ["memory_bottleneck", "存储 / HBM 瓶颈", "供需/瓶颈", /\b(hbm|dram|memory|bandwidth|capacity|tight|bottleneck)\b/i, "关注 AI 训练/推理扩张中最难快速增加的供给环节。"],
  ["ai_networking", "AI 网络 / 光互连", "产业链位置", /\b(ethernet|networking|switch|optics|optical|dsp|interconnect)\b/i, "把算力扩张拆成集群互联、交换芯片、光模块和代工交付能力。"],
  ["custom_silicon", "定制芯片 / ASIC", "催化剂", /\b(custom silicon|asic|xpu|hyperscaler|accelerator)\b/i, "跟踪云厂商资本开支从通用 GPU 向自研/半定制芯片的扩散。"],
  ["compute_platform", "AI 加速器平台", "叙事强度", /\b(gpu|cuda|blackwell|rubin|mi300|mi350|ai chip|ai accelerator)\b/i, "用产品周期和软件生态解释估值溢价是否还能维持。"],
  ["policy_supply_chain", "政策 / 地缘供应链", "反证条件", /\b(export|tariff|china|taiwan|restriction|policy|ban|sanction)\b/i, "把政策变量视为赔率折价和情绪扰动，不把它当成单向叙事。"],
  ["arm_edge", "ARM / 边缘计算生态", "产业链位置", /\b(arm|risc-v|cpu|edge ai|mobile)\b/i, "关注架构授权、终端侧 AI 和生态迁移带来的可选性。"],
  ["robotics_power", "机器人 / 电力基础设施", "催化剂", /\b(robot|robotics|humanoid|power|grid|energy|cooling)\b/i, "寻找 AI 主题向实体基础设施和自动化扩散的第二曲线。"],
] as const;

const DIMENSIONS = ["产业链位置", "供需/瓶颈", "催化剂", "叙事强度", "赔率质量", "反证条件"];

type IntelItem = {
  external_id: string | null;
  item_ts: string | null;
  captured_at: string;
  url: string | null;
  raw_text: string;
  summary: string | null;
  rationale: string | null;
  related_tickers: string | null;
};

function loads(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function themes(text: string) {
  return RULES.filter((r) => r[3].test(text)).map((r) => ({ key: r[0], label: r[1], dimension: r[2], note: r[4] }));
}

function matches(row: IntelItem, terms: string[]) {
  const related = new Set(loads(row.related_tickers).map((t) => t.toUpperCase()));
  const haystack = `${row.raw_text} ${row.summary || ""} ${row.rationale || ""}`.toUpperCase();
  return terms.some((term) => related.has(term.toUpperCase()) || haystack.includes(term.toUpperCase()));
}

function dimensionNote(dimension: string, items: IntelItem[], allThemes: ReturnType<typeof themes>) {
  const labels = allThemes.filter((t) => t.dimension === dimension).map((t) => t.label);
  if (dimension === "赔率质量") {
    if (items.length >= 20) return "档案中出现频率较高，说明叙事不冷门；需要用价格位置和业绩兑现来避免追高。";
    if (items.length >= 5) return "有可观察样本但未到拥挤状态，适合继续跟踪催化剂兑现。";
    return "样本不足，不能把赔率判断建立在单条内容上。";
  }
  if (dimension === "反证条件") return labels.length ? `主要反证来自：${[...new Set(labels)].join("、")}；若政策/供需方向反转，lens 需要降级。` : "需要跟踪需求放缓、毛利率恶化、客户推迟资本开支和估值过度拥挤。";
  return labels.length ? `匹配主题：${[...new Set(labels)].join("、")}。` : "当前档案证据较弱，需要更多帖子或基本面数据确认。";
}

function analyze(query: string, ticker: string | null, limit: number) {
  const cleanQuery = (query || ticker || "").trim().toUpperCase();
  if (!cleanQuery) return { error: "query or ticker is required" };
  const terms = [...new Set([cleanQuery, ticker || "", ...cleanQuery.matchAll(/\$?([A-Z]{2,6})\b/g)].flatMap((m) => typeof m === "string" ? m : m[1]).filter(Boolean))];
  const rows = getDb().prepare(
    `SELECT external_id, item_ts, captured_at, url, raw_text, summary, rationale, related_tickers
     FROM intel_items
     WHERE source_handle='aleabitoreddit'
     ORDER BY COALESCE(item_ts, captured_at) DESC
     LIMIT 1200`,
  ).all() as IntelItem[];
  const items = rows.filter((row) => matches(row, terms)).slice(0, limit);
  const allThemes = items.flatMap((item) => themes(item.raw_text || ""));
  const theme_counts: Record<string, number> = Object.fromEntries(RULES.map((r) => [r[0], allThemes.filter((t) => t.key === r[0]).length]).filter(([, n]) => n));
  const framework = DIMENSIONS.map((dimension) => {
    const strength = allThemes.filter((t) => t.dimension === dimension).length;
    return { dimension, score: Math.min(5, strength + (dimension === "赔率质量" && items.length >= 5 ? 1 : 0)), note: dimensionNote(dimension, items, allThemes) };
  });
  const confidence = items.length >= 20 && Object.values(theme_counts).reduce((a, b) => a + Number(b), 0) >= 10 ? "high" : items.length >= 2 ? "medium" : "low";
  const score = framework.reduce((sum, row) => sum + row.score, 0);
  const verdict = confidence === "low"
    ? { label: "样本不足", summary: `${cleanQuery} 在 Serenity 档案中的有效样本不足，不能硬判定其是否符合该研究框架。` }
    : { label: score >= 16 ? "高契合观察" : "结构性观察", summary: `${cleanQuery} 的档案证据更适合用产业链位置、瓶颈约束和催化剂兑现来观察，而不是只看单日新闻或单条观点。` };
  return {
    query: cleanQuery,
    ticker,
    source: "TradeMind Serenity Lens",
    confidence,
    sample_size: items.length,
    theme_counts,
    verdict,
    framework,
    evidence: items.slice(0, 6).map((item) => ({ external_id: item.external_id, item_ts: item.item_ts || item.captured_at, url: item.url, themes: themes(item.raw_text).map((t) => t.label), tickers: loads(item.related_tickers), summary: item.summary || "档案样本与查询相关。" })),
    counter_signals: confidence === "low" ? ["样本不足时，任何结论都需要等待更多档案或基本面证据。"] : ["如果相关产品周期延后、客户资本开支下修或订单兑现低于预期，需要降低叙事权重。", "如果股价已经提前反映乐观情景，适合把仓位动作从追涨改为等待回撤或卖波动。"],
    action_fit: confidence === "low" ? [`${ticker || "该主题"} 适合先放入观察清单，不适合直接根据 lens 建仓。`] : [`${ticker || "该主题"} 适合继续监控催化剂和价格位置。`],
    disclaimer: "这是 TradeMind 对历史档案的研究框架蒸馏，不代表或模仿 Serenity 本人，也不构成交易指令。",
  };
}

export async function POST(req: NextRequest) {
  let body: { query?: string; ticker?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = String(body.query || body.ticker || "").trim();
  const ticker = body.ticker ? String(body.ticker).trim().toUpperCase() : null;
  const data = analyze(query, ticker, Math.min(Math.max(Number(body.limit || 80), 1), 200));
  return NextResponse.json(data, { status: "error" in data ? 400 : 200 });
}
