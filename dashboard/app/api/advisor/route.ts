import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import path from "path";

const PROJECT_ROOT = path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent");
const PYTHONPATH =
  [
    PROJECT_ROOT,
    process.env.PYTHONPATH,
    path.join(process.env.HOME || "~", "Desktop/AI量化/futures_quant/.venv/lib/python3.13/site-packages"),
  ].filter(Boolean).join(":");

function runAdvisor(payload: Record<string, unknown>) {
  const child = spawnSync("python3", ["-m", "agent.loops.advisor_cli"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONPATH },
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 3 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(child.stderr || child.stdout || `advisor exited ${child.status}`);
  }
  return JSON.parse(child.stdout);
}

export async function GET() {
  try {
    return NextResponse.json(runAdvisor({}));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "advisor failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json(runAdvisor(body || {}));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "advisor failed" }, { status: 500 });
  }
}
