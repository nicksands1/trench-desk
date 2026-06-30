import { getEnhancedTransactions } from "@/lib/sources/helius";

/**
 * Funding-graph bundle detection — the edge over rugcheck/Bubblemaps. Wallets
 * funded by a common source are likely one entity (a bundle/sniper cluster). We
 * map each suspect wallet to its earliest SOL funder, group by funder, and flag
 * the largest shared-funding cluster and its combined holdings share.
 *
 * The clustering is pure and unit-tested. The funder lookup is best-effort via
 * enhanced native transfers; absent data => incomplete (not a fail).
 */

export interface FundingCluster {
  funder: string;
  wallets: string[];
  /** Combined share of supply held by the cluster (0..1), if holdings known. */
  combinedShare?: number;
}

export interface BundleAnalysis {
  largestCluster?: FundingCluster;
  /** Number of distinct funders backing the suspect set. */
  distinctFunders: number;
  incomplete: boolean;
  detail: string;
}

/**
 * Pure: given each wallet's funder and (optional) holdings + supply, find the
 * largest cluster of wallets sharing one funder. Self-funded / unknown funders
 * (mapped to undefined) are ignored.
 */
export function clusterByFunder(
  walletFunders: Map<string, string | undefined>,
  holdings?: Map<string, number>,
  supply?: number,
): { largest?: FundingCluster; distinctFunders: number } {
  const groups = new Map<string, string[]>();
  for (const [wallet, funder] of walletFunders) {
    if (!funder) continue;
    const arr = groups.get(funder) ?? [];
    arr.push(wallet);
    groups.set(funder, arr);
  }
  let largest: FundingCluster | undefined;
  for (const [funder, wallets] of groups) {
    if (wallets.length < 2) continue; // a cluster needs >= 2 shared-funded wallets
    let combinedShare: number | undefined;
    if (holdings && supply && supply > 0) {
      const held = wallets.reduce((s, w) => s + (holdings.get(w) ?? 0), 0);
      combinedShare = held / supply;
    }
    if (
      !largest ||
      wallets.length > largest.wallets.length ||
      (wallets.length === largest.wallets.length &&
        (combinedShare ?? 0) > (largest.combinedShare ?? 0))
    ) {
      largest = { funder, wallets, combinedShare };
    }
  }
  return { largest, distinctFunders: groups.size };
}

/**
 * Best-effort: find the earliest SOL funder of a wallet via enhanced native
 * transfers (the first inbound SOL transfer's sender). Returns undefined when
 * the data is unavailable.
 */
async function findFunder(wallet: string): Promise<string | undefined> {
  const txs = await getEnhancedTransactions(wallet, { limit: 100 });
  if (txs.length === 0) return undefined;
  const events = txs
    .filter((t) => typeof t.timestamp === "number")
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  for (const t of events) {
    for (const nt of t.nativeTransfers ?? []) {
      if (nt.toUserAccount === wallet && nt.fromUserAccount) {
        return nt.fromUserAccount;
      }
    }
  }
  return undefined;
}

/**
 * Analyze a suspect set of wallets (e.g. top holders + early buyers) for shared
 * funding. Bounded to protect Helius credits — pass a small suspect set.
 */
export async function analyzeFundingGraph(
  suspects: string[],
  holdings?: Map<string, number>,
  supply?: number,
  maxLookups = 15,
): Promise<BundleAnalysis> {
  const limited = suspects.slice(0, maxLookups);
  if (limited.length === 0) {
    return { distinctFunders: 0, incomplete: true, detail: "No suspect wallets to analyze." };
  }
  const walletFunders = new Map<string, string | undefined>();
  let anyData = false;
  for (const w of limited) {
    const funder = await findFunder(w);
    if (funder !== undefined) anyData = true;
    walletFunders.set(w, funder);
  }
  if (!anyData) {
    return {
      distinctFunders: 0,
      incomplete: true,
      detail: "Funding sources unavailable (no key / enhanced API empty).",
    };
  }
  const { largest, distinctFunders } = clusterByFunder(walletFunders, holdings, supply);
  return {
    largestCluster: largest,
    distinctFunders,
    incomplete: limited.length < suspects.length,
    detail: largest
      ? `Largest shared-funding cluster: ${largest.wallets.length} wallets from one funder.`
      : "No shared-funding cluster detected among suspects.",
  };
}
