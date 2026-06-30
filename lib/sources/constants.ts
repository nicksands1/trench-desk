/** On-chain constants for Solana / pump.fun (Appendix A). */

/** pump.fun program. */
export const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/** PumpSwap AMM program (post-migration). */
export const PUMPSWAP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

/** Seed for the bonding-curve PDA. */
export const BONDING_CURVE_SEED = "bonding-curve";

/** pump.fun tokens use 6 decimals. */
export const PUMP_DECIMALS = 6;

/** Addresses that mean "LP burned" / null authority when set as an owner. */
export const BURN_ADDRESSES = new Set<string>([
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111", // system program / null address
]);

export function isBurnAddress(addr: string | null | undefined): boolean {
  if (!addr) return true; // null authority == revoked/burned
  return BURN_ADDRESSES.has(addr);
}
