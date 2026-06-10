import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

// Project root = two levels up from dashboard/app/api/chat -> dashboard, then ..
const PROJECT_ROOT =
  process.env.TRADEMIND_ROOT ||
  path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent");

const SCRIPTS =
  process.env.IBKR_SCRIPTS_DIR ||
  path.join(process.env.HOME || "~", "Desktop/ibkr-options-assistant/scripts");

// Python interpreter used to run the agent. Must have `openai` installed
// (pip install -r requirements.txt). Override with TRADEMIND_PYTHON if needed.
const PYTHON = process.env.TRADEMIND_PYTHON || "python3";

// The agent's IBKR tools shell out to scripts that import `ib_async`, which lives
// in the futures_quant venv. Put PROJECT_ROOT first (so `import agent` resolves),
// then the venv site-packages so those scripts can reach IBKR. Same venv the
// positions/trades routes already use.
const IB_SITE_PACKAGES =
  process.env.IBKR_PYTHONPATH ||
  path.join(process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages");
const AGENT_PYTHONPATH = `${PROJECT_ROOT}${path.delimiter}${IB_SITE_PACKAGES}`;

// gpt-5.4 is a reasoning model; a portfolio question can take several tool rounds,
// each with its own IBKR Gateway round-trip. Give it generous headroom (override
// with AGENT_TIMEOUT_MS). Async spawn keeps the Next event loop free meanwhile.
// Backstop only — the agent enforces its own ~70s wall-clock budget and always
// returns an answer well before this. Override with AGENT_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? "150000");

interface AgentResult {
  error?: string;
  [k: string]: unknown;
}

function runAgent(message: string, ticker: string | null): Promise<AgentResult> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-m", "agent.chat_cli"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, IBKR_SCRIPTS_DIR: SCRIPTS, PYTHONPATH: AGENT_PYTHONPATH },
    });

    let stdout = "";
    let stdoutBytes = 0;
    const MAX_STDOUT = 2 * 1024 * 1024; // 2 MB — agent output beyond this is a bug
    let settled = false;
    const finish = (r: AgentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr?.destroy();
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ error: "Agent timed out — 分析耗时过长（多轮工具调用 + 模型推理）。可缩小问题范围或稍后重试。" });
    }, TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => {
      stdoutBytes += d.length;
      if (stdoutBytes > MAX_STDOUT) {
        child.kill("SIGKILL");
        finish({ error: "Agent output too large — 输出超过 2MB，请缩小问题范围。" });
        return;
      }
      stdout += d.toString();
    });
    child.on("error", (e) => finish({ error: `Agent process failed: ${e.message}` }));
    child.on("close", () => {
      try {
        finish(JSON.parse(stdout));
      } catch {
        finish({ error: "Agent returned no parseable output" });
      }
    });

    child.stdin.write(JSON.stringify({ message, ticker }));
    child.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  let body: { message?: string; ticker?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const result = await runAgent(body.message, body.ticker ?? null);
  // chat_cli (and our own guards) always resolve to JSON; surface {error} as 503.
  return result.error
    ? NextResponse.json(result, { status: 503 })
    : NextResponse.json(result);
}
