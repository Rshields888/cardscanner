import { NextResponse } from "next/server";
export const runtime = "edge";
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoints: [
      "/api/health/ebay/env",
      "/api/health/ebay/token",
      "/api/health/ebay?q=2018%20Panini%20Prizm%20Luka%20Doncic%20%23280&limit=5"
    ]
  });
}