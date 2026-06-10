# Serenity Lens Agent Design

## Goal
Build a TradeMind sub-agent that learns a Serenity-inspired research framework from the archived intel corpus and applies it to tickers or themes in Chinese, without impersonating Serenity or copying collected posts as answers.

## Product Shape
The feature is named **Serenity Lens**. It is an internal research lens that answers: "Does this ticker/theme fit the type of structural opportunity Serenity tends to care about?" The output is a framework assessment, not a personality simulation.

## Agent Behavior
The lens evaluates a ticker or theme across six dimensions:

1. 产业链位置: whether the company is upstream, bottlenecked, enabling infrastructure, or a downstream application.
2. 供需/瓶颈: whether there is a capacity, memory, networking, power, foundry, or component constraint.
3. 催化剂: product cycle, earnings, capex, policy, customer adoption, or narrative rotation.
4. 叙事强度: whether repeated archived posts cluster around the same theme.
5. 赔率质量: whether the thesis is early, crowded, policy-sensitive, or dependent on execution.
6. 反证条件: what would weaken or invalidate the thesis.

The agent must:
- Produce Chinese prose except ticker symbols.
- Return structured fields for UI rendering.
- Cite evidence as corpus patterns and sample post references, not as copied conclusions.
- Avoid "Serenity would say" language.
- Mark low-confidence when corpus evidence is thin.

## Data Sources
Primary data is SQLite `intel_items` for source handle `aleabitoreddit`. The lens reads:
- `raw_text`
- `summary`
- `related_tickers`
- `portfolio_overlap`
- `item_ts`
- `external_id`
- `url`

No external network call is required for the first version. Price performance remains handled by existing Intel quote snapshots.

## Architecture
- `agent/agents/serenity_lens.py`: pure local analysis module. It reads archived intel, scores themes, and returns a structured dict.
- `agent/tool_registry.py`: exposes `analyze_serenity_lens` to the orchestrator.
- `dashboard/app/api/intel/lens/route.ts`: small API bridge that calls the Python agent with a query/ticker payload.
- `dashboard/app/intel/page.tsx`: adds a compact research console above the feed/sidebar.

## UI Design
The `/intel` page gains a "Serenity Lens" console using the existing dark terminal design language:
- Left: input for ticker/theme, Run button, headline verdict.
- Center: six framework tiles with scores and Chinese notes.
- Right: evidence stack with post dates, matched themes, and links when available.
- Bottom: "反证条件" and "适合动作" bands.

The console is operational, not explanatory. It should feel like a research instrument: dense, readable, and useful during repeated checks.

## Error Handling
- Empty query defaults to the top portfolio-overlap ticker if available; otherwise returns a clear validation error.
- No corpus match returns a low-confidence output with suggested related themes to search.
- Python/API failure returns a dashboard error banner, not a blank panel.

## Testing
- Unit tests cover ticker extraction, scoring, evidence truncation, low-confidence behavior, and tool registry exposure.
- Existing orchestrator schema test must include the new tool.
- Dashboard TypeScript must pass `tsc --noEmit`.

