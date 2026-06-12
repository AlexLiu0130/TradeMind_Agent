import { NextRequest, NextResponse } from "next/server";
import { getMarketRegime } from "@/lib/marketRegimeData";

export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const data = await getMarketRegime(fresh);
  return NextResponse.json(data);
}
