# Serenity Feed Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/intel` into a Twitter-like Serenity feed with screenshot upload persistence, post dates, media preview, OCR/manual text fallback, and a ticker performance rail.

**Architecture:** Keep `intel_items` as the append-only store. Extend it with post timestamp, media path/mime/name, OCR text, and ticker snapshot JSON. `/api/intel` accepts JSON and multipart form submissions, saves uploaded media locally, analyzes combined OCR/manual text, and returns feed items. The UI becomes a two-column feed: tweet-style cards plus ticker impact rail.

**Tech Stack:** Next.js App Router route handlers with `request.formData()`, SQLite/better-sqlite3, existing Tailwind v4 terminal theme, Python journal_store tests for schema roundtrip.

---

### Task 1: Schema And Storage

**Files:**
- Modify: `agent/db/schema.sql`
- Modify: `agent/journal_store.py`
- Modify: `tests/test_journal_store.py`

- [x] Add media and ticker snapshot fields to `intel_items`.
- [x] Add journal_store JSON roundtrip for `ticker_snapshot`.
- [x] Verify tests fail before implementation and pass after.

### Task 2: API Upload And Analysis

**Files:**
- Modify: `dashboard/app/api/intel/route.ts`
- Modify: `dashboard/lib/intel.ts`

- [x] Accept both JSON and multipart form uploads.
- [x] Save uploaded screenshots under `agent/db/intel_media`.
- [x] Store media metadata and optional OCR/manual text.
- [x] Derive ticker performance snapshots from current quote data when possible, otherwise return pending baseline state.

### Task 3: Twitter-Like Intel UI

**Files:**
- Replace: `dashboard/app/intel/page.tsx`

- [x] Convert capture area into a compact top composer.
- [x] Render Serenity cards with avatar, display name, handle, post date, captured date, text, media preview, and analysis.
- [x] Render a right-side Ticker Impact rail with related tickers, portfolio overlap, current/baseline/since-capture state.

### Task 4: Verification And Worklog

- [x] Run Python tests.
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Browser-check `/intel`.
- [x] Update `WORKLOG.md`.
