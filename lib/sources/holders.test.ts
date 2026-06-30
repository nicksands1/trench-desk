import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateByOwner,
  topNExCurveShare,
  earlyBuyerCaptureShare,
} from "@/lib/sources/holders";

const approx = (a: number | undefined, b: number, eps = 1e-6) =>
  assert.ok(a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("aggregateByOwner sums multiple accounts and drops zero balances", () => {
  const m = aggregateByOwner([
    { owner: "A", amount: 100 },
    { owner: "A", amount: 50 },
    { owner: "B", amount: 200 },
    { owner: "C", amount: 0 },
  ]);
  assert.equal(m.get("A"), 150);
  assert.equal(m.get("B"), 200);
  assert.equal(m.has("C"), false);
});

test("topNExCurveShare excludes infra owners and uses supply denominator", () => {
  const accounts = [
    { owner: "curve", amount: 700 }, // excluded
    { owner: "w1", amount: 100 },
    { owner: "w2", amount: 80 },
    { owner: "w3", amount: 20 },
  ];
  const exclude = new Set(["curve"]);
  // top-2 ex-curve = 180 / supply 1000 = 0.18
  approx(topNExCurveShare(accounts, exclude, 2, 1000), 0.18);
  // top-10 ex-curve = 200 / 1000 = 0.2
  approx(topNExCurveShare(accounts, exclude, 10, 1000), 0.2);
});

test("topNExCurveShare falls back to summed holdings when no supply", () => {
  const accounts = [
    { owner: "w1", amount: 60 },
    { owner: "w2", amount: 40 },
  ];
  // denominator = 100, top-1 = 60 => 0.6
  approx(topNExCurveShare(accounts, new Set(), 1), 0.6);
});

test("earlyBuyerCaptureShare sums first-N buyers' current holdings", () => {
  const byOwner = new Map([
    ["b1", 120],
    ["b2", 30],
    ["b3", 10],
    ["late", 840],
  ]);
  // first 2 buyers hold 150 / 1000 = 0.15
  approx(earlyBuyerCaptureShare(["b1", "b2", "b3"], byOwner, 2, 1000), 0.15);
  // a buyer who fully sold contributes 0
  approx(earlyBuyerCaptureShare(["sold", "b1"], byOwner, 2, 1000), 0.12);
});

test("share helpers return undefined on a zero denominator", () => {
  assert.equal(topNExCurveShare([], new Set(), 10), undefined);
  assert.equal(earlyBuyerCaptureShare(["x"], new Map(), 1), undefined);
});
