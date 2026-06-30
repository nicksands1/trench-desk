/**
 * Smart-money cluster detection — PURE and unit-tested. Given buy events from
 * tracked wallets, find tokens that ≥ `minWallets` DISTINCT tracked wallets
 * bought within a `windowMs` sliding window. Fires preset E.
 */

export interface BuyEvent {
  wallet: string;
  ca: string;
  ts: number; // epoch ms
}

export interface SmartCluster {
  ca: string;
  wallets: string[];
  firstTs: number;
  lastTs: number;
}

/**
 * Detect clusters. For each token, slide a `windowMs` window over its buys; if
 * the window ever holds ≥ `minWallets` distinct wallets, emit a cluster with the
 * distinct wallets in the widest qualifying window.
 */
export function detectSmartMoneyClusters(
  events: BuyEvent[],
  minWallets: number,
  windowMs: number,
): SmartCluster[] {
  const byCa = new Map<string, BuyEvent[]>();
  for (const e of events) {
    const arr = byCa.get(e.ca) ?? [];
    arr.push(e);
    byCa.set(e.ca, arr);
  }

  const clusters: SmartCluster[] = [];
  for (const [ca, evs] of byCa) {
    const sorted = [...evs].sort((a, b) => a.ts - b.ts);
    let best: SmartCluster | null = null;
    // Two-pointer window over time.
    let left = 0;
    for (let right = 0; right < sorted.length; right++) {
      while (sorted[right].ts - sorted[left].ts > windowMs) left++;
      const window = sorted.slice(left, right + 1);
      const wallets = [...new Set(window.map((w) => w.wallet))];
      if (wallets.length >= minWallets) {
        if (!best || wallets.length > best.wallets.length) {
          best = {
            ca,
            wallets,
            firstTs: window[0].ts,
            lastTs: window[window.length - 1].ts,
          };
        }
      }
    }
    if (best) clusters.push(best);
  }
  return clusters;
}
