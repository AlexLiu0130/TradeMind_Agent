"""
knowledge.py — a tiny, dependency-free knowledge base over local markdown.

Sources (config.KNOWLEDGE_DIRS): the IBKR skill's `references/` (strategy, greeks,
wheel mechanics, troubleshooting) plus the trader's own `agent/knowledge/` notes.

Retrieval is deliberately simple: split each doc into sections by `##` headings,
score sections by query-term overlap, return the best few. No embeddings, no index,
no network — good enough to ground the Agent's answers in method, and trivial to read.
"""
import re
from pathlib import Path

from agent.config import KNOWLEDGE_DIRS

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset({
    "the", "a", "an", "of", "to", "in", "is", "and", "or", "for", "on", "with",
    "what", "how", "why", "do", "does", "my", "i", "it", "this", "that", "are",
})


def _docs() -> list[tuple[str, str]]:
    """Yield (source_name, text) for every markdown file in the knowledge dirs."""
    out: list[tuple[str, str]] = []
    for d in KNOWLEDGE_DIRS:
        p = Path(d)
        if not p.is_dir():
            continue
        for f in sorted(p.glob("*.md")):
            try:
                out.append((f.stem, f.read_text(encoding="utf-8")))
            except OSError:
                continue
    return out


def _sections(text: str) -> list[tuple[str, str]]:
    """Split a markdown doc into (heading, body) sections on '#'/'##' lines."""
    sections: list[tuple[str, str]] = []
    heading = ""
    buf: list[str] = []
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            if buf:
                sections.append((heading, "\n".join(buf).strip()))
                buf = []
            heading = line.lstrip("# ").strip()
        else:
            buf.append(line)
    if buf:
        sections.append((heading, "\n".join(buf).strip()))
    return [(h, b) for h, b in sections if b]


def _terms(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP and len(w) > 1}


def list_topics() -> list[dict]:
    """Available knowledge docs with their title (first heading)."""
    topics = []
    for name, text in _docs():
        first = next((l.lstrip("# ").strip() for l in text.splitlines() if l.lstrip().startswith("#")), name)
        topics.append({"source": name, "title": first})
    return topics


def search(query: str, max_results: int = 4) -> dict:
    """
    Return the best-matching sections across the knowledge base for `query`.
    Each result: {source, heading, excerpt}. Falls back to listing topics when
    nothing matches, so the caller always gets something actionable.
    """
    q = _terms(query)
    scored: list[tuple[int, str, str, str]] = []
    for name, text in _docs():
        for heading, body in _sections(text):
            terms = _terms(heading) | _terms(body)
            overlap = len(q & terms)
            if overlap:
                # Light boost when the query hits the heading directly.
                score = overlap + (2 if q & _terms(heading) else 0)
                scored.append((score, name, heading, body))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [
        {"source": name, "heading": heading, "excerpt": body[:1200]}
        for _, name, heading, body in scored[:max_results]
    ]
    if not results:
        return {"query": query, "results": [], "available_topics": list_topics()}
    return {"query": query, "results": results}
