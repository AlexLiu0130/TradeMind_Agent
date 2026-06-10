import { getDb, getWriteDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  let theses: unknown[] = [];
  try {
    theses = db.prepare("SELECT * FROM theses ORDER BY opened_at DESC").all();
  } catch {
    // theses table may be empty
  }
  return NextResponse.json({ theses });
}

// Create a new thesis. Mirrors journal_store.create_thesis (the canonical Python
// writer) for the subset of columns the dashboard form exposes.
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const ticker = String(b.ticker || "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const conf = b.confidence == null ? null : Number(b.confidence);
  const str = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  };

  try {
    const db = getWriteDb();
    const info = db
      .prepare(
        `INSERT INTO theses
           (ticker, structure, direction, opened_at, thesis, bull_case, bear_case, exit_conditions, confidence, status)
         VALUES (?,?,?,?,?,?,?,?,?,'open')`,
      )
      .run(
        ticker,
        str(b.structure),
        str(b.direction),
        new Date().toISOString(),
        str(b.thesis),
        str(b.bull_case),
        str(b.bear_case),
        str(b.exit_conditions),
        conf != null && !Number.isNaN(conf) ? conf : null,
      );
    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Update a thesis status (open / closed / invalidated).
export async function PATCH(req: NextRequest) {
  let b: { id?: number; status?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const allowed = ["open", "closed", "invalidated"];
  if (!b.id || !b.status || !allowed.includes(b.status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  try {
    const db = getWriteDb();
    const info = db.prepare("UPDATE theses SET status=? WHERE id=?").run(b.status, b.id);
    if (info.changes === 0) {
      return NextResponse.json({ error: "thesis not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
