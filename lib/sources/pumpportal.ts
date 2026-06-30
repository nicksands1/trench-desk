import WebSocket from "ws";
import { z } from "zod";

/**
 * PumpPortal data stream — wss://pumpportal.fun/api/data.
 *
 * §0 NON-NEGOTIABLE: this client subscribes ONLY to the FREE, keyless data
 * streams `subscribeMigration` and `subscribeNewToken`. It MUST NEVER subscribe
 * to `subscribeTokenTrade` / `subscribeAccountTrade` (those cost SOL) and MUST
 * NEVER touch any trade API. There is intentionally no code path that can.
 */

const WS_URL = "wss://pumpportal.fun/api/data";

// Allow-list of permitted methods. Anything else is a hard error by construction.
const ALLOWED_METHODS = ["subscribeMigration", "subscribeNewToken"] as const;
type AllowedMethod = (typeof ALLOWED_METHODS)[number];

const EventSchema = z
  .object({
    mint: z.string().optional(),
    // PumpPortal has used different keys across versions; accept the common ones.
    ca: z.string().optional(),
    symbol: z.string().optional(),
    name: z.string().optional(),
    txType: z.string().optional(),
    marketCapSol: z.number().nullish(),
    solAmount: z.number().nullish(),
    pool: z.string().optional(),
  })
  .passthrough();

export type PumpEvent = z.infer<typeof EventSchema> & { ca: string };

export interface StreamHandle {
  close: () => void;
}

export interface StreamOptions {
  methods: AllowedMethod[];
  onEvent: (kind: AllowedMethod, ev: PumpEvent) => void;
  onStatus?: (status: string) => void;
  /** Reconnect with capped backoff (default true). */
  reconnect?: boolean;
}

/**
 * Open a single socket and subscribe to the requested FREE streams. Returns a
 * handle whose close() tears down the socket and stops reconnection.
 */
export function openPumpStream(opts: StreamOptions): StreamHandle {
  const methods = opts.methods.filter((m): m is AllowedMethod =>
    (ALLOWED_METHODS as readonly string[]).includes(m),
  );
  if (methods.length !== opts.methods.length) {
    throw new Error(
      "openPumpStream: refused a non-free PumpPortal method (only subscribeMigration / subscribeNewToken are permitted).",
    );
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;

  const status = (s: string) => opts.onStatus?.(s);

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      backoff = 1000;
      status("connected");
      for (const method of methods) {
        // The subscribe frame carries ONLY a permitted method name.
        ws?.send(JSON.stringify({ method }));
      }
    });

    ws.on("message", (data: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      const result = EventSchema.safeParse(parsed);
      if (!result.success) return;
      const raw = result.data;
      const ca = raw.mint ?? raw.ca;
      if (!ca) return; // status/ack frames have no mint
      const ev: PumpEvent = { ...raw, ca };
      // We can't always tell which stream produced an event; classify by txType
      // when present, else attribute to the first requested method.
      const kind: AllowedMethod =
        raw.txType === "migrate" || raw.pool === "pump-amm"
          ? methods.includes("subscribeMigration")
            ? "subscribeMigration"
            : methods[0]
          : methods.includes("subscribeNewToken")
            ? "subscribeNewToken"
            : methods[0];
      opts.onEvent(kind, ev);
    });

    ws.on("close", () => {
      status("disconnected");
      if (closed || opts.reconnect === false) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });

    ws.on("error", () => {
      // 'close' will follow and drive reconnection.
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}
