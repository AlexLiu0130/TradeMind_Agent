import { NextRequest, NextResponse } from "next/server";
import { getMarketOverview } from "@/lib/marketData";

export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const overview = await getMarketOverview({ fresh });
  return NextResponse.json(overview);
}
