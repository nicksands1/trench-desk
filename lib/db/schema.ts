import {
  pgTable,
  serial,
  integer,
  bigint,
  doublePrecision,
  boolean,
  text,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  Verdict,
  SignalOutcome,
  SignalSource,
  TradeStatus,
  SafetyReport,
} from "@/lib/types";
import type { DoctrineConfig, ExitLadder } from "@/lib/doctrine";

/**
 * trading_state — singleton row (id = 1) holding the live discipline state.
 * All money/percentages are doubles (paper desk; exact decimal accounting is
 * not required). Epoch fields are ms since epoch as bigint(number).
 */
export const tradingState = pgTable("trading_state", {
  id: integer("id").primaryKey().default(1),
  bankroll: doublePrecision("bankroll").notNull().default(0),
  /** Current trading day, YYYY-MM-DD (local to the desk). */
  day: text("day").notNull().default(""),
  dayStartBankroll: doublePrecision("day_start_bankroll").notNull().default(0),
  tradesToday: integer("trades_today").notNull().default(0),
  pnlTodayUsd: doublePrecision("pnl_today_usd").notNull().default(0),
  pnlTodayPct: doublePrecision("pnl_today_pct").notNull().default(0),
  consecutiveLosses: integer("consecutive_losses").notNull().default(0),
  /** Cooldown expiry, epoch ms; 0 = none. */
  cooldownUntil: bigint("cooldown_until", { mode: "number" }).notNull().default(0),
  dailyStopHit: boolean("daily_stop_hit").notNull().default(false),
  lastExitedTickers: jsonb("last_exited_tickers")
    .$type<string[]>()
    .notNull()
    .default([]),
  config: jsonb("config").$type<DoctrineConfig>().notNull(),
});

/** trades — the journal. */
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    ca: text("ca").notNull(),
    ticker: text("ticker").notNull().default(""),
    preset: text("preset"),
    openedAt: bigint("opened_at", { mode: "number" }).notNull(),
    entry: doublePrecision("entry").notNull().default(0),
    sizeUsd: doublePrecision("size_usd").notNull().default(0),
    sizePct: doublePrecision("size_pct").notNull().default(0),
    phase: integer("phase").notNull().default(0),
    thesis: text("thesis").notNull().default(""),
    invalidation: text("invalidation").notNull().default(""),
    exitLadder: jsonb("exit_ladder").$type<ExitLadder | null>(),
    status: text("status").$type<TradeStatus>().notNull().default("open"),
    exits: jsonb("exits").$type<{ multiple: number; fraction: number }[]>(),
    resultUsd: doublePrecision("result_usd"),
    resultPct: doublePrecision("result_pct"),
    holdingSecs: integer("holding_secs"),
    followedLadder: boolean("followed_ladder"),
    emotionalState: text("emotional_state"),
    ruleBreaks: jsonb("rule_breaks").$type<string[]>().notNull().default([]),
    note: text("note").notNull().default(""),
    stoppedOut: boolean("stopped_out").notNull().default(false),
    closedAt: bigint("closed_at", { mode: "number" }),
  },
  (t) => ({
    statusIdx: index("trades_status_idx").on(t.status),
    caIdx: index("trades_ca_idx").on(t.ca),
  }),
);

/** signals — the forward-test log. Every screened candidate + its outcome. */
export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    ca: text("ca").notNull(),
    symbol: text("symbol"),
    preset: text("preset").notNull(),
    entryPrice: doublePrecision("entry_price"),
    entryMcap: doublePrecision("entry_mcap"),
    liquidity: doublePrecision("liquidity"),
    holders: integer("holders"),
    verdict: text("verdict").$type<Verdict>().notNull(),
    source: text("source").$type<SignalSource>().notNull(),
    outcome: text("outcome").$type<SignalOutcome>().notNull().default("pending"),
    maxMultiple: doublePrecision("max_multiple"),
    resolvedTs: bigint("resolved_ts", { mode: "number" }),
  },
  (t) => ({
    // One signal per (ca, preset) — dedupe the forward-test log.
    caPresetIdx: uniqueIndex("signals_ca_preset_idx").on(t.ca, t.preset),
    outcomeIdx: index("signals_outcome_idx").on(t.outcome),
  }),
);

/** tracked_wallets — smart-money addresses (module 7). */
export const trackedWallets = pgTable(
  "tracked_wallets",
  {
    id: serial("id").primaryKey(),
    address: text("address").notNull(),
    label: text("label").notNull().default(""),
    addedTs: bigint("added_ts", { mode: "number" }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    addressIdx: uniqueIndex("tracked_wallets_address_idx").on(t.address),
  }),
);

/** safety_reports — cache keyed by contract address. */
export const safetyReports = pgTable("safety_reports", {
  ca: text("ca").primaryKey(),
  verdict: text("verdict").$type<Verdict>().notNull(),
  report: jsonb("report").$type<SafetyReport>().notNull(),
  computedAt: bigint("computed_at", { mode: "number" }).notNull(),
});

/** candidates — the surfaced watchlist. */
export const candidates = pgTable(
  "candidates",
  {
    ca: text("ca").primaryKey(),
    symbol: text("symbol"),
    verdict: text("verdict").$type<Verdict>().notNull(),
    /** open watchlist status, e.g. "watching" | "dismissed" | "promoted". */
    status: text("status").notNull().default("watching"),
    source: text("source").$type<SignalSource>().notNull(),
    preset: text("preset"),
    liquidityUsd: doublePrecision("liquidity_usd"),
    mcapUsd: doublePrecision("mcap_usd"),
    earlyBuyerCapture: doublePrecision("early_buyer_capture"),
    top10ExCurve: doublePrecision("top10_ex_curve"),
    ageMinutes: doublePrecision("age_minutes"),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    /** True once surfaced (GREEN) to the watchlist UI. */
    surfaced: boolean("surfaced").notNull().default(false),
    firstSeen: bigint("first_seen", { mode: "number" }).notNull(),
    lastSeen: bigint("last_seen", { mode: "number" }).notNull(),
  },
  (t) => ({
    verdictIdx: index("candidates_verdict_idx").on(t.verdict),
    surfacedIdx: index("candidates_surfaced_idx").on(t.surfaced),
  }),
);

/** holder_snapshots — holder counts over time (module 6). */
export const holderSnapshots = pgTable(
  "holder_snapshots",
  {
    id: serial("id").primaryKey(),
    ca: text("ca").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    holders: integer("holders").notNull(),
  },
  (t) => ({
    caTsIdx: index("holder_snapshots_ca_ts_idx").on(t.ca, t.ts),
  }),
);

export type TradingStateRow = typeof tradingState.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type NewTradeRow = typeof trades.$inferInsert;
export type SignalRow = typeof signals.$inferSelect;
export type NewSignalRow = typeof signals.$inferInsert;
export type TrackedWalletRow = typeof trackedWallets.$inferSelect;
export type SafetyReportRow = typeof safetyReports.$inferSelect;
export type CandidateRow = typeof candidates.$inferSelect;
export type HolderSnapshotRow = typeof holderSnapshots.$inferSelect;
