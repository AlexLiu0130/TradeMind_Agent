import { NextRequest, NextResponse } from "next/server";
import { getMarketSeries } from "@/lib/marketSeriesData";

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "3mo";
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const data = await getMarketSeries(range, fresh);
  return NextResponse.json(data);
}
