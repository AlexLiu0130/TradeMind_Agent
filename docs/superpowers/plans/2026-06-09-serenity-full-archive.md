# Serenity Full Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect all accessible Serenity X posts into SQLite with resumable progress, deduplication, validation, and worklog evidence.

**Architecture:** Use Chrome DOM collection for the authenticated X surface and SQLite as the durable source of truth. Add collection window/run tracking tables, a Python storage/import utility that rejects junk and duplicate rows, and dashboard/API visibility for archive coverage. Browser automation writes clean batches to JSON; Python imports batches idempotently.

**Tech Stack:** SQLite, Python, pytest, Next.js, TypeScript, Chrome extension browser control.

---

### Task 1: Durable Storage and Tests

**Files:**
- Modify: `agent/db/schema.sql`
- Modify: `agent/journal_store.py`
- Modify: `tests/test_journal_store.py`
- Create: `agent/serenity_archive.py`
- Create: `tests/test_serenity_archive.py`

- [ ] Add failing tests for collection window roundtrip, post-batch dedupe, and telemetry rejection.
- [ ] Add `intel_collection_windows` table and journal helpers.
- [ ] Add an idempotent Serenity archive importer.
- [ ] Run targeted tests.

### Task 2: Archive Status API and UI

**Files:**
- Create: `dashboard/app/api/intel/collection/route.ts`
- Modify: `dashboard/app/intel/page.tsx`

- [ ] Add API returning total count, duplicate count, garbage count, earliest/latest post, and collection windows.
- [ ] Add `/intel` collection status panel in Chinese.
- [ ] Run TypeScript and lint.

### Task 3: Browser Collection Runner

**Files:**
- Create: `agent/loops/serenity_archive_import.py`
- Runtime artifact: `agent/db/serenity_batches/*.json`

- [ ] Add CLI that imports a JSON batch into SQLite through `serenity_archive`.
- [ ] Use Chrome to search or scroll Serenity timelines by date windows.
- [ ] Save each browser batch to `agent/db/serenity_batches/`.
- [ ] Import each batch idempotently and update window status.

### Task 4: Full Backfill and Verification

**Files:**
- Modify: `WORKLOG.md`

- [ ] Continue date-window collection until all accessible posts are covered or X stops returning older posts.
- [ ] Verify no duplicate `external_id`.
- [ ] Verify no telemetry/debug garbage.
- [ ] Verify archive count and covered date range.
- [ ] Run full tests/build.
- [ ] Record final work diary.
