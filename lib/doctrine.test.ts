import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phaseForBankroll,
  sizing,
  breakevenWinRate,
  rugAdjustedBreakevenWinRate,
  exitLadder,
  CLEAN_BREAKEVEN,
  STOP_LOSS_FRACTION,
} from "@/lib/doctrine";

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("phase ladder bands map correctly", () => {
  assert.equal(phaseForBankroll(0).id, 0);
  assert.equal(phaseForBankroll(499).id, 0);
  assert.equal(phaseForBankroll(500).id, 1);
  assert.equal(phaseForBankroll(1999).id, 1);
  assert.equal(phaseForBankroll(2000).id, 2);
  assert.equal(phaseForBankroll(9999).id, 2);
  assert.equal(phaseForBankroll(10000).id, 3);
  assert.equal(phaseForBankroll(1_000_000).id, 3);
});

test("phase ladder handles bad input", () => {
  assert.equal(phaseForBankroll(-5).id, 0);
  assert.equal(phaseForBankroll(Number.NaN).id, 0);
});

test("sizing applies the phase cap and the -50% real risk", () => {
  const s0 = sizing(400); // phase 0, 50% cap
  approx(s0.maxPositionUsd, 200);
  approx(s0.realRiskUsd, 100);
  approx(s0.realRiskPct, 0.25);

  const s2 = sizing(5000); // phase 2, 15% cap
  approx(s2.maxPositionUsd, 750);
  approx(s2.realRiskUsd, 375);
  approx(s2.realRiskPct, 0.075);
});

test("clean 2:1 breakeven is 33.3%", () => {
  approx(breakevenWinRate(), 1 / 3);
  approx(CLEAN_BREAKEVEN, 1 / 3);
});

test("rug-adjusted breakeven rises with rug share among losses", () => {
  approx(rugAdjustedBreakevenWinRate(0), 1 / 3);
  approx(rugAdjustedBreakevenWinRate(0.2), 0.375); // ~37%
  approx(rugAdjustedBreakevenWinRate(0.4), 0.7 / 1.7); // ~41%
  // monotonic
  assert.ok(rugAdjustedBreakevenWinRate(0.4) > rugAdjustedBreakevenWinRate(0.2));
});

test("stop fraction is 0.5 and ladder modes are well-formed", () => {
  assert.equal(STOP_LOSS_FRACTION, 0.5);
  const a = exitLadder("A");
  assert.equal(a.legs.length, 1);
  approx(a.legs[0].sellFraction, 1);
  assert.equal(a.stopMultiple, 0.5);
  const b = exitLadder("B");
  approx(b.legs[0].sellFraction, 0.85);
  approx(b.legs[1].sellFraction, 0.15);
});
