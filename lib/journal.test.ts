import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReview, MIN_SAMPLE } from "@/lib/journal";
import type { TradeRow } from "@/lib/db/schema";

let id = 0;
function trade(p: Partial<TradeRow>): TradeRow {
  return {
    id: ++id,
    ca: "ca",
    ticker: "T",
    preset: null,
    openedAt: 1,
    entry: 0,
    sizeUsd: 100,
    sizePct: 0.5,
    phase: 0,
    thesis: "",
    invalidation: "",
    exitLadder: null,
    status: "closed",
    exits: null,
    resultUsd: null,
    resultPct: null,
    holdingSecs: null,
    followedLadder: null,
    emotionalState: null,
    ruleBreaks: [],
    note: "",
    stoppedOut: false,
    closedAt: 2,
    ...p,
  };
}

test("win rate, expectancy, and avg win/loss", () => {
  const trades = [
    trade({ resultPct: 1.0, resultUsd: 100 }), // win
    trade({ resultPct: 1.0, resultUsd: 100 }), // win
    trade({ resultPct: -0.5, resultUsd: -50 }), // loss
    trade({ resultPct: -0.5, resultUsd: -50 }), // loss
  ];
  const r = computeReview(trades);
  assert.equal(r.closedCount, 4);
  assert.equal(r.wins, 2);
  assert.equal(r.losses, 2);
  assert.equal(r.winRate, 0.5);
  assert.ok(Math.abs(r.expectancy - 0.25) < 1e-9); // (1+1-0.5-0.5)/4
  assert.ok(Math.abs(r.avgWin - 1.0) < 1e-9);
  assert.ok(Math.abs(r.avgLoss - -0.5) < 1e-9);
  assert.equal(r.totalPnlUsd, 100);
});

test("compares against the 33.3% breakeven line", () => {
  // 1 win / 3 => 33.3% ~ exactly the line
  const r = computeReview([
    trade({ resultPct: 1.0 }),
    trade({ resultPct: -0.5 }),
    trade({ resultPct: -0.5 }),
  ]);
  assert.ok(Math.abs(r.winRate - 1 / 3) < 1e-9);
  assert.ok(Math.abs(r.edgeVsBreakeven) < 1e-9);
  assert.equal(r.aboveBreakeven, true); // >= line
});

test("followed-ladder rate ignores trades where it wasn't recorded", () => {
  const r = computeReview([
    trade({ resultPct: 1.0, followedLadder: true }),
    trade({ resultPct: -0.5, followedLadder: false }),
    trade({ resultPct: 1.0, followedLadder: null }), // not counted
  ]);
  assert.ok(r.followedLadderRate !== null);
  assert.ok(Math.abs((r.followedLadderRate as number) - 0.5) < 1e-9);
});

test("followed-ladder rate is null when never recorded", () => {
  const r = computeReview([trade({ resultPct: 1.0 })]);
  assert.equal(r.followedLadderRate, null);
});

test("rule-break rate counts trades with any rule break", () => {
  const r = computeReview([
    trade({ resultPct: 1.0, ruleBreaks: ["FOMO"] }),
    trade({ resultPct: -0.5, ruleBreaks: [] }),
  ]);
  assert.ok(Math.abs(r.ruleBreakRate - 0.5) < 1e-9);
});

test("win rate by emotional state", () => {
  const r = computeReview([
    trade({ resultPct: 1.0, emotionalState: "calm" }),
    trade({ resultPct: 1.0, emotionalState: "calm" }),
    trade({ resultPct: -0.5, emotionalState: "fomo" }),
    trade({ resultPct: -0.5, emotionalState: "fomo" }),
  ]);
  const calm = r.byEmotion.find((e) => e.state === "calm");
  const fomo = r.byEmotion.find((e) => e.state === "fomo");
  assert.equal(calm?.winRate, 1);
  assert.equal(fomo?.winRate, 0);
});

test("low-sample honesty flag under the minimum", () => {
  assert.equal(computeReview([trade({ resultPct: 1 })]).lowSample, true);
  const many = Array.from({ length: MIN_SAMPLE }, () => trade({ resultPct: 1 }));
  assert.equal(computeReview(many).lowSample, false);
});

test("open trades are excluded from review math but counted", () => {
  const r = computeReview([
    trade({ status: "open", resultPct: null }),
    trade({ resultPct: 1.0 }),
  ]);
  assert.equal(r.openCount, 1);
  assert.equal(r.closedCount, 1);
  assert.equal(r.winRate, 1);
});
