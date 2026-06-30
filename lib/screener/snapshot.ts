import type { TokenSnapshot, SafetyReport } from "@/lib/types";
import { getDexStats } from "@/lib/sources/dexscreener";

/**
 * Build a normalized TokenSnapshot for a contract from DexScreener stats, merged
 * with any caller-supplied overrides (justMigrated from the migration stream,
 * smartMoneyBuyers from module 7, holder velocity from module 6) and the safety
 * report when already computed. Pure-ish: one bounded DexScreener read.
 */
export async function buildSnapshot(
  ca: string,
  overrides: Partial<TokenSnapshot> = {},
  safety?: SafetyReport,
): Promise<TokenSnapshot> {
  const dex = await getDexStats(ca);
  const base: TokenSnapshot = {
    ca,
    symbol: dex?.symbol ?? safety?.symbol,
    ageMinutes: dex?.ageMinutes,
    liquidityUsd: dex?.liquidityUsd ?? safety?.liquidityUsd,
    mcapUsd: dex?.mcapUsd ?? safety?.mcapUsd,
    priceUsd: dex?.priceUsd,
    volume1hUsd: dex?.volume1hUsd,
    priceChange1h: dex?.priceChange1h,
    priceChange5m: dex?.priceChange5m,
    buySellRatio1h: dex?.buySellRatio1h,
    safety,
  };
  return { ...base, ...overrides, safety: safety ?? overrides.safety };
}
