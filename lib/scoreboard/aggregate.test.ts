import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePreset, computeScoreboard, OUTCOME_PAYOFF } from "@/lib/scoreboard/aggregate";
import type { SignalRow } from "@/lib/db/schema";
import type { SignalOutcome } from "@/lib/types";

let id = 0;
function sig(preset: string, outcome: SignalOutcome, maxMultiple?: number): SignalRow {
  return {
    id: ++id,
    ts: 1,
    ca: `ca${id}`,
    symbol: null,
    preset,
    entryPrice: 1,
    entryMcap: null,
    liquidity: null,
    holders: null,
    verdict: "GREEN",
    source: "screener",
    outcome,
    maxMultiple: maxMultiple ?? null,
    resolvedTs: outcome === "pending" ? null : 2,
  };
}

test("hit rate, rug rate, and expectancy per preset", () => {
  const rows = [
    sig("A", "2x", 2.5),
    sig("A", "2x", 3.0),
    sig("A", "stop", 1.2),
    sig("A", "rug", 1.1),
    sig("A", "pending"),
  ];
  const s = scorePreset("A", rows);
  assert.equal(s.total, 5);
  assert.equal(s.pending, 1);
  assert.equal(s.resolved, 4);
  assert.equal(s.hits, 2);
  assert.equal(s.rugs, 1);
  assert.ok(Math.abs(s.hitRate - 0.5) < 1e-9);
  assert.ok(Math.abs(s.rugRate - 0.25) < 1e-9);
  // expectancy = (1 + 1 - 0.5 - 1) / 4 = 0.125
  assert.ok(Math.abs(s.expectancy - 0.125) < 1e-9);
});

test("payoffs match the doctrine mapping", () => {
  assert.equal(OUTCOME_PAYOFF["2x"], 1.0);
  assert.equal(OUTCOME_PAYOFF.stop, -0.5);
  assert.equal(OUTCOME_PAYOFF.rug, -1.0);
  assert.equal(OUTCOME_PAYOFF.expired, 0);
});

test("recommendation: keep-paper under the sample minimum", () => {
  const rows = [sig("B", "2x"), sig("B", "2x")];
  assert.equal(scorePreset("B", rows).recommendation, "keep-paper");
});

test("recommendation: graduate on positive expectancy with enough sample", () => {
  // 20 resolved, mostly 2x => positive expectancy.
  const rows = [
    ...Array.from({ length: 8 }, () => sig("C", "2x")),
    ...Array.from({ length: 12 }, () => sig("C", "stop")),
  ];
  const s = scorePreset("C", rows);
  assert.equal(s.resolved, 20);
  // expectancy = (8*1 + 12*-0.5)/20 = (8 - 6)/20 = 0.1 > 0
  assert.ok(s.expectancy > 0);
  assert.equal(s.recommendation, "graduate");
});

test("recommendation: kill on non-positive expectancy with enough sample", () => {
  const rows = [
    ...Array.from({ length: 4 }, () => sig("D", "2x")),
    ...Array.from({ length: 16 }, () => sig("D", "stop")),
  ];
  const s = scorePreset("D", rows);
  // expectancy = (4 - 8)/20 = -0.2
  assert.ok(s.expectancy < 0);
  assert.equal(s.recommendation, "kill");
});

test("computeScoreboard groups by preset and drops empty ones", () => {
  const board = computeScoreboard([sig("A", "2x"), sig("E", "stop")]);
  assert.deepEqual(board.byPreset.map((p) => p.preset).sort(), ["A", "E"]);
  assert.equal(board.totalSignals, 2);
  assert.equal(board.totalResolved, 2);
});
