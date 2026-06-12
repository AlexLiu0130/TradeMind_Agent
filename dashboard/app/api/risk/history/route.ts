import { NextRequest, NextResponse } from "next/server";
import { getRiskHistory } from "@/lib/riskHistoryData";

export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
  return NextResponse.json(getRiskHistory(days));
}
