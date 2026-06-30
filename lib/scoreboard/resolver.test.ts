import { test } from "node:test";
import assert from "node:assert/strict";
import { stepResolve, resolvePath, type ResolverConfig } from "@/lib/scoreboard/resolver";

const MIN = 60_000;
const T0 = 1_000 * MIN;
const cfg: ResolverConfig = {
  rugFloorUsd: 1000,
  maxWindowMs: 72 * 60 * MIN,
  takeProfitMultiple: 2,
  stopMultiple: 0.5,
};

test("resolves 2x when price doubles before stopping", () => {
  const r = resolvePath(
    1.0,
    T0,
    [
      { at: T0 + 5 * MIN, sample: { priceUsd: 1.3, liquidityUsd: 20_000 } },
      { at: T0 + 10 * MIN, sample: { priceUsd: 1.8, liquidityUsd: 25_000 } },
      { at: T0 + 15 * MIN, sample: { priceUsd: 2.1, liquidityUsd: 30_000 } },
    ],
    cfg,
  );
  assert.equal(r.outcome, "2x");
  assert.ok(r.resolved);
  assert.ok((r.maxMultiple ?? 0) >= 2.1 - 1e-9);
});

test("resolves stop when price halves", () => {
  const r = resolvePath(
    1.0,
    T0,
    [
      { at: T0 + 5 * MIN, sample: { priceUsd: 0.8, liquidityUsd: 20_000 } },
      { at: T0 + 10 * MIN, sample: { priceUsd: 0.45, liquidityUsd: 18_000 } },
    ],
    cfg,
  );
  assert.equal(r.outcome, "stop");
  // max multiple should record the 0.8 peak (still < 1)
  assert.ok(Math.abs((r.maxMultiple ?? 0) - 0.8) < 1e-9);
});

test("resolves rug when liquidity drops below the floor", () => {
  const r = resolvePath(
    1.0,
    T0,
    [
      { at: T0 + 5 * MIN, sample: { priceUsd: 1.5, liquidityUsd: 12_000 } },
      { at: T0 + 10 * MIN, sample: { priceUsd: 1.2, liquidityUsd: 500 } }, // rug
    ],
    cfg,
  );
  assert.equal(r.outcome, "rug");
  // peak 1.5 recorded before the rug
  assert.ok(Math.abs((r.maxMultiple ?? 0) - 1.5) < 1e-9);
});

test("resolves rug when the pair disappears", () => {
  const r = resolvePath(
    1.0,
    T0,
    [{ at: T0 + 5 * MIN, sample: { noPair: true } }],
    cfg,
  );
  assert.equal(r.outcome, "rug");
});

test("rug takes precedence over a simultaneous 2x reading", () => {
  // price says 2x but liquidity is gone — you can't exit => rug.
  const r = stepResolve(
    { entryPrice: 1.0, signalTs: T0, maxMultiple: 1.0 },
    { priceUsd: 2.5, liquidityUsd: 200 },
    cfg,
    T0 + 5 * MIN,
  );
  assert.equal(r.outcome, "rug");
});

test("expires when neither threshold hits within the window", () => {
  const r = resolvePath(
    1.0,
    T0,
    [
      { at: T0 + 10 * MIN, sample: { priceUsd: 1.2, liquidityUsd: 20_000 } },
      { at: T0 + 71 * 60 * MIN, sample: { priceUsd: 1.4, liquidityUsd: 20_000 } },
      { at: T0 + 73 * 60 * MIN, sample: { priceUsd: 1.5, liquidityUsd: 20_000 } }, // past 72h
    ],
    cfg,
  );
  assert.equal(r.outcome, "expired");
  assert.ok(Math.abs((r.maxMultiple ?? 0) - 1.5) < 1e-9);
});

test("stays pending while in range and inside the window", () => {
  const r = stepResolve(
    { entryPrice: 1.0, signalTs: T0, maxMultiple: 1.0 },
    { priceUsd: 1.4, liquidityUsd: 20_000 },
    cfg,
    T0 + 30 * MIN,
  );
  assert.equal(r.outcome, "pending");
  assert.equal(r.resolved, false);
  assert.ok(Math.abs((r.maxMultiple ?? 0) - 1.4) < 1e-9);
});

test("without an entry price, only rug/expiry can resolve", () => {
  const stillPending = stepResolve(
    { entryPrice: undefined, signalTs: T0, maxMultiple: undefined },
    { priceUsd: 5, liquidityUsd: 20_000 },
    cfg,
    T0 + 10 * MIN,
  );
  assert.equal(stillPending.outcome, "pending");
  const expired = stepResolve(
    { entryPrice: undefined, signalTs: T0, maxMultiple: undefined },
    { priceUsd: 5, liquidityUsd: 20_000 },
    cfg,
    T0 + 73 * 60 * MIN,
  );
  assert.equal(expired.outcome, "expired");
});
