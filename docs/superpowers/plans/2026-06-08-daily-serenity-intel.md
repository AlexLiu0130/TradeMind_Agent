# Daily Serenity Intel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable Daily Serenity Brief that stores every manually uploaded or future automatically captured item in SQLite and maps it to relevant tickers.

**Architecture:** Use an append-only `intel_items` table as the shared source of truth. Dashboard `/api/intel` handles manual capture and deterministic analysis; `/intel` renders capture UI and feed. Python `daily_serenity_brief` provides a daily loop ingestion path without requiring X API access.

**Tech Stack:** SQLite, Python stdlib, Next.js App Router, better-sqlite3, Tailwind v4 terminal design tokens.

---

### Task 1: Persistent Storage

**Files:**
- Modify: `agent/db/schema.sql`
- Modify: `agent/journal_store.py`
- Modify: `tests/test_journal_store.py`

- [x] Add `intel_items` append-only table.
- [x] Add `create_intel_item` and `list_intel_items`.
- [x] Add tests for JSON roundtrip and duplicate URL append behavior.

### Task 2: Dashboard API

**Files:**
- Create: `dashboard/lib/intel.ts`
- Create: `dashboard/app/api/intel/route.ts`

- [x] Add deterministic ticker/keyword analysis.
- [x] Add GET feed endpoint.
- [x] Add POST capture endpoint that always inserts a new row.
- [x] Ensure schema exists from the API so existing local DBs migrate safely.

### Task 3: Intel UI

**Files:**
- Create: `dashboard/app/intel/page.tsx`
- Modify: `dashboard/components/Nav.tsx`

- [x] Add `Intel` nav link.
- [x] Build capture form and feed using existing Terminal Instrument visual language.
- [x] Show urgency, direction, related tickers, portfolio overlap, rationale, and raw capture.

### Task 4: Daily Loop

**Files:**
- Create: `agent/loops/daily_serenity_brief.py`

- [x] Add manual-first daily ingestion from `--text`, `--file`, or `--stdin`.
- [x] Use the same append-only DB path and analysis rules.

### Task 5: Verification

- [x] Watch targeted intel storage tests fail before implementation.
- [x] Watch targeted intel storage tests pass after implementation.
- [x] Verify `/intel` renders in browser and feed reflects stored captures.
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Update `WORKLOG.md`.
