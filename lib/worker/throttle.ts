/**
 * A bounded work queue: limits concurrency, enforces a minimum interval between
 * task starts, and dedupes keys within a TTL window. Every background loop runs
 * through one shared instance so we never hammer Helius / external APIs.
 */

export interface ThrottleOptions {
  concurrency: number;
  minIntervalMs: number;
  dedupeTtlMs: number;
}

export class Throttle {
  private readonly concurrency: number;
  private readonly minIntervalMs: number;
  private readonly dedupeTtlMs: number;
  private active = 0;
  private lastStart = 0;
  private readonly queue: Array<() => void> = [];
  private readonly seen = new Map<string, number>();

  constructor(opts: ThrottleOptions) {
    this.concurrency = Math.max(1, opts.concurrency);
    this.minIntervalMs = Math.max(0, opts.minIntervalMs);
    this.dedupeTtlMs = Math.max(0, opts.dedupeTtlMs);
  }

  /** True if `key` was seen within the dedupe window (and refreshes it). */
  private isDuplicate(key: string): boolean {
    const now = Date.now();
    // opportunistic cleanup
    if (this.seen.size > 5000) {
      for (const [k, ts] of this.seen) {
        if (now - ts > this.dedupeTtlMs) this.seen.delete(k);
      }
    }
    const prev = this.seen.get(key);
    if (prev !== undefined && now - prev < this.dedupeTtlMs) return true;
    this.seen.set(key, now);
    return false;
  }

  /**
   * Run `fn` through the throttle. If `dedupeKey` was seen recently, returns null
   * without running. Otherwise resolves with fn()'s result.
   */
  async run<T>(fn: () => Promise<T>, dedupeKey?: string): Promise<T | null> {
    if (dedupeKey && this.isDuplicate(dedupeKey)) return null;
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      const tryStart = () => {
        const now = Date.now();
        const sinceLast = now - this.lastStart;
        if (this.active < this.concurrency && sinceLast >= this.minIntervalMs) {
          this.active += 1;
          this.lastStart = Date.now();
          resolve();
        } else {
          const wait = Math.max(0, this.minIntervalMs - sinceLast);
          this.queue.push(tryStart);
          if (this.active < this.concurrency) setTimeout(this.pump, wait || 5);
        }
      };
      tryStart();
    });
  }

  private release() {
    this.active -= 1;
    this.pump();
  }

  private pump = () => {
    if (this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next) next();
  };
}

import { env } from "@/lib/env";

let shared: Throttle | null = null;
/** The single shared throttle the worker's loops run through. */
export function sharedThrottle(): Throttle {
  if (!shared) {
    shared = new Throttle({
      concurrency: env.SCOUT_CONCURRENCY,
      minIntervalMs: env.SCOUT_MIN_INTERVAL_MS,
      dedupeTtlMs: env.SCOUT_DEDUPE_SEC * 1000,
    });
  }
  return shared;
}
