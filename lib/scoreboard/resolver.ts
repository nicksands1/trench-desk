import type { SignalOutcome } from "@/lib/types";

/**
 * Outcome resolver — PURE and unit-tested. Tracks a paper signal's price vs its
 * entry across polls and resolves it to 2x / stop / rug / expired, recording the
 * max multiple seen. Because we poll discretely, "hit 2x before −50%" is decided
 * by whichever threshold a sample first crosses (rug takes precedence — if
 * liquidity is gone you can't exit at any price).
 *
 * This resolves the FORWARD-TEST, the thing that turns "built" into "validated".
 * It executes nothing.
 */

export interface ResolverConfig {
  rugFloorUsd: number;
  maxWindowMs: number;
  takeProfitMultiple: number; // 2
  stopMultiple: number; // 0.5
}

export interface PendingSignalState {
  entryPrice: number | undefined;
  signalTs: number;
  maxMultiple: number | undefined;
}

export interface Sample {
  priceUsd?: number;
  liquidityUsd?: number;
  /** True when DexScreener has no pair for the token (migrated-away / rugged). */
  noPair?: boolean;
}

export interface StepResult {
  outcome: SignalOutcome; // "pending" if unresolved
  maxMultiple: number | undefined;
  resolved: boolean;
}

export function stepResolve(
  state: PendingSignalState,
  sample: Sample,
  cfg: ResolverConfig,
  now: number,
): StepResult {
  const expired = now - state.signalTs > cfg.maxWindowMs;

  // 1) Rug — pair gone or liquidity below the floor. Highest precedence.
  if (sample.noPair || (sample.liquidityUsd !== undefined && sample.liquidityUsd < cfg.rugFloorUsd)) {
    return { outcome: "rug", maxMultiple: state.maxMultiple, resolved: true };
  }

  // Compute the current multiple when we have both prices.
  let maxMultiple = state.maxMultiple;
  let multiple: number | undefined;
  if (state.entryPrice && state.entryPrice > 0 && sample.priceUsd !== undefined) {
    multiple = sample.priceUsd / state.entryPrice;
    maxMultiple = maxMultiple === undefined ? multiple : Math.max(maxMultiple, multiple);
  }

  // 2) Take-profit.
  if (multiple !== undefined && multiple >= cfg.takeProfitMultiple) {
    return { outcome: "2x", maxMultiple, resolved: true };
  }
  // 3) Stop.
  if (multiple !== undefined && multiple <= cfg.stopMultiple) {
    return { outcome: "stop", maxMultiple, resolved: true };
  }
  // 4) Expiry.
  if (expired) {
    return { outcome: "expired", maxMultiple, resolved: true };
  }
  return { outcome: "pending", maxMultiple, resolved: false };
}

/** Convenience for tests: step a whole synthetic price path until resolved. */
export function resolvePath(
  entryPrice: number | undefined,
  signalTs: number,
  samples: { sample: Sample; at: number }[],
  cfg: ResolverConfig,
): StepResult {
  let state: PendingSignalState = { entryPrice, signalTs, maxMultiple: undefined };
  let last: StepResult = { outcome: "pending", maxMultiple: undefined, resolved: false };
  for (const { sample, at } of samples) {
    last = stepResolve(state, sample, cfg, at);
    state = { ...state, maxMultiple: last.maxMultiple };
    if (last.resolved) return last;
  }
  return last;
}
