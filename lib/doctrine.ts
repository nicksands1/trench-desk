/**
 * THE DOCTRINE — single source of truth for the phase ladder, sizing, real-risk,
 * and breakeven math. NOTHING else in the codebase may hardcode these numbers.
 *
 * Capital is written-off risk money; high variance is intentional. The value of
 * this system is *defense* (not getting rugged) and *discipline* (not blowing up
 * on tilt). It does NOT trade and it does NOT pick coins.
 */

export type ExitMode = "A" | "B";

export interface Phase {
  id: 0 | 1 | 2 | 3;
  name: string;
  /** Inclusive lower bound of the bankroll band, in USD. */
  minBankroll: number;
  /** Exclusive upper bound (Infinity for the top phase). */
  maxBankroll: number;
  /** Hard cap on position size as a fraction of bankroll. */
  maxPositionPct: number;
  /** Real risk = position * stopLossFraction (the −50% stop). */
  maxOpenPositions: number;
  mindset: string;
}

/** The −50% hard stop: a losing trade gives back half the position. */
export const STOP_LOSS_FRACTION = 0.5;

/** Clean win pays +100% (2:1 payoff before the stop). */
export const WIN_PAYOFF = 1.0;

/** A rug blows through the stop to roughly −100%. */
export const RUG_LOSS_FRACTION = 1.0;

export const PHASES: readonly Phase[] = [
  {
    id: 0,
    name: "Trenches",
    minBankroll: 0,
    maxBankroll: 500,
    maxPositionPct: 0.5,
    maxOpenPositions: 1,
    mindset: "Escape velocity. Convexity hunting.",
  },
  {
    id: 1,
    name: "Escape",
    minBankroll: 500,
    maxBankroll: 2000,
    maxPositionPct: 0.25,
    maxOpenPositions: 2,
    mindset: "Compound, more selective.",
  },
  {
    id: 2,
    name: "Establishment",
    minBankroll: 2000,
    maxBankroll: 10000,
    maxPositionPct: 0.15,
    maxOpenPositions: 3,
    mindset: "Base hits. Size is real.",
  },
  {
    id: 3,
    name: "Preservation",
    minBankroll: 10000,
    maxBankroll: Number.POSITIVE_INFINITY,
    maxPositionPct: 0.05,
    maxOpenPositions: 2,
    mindset: "Protect the bag; pull to cold storage.",
  },
] as const;

/** Which phase a bankroll falls into. */
export function phaseForBankroll(bankroll: number): Phase {
  const b = Number.isFinite(bankroll) ? Math.max(0, bankroll) : 0;
  for (const p of PHASES) {
    if (b >= p.minBankroll && b < p.maxBankroll) return p;
  }
  // b is >= the top band's lower bound.
  return PHASES[PHASES.length - 1];
}

export interface SizingResult {
  phase: Phase;
  bankroll: number;
  /** Hard cap in USD = bankroll * maxPositionPct. */
  maxPositionUsd: number;
  maxPositionPct: number;
  /** Real risk in USD at the −50% stop. */
  realRiskUsd: number;
  /** Real risk as a fraction of bankroll. */
  realRiskPct: number;
}

/** Position sizing for a bankroll, straight off the phase ladder. */
export function sizing(bankroll: number): SizingResult {
  const phase = phaseForBankroll(bankroll);
  const b = Number.isFinite(bankroll) ? Math.max(0, bankroll) : 0;
  const maxPositionUsd = b * phase.maxPositionPct;
  return {
    phase,
    bankroll: b,
    maxPositionUsd,
    maxPositionPct: phase.maxPositionPct,
    realRiskUsd: maxPositionUsd * STOP_LOSS_FRACTION,
    realRiskPct: phase.maxPositionPct * STOP_LOSS_FRACTION,
  };
}

/**
 * Breakeven win rate for a payoff/loss profile.
 *   p * win = (1 - p) * loss  =>  p = loss / (win + loss)
 * Clean 2:1 (win=+1.0, loss=0.5) => 0.3333.
 */
export function breakevenWinRate(
  winPayoff: number = WIN_PAYOFF,
  lossFraction: number = STOP_LOSS_FRACTION,
): number {
  const denom = winPayoff + lossFraction;
  if (denom <= 0) return 1;
  return lossFraction / denom;
}

/**
 * Rug-adjusted breakeven. A fraction `rugRateAmongLosses` of losing trades are
 * rugs that blow through the stop to ~−100% instead of −50%. The effective loss
 * size is the blend, which raises the win rate you need to break even.
 *
 *   effLoss = (1 - r) * stop + r * rug
 *   breakeven = effLoss / (win + effLoss)
 *
 * With clean 2:1 and r=0 => 33.3%; r=0.2 => ~37%; r=0.4 => ~40%. This is exactly
 * why screening out rugs matters: it keeps your real breakeven near 33%.
 */
export function rugAdjustedBreakevenWinRate(
  rugRateAmongLosses: number,
  winPayoff: number = WIN_PAYOFF,
  stopFraction: number = STOP_LOSS_FRACTION,
  rugFraction: number = RUG_LOSS_FRACTION,
): number {
  const r = Math.min(1, Math.max(0, rugRateAmongLosses));
  const effLoss = (1 - r) * stopFraction + r * rugFraction;
  return breakevenWinRate(winPayoff, effLoss);
}

/** The clean 2:1 breakeven line the UI references everywhere: 0.3333… */
export const CLEAN_BREAKEVEN = breakevenWinRate();

export interface ExitLeg {
  label: string;
  /** Fraction of the position sold at this leg. */
  sellFraction: number;
  /** Trigger as a multiple of entry (e.g. 2 = 2x). */
  triggerMultiple: number;
}

export interface ExitLadder {
  mode: ExitMode;
  legs: ExitLeg[];
  /** The hard stop as a multiple of entry (0.5 = −50%). */
  stopMultiple: number;
  description: string;
}

/**
 * The exit ladder for a mode. NOTE: both legs are executed in the user's
 * EXTERNAL terminal (Axiom), never by this system. We only describe/record it.
 */
export function exitLadder(mode: ExitMode): ExitLadder {
  if (mode === "B") {
    return {
      mode: "B",
      stopMultiple: 1 - STOP_LOSS_FRACTION,
      description:
        "Sell 85% at 2x (+70% locked), ride a 15% moonbag on a pre-set trailing stop.",
      legs: [
        { label: "Take-profit", sellFraction: 0.85, triggerMultiple: 2 },
        { label: "Moonbag (trailing)", sellFraction: 0.15, triggerMultiple: 2 },
      ],
    };
  }
  return {
    mode: "A",
    stopMultiple: 1 - STOP_LOSS_FRACTION,
    description: "Sell all at 2x. Hard −50% stop.",
    legs: [{ label: "Take-profit (all)", sellFraction: 1, triggerMultiple: 2 }],
  };
}

/** Default discipline config (overridable per-user via trading_state.config). */
export interface DoctrineConfig {
  /** Day is over when down this fraction (0.35 = −35%). */
  dailyStopPct: number;
  /** …or after this many consecutive losses. */
  maxConsecLosses: number;
  /** Cooldown after a full-loss exit, in minutes. */
  cooldownMin: number;
  exitMode: ExitMode;
}

export const DEFAULT_CONFIG: DoctrineConfig = {
  dailyStopPct: 0.35,
  maxConsecLosses: 4,
  cooldownMin: 30,
  exitMode: "A",
};

/**
 * Safety verdict thresholds (tunable, never guessed in-place). Used by the
 * safety engine to map holder concentration into GREEN / YELLOW / RED.
 */
export const SAFETY_THRESHOLDS = {
  /** First-N-buyers' captured supply share. */
  earlyBuyerN: 20,
  redEarlyBuyerCapture: 0.25,
  yellowEarlyBuyerCapture: 0.15,
  /** Top-10 holders ex-bonding-curve concentration. */
  redTop10ExCurve: 0.35,
  yellowTop10ExCurve: 0.22,
} as const;
