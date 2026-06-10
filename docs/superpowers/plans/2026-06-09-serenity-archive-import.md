# Serenity Archive Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/intel` into a Chinese Serenity archive with browser-data import, append-only storage, ticker extraction, sector labels, and performance display.

**Architecture:** Add a pure import parser under `dashboard/lib`, a bulk import API route, a small DB schema extension for `external_id`, and a redesigned Chinese archive UI. Reuse the existing quote snapshot and media-serving paths where possible.

**Tech Stack:** Next.js App Router, React, TypeScript, better-sqlite3, SQLite, Node built-in test runner, pytest.

---

### Task 1: Storage Field

**Files:**
- Modify: `agent/db/schema.sql`
- Modify: `agent/journal_store.py`
- Modify: `tests/test_journal_store.py`
- Modify: `dashboard/app/api/intel/route.ts`

- [x] Add failing Python test for `external_id` roundtrip.
- [x] Add `external_id` to schema and journal store allowlist.
- [x] Add route migration for `external_id`.
- [x] Run targeted pytest.

### Task 2: Import Parser

**Files:**
- Create: `dashboard/lib/intelImport.ts`
- Create: `dashboard/lib/intelImport.test.ts`

- [x] Add failing Node test for HAR/JSON extraction and plain text splitting.
- [x] Implement recursive extraction for tweet-like objects.
- [x] Run Node test.

### Task 3: Bulk Import API

**Files:**
- Create: `dashboard/app/api/intel/import/route.ts`
- Modify: `dashboard/app/api/intel/route.ts`
- Modify: `dashboard/lib/intel.ts`

- [x] Accept multipart and JSON import payloads.
- [x] Insert every extracted item append-only with `capture_method = "browser-import"`.
- [x] Return inserted/skipped counts and parsed post preview.
- [x] Add Chinese ticker sector metadata.

### Task 4: Chinese Archive UI

**Files:**
- Replace: `dashboard/app/intel/page.tsx`

- [x] Add upload/import panel and browser export guide.
- [x] Render archive feed sorted by post time.
- [x] Render Chinese analysis, ticker chips, sector labels, and performance rail.
- [x] Keep manual screenshot/text capture available.

### Task 5: Verification and Diary

**Files:**
- Modify: `WORKLOG.md`

- [x] Run Python tests.
- [x] Run TypeScript check.
- [x] Run lint.
- [x] Run production build.
- [x] Browser-check `/intel`.
- [x] Record the work diary entry.
