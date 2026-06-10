# 交易纪律 (Trading Discipline)

> 本文件是 Agent 知识库的一部分（本地、可编辑）。写下你**自己的**规则、偏好和教训，
> Agent 会在分析时检索它，让建议贴合你的实际打法。与 IBKR skill 的 `references/`
> （McMillan/Overby 策略、greeks、wheel 机制）共同构成知识库。

## 策略定位

- 主策略：**short put → wheel**。卖方为主，收权利金，position < 0 表示已卖出。
- 被指派（assignment）不是失败——它是 wheel 的正常一环：被指派后转为持股 + 卖 covered call。

## 入场纪律

- **IV 环境优先**：低 IV 环境卖 premium 不划算；优先在 IV rank 偏高时卖。
- **避开财报**：DTE 内有财报的标的，默认不新开 short premium（IV crush / 跳空风险）。
- **集中度**：单一标的不超过组合的设定上限（见 guardrail `max_single_pct`）；警惕同板块（如半导体）整体 beta 堆叠。
- **Delta 预算**：组合 net delta 已偏高时，不再叠加同方向裸卖或加仓。

## 持仓管理

- **滚动（roll）有上限**：同一 thesis 滚动次数到上限（`max_rolls`）就停手——要么平仓认亏，要么接受指派，不要无限追。
- **止盈优先于到期**：达到约定利润目标（如 50%）即可提前平仓，释放保证金与风险。
- **退出条件先行**：开仓前就写下 thesis 的退出条件；没有退出计划的单子视为 FOMO。

## 风控红线

- 每日交易笔数有上限（`max_trades_per_day`），防止过度交易。
- 任何下单都要过 guardrail 七项检查 + 人工二次确认；Agent 永不自动下单。

## 复盘

- 每周看胜率（按标的 / 持有期 / 时段）与信心校准（`get_behavior_profile`），修正打法。
- 被推翻（invalidated）的 thesis 要记录原因，避免重复犯错。
