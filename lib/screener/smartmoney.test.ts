import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSmartMoneyClusters, type BuyEvent } from "@/lib/screener/smartmoney";

const MIN = 60_000;
const NOW = 1_000 * MIN;
const WINDOW = 45 * MIN;

test("two distinct wallets buying the same token in-window forms a cluster", () => {
  const events: BuyEvent[] = [
    { wallet: "w1", ca: "tokenA", ts: NOW - 40 * MIN },
    { wallet: "w2", ca: "tokenA", ts: NOW - 10 * MIN },
  ];
  const clusters = detectSmartMoneyClusters(events, 2, WINDOW);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].ca, "tokenA");
  assert.deepEqual(clusters[0].wallets.sort(), ["w1", "w2"]);
});

test("buys outside the window do not cluster", () => {
  const events: BuyEvent[] = [
    { wallet: "w1", ca: "tokenA", ts: NOW - 90 * MIN },
    { wallet: "w2", ca: "tokenA", ts: NOW - 10 * MIN },
  ];
  assert.equal(detectSmartMoneyClusters(events, 2, WINDOW).length, 0);
});

test("the same wallet buying twice is not two wallets", () => {
  const events: BuyEvent[] = [
    { wallet: "w1", ca: "tokenA", ts: NOW - 20 * MIN },
    { wallet: "w1", ca: "tokenA", ts: NOW - 5 * MIN },
  ];
  assert.equal(detectSmartMoneyClusters(events, 2, WINDOW).length, 0);
});

test("threshold of 3 requires three distinct wallets", () => {
  const two: BuyEvent[] = [
    { wallet: "w1", ca: "tokenA", ts: NOW - 20 * MIN },
    { wallet: "w2", ca: "tokenA", ts: NOW - 10 * MIN },
  ];
  assert.equal(detectSmartMoneyClusters(two, 3, WINDOW).length, 0);
  const three = [...two, { wallet: "w3", ca: "tokenA", ts: NOW - 5 * MIN }];
  assert.equal(detectSmartMoneyClusters(three, 3, WINDOW).length, 1);
});

test("clusters are detected per-token independently", () => {
  const events: BuyEvent[] = [
    { wallet: "w1", ca: "A", ts: NOW - 10 * MIN },
    { wallet: "w2", ca: "A", ts: NOW - 5 * MIN },
    { wallet: "w3", ca: "B", ts: NOW - 8 * MIN }, // only one wallet on B
  ];
  const clusters = detectSmartMoneyClusters(events, 2, WINDOW);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].ca, "A");
});

test("picks the widest qualifying wallet set within the window", () => {
  const events: BuyEvent[] = [
    { wallet: "w1", ca: "A", ts: NOW - 44 * MIN },
    { wallet: "w2", ca: "A", ts: NOW - 30 * MIN },
    { wallet: "w3", ca: "A", ts: NOW - 5 * MIN },
  ];
  const clusters = detectSmartMoneyClusters(events, 2, WINDOW);
  assert.equal(clusters.length, 1);
  // all three fall within 45m of each other
  assert.equal(clusters[0].wallets.length, 3);
});
