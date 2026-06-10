import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

_DB_PATH: str | None = None

# ── init ──────────────────────────────────────────────────────────────────────

def init_db(db_path: str) -> None:
    global _DB_PATH
    _DB_PATH = db_path
    schema = Path(__file__).parent / "db" / "schema.sql"
    with _conn() as con:
        con.executescript(schema.read_text())


def _conn() -> sqlite3.Connection:
    if not _DB_PATH:
        raise RuntimeError("Call init_db() first")
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _loads(v):
    """Parse JSON field. Raises JSONDecodeError on corrupt data (fail loudly)."""
    if v is None:
        return None
    return json.loads(v)


def _dumps(v):
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v)


# ── theses ────────────────────────────────────────────────────────────────────

_THESIS_COLUMNS = frozenset({
    "ticker", "structure", "direction", "opened_at", "reason",
    "thesis", "bull_case", "bear_case", "catalysts", "iv_snapshot",
    "exit_conditions", "confidence", "status",
})

_JSON_THESIS_FIELDS = {"iv_snapshot", "catalysts"}


def create_thesis(**fields) -> int:
    unknown = set(fields) - _THESIS_COLUMNS
    if unknown:
        raise ValueError(f"Unknown thesis field(s): {unknown}")
    fields.setdefault("opened_at", _now())
    for f in _JSON_THESIS_FIELDS:
        if f in fields:
            fields[f] = _dumps(fields[f])
    cols = ", ".join(fields)
    placeholders = ", ".join("?" * len(fields))
    with _conn() as con:
        cur = con.execute(
            f"INSERT INTO theses ({cols}) VALUES ({placeholders})",
            list(fields.values()),
        )
        return cur.lastrowid


def get_thesis(thesis_id: int) -> dict | None:
    with _conn() as con:
        row = con.execute("SELECT * FROM theses WHERE id=?", (thesis_id,)).fetchone()
    if row is None:
        return None
    d = dict(row)
    for f in _JSON_THESIS_FIELDS:
        d[f] = _loads(d[f])
    return d


def list_theses(status: str | None = None, ticker: str | None = None) -> list[dict]:
    sql = "SELECT * FROM theses WHERE 1=1"
    params: list = []
    if status:
        sql += " AND status=?"
        params.append(status)
    if ticker:
        sql += " AND ticker=?"
        params.append(ticker)
    sql += " ORDER BY opened_at DESC"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        for f in _JSON_THESIS_FIELDS:
            d[f] = _loads(d[f])
        result.append(d)
    return result


def update_thesis_status(thesis_id: int, status: str) -> None:
    with _conn() as con:
        con.execute("UPDATE theses SET status=? WHERE id=?", (status, thesis_id))


# ── decisions ─────────────────────────────────────────────────────────────────

def log_decision(
    thesis_id: int | None,
    agent: str,
    recommendation: str,
    user_action: str | None = None,
) -> int:
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO decisions (ts, thesis_id, agent, recommendation, user_action)"
            " VALUES (?,?,?,?,?)",
            (_now(), thesis_id, agent, recommendation, user_action),
        )
        return cur.lastrowid


def update_decision_outcome(decision_id: int, user_action: str, outcome: str) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE decisions SET user_action=?, outcome=? WHERE id=?",
            (user_action, outcome, decision_id),
        )


def list_decisions(
    since: str | None = None, thesis_id: int | None = None
) -> list[dict]:
    sql = "SELECT * FROM decisions WHERE 1=1"
    params: list = []
    if since:
        sql += " AND ts>=?"
        params.append(since)
    if thesis_id is not None:
        sql += " AND thesis_id=?"
        params.append(thesis_id)
    sql += " ORDER BY ts DESC"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── snapshots ─────────────────────────────────────────────────────────────────

def save_snapshot(
    positions_json,
    net_delta: float,
    net_vega: float,
    realized_pnl: float,
) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO snapshots (ts, positions_json, net_delta, net_vega, realized_pnl)"
            " VALUES (?,?,?,?,?)",
            (_now(), _dumps(positions_json), net_delta, net_vega, realized_pnl),
        )


def list_snapshots(since: str | None = None) -> list[dict]:
    sql = "SELECT * FROM snapshots"
    params: list = []
    if since:
        sql += " WHERE ts>=?"
        params.append(since)
    sql += " ORDER BY ts DESC"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["positions_json"] = _loads(d["positions_json"])
        result.append(d)
    return result


# ── rules ─────────────────────────────────────────────────────────────────────

def get_rule(key: str, default=None):
    with _conn() as con:
        row = con.execute("SELECT value FROM rules WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_rule(key: str, value) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO rules (key, value) VALUES (?,?)"
            " ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )


def all_rules() -> dict:
    with _conn() as con:
        rows = con.execute("SELECT key, value FROM rules").fetchall()
    return {r["key"]: r["value"] for r in rows}


# ── alert dedupe ──────────────────────────────────────────────────────────────

def should_fire(rule: str, cooldown_minutes: int) -> bool:
    """
    Atomically checks cooldown and updates last_fired_at in a single SQL statement.
    Returns True if the alert should fire (cooldown elapsed or first occurrence).
    Safe for single-process use; multi-process use requires external locking.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    with _conn() as con:
        cur = con.execute(
            """
            INSERT INTO alert_state (rule, last_fired_at) VALUES (?, ?)
            ON CONFLICT(rule) DO UPDATE
              SET last_fired_at = excluded.last_fired_at
              WHERE (
                last_fired_at IS NULL
                OR (julianday(?) - julianday(last_fired_at)) * 1440 >= ?
              )
            """,
            (rule, now_iso, now_iso, cooldown_minutes),
        )
    return cur.rowcount > 0


# ── intel items ───────────────────────────────────────────────────────────────

_INTEL_COLUMNS = frozenset({
    "captured_at", "source", "source_handle", "external_id", "capture_method", "item_ts",
    "url", "title", "media_path", "media_mime", "media_name", "ocr_text",
    "raw_text", "summary", "related_tickers",
    "portfolio_overlap", "impact_direction", "urgency", "rationale",
    "ticker_snapshot", "raw_payload",
})

_JSON_INTEL_FIELDS = {"related_tickers", "portfolio_overlap", "ticker_snapshot", "raw_payload"}


def create_intel_item(**fields) -> int:
    unknown = set(fields) - _INTEL_COLUMNS
    if unknown:
        raise ValueError(f"Unknown intel field(s): {unknown}")
    fields.setdefault("captured_at", _now())
    fields.setdefault("capture_method", "manual")
    if not fields.get("source"):
        raise ValueError("source is required")
    if not fields.get("raw_text"):
        raise ValueError("raw_text is required")
    for f in _JSON_INTEL_FIELDS:
        if f in fields:
            fields[f] = _dumps(fields[f])
    cols = ", ".join(fields)
    placeholders = ", ".join("?" * len(fields))
    with _conn() as con:
        cur = con.execute(
            f"INSERT INTO intel_items ({cols}) VALUES ({placeholders})",
            list(fields.values()),
        )
        return cur.lastrowid


def list_intel_items(source: str | None = None, limit: int = 50) -> list[dict]:
    sql = "SELECT * FROM intel_items WHERE 1=1"
    params: list = []
    if source:
        sql += " AND source=?"
        params.append(source)
    sql += " ORDER BY COALESCE(item_ts, captured_at) DESC, id DESC LIMIT ?"
    params.append(limit)
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        for f in _JSON_INTEL_FIELDS:
            d[f] = _loads(d[f])
        result.append(d)
    return result


# ── intel collection windows ─────────────────────────────────────────────────

_WINDOW_COLUMNS = frozenset({
    "source_handle", "window_start", "window_end", "status", "found_count",
    "inserted_count", "duplicate_count", "rejected_count", "started_at",
    "completed_at", "last_error", "notes", "updated_at",
})


def upsert_intel_collection_window(**fields) -> int:
    unknown = set(fields) - _WINDOW_COLUMNS
    if unknown:
        raise ValueError(f"Unknown collection window field(s): {unknown}")
    for required in ("source_handle", "window_start", "window_end", "status"):
        if not fields.get(required):
            raise ValueError(f"{required} is required")
    fields.setdefault("found_count", 0)
    fields.setdefault("inserted_count", 0)
    fields.setdefault("duplicate_count", 0)
    fields.setdefault("rejected_count", 0)
    fields["updated_at"] = fields.get("updated_at") or _now()
    with _conn() as con:
        cur = con.execute(
            """
            INSERT INTO intel_collection_windows
              (source_handle, window_start, window_end, status, found_count,
               inserted_count, duplicate_count, rejected_count, started_at,
               completed_at, last_error, notes, updated_at)
            VALUES
              (:source_handle, :window_start, :window_end, :status, :found_count,
               :inserted_count, :duplicate_count, :rejected_count, :started_at,
               :completed_at, :last_error, :notes, :updated_at)
            ON CONFLICT(source_handle, window_start, window_end) DO UPDATE SET
              status=excluded.status,
              found_count=excluded.found_count,
              inserted_count=excluded.inserted_count,
              duplicate_count=excluded.duplicate_count,
              rejected_count=excluded.rejected_count,
              started_at=COALESCE(excluded.started_at, intel_collection_windows.started_at),
              completed_at=excluded.completed_at,
              last_error=excluded.last_error,
              notes=excluded.notes,
              updated_at=excluded.updated_at
            """,
            {
                "source_handle": fields["source_handle"],
                "window_start": fields["window_start"],
                "window_end": fields["window_end"],
                "status": fields["status"],
                "found_count": fields.get("found_count", 0),
                "inserted_count": fields.get("inserted_count", 0),
                "duplicate_count": fields.get("duplicate_count", 0),
                "rejected_count": fields.get("rejected_count", 0),
                "started_at": fields.get("started_at"),
                "completed_at": fields.get("completed_at"),
                "last_error": fields.get("last_error"),
                "notes": fields.get("notes"),
                "updated_at": fields["updated_at"],
            },
        )
        row = con.execute(
            "SELECT id FROM intel_collection_windows WHERE source_handle=? AND window_start=? AND window_end=?",
            (fields["source_handle"], fields["window_start"], fields["window_end"]),
        ).fetchone()
        return row["id"] if row else cur.lastrowid


def list_intel_collection_windows(source_handle: str | None = None) -> list[dict]:
    sql = "SELECT * FROM intel_collection_windows WHERE 1=1"
    params: list = []
    if source_handle:
        sql += " AND source_handle=?"
        params.append(source_handle.lstrip("@"))
    sql += " ORDER BY window_start DESC, id DESC"
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


# ── advisor reminders ────────────────────────────────────────────────────────

def upsert_advisor_reminder(
    *,
    card_id: str,
    due_at: str,
    card: dict,
    note: str | None = None,
) -> int:
    now = _now()
    with _conn() as con:
        cur = con.execute(
            """
            INSERT INTO advisor_reminders
              (card_id, created_at, due_at, status, card_json, note)
            VALUES (?, ?, ?, 'pending', ?, ?)
            ON CONFLICT(card_id) DO UPDATE SET
              due_at=excluded.due_at,
              status='pending',
              card_json=excluded.card_json,
              note=excluded.note,
              completed_at=NULL
            """,
            (card_id, now, due_at, _dumps(card), note),
        )
        row = con.execute("SELECT id FROM advisor_reminders WHERE card_id=?", (card_id,)).fetchone()
        return int(row["id"] if row else cur.lastrowid)


def list_advisor_reminders(
    *,
    status: str | None = "pending",
    due_before: str | None = None,
    limit: int = 20,
) -> list[dict]:
    sql = "SELECT * FROM advisor_reminders WHERE 1=1"
    params: list = []
    if status:
        sql += " AND status=?"
        params.append(status)
    if due_before:
        sql += " AND due_at<=?"
        params.append(due_before)
    sql += " ORDER BY due_at ASC, id ASC LIMIT ?"
    params.append(limit)
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["card_json"] = _loads(d["card_json"])
        result.append(d)
    return result


def complete_advisor_reminder(card_id: str, status: str = "done") -> None:
    with _conn() as con:
        con.execute(
            "UPDATE advisor_reminders SET status=?, completed_at=? WHERE card_id=?",
            (status, _now(), card_id),
        )
