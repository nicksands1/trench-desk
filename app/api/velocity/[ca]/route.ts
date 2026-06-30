import { NextResponse } from "next/server";
import { getHolderPoints } from "@/lib/db/holders";
import { computeVelocity } from "@/lib/screener/velocity";

export const dynamic = "force-dynamic";

/** GET /api/velocity/[ca] — holder-velocity series + computed net-new/accel. */
export async function GET(_req: Request, { params }: { params: Promise<{ ca: string }> }) {
  const { ca } = await params;
  if (!ca || ca.length < 32 || ca.length > 44) {
    return NextResponse.json({ error: "invalid contract address" }, { status: 400 });
  }
  const points = await getHolderPoints(ca);
  const velocity = computeVelocity(points);
  return NextResponse.json({ ca, velocity, points });
}
