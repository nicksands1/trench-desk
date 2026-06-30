import { sharedThrottle } from "@/lib/worker/throttle";
import { getHolderCount } from "@/lib/sources/helius";
import { insertHolderSnapshot, getHolderPoints } from "@/lib/db/holders";
import { computeVelocity } from "@/lib/screener/velocity";
import { listCandidates } from "@/lib/db/candidates";
import { screenCandidate } from "@/lib/screener/engine";
import { presetEnabled, env } from "@/lib/env";

/**
 * Holder-velocity poller (module 6). For the ACTIVE watchlist only (bounded),
 * pull a holder count via Helius, store a snapshot, compute velocity, and — when
 * preset F is enabled and the breakout is real — fire the screener with the
 * velocity overrides. Throttled; never polls an unbounded set.
 */

type Log = (msg: string) => void;

/** One poll pass. Returns the number of tokens sampled. */
export async function tickHolderVelocity(limit = 30, log: Log = () => {}): Promise<number> {
  const throttle = sharedThrottle();
  // Active watchlist = surfaced + quiet candidates (bounded).
  const candidates = (await listCandidates({ surfacedOnly: false, limit })).slice(0, limit);
  let sampled = 0;

  await Promise.all(
    candidates.map((c) =>
      throttle.run(async () => {
        try {
          const holders = await getHolderCount(c.ca, 4);
          if (holders === null) return;
          await insertHolderSnapshot(c.ca, holders);
          sampled += 1;

          const points = await getHolderPoints(c.ca);
          const v = computeVelocity(points);

          // Feed preset F if it's enabled and the velocity overrides are present.
          if (presetEnabled("F") && v.net5m !== undefined && v.accel !== undefined) {
            const res = await screenCandidate(c.ca, {
              source: "holder-velocity",
              only: "F",
              overrides: {
                symbol: c.symbol ?? undefined,
                holders,
                holdersNet5m: v.net5m,
                holdersAccel: v.accel,
              },
            });
            if (res.matches.length) log(`F breakout ${c.symbol ?? c.ca} (+${v.net5m}/5m)`);
          }
        } catch (err) {
          log(`velocity error ${c.ca}: ${(err as Error).message}`);
        }
      }, `velocity:${c.ca}`),
    ),
  );
  return sampled;
}

/** Long-lived interval runner. */
export function startHolderVelocity(log: Log = () => {}): { stop: () => void } {
  const intervalMs = env.HV_POLL_INTERVAL_SEC * 1000;
  const timer = setInterval(() => void tickHolderVelocity(30, log), intervalMs);
  log(`started (holder velocity every ${env.HV_POLL_INTERVAL_SEC}s)`);
  return { stop: () => clearInterval(timer) };
}
