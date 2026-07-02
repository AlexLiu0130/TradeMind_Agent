# TradeMind Agent — Agent 协作规范

> 本文件供 Claude Code / Codex 等 AI 编码助手在此仓库工作时遵循。

---

## 项目定位

TradeMind Agent 是一个**有记忆、会规划、有安全门禁的期权交易分析 agent**，供 IBKR short-put/wheel 策略交易者日常使用。它帮助用户完成交易前的思考、风险确认与事后复盘，**永不自动下单**。

---

## 代码架构速览

```
agent/                   # Python 后端
  orchestrator.py        # 规划器：tool_use 最多10轮
  guardrail.py           # 安全门禁：7项预交易检查
  journal_store.py       # 记忆层：SQLite 读写
  tool_registry.py       # 工具注册表：所有工具单一真相源
  tools.py               # subprocess 封装 + 并发调用
  cache.py               # 文件缓存（跨进程 TTL）
  agents/
    research.py          # 行情 + 技术指标 + 财报
    risk.py              # 仓位 + Greeks + 集中度
    strategy.py          # 期权链 + 策略建议
    review.py            # thesis 对比 + 复盘
    advisor.py           # Decision Advisor（主动建议）
    serenity_lens.py     # Serenity 研究框架蒸馏
  loops/
    premarket_brief.py   # 盘前简报（cron）
    intraday_monitor.py  # 盘中监控（cron）
    daily_review.py      # 日度复盘（cron）
    weekly_review.py     # 周度行为分析（cron）
    save_gex_snapshot.py # EOD GEX 快照（3:50 PM ET，cron）
  db/
    schema.sql           # 建表定义（幂等 CREATE TABLE IF NOT EXISTS）
    seed/                # 演示用种子数据库
  knowledge/
    trading_discipline.md  # 用户交易纪律（可编辑）
  prompts/
    system.md            # Agent 人设与行为规则（可编辑，无需改代码）

dashboard/               # Next.js 16 前端
  app/                   # App Router 页面与 API routes
  components/            # React 组件
  lib/                   # 纯函数数据层（TDD 优先）
```

---

## 硬约束（任何改动都不可违反）

1. **绝不自动下单**：agent 无任何路径能在无人工确认的情况下调用 `trade.py`。
2. **`trade.py` 需双重门禁**：`IBKR_TRADING_ENABLED=1` 环境变量 **且** `--confirm-trade` 标志同时存在才能执行。
3. **IBKR 为持仓真相来源**：复盘/对账始终用 `portfolio_positions.py` 实拉，不信任本地数据库快照。
4. **现有行情脚本保持无状态只读**：`agent/db/` 读写逻辑不得进入 `scripts/`（ibkr-options-assistant skill）中的脚本。
5. **每次自主动作写入 decisions 表**，保证可审计。

---

## Token 节约约定（AI Agent 必读）

每次 session 的 token 开销是真实成本。在此仓库工作时：

- **读大文件前先 `smart_outline`** 取行号，再用 `offset+limit` 精准读目标段落；不要不加 limit 读完整文件。
- **利用 session memory**：`get_observations([ID])` 从 `~/.claude/projects/.../memory/` 取已知事实，不要重复推导。
- **搜索优先于阅读**：找函数/符号用 `grep -rn`，找文件用 `find`，不要逐目录浏览。
- **验证用工具不用眼睛**：`git diff`、`tsc --noEmit`、`pytest -q` 验证改动；不要重新 Read 刚写的文件。
- **永远不 Read**：`node_modules/`、`__pycache__/`、`.git/`、`agent/db/seed/*.db`。
- **最小改动原则**：只改请求要求的文件，不顺手清理无关代码。

---

## 开发约定

### 新增工具
只需在 `agent/tool_registry.py` 的列表中追加一个 `Tool(name, description, parameters, handler)`，schema 与行为成对，不需要改其他文件。

### 数据库变更
修改 `agent/db/schema.sql`，所有建表语句用 `CREATE TABLE IF NOT EXISTS`（幂等）。运行时通过 `journal_store.init_db()` 自动执行迁移。

### API Routes（dashboard）
- 只读分析：GET routes，从 journal_store 或调 Python 脚本获取数据。
- 写操作（thesis/decisions/rules）：POST/PATCH，经 journal_store 写入，不绕过它直接操作 SQLite。
- **不要**在 API routes 里直接构造 SQL 字符串。

### 测试规范
- Python：`pytest tests/` — 所有新功能先写失败测试再实现（TDD）。
- TypeScript：`node --test --experimental-strip-types dashboard/lib/*.test.ts` — 纯函数逻辑必须有 `.test.ts`。
- 验收前必须：`pytest 全量通过` + `tsc --noEmit` + `eslint` + `npm run build`。

### 数据诚实原则
数据缺失时用 `missing[]` 标注，**绝不伪造 0 或假数据**。降级返回 stale 缓存时需在响应中明确标记 `stale: true`。

---

## 环境变量（参见 .env.example）

| 变量 | 用途 |
|---|---|
| `OPENAI_API_KEY` | LLM 调用（OpenAI 兼容接口） |
| `OPENAI_BASE_URL` | API 端点 |
| `OPENAI_MODEL` | 默认 deepseek-v4-flash |
| `QVERIS_API_KEY` | QVeris 数据源（Serenity / 财报等非持仓、非价格数据） |
| `IBKR_SCRIPTS_DIR` | ibkr-options-assistant skill 脚本路径 |
| `TRADEMIND_DB` | SQLite 数据库路径 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 自主循环推送通知 |
| `IBKR_TRADING_ENABLED` | 必须显式设为 `1` 才能调 trade.py |

---

## 快速启动

```bash
# Python 环境
pip install -r requirements.txt
cp .env.example .env  # 填入真实密钥

# 验证测试
python3 -m pytest tests/ -q

# 启动 Dashboard
cd dashboard
npm install
npm run dev   # http://localhost:3000

# 命令行 Agent
python3 -m agent.chat_cli "评估当前组合风险"
```
