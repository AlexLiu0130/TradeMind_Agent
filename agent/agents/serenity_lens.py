"""
Serenity Lens — a local research-framework agent.

This module does not impersonate Serenity and does not copy archived posts into
answers. It distills recurring research patterns from the archived intel corpus
and applies them as a TradeMind-owned lens.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from agent import journal_store as js


@dataclass(frozen=True)
class ThemeRule:
    key: str
    label: str
    dimension: str
    pattern: re.Pattern
    note: str


THEME_RULES = [
    ThemeRule(
        "memory_bottleneck",
        "存储 / HBM 瓶颈",
        "供需/瓶颈",
        re.compile(r"\b(hbm|dram|memory|bandwidth|capacity|tight|bottleneck)\b", re.I),
        "关注 AI 训练/推理扩张中最难快速增加的供给环节。",
    ),
    ThemeRule(
        "ai_networking",
        "AI 网络 / 光互连",
        "产业链位置",
        re.compile(r"\b(ethernet|networking|switch|optics|optical|dsp|interconnect)\b", re.I),
        "把算力扩张拆成集群互联、交换芯片、光模块和代工交付能力。",
    ),
    ThemeRule(
        "custom_silicon",
        "定制芯片 / ASIC",
        "催化剂",
        re.compile(r"\b(custom silicon|asic|xpu|hyperscaler|accelerator)\b", re.I),
        "跟踪云厂商资本开支从通用 GPU 向自研/半定制芯片的扩散。",
    ),
    ThemeRule(
        "compute_platform",
        "AI 加速器平台",
        "叙事强度",
        re.compile(r"\b(gpu|cuda|blackwell|rubin|mi300|mi350|ai chip|ai accelerator)\b", re.I),
        "用产品周期和软件生态解释估值溢价是否还能维持。",
    ),
    ThemeRule(
        "policy_supply_chain",
        "政策 / 地缘供应链",
        "反证条件",
        re.compile(r"\b(export|tariff|china|taiwan|restriction|policy|ban|sanction)\b", re.I),
        "把政策变量视为赔率折价和情绪扰动，不把它当成单向叙事。",
    ),
    ThemeRule(
        "arm_edge",
        "ARM / 边缘计算生态",
        "产业链位置",
        re.compile(r"\b(arm|risc-v|cpu|edge ai|mobile)\b", re.I),
        "关注架构授权、终端侧 AI 和生态迁移带来的可选性。",
    ),
    ThemeRule(
        "robotics_power",
        "机器人 / 电力基础设施",
        "催化剂",
        re.compile(r"\b(robot|robotics|humanoid|power|grid|energy|cooling)\b", re.I),
        "寻找 AI 主题向实体基础设施和自动化扩散的第二曲线。",
    ),
]

DIMENSIONS = ["产业链位置", "供需/瓶颈", "催化剂", "叙事强度", "赔率质量", "反证条件"]
PORTFOLIO = {"AMD", "ARM", "MRVL", "MU", "NBIS", "NOK", "DRAM"}


def _loads(value: Any, default):
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _query_terms(query: str, ticker: str | None) -> list[str]:
    terms = [query.strip()]
    if ticker:
        terms.append(ticker.strip().upper())
    terms.extend(re.findall(r"\$?([A-Z]{2,6})\b", query.upper()))
    return [t for t in dict.fromkeys([term for term in terms if term])]


def classify_themes(text: str) -> list[dict]:
    themes = []
    for rule in THEME_RULES:
        if rule.pattern.search(text):
            themes.append({"key": rule.key, "label": rule.label, "dimension": rule.dimension, "note": rule.note})
    return themes


def _row_matches(row: dict, terms: list[str]) -> bool:
    related = {str(t).upper() for t in _loads(row.get("related_tickers"), [])}
    haystack = " ".join(str(row.get(k) or "") for k in ("raw_text", "summary", "rationale")).upper()
    return any(term.upper() in related or term.upper() in haystack for term in terms)


def _load_matching_items(query: str, ticker: str | None, limit: int) -> list[dict]:
    terms = _query_terms(query, ticker)
    rows = js.list_intel_items(source="Serenity", limit=1200)
    matches = [row for row in rows if str(row.get("source_handle") or "").lstrip("@") == "aleabitoreddit" and _row_matches(row, terms)]
    return matches[:limit]


def _theme_counts(items: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        text = str(item.get("raw_text") or "")
        for theme in classify_themes(text):
            counts[theme["key"]] = counts.get(theme["key"], 0) + 1
    return counts


def _dimension_note(dimension: str, items: list[dict], themes: list[dict]) -> str:
    labels = [theme["label"] for theme in themes if theme["dimension"] == dimension]
    if dimension == "赔率质量":
        if len(items) >= 20:
            return "档案中出现频率较高，说明叙事不冷门；需要用价格位置和业绩兑现来避免追高。"
        if len(items) >= 5:
            return "有可观察样本但未到拥挤状态，适合继续跟踪催化剂兑现。"
        return "样本不足，不能把赔率判断建立在单条内容上。"
    if dimension == "反证条件":
        if labels:
            return f"主要反证来自：{'、'.join(dict.fromkeys(labels))}；若政策/供需方向反转，lens 需要降级。"
        return "需要跟踪需求放缓、毛利率恶化、客户推迟资本开支和估值过度拥挤。"
    if labels:
        return f"匹配主题：{'、'.join(dict.fromkeys(labels))}。"
    return "当前档案证据较弱，需要更多帖子或基本面数据确认。"


def _framework(items: list[dict]) -> list[dict]:
    all_themes = [theme for item in items for theme in classify_themes(str(item.get("raw_text") or ""))]
    rows = []
    for dimension in DIMENSIONS:
        strength = sum(1 for theme in all_themes if theme["dimension"] == dimension)
        score = min(5, strength + (1 if dimension == "赔率质量" and len(items) >= 5 else 0))
        rows.append({
            "dimension": dimension,
            "score": score,
            "note": _dimension_note(dimension, items, all_themes),
        })
    return rows


def _evidence(items: list[dict], max_items: int = 6) -> list[dict]:
    result = []
    for item in items[:max_items]:
        themes = classify_themes(str(item.get("raw_text") or ""))
        labels = [theme["label"] for theme in themes]
        tickers = _loads(item.get("related_tickers"), [])
        derived_summary = (
            f"档案样本匹配 {'、'.join(labels[:3])}；涉及 {'、'.join(tickers[:4])}。"
            if labels or tickers
            else "档案样本与查询相关，但未命中已配置主题标签。"
        )
        result.append({
            "external_id": item.get("external_id"),
            "item_ts": item.get("item_ts") or item.get("captured_at"),
            "url": item.get("url"),
            "themes": labels,
            "tickers": tickers,
            "summary": derived_summary,
        })
    return result


def _confidence(items: list[dict], counts: dict[str, int]) -> str:
    if len(items) >= 20 and sum(counts.values()) >= 10:
        return "high"
    if len(items) >= 2:
        return "medium"
    return "low"


def _verdict(query: str, items: list[dict], confidence: str, framework: list[dict]) -> dict:
    total_score = sum(row["score"] for row in framework)
    if confidence == "low":
        return {
            "label": "样本不足",
            "summary": f"{query} 在 Serenity 档案中的有效样本不足，不能硬判定其是否符合该研究框架。",
        }
    if total_score >= 16:
        label = "高契合观察"
    elif total_score >= 5 or confidence == "medium":
        label = "结构性观察"
    else:
        label = "低契合观察"
    return {
        "label": label,
        "summary": f"{query} 的档案证据更适合用产业链位置、瓶颈约束和催化剂兑现来观察，而不是只看单日新闻或单条观点。",
    }


def _counter_signals(framework: list[dict], confidence: str) -> list[str]:
    if confidence == "low":
        return ["样本不足时，任何结论都需要等待更多档案或基本面证据。"]
    signals = [
        "如果相关产品周期延后、客户资本开支下修或订单兑现低于预期，需要降低叙事权重。",
        "如果股价已经提前反映乐观情景，适合把仓位动作从追涨改为等待回撤或卖波动。",
        "如果政策限制、供应链中断或毛利率恶化成为主线，原有多头框架需要重新评估。",
    ]
    weak_dims = [row["dimension"] for row in framework if row["score"] <= 1]
    if weak_dims:
        signals.append(f"当前弱项是{'、'.join(weak_dims)}，这些维度补强前不宜给高确信度。")
    return signals


def _action_fit(ticker: str | None, confidence: str, framework: list[dict]) -> list[str]:
    target = ticker or "该主题"
    if confidence == "low":
        return [f"{target} 适合先放入观察清单，不适合直接根据 lens 建仓。"]
    score = sum(row["score"] for row in framework)
    if score >= 16:
        return [
            f"{target} 适合进入深度研究和期权候选池。",
            "若 IV 合理且风控通过，可进一步让 strategy/risk agent 检查 short put 或分批建仓结构。",
        ]
    return [
        f"{target} 适合继续监控催化剂和价格位置。",
        "更适合等待回撤、财报确认或新证据，而不是直接追逐叙事。",
    ]


def analyze(query: str, ticker: str | None = None, limit: int = 80) -> dict:
    clean_query = (query or ticker or "").strip().upper()
    clean_ticker = ticker.strip().upper() if ticker else None
    if not clean_query:
        return {"error": "query or ticker is required"}

    items = _load_matching_items(clean_query, clean_ticker, limit)
    counts = _theme_counts(items)
    framework = _framework(items)
    confidence = _confidence(items, counts)
    return {
        "query": clean_query,
        "ticker": clean_ticker,
        "source": "TradeMind Serenity Lens",
        "confidence": confidence,
        "sample_size": len(items),
        "theme_counts": counts,
        "verdict": _verdict(clean_query, items, confidence, framework),
        "framework": framework,
        "evidence": _evidence(items),
        "counter_signals": _counter_signals(framework, confidence),
        "action_fit": _action_fit(clean_ticker, confidence, framework),
        "disclaimer": "这是 TradeMind 对历史档案的研究框架蒸馏，不代表或模仿 Serenity 本人，也不构成交易指令。",
    }
