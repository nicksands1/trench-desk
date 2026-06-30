import type { ZodType } from "zod";

/**
 * Lenient HTTP helpers for external data. Everything here NEVER throws to the
 * caller — on any error (network, non-2xx, bad shape) it returns null and the
 * caller treats the read as incomplete. All external responses must be passed
 * through a Zod schema before use.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

export interface FetchOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: unknown;
}

export async function fetchJsonRaw(
  url: string,
  opts: FetchOpts = {},
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(opts.body ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + Zod-validate. Returns null on any failure (never throws). */
export async function fetchJson<T>(
  url: string,
  schema: ZodType<T>,
  opts: FetchOpts = {},
): Promise<T | null> {
  const raw = await fetchJsonRaw(url, opts);
  if (raw === null) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A Solana JSON-RPC call (used for Helius RPC). */
export async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown,
  schema: ZodType<T>,
  opts: FetchOpts = {},
): Promise<T | null> {
  const raw = await fetchJsonRaw(url, {
    ...opts,
    method: "POST",
    body: { jsonrpc: "2.0", id: "trench-desk", method, params },
  });
  if (raw === null) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
