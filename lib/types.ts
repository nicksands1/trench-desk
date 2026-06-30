/** Shared domain types used across safety, screener, worker, and the UI. */

export type Verdict = "GREEN" | "YELLOW" | "RED";

export type PresetLetter = "A" | "B" | "C" | "D" | "E" | "F";

export type SignalSource =
  | "scout" // migration scout (module 1)
  | "screener" // preset poller (module 5)
  | "smart-money" // module 7
  | "holder-velocity" // module 6
  | "manual";

export type SignalOutcome = "pending" | "2x" | "stop" | "rug" | "expired";

export type TradeStatus = "open" | "closed";

export type EmotionalState =
  | "calm"
  | "confident"
  | "fomo"
  | "revenge"
  | "bored"
  | "tilted"
  | "fearful";

/** A single safety check's contribution to the verdict. */
export interface SafetyCheck {
  key: string;
  label: string;
  /** A hard-fail forces RED regardless of everything else. */
  verdict: Verdict;
  hardFail: boolean;
  /** Human-readable reason shown in the watchlist / gate. */
  detail: string;
  /** True when the underlying data could not be read (incomplete, not failed). */
  incomplete?: boolean;
}

export interface SafetyReport {
  ca: string;
  symbol?: string;
  verdict: Verdict;
  checks: SafetyCheck[];
  /** Concise reasons (the RED/YELLOW drivers), for compact display. */
  reasons: string[];
  /** Early-buyer capture share (first N buyers), 0..1, if computed. */
  earlyBuyerCapture?: number;
  /** Top-10 holders ex-bonding-curve concentration, 0..1, if computed. */
  top10ExCurve?: number;
  /** Liquidity in USD from DexScreener, if available. */
  liquidityUsd?: number;
  /** Market cap (fdv) in USD, if available. */
  mcapUsd?: number;
  /** Whether genuine pump.fun provenance was confirmed. */
  pumpProvenance?: boolean;
  /** rugcheck normalized score 0..100, if available. */
  rugcheckScore?: number;
  /** When this report was computed (epoch ms). */
  computedAt: number;
  /** True if one or more checks could not be completed (read errors). */
  incomplete: boolean;
}

/**
 * A normalized snapshot of a token at a point in time. The screener presets are
 * pure predicates over this shape (module 5).
 */
export interface TokenSnapshot {
  ca: string;
  symbol?: string;
  /** Age of the token in minutes. */
  ageMinutes?: number;
  liquidityUsd?: number;
  mcapUsd?: number;
  priceUsd?: number;
  /** 1h volume in USD. */
  volume1hUsd?: number;
  /** Token's own trailing 1h volume baseline (for spike detection). */
  volume1hBaselineUsd?: number;
  /** 1h price change as a fraction (0.2 = +20%). */
  priceChange1h?: number;
  /** 5m price change as a fraction. */
  priceChange5m?: number;
  holders?: number;
  /** Net new holders over the last 5 minutes. */
  holdersNet5m?: number;
  /** Acceleration: change in net-new-holders rate. */
  holdersAccel?: number;
  /** Buy/sell ratio over the last hour (>1 = buy-dominant). */
  buySellRatio1h?: number;
  /** True if just migrated from the bonding curve. */
  justMigrated?: boolean;
  /** Number of distinct tracked smart-money wallets buying (module 7). */
  smartMoneyBuyers?: number;
  /** The safety report, when already computed. */
  safety?: SafetyReport;
}

/** Result of evaluating a single preset against a snapshot. */
export interface PresetMatch {
  preset: PresetLetter;
  matched: boolean;
  reasons: string[];
}
