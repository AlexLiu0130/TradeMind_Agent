# Daily Serenity Intel Design

## Goal
Build a durable Daily Serenity Brief inside TradeMind. Every captured item from `@aleabitoreddit` must be stored in SQLite, whether it is pasted manually today or captured automatically later.

## Scope
- Add `/intel` as a dedicated terminal-style page.
- Add `intel_items` storage.
- Add manual capture: paste tweet/thread/link text, analyze, store, show in feed.
- Add a daily loop skeleton that can ingest text/file input into the same storage path.
- Do not implement Trump or Jensen sources in this phase.
- Do not depend on X API access in this phase.

## Data Model
`intel_items` is append-only. No unique constraint is applied to URL or text because the user explicitly wants captures not to be lost. Duplicates can be filtered visually later, but raw captures remain stored.

Each item stores source, handle, capture method, URL, raw text, summary, detected tickers, watchlist overlap, impact direction, urgency, rationale, raw payload, and timestamps.

## Analysis
First version uses deterministic local keyword/ticker mapping:
- Explicit `$TICKER` and uppercase ticker detection.
- Semiconductor / AI supply-chain keywords map to NVDA, AMD, ARM, MRVL, MU, AVGO, TSM, SMH.
- Memory/HBM/DRAM maps to MU, DRAM, NVDA, AVGO.
- Networking/optics maps to MRVL, AVGO, AAOI.

This keeps the capture path reliable without requiring an LLM call. LLM summarization can be added later as a second-pass enrichment.

## UI
`/intel` uses the existing Terminal Instrument language: dark panels, gold focus, semantic red/green only for urgency and direction. It shows:
- A header summary: total captures, alert/watch counts, Serenity source.
- A capture panel with source, URL, and text input.
- A feed of stored items with urgency, direction, related tickers, overlap, summary, rationale, and raw text preview.

## Verification
- Unit tests cover append-only storage and JSON roundtrip.
- Dashboard typecheck/lint/build must pass.
- Browser verification confirms `/intel` renders and manual capture appears in the feed.
