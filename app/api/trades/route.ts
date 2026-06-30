import { NextResponse } from "next/server";
import { z } from "zod";
import { listTrades, insertTrade, openTradeCount } from "@/lib/db/trades";
import { getState } from "@/lib/db/state";
import { getCachedReport, runSafety } from "@/lib/safety";
import { evaluateGate, type GateState } from "@/lib/discipline";
import { sizing, exitLadder } from "@/lib/doctrine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const rows = await listTrades(status === "open" || status === "closed" ? status : undefined);
  return NextResponse.json({ trades: rows, count: rows.length });
}

const OpenBody = z
  .object({
    ca: z.string().min(32).max(44),
    ticker: z.string().min(1).max(32),
    sizeUsd: z.number().positive(),
    entry: z.number().positive().optional(),
    preset: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
    thesis: z.string().min(1),
    invalidation: z.string().min(1),
    notFomoChase: z.boolean(),
  })
  .strict();

/**
 * POST /api/trades — open a trade from a CLEARED gate. The gate is re-evaluated
 * server-side (defense in depth); a non-cleared gate is rejected. RED stands down.
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = OpenBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  // Verdict: prefer cache, compute on miss.
  const report = (await getCachedReport(body.ca)) ?? (await runSafety(body.ca, { symbol: body.ticker }));
  const state = await getState();
  const openPositions = await openTradeCount();

  const gateState: GateState = {
    bankroll: state.bankroll,
    consecutiveLosses: state.consecutiveLosses,
    cooldownUntil: state.cooldownUntil,
    dailyStopHit: state.dailyStopHit,
    lastExitedTickers: state.lastExitedTickers,
    openPositions,
    config: state.config,
  };

  const result = evaluateGate(
    gateState,
    {
      ca: body.ca,
      ticker: body.ticker,
      verdict: report.verdict,
      thesis: body.thesis,
      invalidation: body.invalidation,
      exitLadderDefined: true,
      intendedSizeUsd: body.sizeUsd,
      notFomoChase: body.notFomoChase,
    },
    Date.now(),
  );

  if (!result.cleared) {
    return NextResponse.json(
      { error: "gate not cleared", standDown: result.standDown, findings: result.findings },
      { status: 422 },
    );
  }

  const s = sizing(state.bankroll);
  const sizePct = state.bankroll > 0 ? body.sizeUsd / state.bankroll : 0;
  const trade = await insertTrade({
    ca: body.ca,
    ticker: body.ticker,
    preset: body.preset,
    openedAt: Date.now(),
    entry: body.entry ?? report.liquidityUsd ?? 0,
    sizeUsd: body.sizeUsd,
    sizePct,
    phase: s.phase.id,
    thesis: body.thesis,
    invalidation: body.invalidation,
    exitLadder: exitLadder(state.config.exitMode),
    status: "open",
    ruleBreaks: result.findings.filter((f) => f.severity === "warn").map((f) => f.code),
    note: "",
    stoppedOut: false,
  });

  return NextResponse.json({ trade });
}
