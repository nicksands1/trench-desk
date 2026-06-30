import { and, eq, gte, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { holderSnapshots } from "@/lib/db/schema";
import type { HolderPoint } from "@/lib/screener/velocity";

/** Holder-snapshot I/O (module 6), with in-memory fallback. */

const g = globalThis as unknown as { __trenchHolders?: Map<string, HolderPoint[]> };
function mem(): Map<string, HolderPoint[]> {
  if (!g.__trenchHolders) g.__trenchHolders = new Map();
  return g.__trenchHolders;
}

export async function insertHolderSnapshot(ca: string, holders: number, ts = Date.now()): Promise<void> {
  const db = getDb();
  if (!db) {
    const arr = mem().get(ca) ?? [];
    arr.push({ ts, holders });
    // keep ~24h of 5-min samples max
    mem().set(ca, arr.slice(-300));
    return;
  }
  await db.insert(holderSnapshots).values({ ca, ts, holders });
}

export async function getHolderPoints(ca: string, sinceMs?: number): Promise<HolderPoint[]> {
  const since = sinceMs ?? Date.now() - 2 * 60 * 60_000; // default last 2h
  const db = getDb();
  if (!db) {
    return (mem().get(ca) ?? []).filter((p) => p.ts >= since);
  }
  const rows = await db
    .select({ ts: holderSnapshots.ts, holders: holderSnapshots.holders })
    .from(holderSnapshots)
    .where(and(eq(holderSnapshots.ca, ca), gte(holderSnapshots.ts, since)))
    .orderBy(desc(holderSnapshots.ts))
    .limit(500);
  return rows.map((r) => ({ ts: r.ts, holders: r.holders }));
}
