"""Knowledge base retrieval tests — run against the committed local knowledge dir."""
from agent import knowledge


def test_local_discipline_doc_is_indexed():
    topics = knowledge.list_topics()
    sources = {t["source"] for t in topics}
    assert "trading_discipline" in sources


def test_search_finds_relevant_section():
    res = knowledge.search("when should I roll a short put position")
    assert res["results"], "expected at least one matching section"
    blob = " ".join(r["heading"] + r["excerpt"] for r in res["results"]).lower()
    assert "roll" in blob


def test_search_no_match_falls_back_to_topics():
    res = knowledge.search("zzzqqq xyzzyfoo qwxzvbar")
    assert res["results"] == []
    assert res["available_topics"], "should list available topics when nothing matches"
