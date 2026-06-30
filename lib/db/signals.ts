import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { signals, type SignalRow } from "@/lib/db/schema";
import type { SignalOutcome } from "@/lib/types";

/**
 * signals I/O. Signals are only written when a DB is present (writeSignalRow
 * no-ops otherwise), so these reads return [] without a DB — the scoreboard is
 * inherently a DB-backed, forward-test-over-time view.
 */

export async function listPendingSignals(limit = 100): Promise<SignalRow[]> {
  const db = getDb();
  if (!db) return [];
  return db.select().from(signals).where(eq(signals.outcome, "pending")).limit(limit);
}

export async function listAllSignals(limit = 2000): Promise<SignalRow[]> {
  const db = getDb();
  if (!db) return [];
  return db.select().from(signals).orderBy(desc(signals.ts)).limit(limit);
}

export async function updateSignalOutcome(
  id: number,
  patch: { outcome?: SignalOutcome; maxMultiple?: number | undefined; resolvedTs?: number },
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.update(signals).set(patch).where(eq(signals.id, id));
}
