import { getDb, getWriteDb } from "@/lib/db";
import { analyzeIntelText, emptyTickerSnapshot, type TickerSnapshot } from "@/lib/intel";
import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const PROJECT_ROOT =
  process.env.TRADEMIND_ROOT ||
  path.join(/* turbopackIgnore: true */ process.env.HOME || "~", "Desktop/TradeMind_Agent");
const MEDIA_DIR = path.join(/* turbopackIgnore: true */ PROJECT_ROOT, "agent/db/intel_media");
const SCRIPTS = path.join(
  process.env.IBKR_SCRIPTS_DIR ||
    path.join(/* turbopackIgnore: true */ process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts"),
);
const PYTHONPATH =
  process.env.PYTHONPATH ||
  path.join(/* turbopackIgnore: true */ process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages");
const QUOTE_LIMIT = 16;

function parseJson(value: unknown) {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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

function buildTickerSnapshot(tickers: string[]): Record<string, TickerSnapshot> {
  const pending = emptyTickerSnapshot(tickers);
  const quotes = runQuotes(tickers);
  for (const t of tickers) {
    const current = quotes[t];
    if (current) pending[t] = { baseline: current, current, since_pct: 0, source: "quote" };
  }
  return pending;
}

function refreshTickerSnapshot(raw: unknown, quotes?: Record<string, number>): Record<string, TickerSnapshot> {
  const snap = (raw && typeof raw === "object" ? raw : {}) as Record<string, TickerSnapshot>;
  const tickers = Object.keys(snap);
  const priceMap = quotes ?? runQuotes(tickers);
  const next: Record<string, TickerSnapshot> = {};
  for (const t of tickers) {
    const old = snap[t] || { baseline: null, current: null, since_pct: null, source: "pending" };
    const quoted = priceMap[t];
    const current = quoted ?? old.current ?? null;
    const baseline = old.baseline ?? null;
    next[t] = {
      ...old,
      baseline,
      current,
      since_pct: baseline && current ? ((current - baseline) / baseline) * 100 : null,
      source: quoted ? "quote" : old.source || (current ? "historical" : "pending"),
    };
  }
  return next;
}

function mediaExt(file: File) {
  const byMime: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
  const fromMime = byMime[file.type];
  if (fromMime) return fromMime;
  const ext = path.extname(file.name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
}

async function saveMedia(file: File | null): Promise<{ media_path: string; media_mime: string; media_name: string; bytes: Buffer } | null> {
  if (!file || file.size <= 0) return null;
  mkdirSync(MEDIA_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  const rel = `agent/db/intel_media/${randomUUID()}${mediaExt(file)}`;
  const abs = path.join(PROJECT_ROOT, rel);
  writeFileSync(abs, bytes);
  return { media_path: rel, media_mime: file.type || "image/png", media_name: file.name || "serenity-capture.png", bytes };
}

async function tryOcrImage(media: { media_mime: string; bytes: Buffer } | null): Promise<string | null> {
  if (!media || !process.env.OPENAI_API_KEY) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract the visible tweet text, account name, handle, and post date/time from this screenshot. Return plain text only." },
            { type: "image_url", image_url: { url: `data:${media.media_mime};base64,${media.bytes.toString("base64")}` } },
          ],
        }],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" ? text.trim() || null : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(req: NextRequest) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("media");
    const media = file instanceof File ? await saveMedia(file) : null;
    const ocr = await tryOcrImage(media);
    return {
      source: String(form.get("source") || "Serenity"),
      source_handle: String(form.get("source_handle") || "aleabitoreddit"),
      external_id: String(form.get("external_id") || "").trim() || null,
      capture_method: String(form.get("capture_method") || (media ? "screenshot" : "manual")),
      url: String(form.get("url") || "").trim() || null,
      item_ts: String(form.get("item_ts") || "").trim() || null,
      raw_text: String(form.get("raw_text") || "").trim(),
      ocr_text: ocr,
      media,
    };
  }
  const body = await req.json();
  return {
    source: String(body.source || "Serenity"),
    source_handle: String(body.source_handle || "aleabitoreddit"),
    external_id: body.external_id == null ? null : String(body.external_id).trim() || null,
    capture_method: String(body.capture_method || "manual"),
    url: body.url == null ? null : String(body.url).trim() || null,
    item_ts: body.item_ts == null ? null : String(body.item_ts).trim() || null,
    raw_text: String(body.raw_text || "").trim(),
    ocr_text: body.ocr_text == null ? null : String(body.ocr_text).trim() || null,
    media: null,
  };
}

export async function GET(req: NextRequest) {
  ensureIntelSchema(getWriteDb());
  const db = getDb();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = db.prepare("SELECT * FROM intel_items ORDER BY COALESCE(item_ts, captured_at) DESC, id DESC LIMIT 200").all() as Record<string, unknown>[];
  } catch {
    rows = [];
  }
  const parsedRows = rows.map((r) => {
    const relatedTickers = parseJson(r.related_tickers) || [];
    const portfolioOverlap = parseJson(r.portfolio_overlap) || [];
    const tickerSnapshot = (parseJson(r.ticker_snapshot) || {}) as Record<string, TickerSnapshot>;
    for (const ticker of relatedTickers) {
      if (!tickerSnapshot[ticker]) {
        tickerSnapshot[ticker] = { baseline: null, current: null, since_pct: null, source: "pending" };
      }
    }
    return { row: r, relatedTickers, portfolioOverlap, tickerSnapshot };
  });
  const quoteTickers = [
    ...new Set(parsedRows.flatMap((r) => Object.keys(r.tickerSnapshot))),
  ];
  const refreshQuotes = req.nextUrl.searchParams.get("fresh") === "1";
  const quotes = refreshQuotes ? runQuotes(quoteTickers) : {};
  const items = parsedRows.map(({ row: r, relatedTickers, portfolioOverlap, tickerSnapshot }) => ({
    ...r,
    related_tickers: relatedTickers,
    portfolio_overlap: portfolioOverlap,
    ticker_snapshot: refreshTickerSnapshot(tickerSnapshot, quotes),
    raw_payload: parseJson(r.raw_payload),
    media_url: r.media_path ? `/api/intel/media?id=${r.id}` : null,
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(req);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rawText = [body.raw_text, body.ocr_text].filter(Boolean).join("\n\n").trim() || "[image capture awaiting OCR/manual text]";
  const source = body.source.trim() || "Serenity";
  const sourceHandle = body.source_handle.replace(/^@/, "").trim() || "aleabitoreddit";
  const captureMethod = body.capture_method.trim() || "manual";
  const analysis = analyzeIntelText(rawText);
  const tickerSnapshot = buildTickerSnapshot(analysis.related_tickers);

  try {
    const db = getWriteDb();
    ensureIntelSchema(db);
    const info = db
      .prepare(
        `INSERT INTO intel_items
          (captured_at, source, source_handle, external_id, capture_method, item_ts, url,
           media_path, media_mime, media_name, ocr_text, raw_text, summary,
           related_tickers, portfolio_overlap, impact_direction, urgency, rationale, ticker_snapshot, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        source,
        sourceHandle,
        body.external_id,
        captureMethod,
        body.item_ts,
        body.url,
        body.media?.media_path ?? null,
        body.media?.media_mime ?? null,
        body.media?.media_name ?? null,
        body.ocr_text,
        rawText,
        analysis.summary,
        JSON.stringify(analysis.related_tickers),
        JSON.stringify(analysis.portfolio_overlap),
        analysis.impact_direction,
        analysis.urgency,
        analysis.rationale,
        JSON.stringify(tickerSnapshot),
        JSON.stringify({ submitted_from: "dashboard", ocr_attempted: Boolean(body.media), ocr_succeeded: Boolean(body.ocr_text) }),
      );
    return NextResponse.json({ id: info.lastInsertRowid, item: analysis }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
