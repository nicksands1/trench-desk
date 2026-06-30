import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tradingState, type TradingStateRow } from "@/lib/db/schema";
import { DEFAULT_CONFIG, type DoctrineConfig } from "@/lib/doctrine";

/**
 * trading_state helper. The desk's live discipline state lives in a single row
 * (id = 1). When no DATABASE_URL is configured we keep an in-memory singleton so
 * the dashboard, gate, and journal remain interactive within a process — writes
 * just don't persist across restarts.
 */

export const SINGLETON_ID = 1;

export function todayStr(d: Date = new Date()): string {
  // YYYY-MM-DD in UTC; the desk treats a "day" as a UTC calendar day.
  return d.toISOString().slice(0, 10);
}

export function defaultState(bankroll = 0): TradingStateRow {
  return {
    id: SINGLETON_ID,
    bankroll,
    day: todayStr(),
    dayStartBankroll: bankroll,
    tradesToday: 0,
    pnlTodayUsd: 0,
    pnlTodayPct: 0,
    consecutiveLosses: 0,
    cooldownUntil: 0,
    dailyStopHit: false,
    lastExitedTickers: [],
    config: { ...DEFAULT_CONFIG },
  };
}

// In-memory fallback for the no-DB path.
const g = globalThis as unknown as { __trenchState?: TradingStateRow };
function memState(): TradingStateRow {
  if (!g.__trenchState) g.__trenchState = defaultState();
  return g.__trenchState;
}

/** Roll the day over if the stored day is stale (resets daily counters). */
function rollDay(s: TradingStateRow): TradingStateRow {
  const today = todayStr();
  if (s.day === today) return s;
  return {
    ...s,
    day: today,
    dayStartBankroll: s.bankroll,
    tradesToday: 0,
    pnlTodayUsd: 0,
    pnlTodayPct: 0,
    dailyStopHit: false,
    // consecutiveLosses and cooldown persist across the day boundary intentionally.
  };
}

/** Read the current state, creating/normalizing the singleton as needed. */
export async function getState(): Promise<TradingStateRow> {
  const db = getDb();
  if (!db) {
    const rolled = rollDay(memState());
    g.__trenchState = rolled;
    return rolled;
  }
  const rows = await db
    .select()
    .from(tradingState)
    .where(eq(tradingState.id, SINGLETON_ID))
    .limit(1);
  let row = rows[0];
  if (!row) {
    const seed = defaultState();
    await db.insert(tradingState).values(seed).onConflictDoNothing();
    row = seed;
  }
  const rolled = rollDay(row);
  if (rolled !== row) {
    await db
      .update(tradingState)
      .set(rolled)
      .where(eq(tradingState.id, SINGLETON_ID));
  }
  return rolled;
}

/** Apply a partial update to the singleton and return the new state. */
export async function updateState(
  patch: Partial<Omit<TradingStateRow, "id">>,
): Promise<TradingStateRow> {
  const current = await getState();
  const next: TradingStateRow = { ...current, ...patch, id: SINGLETON_ID };
  const db = getDb();
  if (!db) {
    g.__trenchState = next;
    return next;
  }
  await db
    .update(tradingState)
    .set({ ...patch })
    .where(eq(tradingState.id, SINGLETON_ID));
  return next;
}

/** Merge a config patch (keeps unspecified config keys). */
export async function updateConfig(
  patch: Partial<DoctrineConfig>,
): Promise<TradingStateRow> {
  const current = await getState();
  const config: DoctrineConfig = { ...current.config, ...patch };
  return updateState({ config });
}
