/**
 * A bounded in-memory registry of recently-seen contract addresses. The B/D
 * pollers re-screen this set over time (we never poll "all of Solana" — only a
 * bounded, relevant working set, to protect API credits). Oldest entries are
 * evicted past the cap.
 */

const MAX_ENTRIES = 300;

interface Entry {
  ca: string;
  firstSeen: number;
  lastScreened: number;
}

const g = globalThis as unknown as { __trenchSeen?: Map<string, Entry> };
function store(): Map<string, Entry> {
  if (!g.__trenchSeen) g.__trenchSeen = new Map();
  return g.__trenchSeen;
}

export function remember(ca: string, now = Date.now()): void {
  const s = store();
  const existing = s.get(ca);
  if (existing) return;
  s.set(ca, { ca, firstSeen: now, lastScreened: 0 });
  // Evict oldest if over cap.
  if (s.size > MAX_ENTRIES) {
    const oldest = [...s.values()].sort((a, b) => a.firstSeen - b.firstSeen)[0];
    if (oldest) s.delete(oldest.ca);
  }
}

export function markScreened(ca: string, now = Date.now()): void {
  const e = store().get(ca);
  if (e) e.lastScreened = now;
}

/** CAs not screened within `staleMs`, oldest-first, capped at `limit`. */
export function dueForScreen(staleMs: number, limit: number, now = Date.now()): string[] {
  return [...store().values()]
    .filter((e) => now - e.lastScreened >= staleMs)
    .sort((a, b) => a.lastScreened - b.lastScreened)
    .slice(0, limit)
    .map((e) => e.ca);
}

export function seenCount(): number {
  return store().size;
}
