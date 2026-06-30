import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { trackedWallets, type TrackedWalletRow } from "@/lib/db/schema";

/** tracked_wallets I/O (module 7), with in-memory fallback. */

const g = globalThis as unknown as { __trenchWallets?: TrackedWalletRow[]; __trenchWalletId?: number };
function mem(): TrackedWalletRow[] {
  if (!g.__trenchWallets) g.__trenchWallets = [];
  return g.__trenchWallets;
}

export async function listWallets(activeOnly = false): Promise<TrackedWalletRow[]> {
  const db = getDb();
  if (!db) {
    const rows = [...mem()].sort((a, b) => b.addedTs - a.addedTs);
    return activeOnly ? rows.filter((r) => r.active) : rows;
  }
  const rows = await db.select().from(trackedWallets);
  const sorted = rows.sort((a, b) => b.addedTs - a.addedTs);
  return activeOnly ? sorted.filter((r) => r.active) : sorted;
}

export async function addWallet(address: string, label = ""): Promise<TrackedWalletRow> {
  const db = getDb();
  const now = Date.now();
  if (!db) {
    const existing = mem().find((w) => w.address === address);
    if (existing) {
      existing.active = true;
      existing.label = label || existing.label;
      return existing;
    }
    g.__trenchWalletId = (g.__trenchWalletId ?? 0) + 1;
    const row: TrackedWalletRow = { id: g.__trenchWalletId, address, label, addedTs: now, active: true };
    mem().push(row);
    return row;
  }
  const [row] = await db
    .insert(trackedWallets)
    .values({ address, label, addedTs: now, active: true })
    .onConflictDoUpdate({ target: trackedWallets.address, set: { active: true, label } })
    .returning();
  return row;
}

export async function removeWallet(address: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    const before = mem().length;
    g.__trenchWallets = mem().filter((w) => w.address !== address);
    return g.__trenchWallets.length < before;
  }
  await db.delete(trackedWallets).where(eq(trackedWallets.address, address));
  return true;
}
