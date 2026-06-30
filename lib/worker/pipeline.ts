import { eq, and } from "drizzle-orm";
import type { PresetLetter, SignalSource, SafetyReport } from "@/lib/types";
import { runSafety, upsertCandidateFromReport } from "@/lib/safety";
import { alertCandidate } from "@/lib/notify/telegram";
import { getDb } from "@/lib/db/client";
import { signals } from "@/lib/db/schema";
import { getDexStats } from "@/lib/sources/dexscreener";

/**
 * The shared per-candidate pipeline used by the scout (module 1) and every
 * screener loop (modules 5-7):
 *
 *   runSafety → RED dropped → else surface (GREEN) / keep quiet (YELLOW)
 *             → optionally write a paper `signals` row (forward-test log)
 *             → optional Telegram alert (GREEN only)
 *
 * §0: this finds and flags. It NEVER trades.
 */

export interface PipelineOpts {
  symbol?: string;
  source: SignalSource;
  preset?: PresetLetter;
  ageMinutes?: number;
  /** Write a forward-test `signals` row (deduped on ca+preset). Default false. */
  writeSignal?: boolean;
  /** Alert on GREEN (default true). */
  alert?: boolean;
}

export interface PipelineResult {
  report: SafetyReport;
  dropped: boolean;
  surfaced: boolean;
  signalWritten: boolean;
}

/** Insert a forward-test signal row, deduped on (ca, preset). */
async function writeSignalRow(
  report: SafetyReport,
  opts: PipelineOpts,
): Promise<boolean> {
  const db = getDb();
  if (!db || !opts.preset) return false;
  // Dedupe: one signal per (ca, preset).
  const existing = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.ca, report.ca), eq(signals.preset, opts.preset)))
    .limit(1);
  if (existing[0]) return false;

  // Entry price/liquidity snapshot for outcome tracking (module 8).
  const dex = await getDexStats(report.ca);
  await db
    .insert(signals)
    .values({
      ts: Date.now(),
      ca: report.ca,
      symbol: report.symbol,
      preset: opts.preset,
      entryPrice: dex?.priceUsd,
      entryMcap: dex?.mcapUsd ?? report.mcapUsd,
      liquidity: dex?.liquidityUsd ?? report.liquidityUsd,
      holders: undefined,
      verdict: report.verdict,
      source: opts.source,
      outcome: "pending",
    })
    .onConflictDoNothing();
  return true;
}

export async function processCandidate(
  ca: string,
  opts: PipelineOpts,
): Promise<PipelineResult> {
  const report = await runSafety(ca, { symbol: opts.symbol });

  if (report.verdict === "RED") {
    // Hard-fail: dropped. The report stays cached; nothing surfaces.
    return { report, dropped: true, surfaced: false, signalWritten: false };
  }

  // YELLOW = quiet watchlist entry; GREEN = surfaced.
  await upsertCandidateFromReport(report, {
    source: opts.source,
    preset: opts.preset,
    ageMinutes: opts.ageMinutes,
  });

  let signalWritten = false;
  if (opts.writeSignal) {
    signalWritten = await writeSignalRow(report, opts);
  }

  const surfaced = report.verdict === "GREEN";
  if (surfaced && opts.alert !== false) {
    await alertCandidate(report, { preset: opts.preset, source: opts.source });
  }

  return { report, dropped: false, surfaced, signalWritten };
}
