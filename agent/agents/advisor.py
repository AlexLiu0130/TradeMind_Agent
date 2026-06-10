"""
Decision Advisor — coordinates agent signals into user-confirmed advice cards.

The advisor is deliberately non-executing: it can surface risks, research leads,
and next review steps, but it must not tell the user to place a trade.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from agent import journal_store as js
from agent.agents import serenity_lens
from agent.tools import run_script

PORTFOLIO_TICKERS = {"AMD", "ARM", "MRVL", "MU", "NBIS", "NOK", "DRAM"}
MAX_CARDS = 6


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _safe_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _rule_set(key: str) -> set[str]:
    try:
        raw = js.get_rule(key, "[]")
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return {str(item).upper() for item in parsed}
    except Exception:
        return set()
    return set()


def _position_symbols(dashboard: dict | None) -> set[str]:
    symbols: set[str] = set()
    for pos in _safe_list(_safe_dict(dashboard).get("positions")):
        symbol = str(pos.get("symbol") or "").upper()
        if symbol:
            symbols.add(symbol)
    return symbols


def _net_delta(dashboard: dict | None) -> float | None:
    greeks = _safe_dict(_safe_dict(dashboard).get("portfolio_greeks"))
    value = greeks.get("net_delta")
    return float(value) if isinstance(value, (int, float)) else None


def _net_theta(dashboard: dict | None) -> float | None:
    greeks = _safe_dict(_safe_dict(dashboard).get("portfolio_greeks"))
    value = greeks.get("net_theta")
    return float(value) if isinstance(value, (int, float)) else None


def _top_drag(dashboard: dict | None) -> dict | None:
    positions = [
        pos for pos in _safe_list(_safe_dict(dashboard).get("positions"))
        if isinstance(pos.get("unrealized_pnl"), (int, float))
    ]
    if not positions:
        return None
    return sorted(positions, key=lambda p: float(p.get("unrealized_pnl") or 0))[0]


def _card(
    *,
    cid: str,
    category: str,
    priority: str,
    title: str,
    tickers: list[str],
    summary: str,
    suggested_action: str,
    confidence: str,
    evidence: list[dict],
    guardrails: list[str] | None = None,
) -> dict:
    return {
        "id": cid,
        "category": category,
        "priority": priority,
        "title": title,
        "tickers": tickers,
        "summary": summary,
        "suggested_action": suggested_action,
        "confidence": confidence,
        "evidence": evidence,
        "guardrails": guardrails or [
            "这是研究建议，不是交易指令。",
            "任何建仓、加仓、减仓都需要用户确认。",
        ],
        "status": "proposal",
    }


def _portfolio_risk_card(dashboard: dict | None) -> dict | None:
    delta = _net_delta(dashboard)
    theta = _net_theta(dashboard)
    drag = _top_drag(dashboard)
    if delta is None and drag is None:
        return None

    triggers: list[str] = []
    priority = "low"
    if delta is not None and abs(delta) >= 3000:
        priority = "high"
        triggers.append(f"组合净 delta {delta:+.0f}，方向暴露偏集中")
    elif delta is not None and abs(delta) >= 1000:
        priority = "medium"
        triggers.append(f"组合净 delta {delta:+.0f}，需要观察方向风险")
    if theta is not None and theta < 0:
        priority = "medium" if priority == "low" else priority
        triggers.append(f"Theta {theta:+.0f}/day，时间价值不是主要顺风")
    if drag and float(drag.get("unrealized_pnl") or 0) < 0:
        triggers.append(
            f"最大未实现拖累：{drag.get('symbol')} {float(drag.get('unrealized_pnl') or 0):+,.0f} USD"
        )

    if not triggers:
        return None

    ticker = str(drag.get("symbol") or "").upper() if drag else ""
    return _card(
        cid="risk-portfolio-delta",
        category="风险提醒",
        priority=priority,
        title="先复核组合暴露，再考虑新增动作",
        tickers=[ticker] if ticker else [],
        summary="；".join(triggers[:3]) + "。这类信号适合先做风险复盘，而不是直接扩大仓位。",
        suggested_action="打开组合风险复盘：确认净 delta、最大拖累和即将到期的期权腿是否仍符合原 thesis。",
        confidence="high" if priority == "high" else "medium",
        evidence=[
            {"agent": "Risk Agent", "label": "portfolio_greeks", "detail": f"net_delta={delta:+.0f}" if delta is not None else "net_delta unavailable"},
            {"agent": "Risk Agent", "label": "largest_drag", "detail": triggers[-1]},
        ],
    )


def _intel_clusters(items: list[dict], held: set[str]) -> list[dict]:
    counts: Counter[str] = Counter()
    latest: dict[str, dict] = {}
    overlaps: defaultdict[str, int] = defaultdict(int)
    urgency_score = {"low": 0, "watch": 1, "alert": 3}

    for item in items:
        tickers = [str(t).upper() for t in _safe_list(item.get("related_tickers"))]
        portfolio_overlap = {str(t).upper() for t in _safe_list(item.get("portfolio_overlap"))}
        for ticker in tickers:
            counts[ticker] += 1
            if ticker in portfolio_overlap or ticker in held or ticker in PORTFOLIO_TICKERS:
                overlaps[ticker] += 1
            if ticker not in latest:
                latest[ticker] = item

    clusters = []
    for ticker, count in counts.items():
        item = latest.get(ticker) or {}
        score = count * 2 + overlaps[ticker] * 4 + urgency_score.get(str(item.get("urgency") or "low"), 0)
        clusters.append({"ticker": ticker, "count": count, "overlap": overlaps[ticker], "score": score, "latest": item})
    return sorted(clusters, key=lambda c: (-c["score"], -c["count"], c["ticker"]))


def _intel_cards(items: list[dict], held: set[str]) -> list[dict]:
    cards: list[dict] = []
    for cluster in _intel_clusters(items, held)[:3]:
        ticker = cluster["ticker"]
        latest = cluster["latest"]
        is_overlap = cluster["overlap"] > 0
        priority = "high" if is_overlap and cluster["count"] >= 2 else "medium" if cluster["count"] >= 2 else "low"
        category = "持仓情报" if is_overlap else "观察清单"
        action = (
            f"复盘 {ticker} 当前 thesis 和风险边界，确认这批新信息是否改变原假设。"
            if is_overlap
            else f"把 {ticker} 放入 watchlist，并让 Serenity Lens / Research Agent 做一页 thesis 草稿。"
        )
        cards.append(_card(
            cid=f"intel-{ticker}",
            category=category,
            priority=priority,
            title=f"{ticker} 在近期 Serenity 档案中反复出现",
            tickers=[ticker],
            summary=(
                f"最近档案中出现 {cluster['count']} 次"
                f"{'，且与当前组合有重叠' if is_overlap else '，当前组合暂无直接暴露'}。"
                "这更适合作为研究触发器，而不是交易触发器。"
            ),
            suggested_action=action,
            confidence="medium" if cluster["count"] >= 2 else "low",
            evidence=[
                {
                    "agent": "Intel Agent",
                    "label": "latest_post",
                    "detail": str(latest.get("summary") or latest.get("raw_text") or "")[:180],
                    "url": latest.get("url"),
                },
                {
                    "agent": "Portfolio Risk Agent",
                    "label": "portfolio_overlap",
                    "detail": "overlap" if is_overlap else "no direct overlap",
                },
            ],
        ))
    return cards


def _lens_card(clusters: list[dict]) -> dict | None:
    target = next((c for c in clusters if c["count"] >= 2), None)
    if not target:
        return None
    ticker = target["ticker"]
    result = serenity_lens.analyze(ticker, ticker=ticker, limit=60)
    if result.get("confidence") == "low":
        return None

    verdict = _safe_dict(result.get("verdict"))
    framework = _safe_list(result.get("framework"))
    top_dims = sorted(framework, key=lambda r: int(r.get("score") or 0), reverse=True)[:2]
    dims = "、".join(row.get("dimension", "") for row in top_dims if row.get("dimension")) or "结构性机会框架"
    return _card(
        cid=f"lens-{ticker}",
        category="结构性研究",
        priority="medium",
        title=f"{ticker} 需要进入 Serenity Lens 研究队列",
        tickers=[ticker],
        summary=f"{verdict.get('label', 'Lens 输出')}：{verdict.get('summary', '')}",
        suggested_action=f"生成 {ticker} thesis 草稿，重点检查 {dims}，并列出反证条件。",
        confidence=str(result.get("confidence") or "medium"),
        evidence=[
            {"agent": "Serenity Lens", "label": "sample_size", "detail": f"{result.get('sample_size', 0)} archived items"},
            {"agent": "Serenity Lens", "label": "strong_dimensions", "detail": dims},
        ],
    )


def _price_reaction_cards(items: list[dict]) -> list[dict]:
    cards: list[dict] = []
    seen: set[str] = set()
    for item in items:
        snapshots = _safe_dict(item.get("ticker_snapshot"))
        for ticker, snap in snapshots.items():
            ticker = str(ticker).upper()
            data = _safe_dict(snap)
            pct = data.get("since_pct")
            if ticker in seen or not isinstance(pct, (int, float)) or abs(pct) < 10:
                continue
            seen.add(ticker)
            direction = "上涨" if pct > 0 else "下跌"
            cards.append(_card(
                cid=f"reaction-{ticker}",
                category="价格反馈",
                priority="medium" if abs(pct) < 25 else "high",
                title=f"{ticker} 发帖后价格已有明显{direction}",
                tickers=[ticker],
                summary=f"从记录基准到最新价格约 {pct:+.1f}%。需要判断这是 thesis 被验证，还是已经透支。",
                suggested_action="让 Research Agent 更新价格、估值和催化剂；不要只因为已上涨而追入。",
                confidence="medium",
                evidence=[
                    {"agent": "Price Reaction Agent", "label": "since_post", "detail": f"{pct:+.1f}%"},
                    {"agent": "Intel Agent", "label": "source_post", "detail": str(item.get("summary") or "")[:160], "url": item.get("url")},
                ],
            ))
            if len(cards) >= 2:
                return cards
    return cards


def _due_reminder_cards(now: str) -> list[dict]:
    try:
        reminders = js.list_advisor_reminders(status="pending", due_before=now, limit=3)
    except Exception:
        return []

    cards: list[dict] = []
    for reminder in reminders:
        original = _safe_dict(reminder.get("card_json"))
        original_id = str(original.get("id") or reminder.get("card_id") or "")
        title = str(original.get("title") or "待复核建议")
        summary = str(original.get("summary") or "")
        cards.append(_card(
            cid=f"reminder-{original_id}",
            category="提醒",
            priority=str(original.get("priority") or "medium"),
            title=f"提醒：{title}",
            tickers=[str(t).upper() for t in _safe_list(original.get("tickers"))],
            summary=f"你之前选择稍后提醒，现在已到期。原始建议：{summary}",
            suggested_action=str(original.get("suggested_action") or "重新检查这条建议是否仍然有效。"),
            confidence=str(original.get("confidence") or "medium"),
            evidence=[
                {"agent": "Advisor Reminder", "label": "due_at", "detail": str(reminder.get("due_at"))},
                *_safe_list(original.get("evidence"))[:1],
            ],
            guardrails=_safe_list(original.get("guardrails")) or None,
        ))
    return cards


def agent_graph() -> dict:
    return {
        "mode": "advisory_only",
        "permission_boundary": "Agent 可以主动建议、排序和准备证据；只有用户可以交易或改变仓位。",
        "agents": [
            {"name": "Intel Agent", "role": "读取 Serenity / 新闻 / 上传材料，提取 ticker、主题、时间和证据。"},
            {"name": "Serenity Lens", "role": "把档案模式蒸馏成结构性研究框架，不复制原帖结论。"},
            {"name": "Portfolio Risk Agent", "role": "读取组合 Greeks、P&L、期权腿、集中度和到期风险。"},
            {"name": "Price Reaction Agent", "role": "比较信息出现后的价格反馈，标记已验证或可能透支的线索。"},
            {"name": "Decision Advisor", "role": "汇总前面 agent 的证据，生成非执行建议卡。"},
        ],
        "handoffs": [
            {"from": "Intel Agent", "to": "Serenity Lens", "trigger": "ticker/theme 在档案中反复出现"},
            {"from": "Intel Agent", "to": "Portfolio Risk Agent", "trigger": "ticker 与持仓或 watchlist 重叠"},
            {"from": "Price Reaction Agent", "to": "Decision Advisor", "trigger": "发帖后涨跌幅超过阈值"},
            {"from": "Portfolio Risk Agent", "to": "Decision Advisor", "trigger": "净 delta、最大拖累或期权风险需要复核"},
        ],
    }


def build_advice(
    *,
    dashboard: dict | None = None,
    intel_items: list[dict] | None = None,
    intel_limit: int = 120,
) -> dict:
    if dashboard is None:
        dashboard = run_script("status_dashboard.py", "--output", "json") or {}
    if intel_items is None:
        intel_items = js.list_intel_items(source="Serenity", limit=intel_limit)

    held = _position_symbols(dashboard)
    clusters = _intel_clusters(intel_items, held)
    now = _now()
    cards: list[dict] = _due_reminder_cards(now)

    risk_card = _portfolio_risk_card(dashboard)
    if risk_card:
        cards.append(risk_card)
    cards.extend(_intel_cards(intel_items, held))
    lens = _lens_card(clusters)
    if lens:
        cards.append(lens)
    cards.extend(_price_reaction_cards(intel_items))

    if not cards:
        cards.append(_card(
            cid="workflow-quiet",
            category="工作流",
            priority="low",
            title="当前没有高优先级 agent 建议",
            tickers=[],
            summary="组合、档案和价格反馈暂未触发强信号。保持采集和复盘节奏即可。",
            suggested_action="维持观察；等待新情报、价格反馈或组合风险变化。",
            confidence="medium",
            evidence=[{"agent": "Decision Advisor", "label": "state", "detail": "no high-priority trigger"}],
        ))

    suppressed = _rule_set("advisor_ignored_cards") | _rule_set("advisor_resolved_cards") | _rule_set("advisor_reminder_cards")
    cards = [card for card in cards if str(card.get("id", "")).upper() not in suppressed]
    if not cards:
        cards.append(_card(
            cid="workflow-cleared",
            category="工作流",
            priority="low",
            title="当前建议已处理",
            tickers=[],
            summary="近期高优先级建议已经被生成 thesis 或忽略。Agent 会继续等待新的风险、情报或价格反馈。",
            suggested_action="维持采集与复盘节奏；等新信号触发下一张建议卡。",
            confidence="medium",
            evidence=[{"agent": "Decision Advisor", "label": "state", "detail": "all generated cards suppressed by user action"}],
        ))

    priority_rank = {"high": 0, "medium": 1, "low": 2}
    cards = sorted(cards, key=lambda c: (priority_rank.get(c["priority"], 9), c["id"]))[:MAX_CARDS]
    return {
        "generated_at": now,
        "cards": cards,
        "agent_graph": agent_graph(),
        "stats": {
            "cards": len(cards),
            "intel_items_scanned": len(intel_items),
            "tracked_clusters": len(clusters),
            "portfolio_symbols": sorted(held),
            "due_reminders": len([card for card in cards if card.get("category") == "提醒"]),
        },
    }
