import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.TRADEMIND_DB ||
  path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent/agent/db/trademind.db");

let _db: Database.Database | null = null;
let _writeDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH, { readonly: true });
  }
  return _db;
}

// Writable connection for the few user-driven mutations the dashboard owns
// (thesis create/status, guardrail rule edits). WAL is already enabled by the
// Python layer, so this coexists with concurrent reads/writes.
export function getWriteDb(): Database.Database {
  if (!_writeDb) {
    _writeDb = new Database(DB_PATH);
    _writeDb.pragma("journal_mode = WAL");
    _writeDb.pragma("foreign_keys = ON");
  }
  return _writeDb;
}
