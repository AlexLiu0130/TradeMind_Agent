import { NextRequest, NextResponse } from "next/server";
import { getPortfolioDashboard } from "@/lib/portfolioData";

export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  return NextResponse.json(getPortfolioDashboard({ fresh }));
}
