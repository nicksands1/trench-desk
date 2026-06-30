import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterByFunder } from "@/lib/sources/funding-graph";

test("finds the largest shared-funding cluster", () => {
  const funders = new Map<string, string | undefined>([
    ["w1", "F1"],
    ["w2", "F1"],
    ["w3", "F1"],
    ["w4", "F2"],
    ["w5", "F2"],
    ["w6", "F3"],
  ]);
  const { largest, distinctFunders } = clusterByFunder(funders);
  assert.equal(distinctFunders, 3);
  assert.equal(largest?.funder, "F1");
  assert.equal(largest?.wallets.length, 3);
});

test("a single wallet per funder is not a cluster", () => {
  const funders = new Map<string, string | undefined>([
    ["w1", "F1"],
    ["w2", "F2"],
  ]);
  const { largest } = clusterByFunder(funders);
  assert.equal(largest, undefined);
});

test("self-funded / unknown funders are ignored", () => {
  const funders = new Map<string, string | undefined>([
    ["w1", undefined],
    ["w2", undefined],
    ["w3", "F1"],
    ["w4", "F1"],
  ]);
  const { largest } = clusterByFunder(funders);
  assert.equal(largest?.funder, "F1");
  assert.equal(largest?.wallets.length, 2);
});

test("computes combined supply share when holdings are known", () => {
  const funders = new Map<string, string | undefined>([
    ["w1", "F1"],
    ["w2", "F1"],
  ]);
  const holdings = new Map([
    ["w1", 150],
    ["w2", 50],
  ]);
  const { largest } = clusterByFunder(funders, holdings, 1000);
  assert.ok(largest?.combinedShare !== undefined);
  assert.ok(Math.abs((largest!.combinedShare as number) - 0.2) < 1e-9);
});

test("breaks ties by combined share", () => {
  const funders = new Map<string, string | undefined>([
    ["a1", "FA"],
    ["a2", "FA"],
    ["b1", "FB"],
    ["b2", "FB"],
  ]);
  const holdings = new Map([
    ["a1", 10],
    ["a2", 10],
    ["b1", 100],
    ["b2", 100],
  ]);
  const { largest } = clusterByFunder(funders, holdings, 1000);
  assert.equal(largest?.funder, "FB");
});
