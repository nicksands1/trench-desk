/**
 * Holder-velocity math — PURE and unit-tested. Given a time series of holder
 * counts, compute net-new holders over 5/15/30/60-minute windows and a simple
 * acceleration (is the 5-minute rate rising?). Feeds preset F.
 */

export interface HolderPoint {
  ts: number; // epoch ms
  holders: number;
}

export interface Velocity {
  latest: number | undefined;
  net5m: number | undefined;
  net15m: number | undefined;
  net30m: number | undefined;
  net60m: number | undefined;
  /** (h0 − h5) − (h5 − h10): positive = the 5-minute rate is accelerating. */
  accel: number | undefined;
  points: number;
}

const MIN = 60_000;

/** Holders at-or-before `targetTs`; falls back to the earliest point. */
export function holdersAt(points: HolderPoint[], targetTs: number): number | undefined {
  if (points.length === 0) return undefined;
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  let val: number | undefined;
  for (const p of sorted) {
    if (p.ts <= targetTs) val = p.holders;
    else break;
  }
  // Before the first sample: use the earliest known value as the baseline.
  return val ?? sorted[0].holders;
}

function netSince(points: HolderPoint[], windowMs: number, now: number): number | undefined {
  if (points.length === 0) return undefined;
  const latest = holdersAt(points, now);
  const past = holdersAt(points, now - windowMs);
  if (latest === undefined || past === undefined) return undefined;
  return latest - past;
}

export function computeVelocity(points: HolderPoint[], now: number = Date.now()): Velocity {
  if (points.length === 0) {
    return { latest: undefined, net5m: undefined, net15m: undefined, net30m: undefined, net60m: undefined, accel: undefined, points: 0 };
  }
  const latest = holdersAt(points, now);
  const h0 = holdersAt(points, now);
  const h5 = holdersAt(points, now - 5 * MIN);
  const h10 = holdersAt(points, now - 10 * MIN);
  const accel =
    h0 !== undefined && h5 !== undefined && h10 !== undefined ? h0 - 2 * h5 + h10 : undefined;

  return {
    latest,
    net5m: netSince(points, 5 * MIN, now),
    net15m: netSince(points, 15 * MIN, now),
    net30m: netSince(points, 30 * MIN, now),
    net60m: netSince(points, 60 * MIN, now),
    accel,
    points: points.length,
  };
}
