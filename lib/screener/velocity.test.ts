import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVelocity, holdersAt, type HolderPoint } from "@/lib/screener/velocity";

const MIN = 60_000;
const NOW = 1_000 * MIN; // arbitrary base

// A series climbing by 10 every 5 minutes for the last hour.
function climbing(): HolderPoint[] {
  const pts: HolderPoint[] = [];
  for (let i = 12; i >= 0; i--) {
    pts.push({ ts: NOW - i * 5 * MIN, holders: 100 + (12 - i) * 10 });
  }
  return pts; // ts NOW-60m..NOW, holders 100..220
}

test("holdersAt returns the value at or before a target, with earliest fallback", () => {
  const pts = climbing();
  assert.equal(holdersAt(pts, NOW), 220);
  assert.equal(holdersAt(pts, NOW - 5 * MIN), 210);
  assert.equal(holdersAt(pts, NOW - 60 * MIN), 100);
  // before the series => earliest value
  assert.equal(holdersAt(pts, NOW - 999 * MIN), 100);
});

test("net-new over windows on a steady climb", () => {
  const v = computeVelocity(climbing(), NOW);
  assert.equal(v.latest, 220);
  assert.equal(v.net5m, 10); // 220 - 210
  assert.equal(v.net15m, 30); // 220 - 190
  assert.equal(v.net30m, 60);
  assert.equal(v.net60m, 120);
  // steady climb => zero acceleration
  assert.equal(v.accel, 0);
});

test("acceleration is positive when the 5m rate increases", () => {
  // h10=100, h5=110 (+10), h0=130 (+20) => accel = 130 - 220 + 100 = 10
  const pts: HolderPoint[] = [
    { ts: NOW - 10 * MIN, holders: 100 },
    { ts: NOW - 5 * MIN, holders: 110 },
    { ts: NOW, holders: 130 },
  ];
  const v = computeVelocity(pts, NOW);
  assert.equal(v.net5m, 20);
  assert.equal(v.accel, 10);
});

test("acceleration is negative when the climb is decelerating", () => {
  // h10=100, h5=130 (+30), h0=140 (+10) => accel = 140 - 260 + 100 = -20
  const pts: HolderPoint[] = [
    { ts: NOW - 10 * MIN, holders: 100 },
    { ts: NOW - 5 * MIN, holders: 130 },
    { ts: NOW, holders: 140 },
  ];
  assert.equal(computeVelocity(pts, NOW).accel, -20);
});

test("empty series yields all-undefined", () => {
  const v = computeVelocity([], NOW);
  assert.equal(v.latest, undefined);
  assert.equal(v.net5m, undefined);
  assert.equal(v.accel, undefined);
  assert.equal(v.points, 0);
});
