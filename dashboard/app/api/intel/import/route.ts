import { getWriteDb } from "@/lib/db";
import { analyzeIntelText, emptyTickerSnapshot, type TickerSnapshot } from "@/lib/intel";
import { extractSerenityPostsFromPayload } from "@/lib/intelImport";
import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import path from "path";

const SCRIPTS = path.join(
  process.env.IBKR_SCRIPTS_DIR ||
    path.join(process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts"),
);
const PYTHONPATH =
  process.env.PYTHONPATH ||
  path.join(process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages");
const QUOTE_LIMIT = 16;

function ensureIntelSchema(db: ReturnType<typeof getWriteDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intel_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at         TEXT NOT NULL,
      source              TEXT NOT NULL,
      source_handle       TEXT,
      external_id         TEXT,
      capture_method      TEXT NOT NULL,
      item_ts             TEXT,
      url                 TEXT,
      title               TEXT,
      media_path          TEXT,
      media_mime          TEXT,
      media_name          TEXT,
      ocr_text            TEXT,
      raw_text            TEXT NOT NULL,
      summary             TEXT,
      related_tickers     TEXT,
      portfolio_overlap   TEXT,
      impact_direction    TEXT,
      urgency             TEXT,
      rationale           TEXT,
      ticker_snapshot     TEXT,
      raw_payload         TEXT
    );
    CREATE INDEX IF NOT EXISTS intel_items_captured_at ON intel_items(captured_at);
    CREATE INDEX IF NOT EXISTS intel_items_source ON intel_items(source, source_handle);
  `);
  const columns = new Set((db.prepare("PRAGMA table_info(intel_items)").all() as { name: string }[]).map((c) => c.name));
  for (const [name, ddl] of [
    ["media_path", "TEXT"],
    ["media_mime", "TEXT"],
    ["media_name", "TEXT"],
    ["ocr_text", "TEXT"],
    ["ticker_snapshot", "TEXT"],
    ["external_id", "TEXT"],
  ] as const) {
    if (!columns.has(name)) db.exec(`ALTER TABLE intel_items ADD COLUMN ${name} ${ddl}`);
  }
}

function extractPrices(data: unknown): Record<string, number> {
  const prices: Record<string, number> = {};
  const visit = (value: unknown, keyHint?: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    const sym = String(obj.symbol || obj.ticker || obj.underlying || keyHint || "").toUpperCase();
    const price = Number(obj.last || obj.last_price || obj.price || obj.market_price || obj.close || obj.mid);
    if (sym && Number.isFinite(price) && price > 0) prices[sym] = price;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") visit(v, k.toUpperCase());
    }
  };
  visit(data);
  return prices;
}

function runQuotes(tickers: string[]): Record<string, number> {
  const selected = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))].slice(0, QUOTE_LIMIT);
  if (selected.length === 0) return {};
  try {
    const out = execFileSync("python3", [path.join(SCRIPTS, "market_quote.py"), ...selected], {
      env: { ...process.env, PYTHONPATH },
      timeout: 35000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return extractPrices(JSON.parse(out.toString()));
  } catch {
    return {};
  }
}

function buildTickerSnapshot(tickers: string[]): Record<string, TickerSnapshot> {
  const pending = emptyTickerSnapshot(tickers);
  const quotes = runQuotes(tickers);
  for (const t of tickers) {
    const current = quotes[t];
    if (current) pending[t] = { baseline: current, current, since_pct: 0, source: "quote" };
  }
  return pending;
}

async function readImportText(req: NextRequest) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const pasted = String(form.get("payload") || "").trim();
    if (file instanceof File && file.size > 0) return await file.text();
    return pasted;
  }
  const body = await req.json();
  if (typeof body.payload === "string") return body.payload;
  if (body.items) return JSON.stringify(body.items);
  return JSON.stringify(body);
}

export async function POST(req: NextRequest) {
  let payload = "";
  try {
    payload = await readImportText(req);
  } catch {
    return NextResponse.json({ error: "无法读取导入文件或内容。" }, { status: 400 });
  }

  const posts = extractSerenityPostsFromPayload(payload);
  if (posts.length === 0) {
    return NextResponse.json({ inserted: 0, posts: [], error: "没有识别到可导入的帖子。" }, { status: 422 });
  }

  const db = getWriteDb();
  ensureIntelSchema(db);
  const inserted: number[] = [];
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT INTO intel_items
      (captured_at, source, source_handle, external_id, capture_method, item_ts, url,
       raw_text, summary, related_tickers, portfolio_overlap, impact_direction, urgency,
       rationale, ticker_snapshot, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const post of posts) {
      const analysis = analyzeIntelText(post.text);
      const snapshot = buildTickerSnapshot(analysis.related_tickers);
      const info = insert.run(
        now,
        "Serenity",
        "aleabitoreddit",
        post.external_id,
        "browser-import",
        post.item_ts,
        post.url,
        post.text,
        analysis.summary,
        JSON.stringify(analysis.related_tickers),
        JSON.stringify(analysis.portfolio_overlap),
        analysis.impact_direction,
        analysis.urgency,
        analysis.rationale,
        JSON.stringify(snapshot),
        JSON.stringify({ import_format: "browser-export", extracted_raw: post.raw }),
      );
      inserted.push(Number(info.lastInsertRowid));
    }
  });
  tx();

  return NextResponse.json({
    inserted: inserted.length,
    ids: inserted,
    posts: posts.slice(0, 20).map((p) => ({ external_id: p.external_id, item_ts: p.item_ts, text: p.text.slice(0, 220) })),
  });
}
