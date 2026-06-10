import { NextRequest, NextResponse } from "next/server";
import { getWriteDb } from "@/lib/db";

type AdvisorAction = "create_thesis" | "watchlist" | "remind" | "ignore";

interface AdvisorCardPayload {
  id?: string;
  category?: string;
  priority?: string;
  title?: string;
  tickers?: string[];
  summary?: string;
  suggested_action?: string;
  confidence?: string;
  evidence?: unknown[];
  guardrails?: string[];
}

const ACTION_LABEL: Record<AdvisorAction, string> = {
  create_thesis: "生成 thesis",
  watchlist: "加入 watchlist",
  remind: "稍后提醒",
  ignore: "忽略",
};

function isAction(value: string): value is AdvisorAction {
  return ["create_thesis", "watchlist", "remind", "ignore"].includes(value);
}

function ensureAdvisorSchema(db: ReturnType<typeof getWriteDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS advisor_reminders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id       TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL,
      due_at        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      card_json     TEXT NOT NULL,
      note          TEXT,
      completed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS advisor_reminders_due ON advisor_reminders(status, due_at);
  `);
}

function cleanCard(value: unknown): AdvisorCardPayload {
  const card = value && typeof value === "object" ? value as AdvisorCardPayload : {};
  return {
    id: String(card.id || "").slice(0, 120),
    category: String(card.category || "").slice(0, 80),
    priority: String(card.priority || "low").slice(0, 20),
    title: String(card.title || "").slice(0, 240),
    tickers: Array.isArray(card.tickers) ? card.tickers.map((t) => String(t).toUpperCase()).filter(Boolean).slice(0, 8) : [],
    summary: String(card.summary || "").slice(0, 1200),
    suggested_action: String(card.suggested_action || "").slice(0, 1200),
    confidence: String(card.confidence || "low").slice(0, 20),
    evidence: Array.isArray(card.evidence) ? card.evidence.slice(0, 8) : [],
    guardrails: Array.isArray(card.guardrails) ? card.guardrails.map(String).slice(0, 4) : [],
  };
}

function confidenceScore(value: string | undefined) {
  if (value === "high") return 4;
  if (value === "medium") return 3;
  return 2;
}

function parseWatchlist(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v).toUpperCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function upsertWatchlist(db: ReturnType<typeof getWriteDb>, tickers: string[]) {
  if (tickers.length === 0) return [];
  const row = db.prepare("SELECT value FROM rules WHERE key='advisor_watchlist'").get() as { value?: string } | undefined;
  const next = [...new Set([...parseWatchlist(row?.value), ...tickers])].sort();
  db.prepare(
    "INSERT INTO rules (key, value) VALUES ('advisor_watchlist', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify(next));
  return next;
}

function upsertJsonArrayRule(db: ReturnType<typeof getWriteDb>, key: string, values: string[]) {
  const row = db.prepare("SELECT value FROM rules WHERE key=?").get(key) as { value?: string } | undefined;
  const existing = parseWatchlist(row?.value);
  const next = [...new Set([...existing, ...values.map((v) => v.toUpperCase()).filter(Boolean)])].sort();
  db.prepare(
    "INSERT INTO rules (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(next));
  return next;
}

function defaultReminderAt() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function reminderAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return defaultReminderAt();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return defaultReminderAt();
  return parsed.toISOString();
}

function reminderCardIds(cardId: string | undefined) {
  const id = String(cardId || "");
  const ids = [id];
  if (id.startsWith("reminder-")) ids.push(id.slice("reminder-".length));
  return [...new Set(ids.filter(Boolean))];
}

export async function POST(req: NextRequest) {
  let body: { action?: string; card?: unknown; remind_at?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const action = String(body.action || "");
  if (!isAction(action)) {
    return NextResponse.json({ error: "Invalid advisor action" }, { status: 400 });
  }

  const card = cleanCard(body.card);
  if (!card.id || !card.title) {
    return NextResponse.json({ error: "Advisor card id/title required" }, { status: 400 });
  }

  try {
    const db = getWriteDb();
    ensureAdvisorSchema(db);
    const now = new Date().toISOString();
    let thesisId: number | null = null;
    let watchlist: string[] | null = null;
    let reminderId: number | null = null;
    let dueAt: string | null = null;

    const tx = db.transaction(() => {
      if (action === "create_thesis") {
        const ticker = card.tickers?.[0];
        if (!ticker) throw new Error("create_thesis requires at least one ticker");
        const info = db.prepare(
          `INSERT INTO theses
             (ticker, structure, direction, opened_at, reason, thesis, bull_case, bear_case, catalysts, exit_conditions, confidence, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        ).run(
          ticker,
          "agent-advisor",
          null,
          now,
          card.title,
          `${card.summary}\n\n建议动作：${card.suggested_action}`,
          "Agent 建议继续验证：档案重复出现、组合相关性、或结构性 Lens 信号。",
          "反证条件：价格反馈透支、原 thesis 被破坏、组合风险过高，或后续情报不再支持。",
          JSON.stringify(card.tickers || []),
          "用户复核后决定是否保留；不得自动交易。",
          confidenceScore(card.confidence),
        );
        thesisId = Number(info.lastInsertRowid);
        upsertJsonArrayRule(db, "advisor_resolved_cards", [card.id || ""]);
        for (const id of reminderCardIds(card.id)) {
          db.prepare("UPDATE advisor_reminders SET status='done', completed_at=? WHERE card_id=? AND status='pending'").run(now, id);
        }
      }

      if (action === "watchlist") {
        watchlist = upsertWatchlist(db, card.tickers || []);
      }

      if (action === "ignore") {
        upsertJsonArrayRule(db, "advisor_ignored_cards", [card.id || ""]);
        for (const id of reminderCardIds(card.id)) {
          db.prepare("UPDATE advisor_reminders SET status='dismissed', completed_at=? WHERE card_id=? AND status='pending'").run(now, id);
        }
      }

      if (action === "remind") {
        dueAt = reminderAt(body.remind_at);
        const info = db.prepare(
          `INSERT INTO advisor_reminders
             (card_id, created_at, due_at, status, card_json, note)
           VALUES (?, ?, ?, 'pending', ?, ?)
           ON CONFLICT(card_id) DO UPDATE SET
             due_at=excluded.due_at,
             status='pending',
             card_json=excluded.card_json,
             note=excluded.note,
             completed_at=NULL`,
        ).run(card.id, now, dueAt, JSON.stringify(card), "用户选择稍后提醒");
        const row = db.prepare("SELECT id FROM advisor_reminders WHERE card_id=?").get(card.id) as { id?: number } | undefined;
        reminderId = Number(row?.id || info.lastInsertRowid);
        upsertJsonArrayRule(db, "advisor_reminder_cards", [card.id || ""]);
      }

      const outcome =
        action === "create_thesis" ? `created thesis ${thesisId}` :
        action === "watchlist" ? `watchlist=${(watchlist || []).join(",")}` :
        action === "remind" ? `reminder ${reminderId} due_at=${dueAt}` :
        "ignored by user";

      const recommendation = {
        type: "advisor_card_action",
        action,
        action_label: ACTION_LABEL[action],
        card,
        remind_at: dueAt,
      };

      db.prepare(
        "INSERT INTO decisions (ts, thesis_id, agent, recommendation, user_action, outcome) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(now, thesisId, "advisor", JSON.stringify(recommendation), action, outcome);
    });

    tx();
    return NextResponse.json({
      ok: true,
      action,
      action_label: ACTION_LABEL[action],
      thesis_id: thesisId,
      watchlist,
      reminder_id: reminderId,
      due_at: dueAt,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "advisor action failed" }, { status: 500 });
  }
}
