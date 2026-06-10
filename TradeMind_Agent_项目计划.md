# TradeMind Agent — 项目构建计划（交给 Claude Code 执行）

> 本文件是给编码 agent（Claude Code）的构建规格说明。请**按阶段执行**，每个阶段都有明确的产出物和验收标准。先读完「0 项目概述」「2 架构与硬约束」「11 非目标」三节，再开始动手。

---

## 0. 项目概述

### 目标
在已有的 `ibkr-options-assistant` skill（一套打通 IBKR API 的只读数据脚本 + 受控下单脚本）之上，构建一个**有记忆、会规划、会主动、有安全门禁的期权交易 agent**，供作者本人日常管理 IBKR 期权仓位使用，同时作为 AI Agent 产品作品集。

### 一句话定位
TradeMind Agent 帮用户完成交易前的思考、交易中的风险确认、交易后的复盘学习；它不替用户做买卖决定，也不自动下单。

### 核心理念
- **IBKR = 现实，数据库 = 记忆。** 实时行情/持仓/Greeks 永远从 IBKR 拉最新的，不在本地存权威副本。数据库只存「IBKR 不替你记住的东西」：交易假设、决策日志、风控规则、历史快照。
- **脚本产出数据，模型产出判断。** 沿用现有 skill 的设计原则。
- **任何写操作（尤其下单）必须经过安全门禁 + 人工确认。**

---

## 1. 现状：已完成的工具层（不要重写，作为工具调用）

现有 skill 提供以下**只读、输出 JSON** 的 CLI 脚本（读 IBKR 配置自环境变量 `IBKR_HOST` / `IBKR_PORT` / `IBKR_CLIENT_ID_BASE` / `IBKR_MARKET_DATA_TYPE`）：

| 脚本 | 用途 |
|------|------|
| `status_dashboard.py` | 账户快照（持仓、Greeks、ITM、本周到期、wheel 阶段）|
| `market_quote.py SYM...` | 实时股票/ETF 报价 |
| `portfolio_positions.py` | 持仓 + 组合 Greeks |
| `options_chain.py SYM` | 期权链、各到期 IV |
| `options_analyzer.py SYM --outlook X --risk-profile Y --iv-context` | 给定观点的策略候选 + IV 环境 |
| `options_daily.py` | 早盘/收盘期权报告 |
| `pnl_analytics.py [--days N]` | 已实现 P&L、胜率、最好/最差 |
| `risk_simulator.py --add "..."` | 加一笔交易后的 Greeks 影响 |
| `earnings_calendar.py SYM --days N` | N 天内 earnings |
| `technical_indicators.py SYM` | RSI / MA / BB / ATR |
| `wheel_tracker.py summary` | wheel 周期状态与年化 |
| `alerts_monitor.py` | 阈值规则（cron-friendly）|
| `cost_basis.py SYM...` | premium 调整后的有效成本基础 |
| `concentration.py` | HHI、行业分布、Top-N 集中度 |
| `flex_import.py [--flex-dir ...]` | 解析 IBKR Flex CSV/XML 历史为 JSON |
| `trade.py <stock\|option\|combo>` | **下单**（双重门禁：`IBKR_TRADING_ENABLED=1` 且 `--confirm-trade`）|

参考库（按需读取）：`references/strategies.md`、`greeks_primer.md`、`wheel_strategy.md`、`options_book_summary.md`、`troubleshooting.md`。

> **约束：现有这批行情脚本保持无状态、只读，不要往里塞数据库逻辑。** 新增的记忆读写单独成模块。

---

## 2. 总体架构与硬约束

自底向上五层（底层已完成）：

```
交互层 Surface        对话 / Claude Code · Telegram 推送 · Dashboard
自主调度层 Autonomy    盘前简报 · 盘中监控告警 · 盘后/周度复盘
Agent 编排层           Orchestrator(规划调度) + 研究/风控/策略/复盘 Agent
—— 安全门禁 Guardrail/HITL：所有写操作必经此门 ——
记忆层 Memory          Thesis 库 · 决策日志 · 行为画像 · 风控规则
工具与数据层 ✓ 已完成   IBKR 数据脚本 · 期权分析 · 风险/Greeks · trade.py
```

数据自下向上流，指令自上向下走。

### 硬约束（任何阶段都不可违反）
1. **绝不自动下单。** agent 永远不主动调用 `trade.py`。它只能「暂存」一个待确认订单，等用户显式确认。
2. **下单前必过 pre-trade 三检查**（见 §7）：IV 环境、DTE 内 earnings、当前组合 Greeks。
3. **IBKR 为持仓真相来源。** 复盘/对账时用 `portfolio_positions.py` 实拉，不假设数据库就是真相（用户可能绕开 agent 手动下单）。
4. **每次自主动作写入决策日志，可审计。**
5. 不做收益预测、不给「确定性买卖推荐」，只给正反方观点 + 风险检查。

---

## 3. 技术栈与项目结构

- 语言：Python 3.11+（与现有脚本一致）
- 数据库：**第一阶段用 SQLite**（单文件、零部署、stdlib `sqlite3`）。后续要做 Web dashboard / 多人时再迁 Supabase(Postgres)。
- Agent 编排：复用现有 CLI 脚本作为工具（subprocess 调用，解析 stdout JSON）。LLM 调用走 Anthropic API（或 Claude Code 自身循环）。
- 调度：`cron` / `launchd` 触发已有 `alerts_monitor.py` 模式的新循环脚本。
- 通知：复用脚本的 `--output telegram`。

建议目录结构（新增部分）：
```
agent/
  journal_store.py        # 记忆层：SQLite 读写（本计划核心新增）
  orchestrator.py         # 编排层：规划 + 调用工具/子agent
  guardrail.py            # 安全门禁：pre-trade 检查 + 规则校验 + HITL
  agents/
    research.py
    risk.py
    strategy.py
    review.py
  loops/
    premarket_brief.py     # 盘前简报
    intraday_monitor.py    # 盘中监控
    daily_review.py        # 盘后复盘
    weekly_review.py       # 周度行为复盘
  behavior.py             # 行为画像：从 decisions/snapshots 聚合
  db/
    schema.sql
    trademind.db           # SQLite 文件（.gitignore）
tests/
```

---

## 4. 数据库设计（`agent/db/schema.sql`）

只持久化「记忆」，不复制 IBKR 的实时真相。

```sql
-- 每笔交易的假设（开仓时写入）
CREATE TABLE theses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL,
  structure       TEXT,            -- 如 "short put" / "covered call" / "stock"
  direction       TEXT,            -- buy/sell/add/trim
  opened_at       TEXT NOT NULL,   -- ISO8601
  reason          TEXT,            -- 用户原始动机
  thesis          TEXT,            -- 整理后的核心假设
  bull_case       TEXT,
  bear_case       TEXT,
  catalysts       TEXT,            -- earnings/CPI/FOMC...
  iv_snapshot     TEXT,            -- 开仓时 IV 环境(JSON)
  exit_conditions TEXT,            -- 止损/止盈/thesis 失效条件
  confidence      INTEGER,         -- 1-5
  status          TEXT DEFAULT 'open'  -- open / closed / invalidated
);

-- agent 每次建议 + 用户响应 + 结果（行为分析的原料）
CREATE TABLE decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  thesis_id       INTEGER REFERENCES theses(id),
  agent           TEXT,            -- research/risk/strategy/review/orchestrator
  recommendation  TEXT,            -- agent 给出的建议(含理由)
  user_action     TEXT,            -- taken / ignored / modified
  outcome         TEXT             -- 事后填:结果摘要/PnL 归因
);

-- 定期持仓/Greeks/PnL 快照（纵向行为分析用，append-only）
CREATE TABLE snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  positions_json  TEXT,            -- portfolio_positions.py 原始输出
  net_delta       REAL,
  net_vega        REAL,
  realized_pnl    REAL
);

-- 用户硬约束（配置表，guardrail 读取）
CREATE TABLE rules (
  key             TEXT PRIMARY KEY,  -- 如 max_single_pct / max_net_delta / max_rolls
  value           TEXT
);

-- 自主循环去重（防止重复推送同一告警）
CREATE TABLE alert_state (
  rule            TEXT PRIMARY KEY,
  last_fired_at   TEXT
);
```

初始 `rules` 种子（可改）：`max_single_pct=30`、`max_rolls=2`、`block_earnings_within_days=2`、`max_trades_per_day=3`。

> 行为画像**不单独建表**，由 `behavior.py` 从 `decisions` + `snapshots` 聚合实时计算（或缓存）。

---

## 5. 记忆模块接口（`agent/journal_store.py`）

薄封装 SQLite，给上层 agent 调用。建议接口：

```python
# 初始化
init_db(db_path)                       # 建表（执行 schema.sql，幂等）

# Thesis
create_thesis(**fields) -> int
get_thesis(thesis_id) -> dict
list_theses(status=None, ticker=None) -> list[dict]
update_thesis_status(thesis_id, status)

# Decisions
log_decision(thesis_id, agent, recommendation, user_action=None) -> int
update_decision_outcome(decision_id, user_action, outcome)
list_decisions(since=None, thesis_id=None) -> list[dict]

# Snapshots
save_snapshot(positions_json, net_delta, net_vega, realized_pnl)
list_snapshots(since=None) -> list[dict]

# Rules
get_rule(key, default=None)
set_rule(key, value)
all_rules() -> dict

# Alert dedupe
should_fire(rule, cooldown_minutes) -> bool   # 读/写 alert_state
```

要求：所有写操作用事务；JSON 字段进出自动 `json.dumps/loads`；只读现有行情脚本不依赖本模块。

---

## 6. Orchestrator 与子 agent（`agent/orchestrator.py`）

把现有「按顺序跑脚本」的固定 workflow，升级为**规划器**：收到目标 → 拆解步骤 → 选工具/子 agent → 串行/必要时并行调用 → 综合输出。

子 agent 即「特定脚本组合 + 该领域的推理 prompt」：
- **研究 Agent**：`market_quote` / `technical_indicators` / `earnings_calendar`（+ 可选新闻）
- **风控 Agent**：`portfolio_positions` / `concentration` / `risk_simulator` / `status_dashboard`
- **策略 Agent**：`options_analyzer` / `options_chain` + 读 `references/strategies.md`
- **复盘 Agent**：`pnl_analytics` / `wheel_tracker` / `cost_basis` + 对比 `theses` 库

工具调用约定：每个脚本以 `--output json` 调用，subprocess 捕获 stdout，解析为 dict 传入推理。缓存期权链（`options_chain.py --output /tmp/chain.json` → `options_analyzer.py --chain-file ...`）以省 IBKR 往返。

Orchestrator 输出统一结构（便于交互层渲染）：`{summary, checks[], recommendations[], requires_confirmation: bool}`。

---

## 7. 安全门禁（`agent/guardrail.py`）

分级自主权：
1. **只读分析** → 永远放行。
2. **给建议/告警** → 放行（但写入 `decisions`）。
3. **暂存订单** → 必须先通过下列全部检查，否则拒绝并说明原因：
   - **Pre-trade 三检查**（沿用 skill 既有规则）：
     - IV 环境（`options_analyzer --iv-context`）：低 IV 不卖 premium / 高 IV 不买 premium 时给警告
     - DTE 内是否有 earnings（`earnings_calendar`）：有则警告 IV crush 风险
     - 当前组合 Greeks（`portfolio_positions`）：方向是否与既有 delta 冲突
   - **规则校验**（读 `rules` 表）：单标的占比 > `max_single_pct`、净 delta 越界、earnings 窗口内、当日交易数 > `max_trades_per_day`
   - **行为标记**（读 `decisions`/`theses`）：roll 次数 ≥ `max_rolls`、疑似 FOMO（当日该标的涨幅大 + 无退出条件）、疑似过度交易
4. **执行下单** → 即使通过门禁，agent 也**只输出待确认订单**，由用户显式确认后才允许调用 `trade.py`（且仍受其 `IBKR_TRADING_ENABLED=1` + `--confirm-trade` 双门禁）。

每条检查都要**显式陈述结论**（例："IV 环境：低(ratio 0.7)；earnings：未来 45 天无；当前净 delta：+1,200"），让用户能审计推理。

---

## 8. 自主调度循环（`agent/loops/`）

复用 `alerts_monitor.py` 的 cron 模式，用 `alert_state` 去重：
- **`premarket_brief.py`**（开盘前）：`options_daily` + earnings + IV 环境 + 未平 thesis 状态 → 推「今天盯 3 件事」到 Telegram。
- **`intraday_monitor.py`**（盘中每 N 分钟）：IV 百分位越界、临近到期 assignment 风险、净 delta 漂移、earnings 进入 DTE、破集中度/风控线 → 告警 + 建议动作。
- **`daily_review.py`**（收盘后）：当日 P&L 变化、被证伪 thesis、wheel 阶段变化，写 `snapshots`。
- **`weekly_review.py`**（周末）：调 `behavior.py` 出行为洞察（信心校准、roll 纪律、过度交易）。

---

## 9. 分阶段实施计划

> 每阶段必须可独立运行、可独立演示后再进入下一阶段。

### P0 — 记忆层 + Thesis 闭环
**做什么**：`schema.sql` + `journal_store.py`；开仓时写 thesis；平仓后 `review.py` 自动对比「假设 vs 实际」并做 P&L 归因（个股逻辑 / 市场 beta / 事件冲击）。
**新增文件**：`db/schema.sql`、`journal_store.py`、`agents/review.py`、`behavior.py`(雏形)。
**验收**：能录入一笔 thesis；平仓后生成一份对比报告（thesis accuracy / execution discipline / P&L attribution / lesson）；数据落库可查询。

### P1 — Orchestrator + 安全门禁
**做什么**：`orchestrator.py` 规划器 + 四个子 agent 包装 + `guardrail.py` 全套检查；"该不该卖 put on $SYM" 这类问题走规划器，任何"暂存订单"走门禁。
**新增文件**：`orchestrator.py`、`agents/{research,risk,strategy}.py`、`guardrail.py`。
**验收**：输入一个交易意图，agent 自主决定调用顺序、跑完三检查 + 规则 + 行为标记、输出含 `requires_confirmation` 的结构化结果；故意构造一笔违规交易（如超集中度 / roll 第 3 次），门禁能拦截并说明理由。

### P2 — 自主调度
**做什么**：`premarket_brief.py` + `intraday_monitor.py` 上线，接 Telegram，`alert_state` 去重。
**验收**：cron 跑起来后能在盘前收到简报、盘中越界时收到告警，且同一告警不重复刷。

### P3 — 行为画像 + Dashboard
**做什么**：`behavior.py` 完整版（信心校准、roll 纪律、过度交易、IV 时机纪律）；轻量 Web dashboard（Next.js + Recharts）展示组合/Greeks/wheel/行为洞察；此阶段可把 SQLite 迁到 Supabase。
**验收**：dashboard 能展示纵向行为洞察（例："信心 5 分的交易胜率反而低于 3 分"）。

---

## 10. 测试与安全检查清单

- [ ] `journal_store` 全部读写有单元测试（含事务回滚）
- [ ] 现有行情脚本未被改成有状态（保持只读）
- [ ] guardrail 对每类违规都有用例：超集中度、净 delta 越界、earnings 窗口、roll 超限、过度交易
- [ ] 全链路中 **agent 无任何路径能不经用户确认就调用 `trade.py`**（重点审计）
- [ ] 复盘/对账始终以 `portfolio_positions.py` 实拉为准
- [ ] `trademind.db` 与任何含密钥的配置加入 `.gitignore`
- [ ] 自主循环有去重，不会重复推送

---

## 11. 非目标 / 边界（明确不做）

- 不做自动下单、不做无人值守交易。
- 不做收益/价格预测。
- 不给"你应该买入/卖出"式的确定性推荐；只给正反方观点和风险检查。
- 不在本地数据库存「当前持仓的权威副本」——持仓真相永远来自 IBKR。
- P0–P2 不引入向量数据库；语义检索需求留到有 Supabase + pgvector 时再说。

---

## 12. 给 Claude Code 的执行说明

1. 先确认能跑通现有 skill 的只读脚本（如 `status_dashboard.py --output json`），确认 IBKR 连接与环境变量就绪。
2. 从 **P0** 开始，**不要跨阶段**。每阶段完成后跑该阶段验收用例，通过再继续。
3. 新增代码集中在 `agent/` 目录，不修改现有行情脚本的只读契约。
4. 涉及 `trade.py` 的任何改动都要在 PR 描述里显式说明，并保证「无人工确认不可下单」这条不被破坏。
5. 每个阶段产出简短 README，说明如何运行与如何演示（作品集会用到）。
