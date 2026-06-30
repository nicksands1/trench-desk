import { openPumpStream, type StreamHandle } from "@/lib/sources/pumpportal";
import { sharedThrottle } from "@/lib/worker/throttle";
import { screenCandidate } from "@/lib/screener/engine";
import { remember } from "@/lib/screener/registry";

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
    remember(ca); // let the B/D re-poller follow it post-migration
    void throttle.run(async () => {
      try {
        // Migration == preset C source; the engine also evaluates any other
        // enabled preset whose data is already present on the snapshot.
        const res = await screenCandidate(ca, {
          source: "scout",
          overrides: { symbol, justMigrated: true },
        });
        if (res.dropped) {
          log(`RED dropped ${symbol ?? ca}`);
        } else if (res.matches.length) {
          log(`${res.verdict} matched [${res.matches.map((m) => m.preset).join(",")}] ${symbol ?? ca}`);
        } else {
          log(`${res.verdict} no-preset ${symbol ?? ca}`);
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
