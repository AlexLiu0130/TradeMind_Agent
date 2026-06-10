import { NextRequest, NextResponse } from "next/server";
import { getPortfolioDashboard } from "@/lib/portfolioData";
import { buildWheelCardsFromDashboard } from "@/lib/wheel";

export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const { dashboard, cached, stale } = getPortfolioDashboard({ fresh });
  const wheels = buildWheelCardsFromDashboard(dashboard);

  return NextResponse.json({
    source: stale ? "positions_stale_cache" : cached ? "positions_cache" : "positions_live",
    stale: Boolean(stale),
    wheels,
  });
}
