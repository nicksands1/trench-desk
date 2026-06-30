import type { TokenSnapshot, PresetLetter, PresetMatch } from "@/lib/types";

/**
 * The 6 screener presets, each a PURE predicate over a normalized TokenSnapshot.
 * Params are STARTING POINTS — tuned later via the scoreboard, never guessed in
 * place. Safety hard-fails (mint/freeze/LP/concentration/bundle) are enforced by
 * the pipeline's runSafety RED-drop; these predicates also refuse a RED snapshot
 * when safety is already attached, so a preset can never "match" a known rug.
 *
 * The system surfaces candidates that pass a preset's structure; it does NOT
 * rank them or claim they are buys. The human decides.
 */

export const SCREENER = {
  A: { maxAgeMin: 60, minLiqUsd: 15_000, minHolders: 50, maxMcapUsd: 200_000 },
  B: { minAgeMin: 24 * 60, maxAgeMin: 72 * 60, volSpikeMult: 3, minLiqUsd: 30_000 },
  C: { minLiqUsd: 15_000, minVol1hUsd: 3_000 },
  D: {
    minAgeMin: 6 * 60,
    maxAgeMin: 48 * 60,
    minMcapUsd: 100_000,
    maxMcapUsd: 2_000_000,
    minLiqUsd: 50_000,
    minLiqMcapRatio: 0.04,
    minVol1hUsd: 20_000,
    minBuySell: 0.7,
  },
  E: { minWallets: 2 },
  F: { minNet5m: 25, minLiqUsd: 15_000 },
} as const;

interface Check {
  ok: boolean;
  label: string;
}

function decide(preset: PresetLetter, checks: Check[]): PresetMatch {
  const matched = checks.every((c) => c.ok);
  const reasons = matched
    ? checks.map((c) => c.label)
    : checks.filter((c) => !c.ok).map((c) => c.label);
  return { preset, matched, reasons };
}

/** A snapshot with an attached RED safety verdict can never match a preset. */
function notRed(s: TokenSnapshot): Check {
  return { ok: s.safety?.verdict !== "RED", label: "safety not RED" };
}

// Helpers that treat `undefined` as a failed condition (we never assume).
const ge = (v: number | undefined, t: number) => v !== undefined && v >= t;
const le = (v: number | undefined, t: number) => v !== undefined && v <= t;
const gt = (v: number | undefined, t: number) => v !== undefined && v > t;

/** A — Fresh Launch. */
export function presetA(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.A;
  return decide("A", [
    { ok: le(s.ageMinutes, t.maxAgeMin), label: `age < ${t.maxAgeMin}m` },
    { ok: ge(s.liquidityUsd, t.minLiqUsd), label: `liquidity > $${t.minLiqUsd / 1000}k` },
    { ok: ge(s.holders, t.minHolders), label: `holders > ${t.minHolders}` },
    { ok: gt(s.holdersNet5m, 0), label: "holders climbing" },
    { ok: gt(s.buySellRatio1h, 1), label: "buy-dominant" },
    { ok: le(s.mcapUsd, t.maxMcapUsd), label: `mcap < $${t.maxMcapUsd / 1000}k` },
    notRed(s),
  ]);
}

/** B — Volume Spike (vs the token's own trailing baseline). */
export function presetB(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.B;
  const spike =
    s.volume1hUsd !== undefined &&
    s.volume1hBaselineUsd !== undefined &&
    s.volume1hBaselineUsd > 0 &&
    s.volume1hUsd / s.volume1hBaselineUsd >= t.volSpikeMult;
  return decide("B", [
    { ok: ge(s.ageMinutes, t.minAgeMin), label: `age > ${t.minAgeMin / 60}h` },
    { ok: le(s.ageMinutes, t.maxAgeMin), label: `age < ${t.maxAgeMin / 60}h` },
    { ok: spike, label: `1h volume ≥ ${t.volSpikeMult}× baseline` },
    { ok: gt(s.priceChange1h, 0), label: "1h price positive" },
    { ok: ge(s.liquidityUsd, t.minLiqUsd), label: `liquidity > $${t.minLiqUsd / 1000}k` },
    notRed(s),
  ]);
}

/** C — Graduation / Migration. */
export function presetC(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.C;
  return decide("C", [
    { ok: s.justMigrated === true, label: "just migrated" },
    { ok: ge(s.liquidityUsd, t.minLiqUsd), label: `post-migration liquidity > $${t.minLiqUsd / 1000}k` },
    { ok: ge(s.volume1hUsd, t.minVol1hUsd), label: "active volume" },
    notRed(s),
  ]);
}

/** D — Mid-Cap Momentum. */
export function presetD(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.D;
  const liqMcapHealthy =
    s.liquidityUsd !== undefined &&
    s.mcapUsd !== undefined &&
    s.mcapUsd > 0 &&
    s.liquidityUsd / s.mcapUsd >= t.minLiqMcapRatio;
  return decide("D", [
    { ok: ge(s.ageMinutes, t.minAgeMin), label: `age > ${t.minAgeMin / 60}h` },
    { ok: le(s.ageMinutes, t.maxAgeMin), label: `age < ${t.maxAgeMin / 60}h` },
    { ok: ge(s.mcapUsd, t.minMcapUsd), label: `mcap > $${t.minMcapUsd / 1000}k` },
    { ok: le(s.mcapUsd, t.maxMcapUsd), label: `mcap < $${t.maxMcapUsd / 1_000_000}M` },
    { ok: ge(s.liquidityUsd, t.minLiqUsd), label: `liquidity > $${t.minLiqUsd / 1000}k` },
    { ok: liqMcapHealthy, label: "healthy liq/mcap" },
    { ok: ge(s.volume1hUsd, t.minVol1hUsd), label: "sustained volume" },
    { ok: gt(s.holdersAccel, 0), label: "accelerating holders" },
    { ok: ge(s.buySellRatio1h, t.minBuySell), label: "healthy buy/sell" },
    notRed(s),
  ]);
}

/** E — Smart-Money Trigger (fed by module 7). */
export function presetE(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.E;
  return decide("E", [
    { ok: ge(s.smartMoneyBuyers, t.minWallets), label: `≥ ${t.minWallets} tracked wallets bought` },
    notRed(s),
  ]);
}

/** F — Holder Velocity Breakout (fed by module 6). */
export function presetF(s: TokenSnapshot): PresetMatch {
  const t = SCREENER.F;
  return decide("F", [
    { ok: ge(s.holdersNet5m, t.minNet5m), label: `net new holders/5m ≥ ${t.minNet5m}` },
    { ok: gt(s.holdersAccel, 0), label: "accelerating" },
    { ok: ge(s.liquidityUsd, t.minLiqUsd), label: `liquidity > $${t.minLiqUsd / 1000}k` },
    { ok: gt(s.volume1hUsd, 0), label: "volume present" },
    { ok: gt(s.priceChange5m, 0), label: "price corroborates" },
    notRed(s),
  ]);
}

export const PRESET_FNS: Record<PresetLetter, (s: TokenSnapshot) => PresetMatch> = {
  A: presetA,
  B: presetB,
  C: presetC,
  D: presetD,
  E: presetE,
  F: presetF,
};

export const PRESET_NAMES: Record<PresetLetter, string> = {
  A: "Fresh Launch",
  B: "Volume Spike",
  C: "Graduation/Migration",
  D: "Mid-Cap Momentum",
  E: "Smart-Money Trigger",
  F: "Holder Velocity Breakout",
};

/** Evaluate one preset. */
export function evalPreset(letter: PresetLetter, s: TokenSnapshot): PresetMatch {
  return PRESET_FNS[letter](s);
}

/** Evaluate a set of presets, returning only the matches. */
export function matchingPresets(
  s: TokenSnapshot,
  enabled: PresetLetter[],
): PresetMatch[] {
  return enabled.map((l) => evalPreset(l, s)).filter((m) => m.matched);
}
