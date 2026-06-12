CREATE TABLE IF NOT EXISTS theses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL,
  structure       TEXT,
  direction       TEXT,
  opened_at       TEXT NOT NULL,
  reason          TEXT,
  thesis          TEXT,
  bull_case       TEXT,
  bear_case       TEXT,
  catalysts       TEXT,
  iv_snapshot     TEXT,
  exit_conditions TEXT,
  confidence      INTEGER,
  status          TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  thesis_id       INTEGER REFERENCES theses(id),
  agent           TEXT,
  recommendation  TEXT,
  user_action     TEXT,
  outcome         TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  positions_json  TEXT,
  net_delta       REAL,
  net_vega        REAL,
  realized_pnl    REAL
);

CREATE TABLE IF NOT EXISTS rules (
  key             TEXT PRIMARY KEY,
  value           TEXT
);

CREATE TABLE IF NOT EXISTS alert_state (
  rule            TEXT PRIMARY KEY,
  last_fired_at   TEXT
);

-- historical trades imported from IBKR Flex XML
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id        TEXT UNIQUE NOT NULL,   -- IBKR tradeID (dedup key)
  order_id        TEXT,                   -- ibOrderID (multiple executions → same order)
  asset_category  TEXT,                   -- STK / OPT
  symbol          TEXT NOT NULL,          -- e.g. AAPL or AAOI  260515P00145000
  underlying      TEXT,                   -- underlying ticker
  put_call        TEXT,                   -- P / C / null
  strike          REAL,
  expiry          TEXT,                   -- YYYY-MM-DD
  multiplier      INTEGER DEFAULT 1,
  trade_date      TEXT NOT NULL,          -- YYYY-MM-DD
  trade_time      TEXT,                   -- HH:MM:SS ET
  buy_sell        TEXT NOT NULL,          -- BUY / SELL
  quantity        REAL NOT NULL,
  trade_price     REAL NOT NULL,
  proceeds        REAL,                   -- positive = received cash
  commission      REAL,
  net_cash        REAL,
  fifo_pnl        REAL,                   -- fifoPnlRealized from Flex
  mtm_pnl         REAL,
  notes           TEXT,
  imported_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trades_symbol ON trades(underlying, trade_date);
CREATE INDEX IF NOT EXISTS trades_date ON trades(trade_date);

-- market-intelligence captures; append-only by design so manual and automated
-- captures are never lost even when they point to the same URL.
CREATE TABLE IF NOT EXISTS intel_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at         TEXT NOT NULL,
  source              TEXT NOT NULL,
  source_handle       TEXT,
  external_id         TEXT,
  capture_method      TEXT NOT NULL,       -- manual / browser / file / clipboard
  item_ts             TEXT,
  url                 TEXT,
  title               TEXT,
  media_path          TEXT,
  media_mime          TEXT,
  media_name          TEXT,
  ocr_text            TEXT,
  raw_text            TEXT NOT NULL,
  summary             TEXT,
  related_tickers     TEXT,                -- JSON array
  portfolio_overlap   TEXT,                -- JSON array
  impact_direction    TEXT,                -- bullish / bearish / uncertain
  urgency             TEXT,                -- low / watch / alert
  rationale           TEXT,
  ticker_snapshot     TEXT,                -- JSON object keyed by ticker
  raw_payload         TEXT                 -- JSON object, optional source metadata
);

CREATE INDEX IF NOT EXISTS intel_items_captured_at ON intel_items(captured_at);
CREATE INDEX IF NOT EXISTS intel_items_source ON intel_items(source, source_handle);

-- daily market prices used to audit Serenity post-date performance. Prices are
-- cached by symbol/date so backfills can be resumed without losing provenance.
CREATE TABLE IF NOT EXISTS market_daily_prices (
  symbol              TEXT NOT NULL,
  price_date          TEXT NOT NULL,       -- YYYY-MM-DD
  close               REAL NOT NULL,
  currency            TEXT,
  source              TEXT NOT NULL,
  fetched_at          TEXT NOT NULL,
  PRIMARY KEY(symbol, price_date, source)
);

CREATE INDEX IF NOT EXISTS market_daily_prices_symbol_date ON market_daily_prices(symbol, price_date);

-- resumable browser collection ledger for long-running X archive backfills.
CREATE TABLE IF NOT EXISTS intel_collection_windows (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_handle       TEXT NOT NULL,
  window_start        TEXT NOT NULL,
  window_end          TEXT NOT NULL,
  status              TEXT NOT NULL,       -- pending / running / done / failed
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

-- advisor reminders created from proactive advice cards. Reminders are not
-- trade instructions; they re-surface a card for user review after due_at.
CREATE TABLE IF NOT EXISTS advisor_reminders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id             TEXT NOT NULL UNIQUE,
  created_at          TEXT NOT NULL,
  due_at              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending / done / dismissed
  card_json           TEXT NOT NULL,
  note                TEXT,
  completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS advisor_reminders_due ON advisor_reminders(status, due_at);

-- portfolio risk snapshots (§4.1: 定时快照入库，不能只保存在浏览器状态中)。
-- Written by the dashboard on live portfolio builds, throttled to ≥10 min.
CREATE TABLE IF NOT EXISTS risk_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,           -- ISO UTC
  net_delta       REAL,
  net_gamma       REAL,
  net_vega        REAL,
  net_theta       REAL,
  net_usd         REAL,
  gross_usd       REAL,
  max_single_pct  REAL,                    -- largest underlying % of gross
  greeks_estimated INTEGER DEFAULT 0,      -- 1 = BS-model fallback, not IBKR
  source          TEXT NOT NULL DEFAULT 'dashboard'
);

CREATE INDEX IF NOT EXISTS risk_history_ts ON risk_history(ts);

-- seed rules (INSERT OR IGNORE = idempotent)
INSERT OR IGNORE INTO rules (key, value) VALUES ('max_single_pct', '30');
INSERT OR IGNORE INTO rules (key, value) VALUES ('max_rolls', '2');
INSERT OR IGNORE INTO rules (key, value) VALUES ('block_earnings_within_days', '2');
INSERT OR IGNORE INTO rules (key, value) VALUES ('max_trades_per_day', '3');
-- IBKR data cache TTL in seconds (0 = real-time / no cache). Editable from the dashboard.
INSERT OR IGNORE INTO rules (key, value) VALUES ('ibkr_cache_ttl', '60');
