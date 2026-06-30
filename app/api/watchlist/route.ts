import { NextResponse } from "next/server";
import { listCandidates } from "@/lib/db/candidates";
import type { Verdict } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/watchlist — surfaced candidates (GREEN) by default.
 *   ?all=1            include YELLOW/quiet candidates too
 *   ?verdict=GREEN    filter by verdict
 *   ?status=watching  filter by status
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const verdict = url.searchParams.get("verdict") as Verdict | null;
  const status = url.searchParams.get("status") ?? undefined;

  const rows = await listCandidates({
    surfacedOnly: !all && !verdict,
    verdict: verdict ?? undefined,
    status,
  });

  return NextResponse.json({ candidates: rows, count: rows.length });
}
