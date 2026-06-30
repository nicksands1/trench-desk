import { eq, and } from "drizzle-orm";
import type { PresetLetter, SignalSource, SafetyReport } from "@/lib/types";
import { getDb } from "@/lib/db/client";
import { signals } from "@/lib/db/schema";
import { getDexStats } from "@/lib/sources/dexscreener";

/**
 * Write a forward-test `signals` row, deduped on (ca, preset). Captures an entry
 * price/liquidity snapshot so the outcome tracker (module 8) can resolve it later.
 * No-op without a DB. Returns true if a new row was written.
 */
export async function writeSignalRow(
  report: SafetyReport,
  meta: { source: SignalSource; preset: PresetLetter; holders?: number },
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const existing = await db
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.ca, report.ca), eq(signals.preset, meta.preset)))
    .limit(1);
  if (existing[0]) return false;

  const dex = await getDexStats(report.ca);
  await db
    .insert(signals)
    .values({
      ts: Date.now(),
      ca: report.ca,
      symbol: report.symbol,
      preset: meta.preset,
      entryPrice: dex?.priceUsd,
      entryMcap: dex?.mcapUsd ?? report.mcapUsd,
      liquidity: dex?.liquidityUsd ?? report.liquidityUsd,
      holders: meta.holders,
      verdict: report.verdict,
      source: meta.source,
      outcome: "pending",
    })
    .onConflictDoNothing();
  return true;
}
