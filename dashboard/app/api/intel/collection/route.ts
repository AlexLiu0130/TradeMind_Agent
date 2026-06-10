import { getDb, getWriteDb } from "@/lib/db";
import { NextResponse } from "next/server";

function ensureCollectionSchema(db: ReturnType<typeof getWriteDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intel_collection_windows (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_handle       TEXT NOT NULL,
      window_start        TEXT NOT NULL,
      window_end          TEXT NOT NULL,
      status              TEXT NOT NULL,
      found_count         INTEGER NOT NULL DEFAULT 0,
      inserted_count      INTEGER NOT NULL DEFAULT 0,
      duplicate_count     INTEGER NOT NULL DEFAULT 0,
      rejected_count      INTEGER NOT NULL DEFAULT 0,
      started_at          TEXT,
      completed_at        TEXT,
      last_error          TEXT,
      notes               TEXT,
      updated_at          TEXT NOT NULL,
      UNIQUE(source_handle, window_start, window_end)
    );
    CREATE INDEX IF NOT EXISTS intel_collection_windows_status ON intel_collection_windows(status, window_start);
  `);
}

export async function GET() {
  ensureCollectionSchema(getWriteDb());
  const db = getDb();
  const total = db.prepare("SELECT COUNT(*) AS n FROM intel_items").get() as { n: number };
  const duplicateIds = db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT external_id FROM intel_items
      WHERE external_id IS NOT NULL AND external_id != ''
      GROUP BY external_id HAVING COUNT(*) > 1
    )
  `).get() as { n: number };
  const garbage = db.prepare(`
    SELECT COUNT(*) AS n FROM intel_items
    WHERE raw_text LIKE 'debug=true&log=%'
       OR raw_text LIKE 'category=perftown%'
       OR raw_text LIKE 'sub_topics=%'
  `).get() as { n: number };
  const range = db.prepare(`
    SELECT MIN(item_ts) AS earliest, MAX(item_ts) AS latest
    FROM intel_items
    WHERE source_handle='aleabitoreddit' AND item_ts IS NOT NULL
  `).get() as { earliest: string | null; latest: string | null };
  const windows = db.prepare(`
    SELECT * FROM intel_collection_windows
    WHERE source_handle='aleabitoreddit'
    ORDER BY window_start DESC
    LIMIT 120
  `).all();
  return NextResponse.json({
    total: total.n,
    duplicate_external_ids: duplicateIds.n,
    garbage_rows: garbage.n,
    earliest: range.earliest,
    latest: range.latest,
    windows,
  });
}
