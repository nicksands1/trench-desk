import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { heliusRpcUrl } from "@/lib/env";
import { rpcCall } from "@/lib/sources/http";
import {
  PUMP_FUN_PROGRAM,
  BONDING_CURVE_SEED,
} from "@/lib/sources/constants";

/**
 * Provenance — confirm GENUINE pump.fun origin via the bonding-curve PDA. This
 * is clone-proof: a copy-cat token cannot reproduce a PDA owned by the pump.fun
 * program for its own mint. For canonical pump migrations the LP is auto-burned,
 * so confirmed pump origin satisfies the LP hard-fail.
 *
 * The PDA derivation is pure (no network). Existence/ownership is confirmed via
 * Helius getAccountInfo when a key is configured; without it we still return the
 * derived address and mark the read incomplete.
 */

export interface ProvenanceResult {
  /** Derived bonding-curve PDA for this mint (deterministic). */
  bondingCurvePda?: string;
  /** True when the PDA account exists and is owned by the pump.fun program. */
  pumpOrigin: boolean;
  /** True when ownership could not be confirmed on-chain (key absent / RPC fail). */
  incomplete: boolean;
  detail: string;
}

const AccountInfoSchema = z.object({
  result: z
    .object({
      value: z
        .object({ owner: z.string().optional(), lamports: z.number().optional() })
        .passthrough()
        .nullable(),
    })
    .passthrough()
    .nullable(),
});

/** Pure: derive the bonding-curve PDA address for a mint. Null if mint invalid. */
export function deriveBondingCurvePda(mint: string): string | null {
  try {
    const mintKey = new PublicKey(mint);
    const programKey = new PublicKey(PUMP_FUN_PROGRAM);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mintKey.toBuffer()],
      programKey,
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}

export async function checkProvenance(mint: string): Promise<ProvenanceResult> {
  const pda = deriveBondingCurvePda(mint);
  if (!pda) {
    return { pumpOrigin: false, incomplete: false, detail: "Invalid mint address." };
  }
  const url = heliusRpcUrl();
  if (!url) {
    return {
      bondingCurvePda: pda,
      pumpOrigin: false,
      incomplete: true,
      detail: "Derived bonding-curve PDA; on-chain confirmation needs HELIUS_API_KEY.",
    };
  }
  const data = await rpcCall(
    url,
    "getAccountInfo",
    [pda, { encoding: "base64" }],
    AccountInfoSchema,
  );
  if (!data) {
    return {
      bondingCurvePda: pda,
      pumpOrigin: false,
      incomplete: true,
      detail: "Could not read bonding-curve PDA account (RPC error).",
    };
  }
  const owner = data.result?.value?.owner;
  if (!data.result?.value) {
    return {
      bondingCurvePda: pda,
      pumpOrigin: false,
      incomplete: false,
      detail: "No bonding-curve account — not a canonical pump.fun token (or already closed).",
    };
  }
  const isPump = owner === PUMP_FUN_PROGRAM;
  return {
    bondingCurvePda: pda,
    pumpOrigin: isPump,
    incomplete: false,
    detail: isPump
      ? "Genuine pump.fun bonding-curve PDA confirmed (LP auto-burned on migration)."
      : `Bonding-curve PDA owned by ${owner ?? "unknown"}, not pump.fun.`,
  };
}
