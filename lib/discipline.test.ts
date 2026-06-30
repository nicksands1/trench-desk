import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGate,
  applyTradeClose,
  YELLOW_SIZE_FACTOR,
  type GateState,
  type GateInput,
} from "@/lib/discipline";
import { DEFAULT_CONFIG } from "@/lib/doctrine";

const NOW = 1_700_000_000_000;

const baseState: GateState = {
  bankroll: 400, // phase 0: 50% cap => $200 max, 1 open position
  consecutiveLosses: 0,
  cooldownUntil: 0,
  dailyStopHit: false,
  lastExitedTickers: [],
  openPositions: 0,
  config: { ...DEFAULT_CONFIG },
};

const cleanInput: GateInput = {
  ca: "So11111111111111111111111111111111111111112",
  ticker: "WIF",
  verdict: "GREEN",
  thesis: "clean migration with burned LP and climbing holders",
  invalidation: "loses migration support",
  exitLadderDefined: true,
  intendedSizeUsd: 150,
  notFomoChase: true,
};

test("a clean GREEN entry within cap clears the gate", () => {
  const r = evaluateGate(baseState, cleanInput, NOW);
  assert.equal(r.cleared, true);
  assert.equal(r.standDown, false);
  assert.equal(r.findings.filter((f) => f.severity === "block").length, 0);
});

test("RED is a hard STAND DOWN", () => {
  const r = evaluateGate(baseState, { ...cleanInput, verdict: "RED" }, NOW);
  assert.equal(r.standDown, true);
  assert.equal(r.cleared, false);
  assert.ok(r.findings.some((f) => f.code === "DD_RED"));
});

test("YELLOW halves the suggested cap and blocks oversize", () => {
  const r = evaluateGate(baseState, { ...cleanInput, verdict: "YELLOW", intendedSizeUsd: 150 }, NOW);
  assert.equal(r.suggestedMaxUsd, 200 * YELLOW_SIZE_FACTOR); // 100
  // 150 > 100 reduced cap => blocked
  assert.ok(r.findings.some((f) => f.code === "OVERSIZE"));
  assert.equal(r.cleared, false);
  // within reduced cap => clears (still a warn)
  const ok = evaluateGate(baseState, { ...cleanInput, verdict: "YELLOW", intendedSizeUsd: 90 }, NOW);
  assert.equal(ok.cleared, true);
  assert.ok(ok.findings.some((f) => f.code === "DD_YELLOW" && f.severity === "warn"));
});

test("cooldown, daily-stop, and loss-streak each block", () => {
  assert.ok(
    evaluateGate({ ...baseState, cooldownUntil: NOW + 60_000 }, cleanInput, NOW).findings.some((f) => f.code === "COOLDOWN"),
  );
  assert.ok(
    evaluateGate({ ...baseState, dailyStopHit: true }, cleanInput, NOW).findings.some((f) => f.code === "DAILY_STOP"),
  );
  assert.ok(
    evaluateGate({ ...baseState, consecutiveLosses: 4 }, cleanInput, NOW).findings.some((f) => f.code === "LOSS_STREAK"),
  );
});

test("no-flip blocks a ticker already exited this session", () => {
  const r = evaluateGate({ ...baseState, lastExitedTickers: ["WIF"] }, cleanInput, NOW);
  assert.ok(r.findings.some((f) => f.code === "NO_FLIP"));
  assert.equal(r.cleared, false);
});

test("open-position cap blocks at phase max", () => {
  const r = evaluateGate({ ...baseState, openPositions: 1 }, cleanInput, NOW);
  assert.ok(r.findings.some((f) => f.code === "MAX_OPEN"));
});

test("missing thesis / invalidation / fomo-attestation each block", () => {
  assert.ok(evaluateGate(baseState, { ...cleanInput, thesis: "x" }, NOW).findings.some((f) => f.code === "NO_THESIS"));
  assert.ok(evaluateGate(baseState, { ...cleanInput, invalidation: "" }, NOW).findings.some((f) => f.code === "NO_INVALIDATION"));
  assert.ok(evaluateGate(baseState, { ...cleanInput, notFomoChase: false }, NOW).findings.some((f) => f.code === "FOMO"));
});

test("oversize beyond the phase cap blocks", () => {
  const r = evaluateGate(baseState, { ...cleanInput, intendedSizeUsd: 250 }, NOW);
  assert.ok(r.findings.some((f) => f.code === "OVERSIZE"));
});

// ── applyTradeClose ────────────────────────────────────────────────────────

const closeBase = {
  bankroll: 400,
  dayStartBankroll: 400,
  tradesToday: 0,
  pnlTodayUsd: 0,
  consecutiveLosses: 0,
  cooldownUntil: 0,
  lastExitedTickers: [] as string[],
  config: { ...DEFAULT_CONFIG },
};

test("a win adds P&L and resets the loss streak", () => {
  const m = applyTradeClose(
    { ...closeBase, consecutiveLosses: 2 },
    { ticker: "WIF", resultPct: 1.0, sizeUsd: 150, stoppedOut: false },
    NOW,
  );
  assert.equal(m.bankroll, 550); // +150
  assert.equal(m.consecutiveLosses, 0);
  assert.equal(m.cooldownUntil, 0);
  assert.equal(m.tradesToday, 1);
  assert.ok(Math.abs(m.pnlTodayPct - 150 / 400) < 1e-9);
  assert.deepEqual(m.lastExitedTickers, ["WIF"]);
});

test("a stop-out subtracts the stop, bumps the streak, and sets the cooldown", () => {
  const m = applyTradeClose(
    closeBase,
    { ticker: "BONK", resultPct: -0.5, sizeUsd: 200, stoppedOut: true },
    NOW,
  );
  assert.equal(m.bankroll, 300); // -100
  assert.equal(m.consecutiveLosses, 1);
  assert.equal(m.cooldownUntil, NOW + 30 * 60_000);
});

test("daily stop fires when down past the daily-stop percent", () => {
  // -35% of 400 = -140. A -50% stop on a 300 position = -150 => trips it.
  const m = applyTradeClose(
    closeBase,
    { ticker: "X", resultPct: -0.5, sizeUsd: 300, stoppedOut: true },
    NOW,
  );
  assert.ok(m.pnlTodayPct <= -0.35);
  assert.equal(m.dailyStopHit, true);
});

test("daily stop fires on the consecutive-loss limit", () => {
  const m = applyTradeClose(
    { ...closeBase, consecutiveLosses: 3 },
    { ticker: "Y", resultPct: -0.5, sizeUsd: 20, stoppedOut: true },
    NOW,
  );
  assert.equal(m.consecutiveLosses, 4);
  assert.equal(m.dailyStopHit, true);
});
