import pytest
from agent import journal_store as js


@pytest.fixture(autouse=True)
def fresh_db(tmp_path):
    db_file = str(tmp_path / "test.db")
    js.init_db(db_file)
    yield db_file
    js._DB_PATH = None
