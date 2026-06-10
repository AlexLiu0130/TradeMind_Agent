import sqlite3

from agent.loops.restore_seed_db import restore_seed_db


def test_restore_seed_db_copies_bundled_serenity_data(tmp_path):
    target = tmp_path / "trademind.db"

    restored = restore_seed_db(target=target)

    assert restored == target
    with sqlite3.connect(target) as con:
        intel_count = con.execute("SELECT COUNT(*) FROM intel_items").fetchone()[0]
        trade_count = con.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
        decision_count = con.execute("SELECT COUNT(*) FROM decisions").fetchone()[0]

    assert intel_count == 2449
    assert trade_count == 0
    assert decision_count == 0
