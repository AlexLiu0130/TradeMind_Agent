# TradeMind Demo Script

## Goal
Show TradeMind as a practical trading cockpit: live portfolio risk, fast Wheel monitoring, Serenity intel with historical price reaction, and advisory-only agent collaboration.

## Suggested Runtime
2 to 3 minutes.

## Flow

1. Portfolio Cockpit
   - URL: `http://localhost:3000/`
   - Show the global market status bar (SPY/QQQ/SMH/VIX/10Y/DXY), attention strip, KPI cards, Event Timeline (earnings/expiry/intel/risk), and Agent Committee.
   - Scroll to Market Trends (SPY/QQQ/SMH normalized comparison) + Market Regime (6-dimension scoring), then Greeks trend cards with 7D/30D deltas backed by SQLite risk history.
   - Message: TradeMind turns IBKR + market data into a disciplined daily operating screen — market first, then portfolio.

2. Wheel Monitor
   - URL: `http://localhost:3000/wheel`
   - Show option legs, DTE, IV, delta, P&L, and source label.
   - Message: Wheel now reuses the Portfolio cache; repeated loads are near-instant.

3. Serenity Archive
   - URL: `http://localhost:3000/intel`
   - Show 2449 archived posts, collection ledger, Chinese post interpretation, ticker sector labels, and performance since post baseline.
   - Message: Serenity posts are treated as durable project data. Future updates are user-imported.

4. Serenity Lens
   - Stay on `/intel`.
   - Run a ticker such as `MRVL` if the demo needs an active interaction.
   - Message: The lens distills recurring research patterns instead of copying posts.

5. Showcase
   - URL: `http://localhost:3000/showcase`
   - Show the product story: ask, plan, check, decide, remember.
   - Message: Agent can suggest and organize evidence, but never trades autonomously.

## Regenerating Assets

```bash
cd dashboard && node ../scripts/capture_demo_assets.mjs   # headless Playwright; warm API caches first
```

## Key Claims To Mention
- Market cockpit: status bar, normalized trend comparison, regime matrix, Greeks history, and a unified event timeline — all honest-data (missing/stale flagged, never faked zeros).
- Agent tools now run concurrently and are guarded by fail-closed checks.
- Wheel hot path is backed by shared Portfolio cache.
- Serenity archive has 2449 records and historical price reaction for most mapped ticker references.
- All user-facing advice is advisory-only; trading requires human confirmation outside the agent.

## Acceptance Checklist
- Dashboard loads at `http://localhost:3000/`.
- Wheel page shows live legs and a `positions_cache` or `positions_live` source.
- Intel page shows total Serenity records after data load.
- At least one post shows Chinese interpretation and ticker performance.
- Demo screenshots or a recording are saved under `docs/demo/`.
