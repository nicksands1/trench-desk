import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { trades, type TradeRow, type NewTradeRow } from "@/lib/db/schema";
import { getState, updateState } from "@/lib/db/state";
import { applyTradeClose, type CloseInput } from "@/lib/discipline";

/**
 * Trades I/O. Mirrors the no-DB degrade pattern: without a DATABASE_URL we keep
 * an in-memory list per process so the gate → journal flow stays interactive.
 */

const g = globalThis as unknown as { __trenchTrades?: TradeRow[]; __trenchTradeId?: number };
function mem(): TradeRow[] {
  if (!g.__trenchTrades) g.__trenchTrades = [];
  return g.__trenchTrades;
}
function nextMemId(): number {
  g.__trenchTradeId = (g.__trenchTradeId ?? 0) + 1;
  return g.__trenchTradeId;
}

export async function listTrades(status?: "open" | "closed"): Promise<TradeRow[]> {
  const db = getDb();
  if (!db) {
    const rows = [...mem()].sort((a, b) => b.openedAt - a.openedAt);
    return status ? rows.filter((r) => r.status === status) : rows;
  }
  if (status) {
    return db.select().from(trades).where(eq(trades.status, status)).orderBy(desc(trades.openedAt));
  }
  return db.select().from(trades).orderBy(desc(trades.openedAt));
}

export async function getTrade(id: number): Promise<TradeRow | null> {
  const db = getDb();
  if (!db) return mem().find((t) => t.id === id) ?? null;
  const rows = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function openTradeCount(): Promise<number> {
  const open = await listTrades("open");
  return open.length;
}

export async function insertTrade(values: NewTradeRow): Promise<TradeRow> {
  const db = getDb();
  if (!db) {
    const row: TradeRow = {
      id: nextMemId(),
      ca: values.ca,
      ticker: values.ticker ?? "",
      preset: values.preset ?? null,
      openedAt: values.openedAt,
      entry: values.entry ?? 0,
      sizeUsd: values.sizeUsd ?? 0,
      sizePct: values.sizePct ?? 0,
      phase: values.phase ?? 0,
      thesis: values.thesis ?? "",
      invalidation: values.invalidation ?? "",
      exitLadder: values.exitLadder ?? null,
      status: values.status ?? "open",
      exits: values.exits ?? null,
      resultUsd: values.resultUsd ?? null,
      resultPct: values.resultPct ?? null,
      holdingSecs: values.holdingSecs ?? null,
      followedLadder: values.followedLadder ?? null,
      emotionalState: values.emotionalState ?? null,
      ruleBreaks: values.ruleBreaks ?? [],
      note: values.note ?? "",
      stoppedOut: values.stoppedOut ?? false,
      closedAt: values.closedAt ?? null,
    };
    mem().push(row);
    return row;
  }
  const [row] = await db.insert(trades).values(values).returning();
  return row;
}

export interface CloseTradeInput {
  resultPct: number;
  emotionalState?: string;
  ruleBreaks?: string[];
  note?: string;
  followedLadder?: boolean;
  stoppedOut?: boolean;
  exits?: { multiple: number; fraction: number }[];
}

/**
 * Close a trade and apply the doctrine state mutation (cooldown, daily-stop,
 * loss streak, bankroll, today P&L, no-flip ticker). Returns the closed trade.
 */
export async function closeTrade(id: number, input: CloseTradeInput): Promise<TradeRow | null> {
  const trade = await getTrade(id);
  if (!trade || trade.status === "closed") return trade ?? null;

  const now = Date.now();
  const resultUsd = trade.sizeUsd * input.resultPct;
  const stoppedOut = input.stoppedOut ?? input.resultPct <= -0.5;
  const holdingSecs = Math.max(0, Math.round((now - trade.openedAt) / 1000));

  const patch: Partial<TradeRow> = {
    status: "closed",
    resultPct: input.resultPct,
    resultUsd,
    holdingSecs,
    emotionalState: input.emotionalState ?? trade.emotionalState,
    ruleBreaks: input.ruleBreaks ?? trade.ruleBreaks,
    note: input.note ?? trade.note,
    followedLadder: input.followedLadder ?? trade.followedLadder,
    stoppedOut,
    exits: input.exits ?? trade.exits,
    closedAt: now,
  };

  // Persist the trade close.
  const db = getDb();
  if (!db) {
    Object.assign(trade, patch);
  } else {
    await db.update(trades).set(patch).where(eq(trades.id, id));
  }

  // Apply the discipline state mutation.
  const state = await getState();
  const mutation = applyTradeClose(
    {
      bankroll: state.bankroll,
      dayStartBankroll: state.dayStartBankroll,
      tradesToday: state.tradesToday,
      pnlTodayUsd: state.pnlTodayUsd,
      consecutiveLosses: state.consecutiveLosses,
      cooldownUntil: state.cooldownUntil,
      lastExitedTickers: state.lastExitedTickers,
      config: state.config,
    },
    {
      ticker: trade.ticker || trade.ca,
      resultPct: input.resultPct,
      sizeUsd: trade.sizeUsd,
      stoppedOut,
    } satisfies CloseInput,
    now,
  );
  await updateState(mutation);

  return { ...trade, ...patch };
}
