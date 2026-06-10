import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import path from "path";

const PROJECT_ROOT = path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent");

export async function POST(req: NextRequest) {
  let body: { query?: string; ticker?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = String(body.query || body.ticker || "").trim();
  const ticker = body.ticker ? String(body.ticker).trim().toUpperCase() : null;
  if (!query && !ticker) {
    return NextResponse.json({ error: "query or ticker is required" }, { status: 400 });
  }

  try {
    const out = execFileSync("python3", ["-m", "agent.loops.serenity_lens_cli"], {
      cwd: PROJECT_ROOT,
      input: JSON.stringify({ query, ticker, limit: body.limit || 80 }),
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: PROJECT_ROOT },
    });
    const data = JSON.parse(out.toString());
    const status = data.error ? 400 : 200;
    return NextResponse.json(data, { status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Serenity Lens failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
