import type { PresetLetter, SignalOutcome } from "@/lib/types";
import type { SignalRow } from "@/lib/db/schema";
import { MIN_SAMPLE } from "@/lib/journal";

/**
 * Scoreboard aggregation — PURE. Per-preset hit/rug rates, expectancy, sample
 * size + honesty flag, and a graduate / keep-paper / kill recommendation.
 *
 * Outcome payoffs (fraction of position), consistent with the doctrine:
 *   2x → +1.0, stop → −0.5, rug → −1.0, expired → 0 (exited ~flat).
 * Real capital only goes on a preset with positive expectancy over ≥20 outcomes.
 */

export const OUTCOME_PAYOFF: Record<Exclude<SignalOutcome, "pending">, number> = {
  "2x": 1.0,
  stop: -0.5,
  rug: -1.0,
  expired: 0,
};

export type Recommendation = "graduate" | "keep-paper" | "kill";

export interface PresetScore {
  preset: PresetLetter;
  total: number;
  pending: number;
  resolved: number;
  hits: number; // 2x
  stops: number;
  rugs: number;
  expired: number;
  hitRate: number; // 2x / resolved
  rugRate: number; // rug / resolved
  expectancy: number; // mean payoff over resolved
  avgMaxMultiple: number | undefined;
  lowSample: boolean;
  recommendation: Recommendation;
}

function recommend(resolved: number, expectancy: number): Recommendation {
  if (resolved < MIN_SAMPLE) return "keep-paper";
  return expectancy > 0 ? "graduate" : "kill";
}

export function scorePreset(preset: PresetLetter, rows: SignalRow[]): PresetScore {
  const total = rows.length;
  const resolvedRows = rows.filter((r) => r.outcome !== "pending");
  const resolved = resolvedRows.length;
  const pending = total - resolved;

  const hits = resolvedRows.filter((r) => r.outcome === "2x").length;
  const stops = resolvedRows.filter((r) => r.outcome === "stop").length;
  const rugs = resolvedRows.filter((r) => r.outcome === "rug").length;
  const expired = resolvedRows.filter((r) => r.outcome === "expired").length;

  const payoffs = resolvedRows.map((r) => OUTCOME_PAYOFF[r.outcome as Exclude<SignalOutcome, "pending">] ?? 0);
  const expectancy = payoffs.length ? payoffs.reduce((s, v) => s + v, 0) / payoffs.length : 0;

  const maxMults = rows.map((r) => r.maxMultiple).filter((v): v is number => v != null);
  const avgMaxMultiple = maxMults.length ? maxMults.reduce((s, v) => s + v, 0) / maxMults.length : undefined;

  return {
    preset,
    total,
    pending,
    resolved,
    hits,
    stops,
    rugs,
    expired,
    hitRate: resolved ? hits / resolved : 0,
    rugRate: resolved ? rugs / resolved : 0,
    expectancy,
    avgMaxMultiple,
    lowSample: resolved < MIN_SAMPLE,
    recommendation: recommend(resolved, expectancy),
  };
}

export interface Scoreboard {
  byPreset: PresetScore[];
  totalSignals: number;
  totalResolved: number;
}

const PRESETS: PresetLetter[] = ["A", "B", "C", "D", "E", "F"];

export function computeScoreboard(signals: SignalRow[]): Scoreboard {
  const byPreset = PRESETS.map((p) =>
    scorePreset(
      p,
      signals.filter((s) => s.preset === p),
    ),
  ).filter((s) => s.total > 0);

  return {
    byPreset,
    totalSignals: signals.length,
    totalResolved: signals.filter((s) => s.outcome !== "pending").length,
  };
}
