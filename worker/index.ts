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
import { heliusConfigured } from "@/lib/sources/helius";
import { dbAvailable } from "@/lib/db/client";

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`${ts} [worker] ${msg}`);
}

async function main() {
  log("starting…");
  if (!dbAvailable()) log("DATABASE_URL not set — DB writes are no-ops (degraded).");
  if (!heliusConfigured()) log("HELIUS_API_KEY not set — safety reads will be incomplete.");

  const scout = startScout((m) => log(m));

  const shutdown = () => {
    log("shutting down…");
    scout.stop();
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
