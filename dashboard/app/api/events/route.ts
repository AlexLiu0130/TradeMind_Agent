import { NextRequest, NextResponse } from "next/server";
import { getDashboardEvents } from "@/lib/eventsData";

export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 14;
  return NextResponse.json(await getDashboardEvents(days));
}
