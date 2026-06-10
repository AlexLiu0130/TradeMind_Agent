# TradeMind Agent

有记忆、会规划、有安全门禁的期权交易 agent，建立在 `ibkr-options-assistant` 工具层之上。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IBKR_SCRIPTS_DIR` | `~/Desktop/ibkr-options-assistant/scripts` | ibkr 只读脚本路径 |
| `TRADEMIND_DB` | `~/Desktop/TradeMind_Agent/agent/db/trademind.db` | SQLite 数据库路径 |
| `OPENAI_API_KEY` | — | LLM API 密钥（编排器需要）|
| `OPENAI_BASE_URL` | `https://node-cf.sssaicodeapi.com/api/v1` | OpenAI 兼容端点（sssaicode Codex 渠道，走 Responses API）|
| `OPENAI_MODEL` | `gpt-5.4` | 编排器使用的模型 |
| `OPENAI_MAX_OUTPUT_TOKENS` | `8000` | 单次响应最大输出 token（推理模型需较大预算）|
| `TELEGRAM_BOT_TOKEN` | — | Telegram 通知（P2 起需要）|
| `TELEGRAM_CHAT_ID` | — | Telegram 目标 chat ID |

---

## P0 — 记忆层 + Thesis 闭环

### 新增文件

- `agent/db/schema.sql` — 5 张表：theses / decisions / snapshots / rules / alert_state
- `agent/journal_store.py` — SQLite 薄封装，所有记忆读写接口
- `agent/agents/review.py` — 复盘 agent：thesis 假设 vs 实际 P&L 归因
- `agent/behavior.py` — 行为画像（P0 骨架）

### 运行测试

```bash
cd ~/Desktop/TradeMind_Agent
python3 -m pytest tests/test_journal_store.py -v
```

### 演示流程

```python
from agent.journal_store import init_db, create_thesis, update_thesis_status
from agent.agents.review import review_thesis

DB = "agent/db/trademind.db"
init_db(DB)

# 1. 开仓时录入 thesis
tid = create_thesis(
    ticker="AAPL",
    structure="short put",
    direction="sell",
    reason="IV 偏高，看好 200 支撑",
    thesis="AAPL 将在财报前维持 200 以上，IV crush 后收权利金",
    bull_case="技术面强，200 均线支撑",
    bear_case="宏观风险，若破 195 止损",
    exit_conditions="平仓条件：获利 50% 或 DTE<7",
    confidence=4,
)

# 2. 平仓后复盘
update_thesis_status(tid, "closed")
report = review_thesis(tid)
print(report["lesson"])
print(report["pnl_attribution"])
```

---

## P1 — Orchestrator + 安全门禁

*(执行中，见下方各文件)*

---

## P2 — 自主调度

### 新增文件

| 文件 | 触发时机 | 功能 |
|------|----------|------|
| `loops/premarket_brief.py` | 开盘前（ET 09:00 周一~五）| 盘前简报：未平 thesis + 财报 + 组合状态 |
| `loops/intraday_monitor.py` | 盘中每 15 分钟（ET 09:30-16:00）| IV 越界、assignment 风险、delta 漂移、集中度 |
| `loops/daily_review.py` | 收盘后（ET 16:30）| 日报：P&L 快照落库、ITM 持仓告警 |
| `loops/weekly_review.py` | 周六（ET 08:00）| 行为复盘：信心校准、roll 纪律、过度交易 |

### Telegram 配置

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
```

未配置时消息打印到 stdout（不报错）。

### Cron 配置（以 ET 时区系统为例，UTC 夏令时偏移 -4h）

```cron
# 盘前简报 — ET 09:00 = UTC 13:00（夏令时）
0 13 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.premarket_brief

# 盘中监控 — 每 15 分钟 ET 09:30-16:00
*/15 13-20 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.intraday_monitor

# 日报 — ET 16:30 = UTC 20:30（夏令时）
30 20 * * 1-5  cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.daily_review

# 周报 — 周六 ET 08:00 = UTC 12:00（夏令时）
0 12 * * 6    cd ~/Desktop/TradeMind_Agent && python3 -m agent.loops.weekly_review
```

> ⚠️ 冬令时 UTC 偏移变为 -5h，需相应调整 cron（或改用 launchd 的时区感知触发）。

### 验收

1. 配置 Telegram，启动 `cron`
2. 手动触发：`python3 -m agent.loops.premarket_brief`
3. 确认 Telegram 收到消息，且再次触发在 12h cooldown 内跳过
4. 触发 `intraday_monitor`，制造 concentration 越界，确认告警发出且不重复推送

---

## 硬约束（任何阶段不可违反）

1. agent 永远不自动调用 `trade.py`
2. 任何"暂存订单"必须先通过 guardrail 三检查 + 规则 + 行为标记
3. 持仓真相永远来自 IBKR（`portfolio_positions.py`），不假设数据库
4. 每次自主动作写入 `decisions` 表，可审计
