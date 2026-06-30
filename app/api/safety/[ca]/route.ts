import { NextResponse } from "next/server";
import { runSafety, getCachedReport } from "@/lib/safety";

export const dynamic = "force-dynamic";

/**
 * GET /api/safety/[ca] — serve a cached safety report. Computes one on a miss
 * (runSafety caches it). `?refresh=1` forces a recompute. Never trades.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ca: string }> },
) {
  const { ca } = await params;
  if (!ca || ca.length < 32 || ca.length > 44) {
    return NextResponse.json({ error: "invalid contract address" }, { status: 400 });
  }
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  if (!refresh) {
    const cached = await getCachedReport(ca);
    if (cached) return NextResponse.json({ report: cached, cached: true });
  }
  const report = await runSafety(ca, { force: refresh });
  return NextResponse.json({ report, cached: false });
}
