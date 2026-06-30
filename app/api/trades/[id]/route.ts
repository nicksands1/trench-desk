import { NextResponse } from "next/server";
import { z } from "zod";
import { closeTrade } from "@/lib/db/trades";
import { getState } from "@/lib/db/state";

export const dynamic = "force-dynamic";

const CloseBody = z
  .object({
    resultPct: z.number().min(-1).max(100),
    emotionalState: z
      .enum(["calm", "confident", "fomo", "revenge", "bored", "tilted", "fearful"])
      .optional(),
    ruleBreaks: z.array(z.string()).optional(),
    note: z.string().max(2000).optional(),
    followedLadder: z.boolean().optional(),
    stoppedOut: z.boolean().optional(),
    exits: z
      .array(z.object({ multiple: z.number(), fraction: z.number() }))
      .optional(),
  })
  .strict();

/**
 * PATCH /api/trades/[id] — close a trade. Mutates trading_state per doctrine
 * (cooldown on a stop-out, daily-stop recompute, loss streak, bankroll, P&L,
 * no-flip ticker). Returns the closed trade + the new state.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tradeId = Number.parseInt(id, 10);
  if (!Number.isFinite(tradeId)) {
    return NextResponse.json({ error: "invalid trade id" }, { status: 400 });
  }
  const json = await req.json().catch(() => null);
  const parsed = CloseBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const trade = await closeTrade(tradeId, parsed.data);
  if (!trade) {
    return NextResponse.json({ error: "trade not found" }, { status: 404 });
  }
  const state = await getState();
  return NextResponse.json({ trade, state });
}
