import { openPumpStream, type StreamHandle } from "@/lib/sources/pumpportal";
import { sharedThrottle } from "@/lib/worker/throttle";
import { processCandidate } from "@/lib/worker/pipeline";

/**
 * The migration scout (module 1). Holds the PumpPortal `subscribeMigration`
 * socket (FREE/keyless) and runs each migrated token through the throttled
 * safety pipeline. This is the only loop that strictly needs a persistent socket.
 *
 * NOTE: deliberately no function named `process` here (it would shadow Node's
 * global). The migration handler is `handleMigration`.
 */

export interface ScoutHandle {
  stop: () => void;
}

export function startScout(
  log: (msg: string) => void = (m) => console.log(`[scout] ${m}`),
): ScoutHandle {
  const throttle = sharedThrottle();

  const handleMigration = (ca: string, symbol?: string) => {
    void throttle.run(async () => {
      try {
        const res = await processCandidate(ca, {
          symbol,
          source: "scout",
          preset: "C", // migration scout == preset C source
          writeSignal: true,
        });
        if (res.dropped) {
          log(`RED dropped ${symbol ?? ca}`);
        } else if (res.surfaced) {
          log(`GREEN surfaced ${symbol ?? ca}`);
        } else {
          log(`YELLOW quiet ${symbol ?? ca}`);
        }
      } catch (err) {
        log(`error processing ${ca}: ${(err as Error).message}`);
      }
    }, `scout:${ca}`);
  };

  const handle: StreamHandle = openPumpStream({
    methods: ["subscribeMigration"],
    onStatus: (s) => log(`stream ${s}`),
    onEvent: (_kind, ev) => handleMigration(ev.ca, ev.symbol),
    reconnect: true,
  });

  log("started (subscribeMigration)");
  return { stop: () => handle.close() };
}
