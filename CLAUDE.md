# CLAUDE.md — TradeMind Agent · AI 编码助手规范

> 每次会话自动读入。硬约束 + token 节约规范在此，具体架构见 [AGENTS.md](AGENTS.md)。

---

## 项目一句话

TradeMind 是跑在 IBKR 上的期权交易分析 Agent + 深色 Dashboard，永不自动下单，所有写操作经人工确认。

---

## 读文件前的 Token 节约规则（必须遵守）

| 场景 | 正确做法 | 禁止 |
|---|---|---|
| 不知道文件结构 | `smart_outline(path)` 先拿行号 | 直接 `Read` 整个大文件 |
| 已有 session memory | `get_observations([ID])` 取已知事实 | 重新读代码推导 |
| 搜索符号/函数 | `grep` 或 `Bash: grep -rn` | 逐文件 Read |
| 大文件（>150 行）| `Read` with `offset` + `limit` | 不加 limit 读完 |
| 验证改动效果 | `git diff` / `tsc --noEmit` / `pytest -q` | 重新 Read 刚编辑的文件 |

**永远不要 Read：** `node_modules/`、`__pycache__/`、`.git/`、`agent/db/seed/*.db`（二进制）

---

## 架构速查（常用文件）

```
agent/tool_registry.py   ← 加新 Agent 工具的唯一入口
agent/prompts/system.md  ← Agent 人设（改行为不改代码）
agent/db/schema.sql      ← 所有建表（幂等 IF NOT EXISTS）
dashboard/app/api/       ← Next.js API routes（每个文件一个 route）
dashboard/app/           ← 页面（每目录一个 page.tsx）
dashboard/lib/           ← 纯函数数据层（TDD，配 .test.ts）
dashboard/components/    ← React 共享组件
```

---

## 常见操作检查清单

### 新增 Agent 工具
1. `agent/tool_registry.py`：加一个 `Tool(name, description, parameters, handler)`
2. 写 `tests/test_tool_registry.py` 中对应的测试
3. 如果需要 IBKR 脚本：脚本放 `~/Desktop/ibkr-options-assistant/scripts/`，通过 `run_script()` 调用

### 新增 Dashboard 页面
1. 创建 `dashboard/app/{page}/page.tsx`（`"use client"`）
2. 创建 `dashboard/app/api/{page}/route.ts`（GET handler，15min in-process cache）
3. `dashboard/components/Nav.tsx`：在 `links` 数组加条目

### 数据库变更
1. `agent/db/schema.sql`：用 `CREATE TABLE IF NOT EXISTS`（幂等）
2. 无需手动 migration，`init_db()` 运行时自动执行

### 验收命令
```bash
python3 -m pytest tests/ -q                                    # Python
node --test --experimental-strip-types dashboard/lib/*.test.ts # TypeScript
cd dashboard && npx tsc --noEmit && npm run build              # 类型 + 构建
```

---

## 安全硬约束（永不违反）

1. **永不自动下单** — `trade.py` 需 `IBKR_TRADING_ENABLED=1` + `--confirm-trade` 双闸门，且只有用户明确要求才能触发
2. **IBKR 为持仓真相来源** — 不信任本地 DB 快照，持仓/Greeks 实时拉取
3. **数据诚实** — 缺数据用 `missing[]` 标注，降级缓存标 `stale: true`，**绝不伪造 0**
4. **现有行情脚本只读无状态** — `agent/db/` 读写不得进入 `ibkr-options-assistant/scripts/`
