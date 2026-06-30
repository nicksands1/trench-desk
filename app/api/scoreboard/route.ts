import { NextResponse } from "next/server";
import { listAllSignals } from "@/lib/db/signals";
import { computeScoreboard } from "@/lib/scoreboard/aggregate";

export const dynamic = "force-dynamic";

/** GET /api/scoreboard — per-preset forward-test stats + recommendations. */
export async function GET() {
  const signals = await listAllSignals();
  const board = computeScoreboard(signals);
  return NextResponse.json(board);
}
