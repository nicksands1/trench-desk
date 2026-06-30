import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { candidates, type CandidateRow } from "@/lib/db/schema";

/** Read helpers for the watchlist (candidates table). Degrade to [] without DB. */

export interface WatchlistQuery {
  /** Only surfaced (GREEN) candidates when true (default). */
  surfacedOnly?: boolean;
  verdict?: "GREEN" | "YELLOW" | "RED";
  status?: string;
  limit?: number;
}

export async function listCandidates(q: WatchlistQuery = {}): Promise<CandidateRow[]> {
  const db = getDb();
  if (!db) return [];
  const surfacedOnly = q.surfacedOnly ?? true;
  let rows = await db
    .select()
    .from(candidates)
    .orderBy(desc(candidates.lastSeen))
    .limit(q.limit ?? 200);
  if (surfacedOnly) rows = rows.filter((r) => r.surfaced);
  if (q.verdict) rows = rows.filter((r) => r.verdict === q.verdict);
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  return rows;
}

export async function getCandidate(ca: string): Promise<CandidateRow | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(candidates).where(eq(candidates.ca, ca)).limit(1);
  return rows[0] ?? null;
}
