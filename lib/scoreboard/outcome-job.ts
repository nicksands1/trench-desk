import { sharedThrottle } from "@/lib/worker/throttle";
import { getDexStats } from "@/lib/sources/dexscreener";
import { listPendingSignals, updateSignalOutcome } from "@/lib/db/signals";
import { stepResolve, type ResolverConfig } from "@/lib/scoreboard/resolver";
import { env } from "@/lib/env";

/**
 * Outcome tracker (module 8). For each PENDING signal, sample price/liquidity via
 * DexScreener and resolve 2x / stop / rug / expired, recording the max multiple.
 * Pending-only, bounded, throttled. This is the validation backbone — it logs
 * what would have happened; it never trades.
 */

type Log = (msg: string) => void;

function config(): ResolverConfig {
  return {
    rugFloorUsd: env.RUG_LIQUIDITY_FLOOR_USD,
    maxWindowMs: env.OUTCOME_MAX_WINDOW_HRS * 60 * 60_000,
    takeProfitMultiple: 2,
    stopMultiple: 0.5,
  };
}

/** One outcome-tracking pass. Returns the number of signals resolved this pass. */
export async function tickOutcomes(limit = 100, log: Log = () => {}): Promise<number> {
  const throttle = sharedThrottle();
  const pending = await listPendingSignals(limit);
  if (pending.length === 0) return 0;
  const cfg = config();
  const now = Date.now();
  let resolved = 0;

  await Promise.all(
    pending.map((sig) =>
      throttle.run(async () => {
        try {
          const dex = await getDexStats(sig.ca);
          const step = stepResolve(
            {
              entryPrice: sig.entryPrice ?? undefined,
              signalTs: sig.ts,
              maxMultiple: sig.maxMultiple ?? undefined,
            },
            {
              priceUsd: dex?.priceUsd,
              liquidityUsd: dex?.liquidityUsd,
              // A confirmed missing pair is a rug signal; a failed fetch (dex === null)
              // is NOT — leave it pending rather than falsely resolving.
              noPair: dex ? dex.noPair : false,
            },
            cfg,
            now,
          );
          if (step.resolved) {
            await updateSignalOutcome(sig.id, {
              outcome: step.outcome,
              maxMultiple: step.maxMultiple,
              resolvedTs: now,
            });
            resolved += 1;
            log(`resolved ${sig.preset} ${sig.symbol ?? sig.ca} → ${step.outcome}`);
          } else if (step.maxMultiple !== undefined && step.maxMultiple !== (sig.maxMultiple ?? undefined)) {
            // Persist the running max-multiple even while pending.
            await updateSignalOutcome(sig.id, { maxMultiple: step.maxMultiple });
          }
        } catch (err) {
          log(`outcome error ${sig.ca}: ${(err as Error).message}`);
        }
      }, `outcome:${sig.ca}`),
    ),
  );
  return resolved;
}

/** Long-lived interval runner. */
export function startOutcomeTracker(log: Log = () => {}): { stop: () => void } {
  const intervalMs = env.OUTCOME_POLL_INTERVAL_SEC * 1000;
  const timer = setInterval(() => void tickOutcomes(100, log), intervalMs);
  log(`started (outcome tracker every ${env.OUTCOME_POLL_INTERVAL_SEC}s)`);
  return { stop: () => clearInterval(timer) };
}
