# TradeMind Demo Script

## Goal
Show TradeMind as a practical trading cockpit: live portfolio risk, fast Wheel monitoring, Serenity intel with historical price reaction, and advisory-only agent collaboration.

## Suggested Runtime
2 to 3 minutes.

## Flow

1. Portfolio Cockpit
   - URL: `http://localhost:3000/`
   - Show KPI strip, live portfolio state, market exposure, and Agent Committee.
   - Message: TradeMind turns IBKR data into a disciplined daily operating screen.

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

## Key Claims To Mention
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
