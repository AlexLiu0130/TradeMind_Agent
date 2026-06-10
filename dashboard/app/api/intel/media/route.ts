import { getDb } from "@/lib/db";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const PROJECT_ROOT = path.join(process.env.HOME || "~", "Desktop/TradeMind_Agent");

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "valid id required" }, { status: 400 });
  }
  const db = getDb();
  const row = db.prepare("SELECT media_path, media_mime FROM intel_items WHERE id=?").get(id) as
    | { media_path: string | null; media_mime: string | null }
    | undefined;
  if (!row?.media_path) {
    return NextResponse.json({ error: "media not found" }, { status: 404 });
  }
  const abs = path.resolve(PROJECT_ROOT, row.media_path);
  const allowed = path.resolve(PROJECT_ROOT, "agent/db/intel_media");
  if (!abs.startsWith(allowed)) {
    return NextResponse.json({ error: "media path rejected" }, { status: 403 });
  }
  try {
    const bytes = readFileSync(abs);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": row.media_mime || "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "media file missing" }, { status: 404 });
  }
}
