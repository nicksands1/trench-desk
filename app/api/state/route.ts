import { NextResponse } from "next/server";
import { z } from "zod";
import { getState, updateState, updateConfig } from "@/lib/db/state";
import { sizing, exitLadder, type ExitMode } from "@/lib/doctrine";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  const s = sizing(state.bankroll);
  return NextResponse.json({
    state,
    sizing: s,
    ladder: exitLadder(state.config.exitMode),
  });
}

const ConfigPatch = z
  .object({
    dailyStopPct: z.number().min(0).max(1).optional(),
    maxConsecLosses: z.number().int().min(1).max(50).optional(),
    cooldownMin: z.number().min(0).max(1440).optional(),
    exitMode: z.enum(["A", "B"]).optional(),
  })
  .strict();

const PatchBody = z
  .object({
    bankroll: z.number().min(0).optional(),
    config: ConfigPatch.optional(),
  })
  .strict();

export async function PATCH(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.config) {
    await updateConfig({
      ...parsed.data.config,
      exitMode: parsed.data.config.exitMode as ExitMode | undefined,
    });
  }
  if (parsed.data.bankroll !== undefined) {
    await updateState({ bankroll: parsed.data.bankroll });
  }
  const state = await getState();
  return NextResponse.json({ state, sizing: sizing(state.bankroll) });
}
