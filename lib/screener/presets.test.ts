import { test } from "node:test";
import assert from "node:assert/strict";
import {
  presetA,
  presetB,
  presetC,
  presetD,
  presetE,
  presetF,
  matchingPresets,
  SCREENER,
} from "@/lib/screener/presets";
import type { TokenSnapshot } from "@/lib/types";

// ── Preset A — Fresh Launch ──────────────────────────────────────────────
const freshA: TokenSnapshot = {
  ca: "ca",
  ageMinutes: 20,
  liquidityUsd: 25_000,
  mcapUsd: 120_000,
  holders: 80,
  holdersNet5m: 10,
  buySellRatio1h: 1.6,
  safety: undefined,
};

test("A matches a clean fresh launch", () => {
  assert.equal(presetA(freshA).matched, true);
});

test("A fails when too old / too few holders / not buy-dominant", () => {
  assert.equal(presetA({ ...freshA, ageMinutes: 120 }).matched, false);
  assert.equal(presetA({ ...freshA, holders: 10 }).matched, false);
  assert.equal(presetA({ ...freshA, buySellRatio1h: 0.8 }).matched, false);
});

test("A fails on missing data (never assumes)", () => {
  assert.equal(presetA({ ca: "x" }).matched, false);
});

test("A refuses a RED-safety snapshot", () => {
  const red = { ...freshA, safety: { verdict: "RED" } as TokenSnapshot["safety"] };
  assert.equal(presetA(red).matched, false);
});

// ── Preset B — Volume Spike ──────────────────────────────────────────────
test("B matches a volume spike over baseline with positive price", () => {
  const s: TokenSnapshot = {
    ca: "ca",
    ageMinutes: 36 * 60,
    volume1hUsd: 120_000,
    volume1hBaselineUsd: 30_000, // 4x
    priceChange1h: 0.2,
    liquidityUsd: 40_000,
  };
  assert.equal(presetB(s).matched, true);
  // below the spike multiple => no match
  assert.equal(presetB({ ...s, volume1hUsd: 45_000 }).matched, false);
  // negative price => no match
  assert.equal(presetB({ ...s, priceChange1h: -0.1 }).matched, false);
});

// ── Preset C — Migration ─────────────────────────────────────────────────
test("C matches a freshly migrated token with liquidity + volume", () => {
  const s: TokenSnapshot = { ca: "ca", justMigrated: true, liquidityUsd: 20_000, volume1hUsd: 8_000 };
  assert.equal(presetC(s).matched, true);
  assert.equal(presetC({ ...s, justMigrated: false }).matched, false);
  assert.equal(presetC({ ...s, liquidityUsd: 1_000 }).matched, false);
});

// ── Preset D — Mid-Cap Momentum ──────────────────────────────────────────
test("D matches sustained mid-cap momentum", () => {
  const s: TokenSnapshot = {
    ca: "ca",
    ageMinutes: 24 * 60,
    mcapUsd: 500_000,
    liquidityUsd: 80_000, // liq/mcap = 0.16 > 0.04
    volume1hUsd: 50_000,
    holdersAccel: 2,
    buySellRatio1h: 1.1,
  };
  assert.equal(presetD(s).matched, true);
  assert.equal(presetD({ ...s, holdersAccel: -1 }).matched, false);
  assert.equal(presetD({ ...s, liquidityUsd: 5_000 }).matched, false);
});

// ── Preset E — Smart Money ───────────────────────────────────────────────
test("E matches at the smart-money wallet threshold", () => {
  assert.equal(presetE({ ca: "ca", smartMoneyBuyers: SCREENER.E.minWallets }).matched, true);
  assert.equal(presetE({ ca: "ca", smartMoneyBuyers: 1 }).matched, false);
});

// ── Preset F — Holder Velocity ───────────────────────────────────────────
test("F matches an accelerating holder breakout with corroboration", () => {
  const s: TokenSnapshot = {
    ca: "ca",
    holdersNet5m: 40,
    holdersAccel: 3,
    liquidityUsd: 20_000,
    volume1hUsd: 5_000,
    priceChange5m: 0.05,
  };
  assert.equal(presetF(s).matched, true);
  assert.equal(presetF({ ...s, holdersAccel: 0 }).matched, false);
  assert.equal(presetF({ ...s, priceChange5m: -0.01 }).matched, false);
});

// ── matchingPresets ──────────────────────────────────────────────────────
test("matchingPresets returns only enabled + matched presets", () => {
  const matches = matchingPresets(freshA, ["A", "B", "C"]);
  assert.deepEqual(matches.map((m) => m.preset), ["A"]);
  // disabling A drops it
  assert.equal(matchingPresets(freshA, ["B", "C"]).length, 0);
});
