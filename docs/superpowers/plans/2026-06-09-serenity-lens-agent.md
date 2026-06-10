# Serenity Lens Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Serenity-inspired research framework agent, expose it to the orchestrator and dashboard, and render a polished Chinese lens console on `/intel`.

**Architecture:** Implement a pure local Python lens module that reads `intel_items`, scores the query across six research dimensions, and returns structured JSON. Register it as an orchestrator tool, then add a Next.js API bridge and React UI panel.

**Tech Stack:** Python 3.13, SQLite via existing `journal_store`, pytest, Next.js App Router, React, Tailwind v4.

---

### Task 1: Core Serenity Lens Agent

**Files:**
- Create: `agent/agents/serenity_lens.py`
- Test: `tests/test_serenity_lens.py`

- [ ] Write failing tests for structured output, ticker evidence, and low-confidence behavior.
- [ ] Run `python3 -m pytest -q tests/test_serenity_lens.py` and confirm import failure.
- [ ] Implement `analyze(query, ticker=None, limit=80)` with local SQLite reads, theme scoring, evidence extraction, and Chinese output.
- [ ] Run `python3 -m pytest -q tests/test_serenity_lens.py` and confirm pass.

### Task 2: Tool Registry Integration

**Files:**
- Modify: `agent/tool_registry.py`
- Modify: `tests/test_tool_registry.py`

- [ ] Update registry test expected tool names with `analyze_serenity_lens`.
- [ ] Run `python3 -m pytest -q tests/test_tool_registry.py` and confirm failure.
- [ ] Add handler and JSON schema for the new tool.
- [ ] Run `python3 -m pytest -q tests/test_tool_registry.py`.

### Task 3: Dashboard API Bridge

**Files:**
- Create: `agent/loops/serenity_lens_cli.py`
- Create: `dashboard/app/api/intel/lens/route.ts`
- Test: `tests/test_serenity_lens.py`

- [ ] Add CLI test via direct function behavior rather than shelling out.
- [ ] Implement stdin/stdout JSON CLI around `serenity_lens.analyze`.
- [ ] Implement Next.js route that calls the CLI with `execFileSync`, fixed argv, JSON via stdin.

### Task 4: Intel Page Lens Console

**Files:**
- Modify: `dashboard/app/intel/page.tsx`
- Modify: `dashboard/lib/intel.ts` only if additional ticker metadata is needed.

- [ ] Add TypeScript interfaces for lens response.
- [ ] Add state/query/run handler.
- [ ] Render the console above the feed with framework tiles, evidence stack,反证条件, and action fit.
- [ ] Keep all labels Chinese except ticker symbols.

### Task 5: Verification and Worklog

**Files:**
- Modify: `WORKLOG.md`

- [ ] Run `python3 -m pytest -q`.
- [ ] Run `cd dashboard && npx tsc --noEmit`.
- [ ] Run `cd dashboard && npm run lint`.
- [ ] If a dev server is running, verify `/intel`; otherwise start one and inspect.
- [ ] Add a `[0.10.8]` worklog entry with files changed, behavior, and verification results.

