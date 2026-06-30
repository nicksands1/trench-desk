import { sharedThrottle } from "@/lib/worker/throttle";
import { getEnhancedTransactions } from "@/lib/sources/helius";
import { listWallets } from "@/lib/db/wallets";
import { detectSmartMoneyClusters, type BuyEvent } from "@/lib/screener/smartmoney";
import { screenCandidate } from "@/lib/screener/engine";
import { remember } from "@/lib/screener/registry";
import { env, presetEnabled } from "@/lib/env";

/**
 * Smart-money tracking (module 7). Polls each tracked wallet's recent SWAPs via
 * Helius enhanced transactions, extracts token buys, and when ≥ N distinct
 * tracked wallets bought the same token within the window, fires preset E.
 *
 * Polling (not webhooks) — webhooks are a future upgrade (see OPS.md / NEEDS NICK).
 * §0: this watches wallets to FLAG copy-trades. It never copies or executes one.
 */

type Log = (msg: string) => void;

// Mints that are not "the token being bought" (quote/base assets).
const QUOTE_MINTS = new Set<string>([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

/** Extract this wallet's recent token buys within the window. */
async function walletBuys(wallet: string, windowMs: number, now: number): Promise<BuyEvent[]> {
  const txs = await getEnhancedTransactions(wallet, { type: "SWAP", limit: 100 });
  const out: BuyEvent[] = [];
  for (const t of txs) {
    const tsMs = (t.timestamp ?? 0) * 1000;
    if (!tsMs || now - tsMs > windowMs) continue;
    for (const tr of t.tokenTransfers ?? []) {
      // A buy = this wallet RECEIVES a non-quote token.
      if (tr.toUserAccount === wallet && tr.mint && !QUOTE_MINTS.has(tr.mint)) {
        out.push({ wallet, ca: tr.mint, ts: tsMs });
      }
    }
  }
  return out;
}

/** One smart-money poll pass. Returns the number of E-clusters fired. */
export async function tickSmartMoney(log: Log = () => {}): Promise<number> {
  const throttle = sharedThrottle();
  const wallets = await listWallets(true);
  if (wallets.length === 0) return 0;

  const windowMs = env.SMART_MONEY_WINDOW_MIN * 60_000;
  const now = Date.now();

  // Gather buys from every tracked wallet (throttled).
  const buckets = await Promise.all(
    wallets.map((w) =>
      throttle.run(() => walletBuys(w.address, windowMs, now), `sm:${w.address}`).then((b) => b ?? []),
    ),
  );
  const events = buckets.flat();

  const clusters = detectSmartMoneyClusters(events, env.SMART_MONEY_MIN_WALLETS, windowMs);
  let fired = 0;
  for (const c of clusters) {
    remember(c.ca);
    if (!presetEnabled("E")) continue;
    const res = await throttle.run(
      () =>
        screenCandidate(c.ca, {
          source: "smart-money",
          only: "E",
          overrides: { smartMoneyBuyers: c.wallets.length },
        }),
      `sm-screen:${c.ca}`,
    );
    if (res && res.matches.length) {
      fired += 1;
      log(`E cluster ${c.ca}: ${c.wallets.length} wallets`);
    }
  }
  return fired;
}

/** Long-lived interval runner (reuses the holder-velocity cadence). */
export function startSmartMoney(log: Log = () => {}): { stop: () => void } {
  const intervalMs = env.HV_POLL_INTERVAL_SEC * 1000;
  const timer = setInterval(() => void tickSmartMoney(log), intervalMs);
  log(`started (smart-money every ${env.HV_POLL_INTERVAL_SEC}s, ≥${env.SMART_MONEY_MIN_WALLETS} wallets / ${env.SMART_MONEY_WINDOW_MIN}m)`);
  return { stop: () => clearInterval(timer) };
}
