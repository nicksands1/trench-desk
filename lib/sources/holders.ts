import {
  getTokenAccounts,
  getEnhancedTransactions,
  type HolderAccount,
} from "@/lib/sources/helius";
import { deriveBondingCurvePda } from "@/lib/sources/provenance";
import { PUMP_FUN_PROGRAM, PUMPSWAP_AMM_PROGRAM } from "@/lib/sources/constants";

/**
 * Holder distribution analysis:
 *  - top-10 holders ex-bonding-curve concentration (share of supply held by the
 *    largest 10 owners that are NOT the curve/AMM/program),
 *  - early-buyer capture (first N buyers' current share of supply).
 *
 * The math is pure and unit-tested; the I/O wrappers fetch + assemble inputs.
 */

/** Owners that are infrastructure, not real holders (excluded from concentration). */
export function infraOwners(mint: string): Set<string> {
  const set = new Set<string>([PUMP_FUN_PROGRAM, PUMPSWAP_AMM_PROGRAM]);
  const pda = deriveBondingCurvePda(mint);
  if (pda) set.add(pda);
  return set;
}

/** Sum amounts per owner (a holder may have multiple token accounts). */
export function aggregateByOwner(accounts: HolderAccount[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of accounts) {
    if (a.amount <= 0) continue;
    m.set(a.owner, (m.get(a.owner) ?? 0) + a.amount);
  }
  return m;
}

/**
 * Top-N concentration excluding infra owners, as a fraction of total supply.
 * `supply` should be the on-chain supply; if not provided we use the sum of all
 * holder amounts as the denominator (best effort).
 */
export function topNExCurveShare(
  accounts: HolderAccount[],
  exclude: Set<string>,
  n = 10,
  supply?: number,
): number | undefined {
  const byOwner = aggregateByOwner(accounts);
  const total =
    supply && supply > 0
      ? supply
      : [...byOwner.values()].reduce((s, v) => s + v, 0);
  if (!total || total <= 0) return undefined;
  const ranked = [...byOwner.entries()]
    .filter(([owner]) => !exclude.has(owner))
    .map(([, amt]) => amt)
    .sort((a, b) => b - a)
    .slice(0, n);
  const top = ranked.reduce((s, v) => s + v, 0);
  return top / total;
}

/**
 * Early-buyer capture: of the first `n` distinct buyers (by time), what fraction
 * of supply do they currently hold? `ordered` is the list of early buyer owners
 * (earliest first); `byOwner` is current holdings; `supply` the denominator.
 */
export function earlyBuyerCaptureShare(
  orderedEarlyBuyers: string[],
  byOwner: Map<string, number>,
  n: number,
  supply?: number,
): number | undefined {
  const total =
    supply && supply > 0
      ? supply
      : [...byOwner.values()].reduce((s, v) => s + v, 0);
  if (!total || total <= 0) return undefined;
  const first = orderedEarlyBuyers.slice(0, n);
  let held = 0;
  for (const owner of first) held += byOwner.get(owner) ?? 0;
  return held / total;
}

export interface HolderAnalysis {
  top10ExCurve?: number;
  earlyBuyerCapture?: number;
  holderCount?: number;
  /** True if any input could not be fully read. */
  incomplete: boolean;
  detail: string;
}

/**
 * Assemble a holder analysis for a mint. Bounded page count to protect Helius
 * credits. Early-buyer capture is best-effort via enhanced transactions; when
 * that data is unavailable the field is left undefined and the read is flagged
 * incomplete (NOT failed).
 */
export async function analyzeHolders(
  mint: string,
  supply: number | undefined,
  earlyBuyerN: number,
): Promise<HolderAnalysis> {
  const res = await getTokenAccounts(mint, 4);
  if (!res) {
    return { incomplete: true, detail: "Holder accounts unavailable (no key / RPC error)." };
  }
  const exclude = infraOwners(mint);
  const byOwner = aggregateByOwner(res.accounts);
  const holderCount = byOwner.size;
  const top10ExCurve = topNExCurveShare(res.accounts, exclude, 10, supply);

  // Best-effort early buyers: earliest token-transfer recipients of this mint.
  let earlyBuyerCapture: number | undefined;
  let earlyIncomplete = true;
  const txs = await getEnhancedTransactions(mint, { limit: 100 });
  if (txs.length > 0) {
    const events = txs
      .filter((t) => typeof t.timestamp === "number")
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const orderedBuyers: string[] = [];
    const seen = new Set<string>();
    for (const t of events) {
      for (const tr of t.tokenTransfers ?? []) {
        if (tr.mint !== mint) continue;
        const buyer = tr.toUserAccount ?? undefined;
        if (!buyer || exclude.has(buyer) || seen.has(buyer)) continue;
        seen.add(buyer);
        orderedBuyers.push(buyer);
      }
      if (orderedBuyers.length >= earlyBuyerN) break;
    }
    if (orderedBuyers.length > 0) {
      earlyBuyerCapture = earlyBuyerCaptureShare(orderedBuyers, byOwner, earlyBuyerN, supply);
      earlyIncomplete = orderedBuyers.length < earlyBuyerN;
    }
  }

  return {
    top10ExCurve,
    earlyBuyerCapture,
    holderCount,
    incomplete: res.truncated || top10ExCurve === undefined || earlyIncomplete,
    detail: res.truncated
      ? "Holder set partially read (bounded pages)."
      : "Holder distribution computed.",
  };
}
