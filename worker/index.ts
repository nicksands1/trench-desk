/**
 * Trench Desk worker entry point.
 *
 * Holds the migration socket and (in later modules) the background pollers. Run
 * with `npm run worker`. Every loop is also exported as an importable module so
 * it can run once-per-tick under a scheduler (Vercel Cron) instead of a 24/7
 * host — see OPS.md. Only the live migration socket strictly needs persistence.
 *
 * §0: this worker screens, vets, alerts, and logs. It NEVER trades.
 */
import { startScout } from "@/lib/worker/scout";
import { startNewTokenScout, startDexPollInterval } from "@/lib/screener/loops";
import { startHolderVelocity } from "@/lib/screener/velocity-job";
import { heliusConfigured } from "@/lib/sources/helius";
import { dbAvailable } from "@/lib/db/client";
import { env, presetEnabled } from "@/lib/env";

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`${ts} [worker] ${msg}`);
}

async function main() {
  log("starting…");
  if (!dbAvailable()) log("DATABASE_URL not set — DB writes are no-ops (degraded).");
  if (!heliusConfigured()) log("HELIUS_API_KEY not set — safety reads will be incomplete.");

  log(`active presets: ${env.SCREENER_PRESETS.join(",") || "(none)"}`);

  // Migration scout (preset C) — always on; it's the core surfacing loop.
  const scout = startScout((m) => log(m));

  // New-token stream (preset A) — only if A is enabled.
  const newToken = presetEnabled("A") ? startNewTokenScout((m) => log(m)) : null;

  // DexScreener re-poll (presets B/D) — only if either is enabled.
  const dexPoll =
    presetEnabled("B") || presetEnabled("D") ? startDexPollInterval(60_000, (m) => log(m)) : null;

  // Holder-velocity poller (feeds preset F) — only if F is enabled.
  const velocity = presetEnabled("F") ? startHolderVelocity((m) => log(m)) : null;

  const shutdown = () => {
    log("shutting down…");
    scout.stop();
    newToken?.close();
    dexPoll?.stop();
    velocity?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("running. Ctrl-C to stop.");
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
