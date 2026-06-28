# TradeMind Agent — 改进方案

> 审查日期：2026-06-08  
> 当前版本快照：Next.js 16 · React 19 · Tailwind v4 · Recharts · Python orchestrator (Anthropic tool_use)

---

## 一、现状诊断

### 后端（`agent/`）— 已经很扎实
| 模块 | 状态 | 备注 |
|---|---|---|
| `orchestrator.py` | ✅ 完整 | tool_use 驱动，最多 10 轮工具调用 |
| `agents/research.py` | ✅ | 行情 + 技术指标 + 财报 |
| `agents/risk.py` | ✅ | 仓位 + Greeks + HHI 集中度 |
| `agents/strategy.py` | ✅ | 期权链 + McMillan/Overby |
| `agents/review.py` | ✅ | thesis review |
| `guardrail.py` | ✅ | 7 项预交易检查 |
| `journal_store.py` | ✅ | SQLite thesis + decisions |
| `loops/` | ✅ | 盘前/日内/日回顾/周回顾 |

### 前端（`dashboard/`）— 两大问题
1. **Agent 能力完全未暴露**：orchestrator 的所有分析能力只能从命令行触发，dashboard 和 agent 层是两个孤立世界
2. **视觉设计套用 GitHub token**：`#0969da` / `#f6f8fa` / `#d0d7de` 全套 GitHub 色，功能性强但无辨识度，缺乏交易终端该有的质感

---

## 二、改进优先级

```
Priority 1 ── Chat Panel（接通 agent，解锁所有功能）
Priority 2 ── 视觉重设计（高设计感，用 frontend-design skill）
Priority 3 ── 功能补全（Wheel 进度追踪、P&L 时序图、快捷交易面板）
```

---

## 三、Priority 1：Chat Panel（Agent 对话界面）

### 3.1 目标

在 dashboard 任意页面右侧打开一个悬浮 Chat Panel，直接向 orchestrator 提问：

- "分析 NVDA，我想卖一个 30 delta 的 put"
- "现在 portfolio 的集中度风险高吗"
- "帮我查 TSLA 的 thesis 历史"
- "盘前简报"

所有回答引用实时数据（IBKR + Anthropic），结构化展示 checks / recommendations。

### 3.2 需要新建的文件

```
dashboard/
├── app/api/chat/
│   └── route.ts          # POST → stream orchestrator output
├── components/
│   ├── ChatPanel.tsx      # 右侧抽屉式 Chat UI
│   └── ChatMessage.tsx    # 单条消息渲染（Markdown + checks + recommendations）
```

### 3.3 后端 API：`/api/chat/route.ts`

**实现要点：**
- 接收 `{ message: string, ticker?: string }`
- 用 `child_process.spawn` 调用 Python orchestrator，或通过 HTTP 如果你后续起 FastAPI server
- **推荐方案**：起一个轻量 FastAPI server（`agent/server.py`），dashboard 通过 `http://localhost:8000/chat` 调用，避免 Next.js 进程管理 Python 子进程的复杂性
- 支持 **Server-Sent Events (SSE)** 流式输出，让用户看到逐步思考过程

**最简实现（非 streaming，先跑通）：**
```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { message, ticker } = await req.json();
  const res = await fetch("http://localhost:8000/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ticker }),
  });
  const data = await res.json();
  return NextResponse.json(data);
}
```

**Python FastAPI server（`agent/server.py`）：**
```python
from fastapi import FastAPI
from pydantic import BaseModel
from agent.orchestrator import run

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    ticker: str | None = None

@app.post("/chat")
def chat(req: ChatRequest):
    return run(req.message, ticker=req.ticker)
```

启动：`uvicorn agent.server:app --port 8000`

### 3.4 前端 Chat Panel：`ChatPanel.tsx`

**UI 结构：**
```
┌─────────────────────────────────────────┐
│  🧠 TradeMind Agent          [×]        │
├─────────────────────────────────────────┤
│                                         │
│  [用户消息气泡]                          │
│                                         │
│  [AI 回复]                              │
│  ┌── Checks ──────────────────────────┐ │
│  │ ✅ IV Environment: Passed          │ │
│  │ ⚠️  Earnings: NVDA reports in 12d  │ │
│  │ ✅ Concentration: 18% < 25% limit  │ │
│  └────────────────────────────────────┘ │
│  ┌── Recommendation ──────────────────┐ │
│  │ → Stage order pending confirmation │ │
│  └────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│  [Ticker: NVDA ▼]  [Ask anything...]   │
│                              [Send →]  │
└─────────────────────────────────────────┘
```

**关键设计决策：**
- Chat Panel 以 **固定右侧抽屉** 形式存在（`fixed right-0 top-0 h-full w-96`），不遮挡主内容
- Nav 增加 "Agent" 按钮控制开关
- Ticker 输入框在 Chat 底部，方便快速切换分析对象
- checks 用彩色 badge 结构化展示（passed=绿 / warning=黄 / blocking=红）
- `requires_confirmation: true` 时显示醒目的确认横幅

### 3.5 Nav 改动

在 `components/Nav.tsx` 增加 Agent 开关按钮：

```tsx
// 右侧新增
<button onClick={() => setAgentOpen(v => !v)} 
  className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium bg-[agent-color] text-white">
  🧠 Agent
</button>
```

需要把 `agentOpen` 状态提升到 layout 层或用 Context。

---

## 四、Priority 2：视觉重设计

### 4.1 执行方式

用 **`frontend-design` skill**，它专门生成有辨识度的 production-grade 界面，避免 generic AI 审美。

**触发命令：**
```
/frontend-design
```

**给 skill 的 prompt 方向：**

> 重设计 TradeMind trading dashboard。风格参考：Bloomberg Terminal 的信息密度 + Linear/Vercel 的现代极简 + 暗色金融终端质感。
> 
> 核心设计语言：
> - 背景：深色 `#0a0e1a`（近黑蓝），不是白底
> - Accent：Electric Blue `#3b82f6` + 盈利绿 `#22c55e` + 亏损红 `#ef4444`
> - 字体：数字用 tabular-nums + monospace 感，标签用细体
> - 卡片：带微妙 glow 的 `border + backdrop-blur`，不是平白底
> - 图表：深底色上的高对比度线条，去掉 grid 噪音
> - Nav：全透明 + 毛玻璃效果，底部分割线

### 4.2 具体需要重做的组件

| 文件 | 现状 | 目标 |
|---|---|---|
| `app/layout.tsx` | `bg-[#f6f8fa]` 白底 | 深色背景 + 全局 CSS var |
| `components/Nav.tsx` | GitHub 白色导航栏 | 透明毛玻璃 nav |
| `app/page.tsx` | KPI cards 白底平面 | 带 glow 的深色卡片 |
| `app/analytics/page.tsx` | 白底 BarChart | 深色底 + 渐变 fill |
| `app/trades/page.tsx` | 普通 table | 密度优化的 monospace table |
| `app/thesis/page.tsx` | 白卡片列表 | Timeline 风格卡片 |
| `components/ChatPanel.tsx` | （新建）| 深色毛玻璃抽屉 |

### 4.3 设计 Token（建议写入 `app/globals.css`）

```css
:root {
  --bg-base: #0a0e1a;
  --bg-card: #111827;
  --bg-hover: #1f2937;
  --border: #1f2937;
  --border-subtle: #374151;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --accent: #3b82f6;
  --profit: #22c55e;
  --loss: #ef4444;
  --warning: #f59e0b;
  --glow-blue: 0 0 20px rgba(59, 130, 246, 0.15);
  --glow-green: 0 0 20px rgba(34, 197, 94, 0.1);
}
```

---

## 五、Priority 3：功能补全

### 5.1 Wheel 策略进度追踪（新页面 `/wheel`）

你的主策略是 short put → wheel，但现在没有任何地方能一眼看到每个 wheel 的进度：

```
NVDA Wheel  ──────────────────────────────────────────
  Phase: Short Put  │  Strike: $115  │  Exp: 2026-06-21
  Premium Collected: +$340  │  Days Remaining: 13d
  [████████████░░░░░░░░] 62% time decay
  Status: OTM ✅  │  Δ: -0.28  │  IV: 42%
  
  Roll History: [Jun-14 $120P → Jun-21 $115P (-$0.40)]
```

**需要新建：**
- `dashboard/app/wheel/page.tsx`
- `dashboard/app/api/wheel/route.ts` — 从 journal_store + positions 聚合数据

### 5.2 P&L 时序图（Portfolio 页增强）

现在 Portfolio 页只有横截面快照，缺少历史曲线。需要：
- 每次刷新时把 `totalUPnL` 存入 localStorage（短期方案）
- 或者 orchestrator 每小时 snapshot 写入 DB（长期方案）
- 用 `LineChart` 展示日内 / 本周 / 本月 P&L 曲线

### 5.3 快捷交易面板（Chat Panel 增强）

在 Chat 回复中，如果 `requires_confirmation: false`（guardrail 全过），显示：

```
┌─────────────────────────────────────────┐
│  ⚡ Suggested Order                     │
│  SELL 1x NVDA Jul18 115P @ ~$3.40      │
│  Est. Premium: +$340  │  Max Risk: -$11.5k │
│                                         │
│  [Review in IBKR]    [Stage Order ⚠️]   │
└─────────────────────────────────────────┘
```

"Stage Order" 按钮调用 `trade.py`（需要 `IBKR_TRADING_ENABLED=1` + `--confirm-trade` 双闸门，在后端强制校验）。

---

## 六、执行顺序建议

```
Week 1
  Day 1-2: Priority 1 后端 — agent/server.py + /api/chat route
  Day 3-4: Priority 1 前端 — ChatPanel.tsx + Nav 改动
  Day 5:   测试：从 chat 问 "分析 NVDA" 能收到结构化回复

Week 2
  Day 1-3: Priority 2 — /frontend-design skill 重做设计语言
  Day 4-5: 把 ChatPanel 融入新设计

Week 3
  Day 1-2: Priority 3a — Wheel 追踪页面
  Day 3-4: Priority 3b — P&L 时序图
  Day 5:   Priority 3c — 快捷交易面板（可选，风险最高）
```

---

## 七、技术风险 & 注意事项

| 风险 | 说明 | 缓解 |
|---|---|---|
| orchestrator 响应慢 | tool_use 多轮可能 30-60s | 先用 SSE streaming 让用户看到进度，或加 loading skeleton |
| FastAPI server 管理 | 需要单独起进程，crash 不会自动重启 | 用 `launchd` 或简单的 `pm2` 管理 |
| `trade.py` 误触 | Chat 里讨论交易不能意外下单 | 后端强制检查双闸门，前端 "Stage Order" 按钮加二次确认 modal |
| 暗色设计 recharts | Recharts 默认白底 tooltip | 需要自定义 `contentStyle` + `labelStyle` |
| IBKR Gateway offline | positions API 失败时 Chat 也受影响 | Chat 里明确提示 "IBKR offline，分析功能受限" |

---

## 八、成功标准

- [ ] 在 dashboard 输入 "分析 TSLA，我想 short put" 能收到包含 checks + recommendations 的结构化回复
- [ ] Portfolio / Trades / Analytics / Thesis 页面在新设计下视觉一致，无白底残留
- [ ] Wheel 页面能正确聚合现有 short put 仓位的 phase / premium / days remaining
- [ ] Chat Panel 在 IBKR Gateway offline 时给出明确的降级提示而不是白屏
- [ ] 任何涉及下单的路径都经过 guardrail，前端显示 `requires_confirmation` 标志

---

*文档由 Claude Code 生成，基于 2026-06-08 代码审查。*
