"""
Restore the bundled TradeMind seed database.

The seed contains Serenity intel, collection windows, daily price cache, and
default rules. It intentionally excludes trades, decisions, theses, and snapshots.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from agent.config import TRADEMIND_DB

SEED_DB = Path(__file__).resolve().parents[1] / "db" / "seed" / "trademind_seed.sqlite"


def restore_seed_db(*, target: Path = TRADEMIND_DB, force: bool = False) -> Path:
    target = target.expanduser()
    if not SEED_DB.exists():
        raise FileNotFoundError(f"Seed database not found: {SEED_DB}")
    if target.exists() and not force:
        raise FileExistsError(f"Target database already exists: {target}. Use --force to overwrite.")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SEED_DB, target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore bundled TradeMind seed database.")
    parser.add_argument("--target", default=str(TRADEMIND_DB), help="Target SQLite path")
    parser.add_argument("--force", action="store_true", help="Overwrite target if it exists")
    args = parser.parse_args()

    restored = restore_seed_db(target=Path(args.target), force=args.force)
    print(f"Restored seed database to {restored}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
