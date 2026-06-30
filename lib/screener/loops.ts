import { openPumpStream, type StreamHandle } from "@/lib/sources/pumpportal";
import { sharedThrottle } from "@/lib/worker/throttle";
import { screenCandidate } from "@/lib/screener/engine";
import { remember, markScreened, dueForScreen, seenCount } from "@/lib/screener/registry";

/**
 * Screener acquisition loops, all behind the shared throttle:
 *  - new-token stream (subscribeNewToken, FREE) → settle delay → screen (preset A)
 *  - DexScreener re-poll over the bounded recently-seen set → screen (B/D)
 *
 * Each loop is also exposed as a single-tick function so it can run under a
 * scheduler (Vercel Cron) instead of a 24/7 host. §0: free streams only.
 */

type Log = (msg: string) => void;

/** Settle delay before screening a brand-new token (let stats populate). */
const NEW_TOKEN_SETTLE_MS = 45_000;

/** Re-screen a seen token at most this often. */
const RESCREEN_STALE_MS = 5 * 60_000;

/** Subscribe to subscribeNewToken; screen each after a settle delay (preset A). */
export function startNewTokenScout(log: Log = () => {}): StreamHandle {
  const throttle = sharedThrottle();
  const handle = openPumpStream({
    methods: ["subscribeNewToken"],
    onStatus: (s) => log(`newtoken stream ${s}`),
    onEvent: (_kind, ev) => {
      const ca = ev.ca;
      remember(ca);
      setTimeout(() => {
        void throttle.run(async () => {
          try {
            const res = await screenCandidate(ca, { source: "screener", overrides: { symbol: ev.symbol } });
            markScreened(ca);
            if (res.matches.length) log(`A/new match ${ev.symbol ?? ca}: ${res.matches.map((m) => m.preset).join(",")}`);
          } catch (err) {
            log(`newtoken screen error ${ca}: ${(err as Error).message}`);
          }
        }, `screen:new:${ca}`);
      }, NEW_TOKEN_SETTLE_MS);
    },
    reconnect: true,
  });
  log(`started (subscribeNewToken); seen=${seenCount()}`);
  return handle;
}

/**
 * One DexScreener re-poll pass over the recently-seen set (presets B/D, plus any
 * other enabled preset whose data is present). Bounded by `limit`. Returns the
 * number of candidates screened. Call on an interval OR once per scheduler tick.
 */
export async function tickDexPoll(limit = 20, log: Log = () => {}): Promise<number> {
  const throttle = sharedThrottle();
  const due = dueForScreen(RESCREEN_STALE_MS, limit);
  let screened = 0;
  await Promise.all(
    due.map((ca) =>
      throttle.run(async () => {
        try {
          const res = await screenCandidate(ca, { source: "screener" });
          markScreened(ca);
          screened += 1;
          if (res.matches.length) log(`poll match ${ca}: ${res.matches.map((m) => m.preset).join(",")}`);
        } catch (err) {
          log(`poll screen error ${ca}: ${(err as Error).message}`);
        }
      }, `screen:poll:${ca}`),
    ),
  );
  return screened;
}

/** Run the DexScreener poll on a fixed interval (long-lived worker mode). */
export function startDexPollInterval(intervalMs = 60_000, log: Log = () => {}): { stop: () => void } {
  const timer = setInterval(() => {
    void tickDexPoll(20, log);
  }, intervalMs);
  log(`started (dex re-poll every ${Math.round(intervalMs / 1000)}s)`);
  return { stop: () => clearInterval(timer) };
}
