# TradeMind Agent — 完整改进方案 V2

> 审查日期：2026-06-08  
> 基于对代码、数据库 schema、loops、guardrail 的完整审查，从**真实交易日使用流程**倒推缺口

---

## 一、真实使用流程 vs 现有能力的差距地图

一个典型交易日分五个阶段。每格标注「✅ 已有」「⚠️ 半成品」「❌ 完全缺失」。

### 盘前（09:00–09:30 ET）
| 用户想做的事 | 现有能力 | 差距 |
|---|---|---|
| 一眼看清今天有哪些仓位要关注 | ✅ Portfolio 页展示仓位 | ⚠️ 看不到到期倒计时、ITM 警告不突出 |
| 了解今天有哪些财报影响持仓 | ⚠️ premarket_brief.py → Telegram | ❌ Dashboard 没有盘前简报入口 |
| 快速检查昨晚有没有告警触发 | ⚠️ alerts_monitor.py 跑了 | ❌ Dashboard 看不到告警历史/状态 |
| 给今天想看的票快速拉研究报告 | ❌ 只能命令行调 orchestrator | ❌ Chat Panel 未建 |

### 开盘后监控（09:30–16:00 ET）
| 用户想做的事 | 现有能力 | 差距 |
|---|---|---|
| 看哪个 short put 快 ITM 了 | ✅ Portfolio 页有 ITM 字段 | ⚠️ 无实时刷新，无突出警告样式 |
| 查某票的 IV Rank / 技术面 | ❌ | ❌ Chat Panel 未建 |
| 决定要不要 roll 某个仓位 | ❌ | ❌ 没有 Roll 分析视图 |
| 看当前 Wheel 进度（哪个阶段）| ⚠️ wheel_tracker.py 存在 | ❌ Dashboard 无 Wheel 页面 |

### 交易分析（随时）
| 用户想做的事 | 现有能力 | 差距 |
|---|---|---|
| "分析 NVDA，我想 short put" | ⚠️ orchestrator 有能力 | ❌ 只能命令行触发 |
| 看 guardrail 会不会拦截 | ⚠️ guardrail.py 完整 | ❌ 只能命令行触发 |
| 调整 guardrail 规则（如 max_rolls）| ⚠️ rules 表有数据 | ❌ 需要手动 SQL |
| 查该票的历史 thesis / 决策记录 | ⚠️ journal_store 完整 | ⚠️ Thesis 页只读，无决策日志视图 |

### 交易后管理（日内/收盘后）
| 用户想做的事 | 现有能力 | 差距 |
|---|---|---|
| 新建一个 thesis 记录这笔交易思路 | ⚠️ journal_store.create_thesis() | ❌ Dashboard 无创建 UI，要手动 Python |
| 查看今天的 P&L 变化 | ⚠️ snapshots 表在收盘后写入 | ❌ Dashboard 没有 P&L 曲线 |
| 记录这笔决策（taken/skipped）| ⚠️ decisions 表有字段 | ❌ Dashboard 无决策日志 UI |
| 更新某个 thesis 的状态 | ❌ | ❌ Thesis 页只能看，不能改 |

### 周度复盘（周五盘后）
| 用户想做的事 | 现有能力 | 差距 |
|---|---|---|
| 看本周胜率、平均 P&L | ✅ Analytics 页有数据 | ⚠️ 数据有但设计平 |
| 看哪些 thesis 验证了 / 被推翻了 | ⚠️ Thesis 页有数据 | ⚠️ 无筛选/标注工具 |
| 看 wheel 年化收益率 | ⚠️ wheel_tracker.py 有 | ❌ Dashboard 没有展示 |
| 生成周报分享 | ⚠️ weekly_review.py → Telegram | ❌ Dashboard 无周报浏览 |

---

## 二、差距按价值 × 工作量排序

```
价值
 ↑
高│  [Chat Panel]   [Thesis CRUD]     [Wheel Page]
  │  [P&L 曲线]    [Guardrail Rules]
  │  [告警面板]    [决策日志]
低│                              [盘前简报页]
  └──────────────────────────────────────── 工作量
      少                              多
```

---

## 三、改进项详细规格

---

### 【A】Chat Panel — Agent 对话入口（价值最高）

**一句话：** 把 orchestrator 的能力接入 Dashboard，让所有分析功能通过自然语言触达。

#### 后端：`agent/server.py`（新建）

```python
# uvicorn agent.server:app --port 8000
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json, asyncio
from agent.orchestrator import run

app = FastAPI()

class ChatReq(BaseModel):
    message: str
    ticker: str | None = None

@app.post("/chat")
def chat(req: ChatReq):
    result = run(req.message, ticker=req.ticker)
    return result

@app.get("/health")
def health():
    return {"status": "ok"}
```

**依赖新增：** `requirements.txt` 加 `fastapi uvicorn`

#### 前端：`dashboard/app/api/chat/route.ts`（新建）

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await fetch("http://localhost:8000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000), // orchestrator 可能慢
    });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Agent server offline" }, { status: 503 });
  }
}
```

#### 前端：`dashboard/components/ChatPanel.tsx`（新建）

**UI 布局：**
```
┌──────────────────────────────────────────────┐
│ 🧠 TradeMind Agent                      [×]  │
├──────────────────────────────────────────────┤
│ [消息历史滚动区]                              │
│                                              │
│  user: 分析 NVDA，想卖 30 delta put          │
│                                              │
│  agent: NVDA 当前 $127.3，IV Rank 62%...    │
│  ┌─ Pre-trade Checks ──────────────────────┐ │
│  │ ✅ IV Environment: OK (ratio 0.68)      │ │
│  │ ✅ Portfolio Greeks: delta −420 / OK   │ │
│  │ ⚠️  Earnings: NVDA reports Jun 25      │ │
│  │ ✅ Concentration: 18% < 30%            │ │
│  └─────────────────────────────────────────┘ │
│  ┌─ Recommendation ────────────────────────┐ │
│  │ → NVDA Jun18 $120P 可行，注意财报 DTE  │ │
│  └─────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ Ticker [NVDA____] [分析这只票 ▼]            │
│ [输入问题...                    ] [发送 →]  │
└──────────────────────────────────────────────┘
```

**关键交互细节：**
- 固定右侧抽屉 `fixed right-0 top-0 h-full w-[400px]`，不遮挡主内容
- checks 用三色 badge：`passed` 绿 / `warning` 黄 / `blocking` 红
- `requires_confirmation: true` 时显示橙色横幅「⚠️ 此操作需确认」
- 快捷问法按钮（点即发）：「盘前简报」「组合风险」「分析持仓」
- 消息里 ticker 自动高亮，点击可跳转到对应 Thesis 记录

#### Nav 改动（`components/Nav.tsx`）

在右侧加 Agent 按钮，状态存 `localStorage`（跨页面保持开关）：

```tsx
// 新增：AgentContext 提供 open/setOpen
// Nav 右侧加：
<button onClick={() => setAgentOpen(v => !v)}
  className="ml-auto px-3 py-1 rounded text-sm font-semibold bg-violet-600 text-white">
  🧠 Agent {agentOpen ? "▶" : "◀"}
</button>
```

---

### 【B】Wheel 追踪页面（`/wheel`）— wheel_tracker.py 已有，只差前端

**背景：** `wheel_tracker.py summary` 脚本已实现，输出每个 wheel 的阶段、收益率、年化。这是你主策略，不应该只在命令行看。

#### 新建文件：
- `dashboard/app/wheel/page.tsx`
- `dashboard/app/api/wheel/route.ts`

#### UI 结构（每个 wheel 一张卡片）：

```
NVDA Wheel  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段: Short Put  │  Strike: $115  │  到期: Jun 21 (13d)
权利金已收: +$340  │  成本基础: $114.66
进度条: [████████████░░░░░░░░] 62% time decay

Delta: −0.28  IV: 42%  状态: ✅ OTM ($127 vs $115)

滚动历史:
  Jun 07: $120P → Jun 21 $115P  (借记 −$0.40)
  May 15: 初始建仓 $120P +$3.80

年化收益率: 24.3%  ←  来自 wheel_tracker.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**API route** 直接调 `wheel_tracker.py summary`，解析 JSON 返回。

---

### 【C】P&L 时序图（Portfolio 页增强）

**背景：** `snapshots` 表每天收盘后由 `daily_review.py` 写入，但 Portfolio 页从未读取过这张表。

#### API：`/api/snapshots/route.ts`（新建）

```typescript
// 读 snapshots 表，返回最近 N 天的 [{ts, net_delta, net_vega, realized_pnl}]
```

#### 在 Portfolio 页 `app/page.tsx` 下方增加：

```
── P&L History ────────────────────────────────────────
[7d] [30d] [90d]  ← tab 切换

  $2.4k ┤                          ╭──╮
  $1.2k ┤           ╭──╮          ╯  ╰──
     $0 ┼───────────╯  ╰──────────────────
 −$1.2k ┤
        └──────────────────────────────────
         May 12  May 19  May 26  Jun 2  Jun 9
```

**注意：** 如果 snapshots 表为空（还没跑过 daily_review），显示「暂无历史数据，每日收盘后自动记录」的空状态。

---

### 【D】Thesis CRUD — 从只读到可编辑

**背景：** `journal_store.create_thesis()` / `update_thesis()` 完整存在，但 UI 是只读的。用户要新建 thesis 只能手动跑 Python。

#### 改动范围：
1. `dashboard/app/api/thesis/route.ts` 增加 `POST`（创建）和 `PATCH`（更新状态/字段）
2. `dashboard/app/thesis/page.tsx` 增加：
   - 「+ New Thesis」按钮 → Modal 表单（ticker / structure / thesis / bull_case / bear_case / exit_conditions / confidence）
   - 每条 thesis 右侧加 「✓ Close」「✗ Invalidate」「✏️ Edit」按钮
   - 状态改变立即持久化到 DB

#### 表单字段设计：
```
Ticker: [NVDA______]  Structure: [Short Put ▼]  Confidence: [3 ▼]/5
Thesis: [核心假设... (textarea)]
Bull Case: [多头论点...]
Bear Case: [空头论点...]
Exit Conditions: [什么情况平仓...]
```

---

### 【E】告警面板（Alerts Dashboard）

**背景：** `alerts_monitor.py` 跑在 cron 上，但结果只推 Telegram，Dashboard 完全看不到。`alert_state` 表记录了每条告警的最后触发时间。

#### 新建：`dashboard/app/api/alerts/route.ts`
读 `alert_state` 表 + `rules` 表，返回告警规则列表和最近触发状态。

#### 在 Portfolio 页顶部增加告警条：
```
┌──────────────────────────────────────────────────────────┐
│ ⚠️  2 active alerts  │ NVDA: ITM Warning  │ Delta: −2100 │
└──────────────────────────────────────────────────────────┘
```

点击展开告警详情侧栏（不需要新页面，inline expand 即可）。

---

### 【F】Guardrail 规则可视化配置

**背景：** `rules` 表存了 4 条规则（`max_single_pct`, `max_rolls`, `block_earnings_within_days`, `max_trades_per_day`），改动要手动 SQL。这是风险管理的核心参数，应该有 UI。

#### 在 Analytics 页或新建 `/settings` 页加一个 Rules 卡片：

```
┌─ Guardrail Rules ─────────────────────────────┐
│ Max single position %    [30____]  %           │
│ Max rolls per thesis     [2_____]  times       │
│ Block earnings within    [2_____]  days        │
│ Max trades per day       [3_____]  trades      │
│                          [Save Changes]        │
└────────────────────────────────────────────────┘
```

**API：** `PATCH /api/rules` → 调 `journal_store` 更新 rules 表。

---

### 【G】决策日志视图

**背景：** `decisions` 表记录了每次 agent 建议 + 用户动作（taken/skipped）+ 结果，这是整个「有记忆」系统的核心，但完全没有 UI 可以查看。

#### 在 Thesis 详情页（点击某条 thesis 展开）增加：
```
── Decision History for NVDA ──────────────────────
Jun 07 14:32  Roll suggested → taken
  "IV ratio 0.72, roll to Jun21 $115P"
Jun 05 10:15  Short put suggested → skipped
  "Earnings within 3 days"
May 15 09:45  Short put suggested → taken
  "IV rank 68%, premium $3.80"
───────────────────────────────────────────────────
```

---

### 【H】视觉重设计（从 GitHub 白底 → 金融终端深色）

**执行方式：** 使用 `frontend-design` skill，给定明确方向

**触发命令：**
```
/frontend-design
```

**给 skill 的设计 brief：**

> 目标：把现有 TradeMind trading dashboard 的视觉语言从 GitHub 系（白底 `#f6f8fa`，蓝 `#0969da`）升级为高端金融终端风格。
>
> 参考：Bloomberg Terminal 的信息密度 + Vercel/Linear 的极简现代感 + 暗色终端质感
>
> 设计语言要求：
> - 背景：深色 `#0a0e1a`（近黑蓝），卡片 `#111827`，hover `#1f2937`
> - Accent：Electric Blue `#3b82f6`，不用 GitHub 蓝
> - 盈亏色：盈利 `#22c55e`，亏损 `#ef4444`（比现在的 GitHub 绿红更饱和）
> - 数字字体：tabular-nums + 略带 monospace 感（`font-variant-numeric: tabular-nums`）
> - 卡片：`border border-white/5 backdrop-blur-sm`，微妙 glow（`box-shadow: 0 0 20px rgba(59,130,246,0.08)`）
> - Nav：透明毛玻璃（`bg-black/40 backdrop-blur border-b border-white/10`）
> - 图表：深底色 + 高对比度线条，去掉多余 grid，Recharts 自定义 `contentStyle`
> - ITM 警告：红色 glow 脉冲动画
> - 告警状态：amber glow

**需要重做的文件（按优先级）：**
1. `app/globals.css` — 写入 CSS variables
2. `app/layout.tsx` — 深色背景
3. `components/Nav.tsx` — 毛玻璃导航
4. `app/page.tsx` — KPI 卡片 glow + 深色图表
5. `components/ChatPanel.tsx` — 深色毛玻璃抽屉（新建时直接用新设计语言）
6. 其余页面跟随

---

## 四、执行顺序（最优路径）

```
阶段 1 — 接通 Agent（1-2天）
  ├── agent/server.py  +  requirements.txt 加 fastapi/uvicorn
  ├── dashboard/app/api/chat/route.ts
  └── dashboard/components/ChatPanel.tsx  +  Nav 改动
  ✓ 验收：在 dashboard 输入"分析 NVDA"能收到结构化回复

阶段 2 — 视觉重设计（1-2天）
  └── /frontend-design skill 驱动，一次性重做视觉语言
  ✓ 验收：所有页面无白底残留，深色金融终端风格

阶段 3 — 功能补全（3-4天）
  ├── [C] P&L 曲线（snapshots 表已有数据，API + LineChart）
  ├── [B] Wheel 页面（wheel_tracker.py 已有，API + 卡片 UI）
  ├── [D] Thesis CRUD（create/update API + 表单 Modal）
  └── [E] 告警面板（alert_state 表 + Portfolio 页顶部条）

阶段 4 — 进阶（可选，按需）
  ├── [F] Guardrail Rules UI
  └── [G] 决策日志视图
```

---

## 五、技术注意事项

| 问题 | 说明 | 处理方式 |
|---|---|---|
| orchestrator 响应慢 | tool_use 多轮可能 30–60s | Chat Panel 加 skeleton + "正在分析..." 状态；考虑后续加 SSE 流式 |
| FastAPI server 进程管理 | Next.js 不管 Python 进程 | 开发用 `pm2` / `launchd`；文档化启动命令 |
| SQLite 并发写 | Next.js API + Python server 同时写 | SQLite WAL 模式已开启，可支持并发读，写冲突极低频，暂可接受 |
| Recharts 深色 tooltip | 默认白底 | 所有 `<Tooltip>` 加 `contentStyle={{ background: "#111827", border: "1px solid #1f2937" }}` |
| `trade.py` 双闸门 | Chat 里讨论交易 ≠ 下单 | 后端强制校验，前端 Stage Order 按钮加二次确认 Modal，agent 返回的 `requires_confirmation` 字段在 UI 必须可见 |
| IBKR Gateway offline | positions/guardrail 数据缺失 | Chat Panel 明确提示"IBKR offline，实时数据不可用"，不白屏 |

---

## 六、完整成功标准

### 阶段 1
- [ ] Dashboard 输入「分析 TSLA，我想 short put」→ 收到含 checks + recommendations 的结构化回复
- [ ] Chat Panel 在 IBKR offline 时显示降级提示，不白屏
- [ ] Nav Agent 按钮控制 Panel 开关，状态跨页面保持

### 阶段 2
- [ ] 所有页面使用深色主题，无 `#f6f8fa`/`#0969da` 残留
- [ ] KPI 卡片、图表、Nav 视觉一致，有设计感

### 阶段 3
- [ ] Wheel 页面展示每个 short put 的阶段、权利金、剩余天数、年化收益
- [ ] Portfolio 页显示最近 30 天 P&L 折线（snapshots 表有数据时）
- [ ] Thesis 页可新建、可更改状态（open/closed/invalidated）
- [ ] Portfolio 页顶部显示活跃告警条目

---

*文档由 Claude Code 生成 —— 基于完整代码审查 + 真实交易日流程分析，2026-06-08*
