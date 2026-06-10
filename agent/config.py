import os
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """
    Load KEY=VALUE pairs from the project-root .env into os.environ, without
    overriding variables already set in the real environment (explicit env wins).
    Zero-dependency: a tiny parser, not python-dotenv. Lines starting with # are
    comments; surrounding quotes on values are stripped.
    """
    env_file = _PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()

IBKR_SCRIPTS_DIR = Path(
    os.environ.get("IBKR_SCRIPTS_DIR", "~/Desktop/ibkr-options-assistant/scripts")
).expanduser()

TRADEMIND_DB = Path(
    os.environ.get("TRADEMIND_DB", "~/Desktop/TradeMind_Agent/agent/db/trademind.db")
).expanduser()

# Agent behavior + knowledge.
# - PROMPTS_DIR: editable markdown that defines the Agent's system prompt.
# - KNOWLEDGE_DIRS: markdown the Agent can retrieve from — the IBKR skill's
#   strategy/greeks references plus the trader's own local discipline notes.
PROMPTS_DIR = _PROJECT_ROOT / "agent" / "prompts"
KNOWLEDGE_DIRS = [
    Path(os.environ.get("KNOWLEDGE_DIR", str(IBKR_SCRIPTS_DIR.parent / "references"))).expanduser(),
    _PROJECT_ROOT / "agent" / "knowledge",
]

# LLM provider — OpenAI-compatible Responses API (sssaicode Codex channel).
# The API key is read from OPENAI_API_KEY at runtime (never hard-coded here).
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4")
OPENAI_BASE_URL = os.environ.get(
    "OPENAI_BASE_URL", "https://node-cf.sssaicodeapi.com/api/v1"
)
# Reasoning models burn output tokens on hidden reasoning; keep the budget generous.
OPENAI_MAX_OUTPUT_TOKENS = int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "8000"))

# IBKR script result cache (reduces repeated Gateway round-trips).
# TTL in seconds; set 0 to disable. Data can be up to TTL seconds stale.
IBKR_CACHE_DIR = _PROJECT_ROOT / "agent" / "db" / "cache"
IBKR_CACHE_TTL = float(os.environ.get("IBKR_CACHE_TTL", "60"))
