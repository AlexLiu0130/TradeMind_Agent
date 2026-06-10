"""
Chat CLI — thin stdin/stdout bridge so the Next.js dashboard can reach the orchestrator.

Usage (the dashboard spawns this; you normally don't run it by hand):
    echo '{"message": "分析 NVDA", "ticker": "NVDA"}' | python3 -m agent.chat_cli

Contract:
    stdin  : one JSON object {"message": str, "ticker": str | null}
    stdout : one JSON object — orchestrator output on success, or {"error": str} on failure.
             Always exits 0 with valid JSON so the caller never has to parse a stack trace.
"""
import json
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid JSON on stdin"}))
        return

    message = payload.get("message")
    if not message or not isinstance(message, str):
        print(json.dumps({"error": "Missing 'message' field"}))
        return

    try:
        from agent.orchestrator import run
        result = run(message, ticker=payload.get("ticker"))
    except ImportError as e:
        result = {"error": f"Agent dependency missing ({e}). Run: pip install -r requirements.txt"}
    except RuntimeError as e:
        # e.g. OPENAI_API_KEY not set
        result = {"error": str(e)}
    except Exception as e:  # noqa: BLE001 — surface anything else as a clean JSON error
        result = {"error": f"Agent failed: {type(e).__name__}: {e}"}

    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
