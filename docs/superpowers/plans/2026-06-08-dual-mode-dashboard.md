# Dual Mode Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the daily trading cockpit layer and a separate showcase mode while preserving the existing Terminal Instrument visual system.

**Architecture:** Keep the current Next.js dashboard as the cockpit. Add small, focused API routes for cockpit signals, alerts, and wheel data; add pages for Wheel, Alerts, and Showcase; enhance Portfolio with a top attention strip derived from the live positions response.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 theme tokens, Recharts where already used, better-sqlite3, existing IBKR CLI scripts via `execFileSync`.

---

### Task 1: Shared Cockpit Signals

**Files:**
- Create: `dashboard/lib/cockpit.ts`
- Modify: `dashboard/app/page.tsx`

- [ ] Add pure helpers that derive attention signals from `positions`, `portfolio_greeks`, and `exposure`.
- [ ] Surface four signals on Portfolio: today focus, largest drag, options watch, and data state.
- [ ] Keep the existing KPI cards, Market Exposure, Greeks, chart, table, and P&L history intact.

### Task 2: Wheel Page

**Files:**
- Create: `dashboard/app/api/wheel/route.ts`
- Create: `dashboard/app/wheel/page.tsx`
- Modify: `dashboard/components/Nav.tsx`

- [ ] Add a read-only API route that tries `wheel_tracker.py summary --output json`, then falls back to deriving option watch cards from `/api/positions` style data if the script is unavailable.
- [ ] Build `/wheel` as dense terminal cards: phase, ticker, strike, expiry, DTE, moneyness, IV, delta, unrealized P&L, and risk status.
- [ ] Add `Wheel` to the navigation.

### Task 3: Alerts Page

**Files:**
- Create: `dashboard/app/api/alerts/route.ts`
- Create: `dashboard/app/alerts/page.tsx`
- Modify: `dashboard/components/Nav.tsx`

- [ ] Read `alert_state` and editable `rules` from SQLite.
- [ ] Show active/recent/quiet rules with severity, last fired time, linked rule value, and suggested operator action.
- [ ] Add `Alerts` to the navigation.

### Task 4: Showcase Mode

**Files:**
- Create: `dashboard/app/showcase/page.tsx`
- Modify: `dashboard/components/Nav.tsx`

- [ ] Add a single `/showcase` route that explains the Agent system using the same panel language.
- [ ] Include demo flow, architecture, memory model, guardrail checks, and explicit safety/privacy boundaries.
- [ ] Add `Showcase` to the navigation without turning the main app into a landing page.

### Task 5: Worklog And Verification

**Files:**
- Modify: `WORKLOG.md`

- [ ] Add a new top entry summarizing user-visible changes, files changed, and verification.
- [ ] Run `npx tsc --noEmit`, `npm run lint`, and relevant Python tests if backend logic changed.
- [ ] Visually inspect Portfolio, Wheel, Alerts, Showcase, and mobile-ish width for obvious overflow.

### Self-Review

- Spec coverage: covers cockpit enhancement, Wheel, Alerts, Showcase, navigation, and worklog.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: API objects are intentionally dashboard-local and will be typed in each component or shared helper.
