import { z } from "zod";
import { heliusRpcUrl, heliusEnhancedUrl, env } from "@/lib/env";
import { rpcCall, fetchJson } from "@/lib/sources/http";

/**
 * Helius RPC + Enhanced Transactions wrappers. Shapes per Appendix A — RE-VERIFY
 * before trusting in production; everything is Zod-validated and degrades to null.
 * Throttle: callers must go through the worker throttle; these do no rate-limiting
 * themselves beyond a per-call timeout.
 */

// ── getAsset (token_info: authorities, supply, decimals) ──────────────────
const TokenInfoSchema = z
  .object({
    supply: z.union([z.number(), z.string()]).optional(),
    decimals: z.number().optional(),
    mint_authority: z.string().nullable().optional(),
    freeze_authority: z.string().nullable().optional(),
    token_program: z.string().optional(),
  })
  .passthrough();

const GetAssetSchema = z.object({
  result: z
    .object({
      id: z.string().optional(),
      token_info: TokenInfoSchema.optional(),
      content: z
        .object({
          metadata: z
            .object({ symbol: z.string().optional(), name: z.string().optional() })
            .partial()
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .nullable(),
});

export interface AssetInfo {
  symbol?: string;
  supply?: number;
  decimals?: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** True if the asset/token_info could not be read. */
  incomplete: boolean;
}

export async function getAsset(ca: string): Promise<AssetInfo | null> {
  const url = heliusRpcUrl();
  if (!url) return null;
  const data = await rpcCall(
    url,
    "getAsset",
    { id: ca, displayOptions: { showFungible: true } },
    GetAssetSchema,
  );
  if (!data || !data.result) return { mintAuthority: null, freezeAuthority: null, incomplete: true };
  const ti = data.result.token_info;
  const supplyNum =
    ti?.supply === undefined ? undefined : Number(ti.supply);
  return {
    symbol: data.result.content?.metadata?.symbol,
    supply: Number.isFinite(supplyNum) ? supplyNum : undefined,
    decimals: ti?.decimals,
    mintAuthority: ti?.mint_authority ?? null,
    freezeAuthority: ti?.freeze_authority ?? null,
    incomplete: !ti,
  };
}

// ── getTokenAccounts (holder owners + amounts, paginated by cursor) ────────
const TokenAccountsSchema = z.object({
  result: z
    .object({
      token_accounts: z
        .array(
          z
            .object({
              owner: z.string(),
              amount: z.union([z.number(), z.string()]),
            })
            .passthrough(),
        )
        .default([]),
      cursor: z.string().nullish(),
    })
    .passthrough()
    .nullable(),
});

export interface HolderAccount {
  owner: string;
  amount: number;
}

export interface HoldersResult {
  accounts: HolderAccount[];
  /** True if pagination was cut short (read incomplete). */
  truncated: boolean;
}

/**
 * Fetch token-account holders, paginating up to `maxPages` (bounded to protect
 * Helius credits). Returns owners with raw amounts.
 */
export async function getTokenAccounts(
  mint: string,
  maxPages = 4,
  pageLimit = 1000,
): Promise<HoldersResult | null> {
  const url = heliusRpcUrl();
  if (!url) return null;
  const accounts: HolderAccount[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const params: Record<string, unknown> = { mint, limit: pageLimit };
    if (cursor) params.cursor = cursor;
    const data = await rpcCall(url, "getTokenAccounts", params, TokenAccountsSchema);
    if (!data || !data.result) {
      return { accounts, truncated: true };
    }
    const accts = data.result.token_accounts ?? [];
    for (const a of accts) {
      const amt = Number(a.amount);
      accounts.push({ owner: a.owner, amount: Number.isFinite(amt) ? amt : 0 });
    }
    pages += 1;
    cursor = data.result.cursor ?? undefined;
    if (!cursor || accts.length === 0) {
      return { accounts, truncated: false };
    }
  }
  return { accounts, truncated: true };
}

/** Distinct-holder count derived from token accounts (owners with amount > 0). */
export async function getHolderCount(mint: string, maxPages = 4): Promise<number | null> {
  const res = await getTokenAccounts(mint, maxPages);
  if (!res) return null;
  const owners = new Set<string>();
  for (const a of res.accounts) if (a.amount > 0) owners.add(a.owner);
  return owners.size;
}

// ── getSignaturesForAddress (standard) ────────────────────────────────────
const SignaturesSchema = z.object({
  result: z
    .array(
      z
        .object({
          signature: z.string(),
          blockTime: z.number().nullish(),
          slot: z.number().optional(),
        })
        .passthrough(),
    )
    .nullable(),
});

export async function getSignaturesForAddress(
  address: string,
  limit = 100,
): Promise<{ signature: string; blockTime: number | null }[] | null> {
  const url = heliusRpcUrl();
  if (!url) return null;
  const data = await rpcCall(url, "getSignaturesForAddress", [address, { limit }], SignaturesSchema);
  if (!data || !data.result) return null;
  return data.result.map((s) => ({ signature: s.signature, blockTime: s.blockTime ?? null }));
}

// ── Enhanced Transactions (REST; deprecated but functional) ───────────────
// Wrapped leniently — newer DAS methods are unverified, so we keep this generic.
const EnhancedTxSchema = z.array(
  z
    .object({
      signature: z.string().optional(),
      timestamp: z.number().optional(),
      type: z.string().optional(),
      tokenTransfers: z
        .array(
          z
            .object({
              mint: z.string().optional(),
              fromUserAccount: z.string().nullish(),
              toUserAccount: z.string().nullish(),
              tokenAmount: z.union([z.number(), z.string()]).nullish(),
            })
            .passthrough(),
        )
        .optional(),
      nativeTransfers: z
        .array(
          z
            .object({
              fromUserAccount: z.string().nullish(),
              toUserAccount: z.string().nullish(),
              amount: z.union([z.number(), z.string()]).nullish(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
);

export type EnhancedTx = z.infer<typeof EnhancedTxSchema>[number];

/**
 * Recent enhanced transactions for an address. `type` filters (e.g. "SWAP").
 * `before` is a signature cursor. Returns [] on absent key / errors.
 */
export async function getEnhancedTransactions(
  address: string,
  opts: { type?: string; before?: string; limit?: number } = {},
): Promise<EnhancedTx[]> {
  const base = heliusEnhancedUrl(address);
  if (!base) return [];
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  if (opts.before) params.set("before", opts.before);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const url = qs ? `${base}&${qs}` : base;
  const data = await fetchJson(url, EnhancedTxSchema);
  return data ?? [];
}

export function heliusConfigured(): boolean {
  return Boolean(env.HELIUS_API_KEY);
}
