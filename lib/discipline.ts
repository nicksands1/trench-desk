import type { Verdict, EmotionalState } from "@/lib/types";
import {
  sizing,
  exitLadder,
  rugAdjustedBreakevenWinRate,
  type DoctrineConfig,
  type SizingResult,
  type ExitLadder,
} from "@/lib/doctrine";

/**
 * THE GATE — the deterministic discipline check, and the trade-close state
 * mutation. Both functions here are PURE (no I/O, `now` injected) so they are
 * fully unit-testable. This is the enforcement layer; it never executes a trade.
 */

export interface GateState {
  bankroll: number;
  consecutiveLosses: number;
  cooldownUntil: number;
  dailyStopHit: boolean;
  lastExitedTickers: string[];
  openPositions: number;
  config: DoctrineConfig;
}

export interface GateInput {
  ca: string;
  ticker: string;
  /** Safety verdict for the CA (RED is a hard stand-down). */
  verdict: Verdict | undefined;
  thesis: string;
  invalidation: string;
  /** Whether an exit ladder is defined (the doctrine ladder is always available). */
  exitLadderDefined: boolean;
  intendedSizeUsd: number;
  /** Human attestation: this is NOT a FOMO chase past the first major leg. */
  notFomoChase: boolean;
}

export type GateSeverity = "block" | "warn";

export interface GateFinding {
  /** Which of the 6 entry criteria / tilt locks this maps to. */
  code: string;
  severity: GateSeverity;
  message: string;
}

export interface GateResult {
  cleared: boolean;
  /** STAND DOWN: a hard, non-overridable block (RED verdict). */
  standDown: boolean;
  findings: GateFinding[];
  sizing: SizingResult;
  /** Suggested max size for this entry (reduced for YELLOW). */
  suggestedMaxUsd: number;
  ladder: ExitLadder;
  rugAdjustedBreakeven: number;
}

/** Reduced-size factor applied when the verdict is YELLOW (elevated risk). */
export const YELLOW_SIZE_FACTOR = 0.5;

/**
 * Evaluate the gate. Returns every finding; `cleared` is true only when there
 * are no `block` findings. RED short-circuits to a hard STAND DOWN.
 */
export function evaluateGate(state: GateState, input: GateInput, now: number): GateResult {
  const s = sizing(state.bankroll);
  const ladder = exitLadder(state.config.exitMode);
  const findings: GateFinding[] = [];

  const yellow = input.verdict === "YELLOW";
  const suggestedMaxUsd = yellow ? s.maxPositionUsd * YELLOW_SIZE_FACTOR : s.maxPositionUsd;

  // ── Criterion 1: passes full DD ──────────────────────────────────────────
  const standDown = input.verdict === "RED";
  if (standDown) {
    findings.push({
      code: "DD_RED",
      severity: "block",
      message: "STAND DOWN — safety verdict is RED (a DD hard-fail). Not overridable.",
    });
  } else if (input.verdict === undefined) {
    findings.push({
      code: "DD_UNKNOWN",
      severity: "block",
      message: "No safety verdict yet — run the DD before the gate will clear.",
    });
  } else if (yellow) {
    findings.push({
      code: "DD_YELLOW",
      severity: "warn",
      message: `Elevated risk (YELLOW) — reduced size only. Suggested cap $${suggestedMaxUsd.toFixed(0)}.`,
    });
  }

  // ── Criterion 2: one-sentence thesis ─────────────────────────────────────
  if (input.thesis.trim().length < 8) {
    findings.push({ code: "NO_THESIS", severity: "block", message: "Write a one-sentence thesis before entering." });
  }

  // ── Criterion 3: exit ladder + invalidation defined before buying ────────
  if (!input.exitLadderDefined) {
    findings.push({ code: "NO_LADDER", severity: "block", message: "Define the exit ladder before buying." });
  }
  if (input.invalidation.trim().length < 4) {
    findings.push({ code: "NO_INVALIDATION", severity: "block", message: "Define the invalidation (what kills the thesis) before buying." });
  }

  // ── Criterion 4: not on cooldown / daily-stop not hit (tilt locks) ───────
  if (state.cooldownUntil > now) {
    const mins = Math.ceil((state.cooldownUntil - now) / 60_000);
    findings.push({ code: "COOLDOWN", severity: "block", message: `On cooldown after a full-loss exit — ${mins}m remaining.` });
  }
  if (state.dailyStopHit) {
    findings.push({ code: "DAILY_STOP", severity: "block", message: "Daily stop hit — the day is over. No new entries." });
  }
  if (state.consecutiveLosses >= state.config.maxConsecLosses) {
    findings.push({ code: "LOSS_STREAK", severity: "block", message: `Consecutive-loss limit reached (${state.consecutiveLosses}/${state.config.maxConsecLosses}). Stop for the day.` });
  }

  // ── Tilt lock: no flip — a ticker exited this session is dead ────────────
  const exited = new Set(state.lastExitedTickers.map((t) => t.toLowerCase()));
  if (input.ticker && exited.has(input.ticker.trim().toLowerCase())) {
    findings.push({ code: "NO_FLIP", severity: "block", message: `No flip — you already exited ${input.ticker} this session.` });
  }

  // ── Tilt lock: no FOMO chase (human attestation) ─────────────────────────
  if (!input.notFomoChase) {
    findings.push({ code: "FOMO", severity: "block", message: "Confirm this is not a FOMO chase past the first major leg (fresh DD required)." });
  }

  // ── Open-position cap for the phase ──────────────────────────────────────
  if (state.openPositions >= s.phase.maxOpenPositions) {
    findings.push({ code: "MAX_OPEN", severity: "block", message: `At the open-position cap for phase ${s.phase.id} (${state.openPositions}/${s.phase.maxOpenPositions}).` });
  }

  // ── Criterion 5: size within (verdict-adjusted) phase cap ─────────────────
  if (input.intendedSizeUsd <= 0) {
    findings.push({ code: "NO_SIZE", severity: "block", message: "Enter an intended position size." });
  } else if (input.intendedSizeUsd > suggestedMaxUsd + 1e-6) {
    findings.push({
      code: "OVERSIZE",
      severity: "block",
      message: `Size $${input.intendedSizeUsd.toFixed(0)} exceeds the ${yellow ? "reduced " : ""}phase cap $${suggestedMaxUsd.toFixed(0)}.`,
    });
  }

  const cleared = !standDown && !findings.some((f) => f.severity === "block");

  return {
    cleared,
    standDown,
    findings,
    sizing: s,
    suggestedMaxUsd,
    ladder,
    rugAdjustedBreakeven: rugAdjustedBreakevenWinRate(0.2),
  };
}

// ── Trade-close state mutation (pure) ──────────────────────────────────────

export interface CloseInput {
  ticker: string;
  /** Result as a fraction of the position (e.g. +1.0 = 2x, -0.5 = stop). */
  resultPct: number;
  sizeUsd: number;
  /** True if this was a full-loss / stop-out exit (fires the cooldown). */
  stoppedOut: boolean;
}

export interface StateMutation {
  bankroll: number;
  tradesToday: number;
  pnlTodayUsd: number;
  pnlTodayPct: number;
  consecutiveLosses: number;
  cooldownUntil: number;
  dailyStopHit: boolean;
  lastExitedTickers: string[];
}

/** The realized P&L of a close in USD. */
export function realizedPnlUsd(sizeUsd: number, resultPct: number): number {
  return sizeUsd * resultPct;
}

/**
 * Apply a trade close to the discipline state, per doctrine:
 *  - bankroll + today P&L updated,
 *  - consecutive losses incremented on a loss / reset on a win,
 *  - 30-min cooldown set on a stop-out,
 *  - daily-stop recomputed (down >= dailyStopPct on the day, or loss streak),
 *  - exited ticker pushed to lastExitedTickers (no-flip).
 */
export function applyTradeClose(
  state: {
    bankroll: number;
    dayStartBankroll: number;
    tradesToday: number;
    pnlTodayUsd: number;
    consecutiveLosses: number;
    cooldownUntil: number;
    lastExitedTickers: string[];
    config: DoctrineConfig;
  },
  close: CloseInput,
  now: number,
): StateMutation {
  const pnl = realizedPnlUsd(close.sizeUsd, close.resultPct);
  const bankroll = state.bankroll + pnl;
  const pnlTodayUsd = state.pnlTodayUsd + pnl;
  const denom = state.dayStartBankroll > 0 ? state.dayStartBankroll : state.bankroll;
  const pnlTodayPct = denom > 0 ? pnlTodayUsd / denom : 0;

  const isLoss = close.resultPct < 0;
  const consecutiveLosses = isLoss ? state.consecutiveLosses + 1 : 0;

  const cooldownUntil = close.stoppedOut
    ? now + state.config.cooldownMin * 60_000
    : state.cooldownUntil;

  const dailyStopHit =
    pnlTodayPct <= -state.config.dailyStopPct ||
    consecutiveLosses >= state.config.maxConsecLosses;

  const tickers = [...state.lastExitedTickers];
  const t = close.ticker.trim();
  if (t && !tickers.some((x) => x.toLowerCase() === t.toLowerCase())) tickers.push(t);

  return {
    bankroll,
    tradesToday: state.tradesToday + 1,
    pnlTodayUsd,
    pnlTodayPct,
    consecutiveLosses,
    cooldownUntil,
    dailyStopHit,
    lastExitedTickers: tickers,
  };
}

export type { EmotionalState };
