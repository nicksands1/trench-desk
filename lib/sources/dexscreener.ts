import { z } from "zod";
import { fetchJson } from "@/lib/sources/http";

/**
 * DexScreener — keyless. https://api.dexscreener.com/latest/dex/tokens/{ca}
 * Returns pairs with priceUsd, liquidity.usd, fdv, volume, txns. Shapes per
 * Appendix A; Zod-validated and lenient (DexScreener adds fields over time).
 */

const PairSchema = z
  .object({
    chainId: z.string().optional(),
    dexId: z.string().optional(),
    pairAddress: z.string().optional(),
    baseToken: z
      .object({ address: z.string().optional(), symbol: z.string().optional() })
      .partial()
      .passthrough()
      .optional(),
    priceUsd: z.string().nullish(),
    liquidity: z
      .object({ usd: z.number().nullish(), base: z.number().nullish(), quote: z.number().nullish() })
      .partial()
      .passthrough()
      .nullish(),
    fdv: z.number().nullish(),
    marketCap: z.number().nullish(),
    pairCreatedAt: z.number().nullish(),
    volume: z
      .object({ h24: z.number().nullish(), h6: z.number().nullish(), h1: z.number().nullish(), m5: z.number().nullish() })
      .partial()
      .passthrough()
      .nullish(),
    priceChange: z
      .object({ h24: z.number().nullish(), h6: z.number().nullish(), h1: z.number().nullish(), m5: z.number().nullish() })
      .partial()
      .passthrough()
      .nullish(),
    txns: z
      .object({
        h1: z.object({ buys: z.number().nullish(), sells: z.number().nullish() }).partial().passthrough().nullish(),
        m5: z.object({ buys: z.number().nullish(), sells: z.number().nullish() }).partial().passthrough().nullish(),
      })
      .partial()
      .passthrough()
      .nullish(),
  })
  .passthrough();

const TokensResponseSchema = z
  .object({
    pairs: z.array(PairSchema).nullish(),
  })
  .passthrough();

export interface DexStats {
  ca: string;
  symbol?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  mcapUsd?: number;
  /** Pair creation epoch ms (earliest across pairs). */
  pairCreatedAt?: number;
  ageMinutes?: number;
  volume1hUsd?: number;
  volume24hUsd?: number;
  priceChange1h?: number;
  priceChange5m?: number;
  buys1h?: number;
  sells1h?: number;
  buySellRatio1h?: number;
  /** True if no pair was found (migrated-but-not-indexed, or rugged/gone). */
  noPair: boolean;
}

function num(s: string | number | null | undefined): number | undefined {
  if (s === null || s === undefined) return undefined;
  const n = typeof s === "string" ? Number(s) : s;
  return Number.isFinite(n) ? n : undefined;
}

/** Fetch and reduce DexScreener stats for a token, picking the deepest pair. */
export async function getDexStats(ca: string): Promise<DexStats | null> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${ca}`;
  const data = await fetchJson(url, TokensResponseSchema);
  if (!data) return null;
  const pairs = data.pairs ?? [];
  if (pairs.length === 0) {
    return { ca, noPair: true };
  }
  // Deepest-liquidity pair is the representative one.
  const best = [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];

  const createdAt = pairs
    .map((p) => p.pairCreatedAt ?? undefined)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b)[0];

  const ageMinutes =
    createdAt !== undefined ? Math.max(0, (Date.now() - createdAt) / 60_000) : undefined;

  const buys1h = num(best.txns?.h1?.buys);
  const sells1h = num(best.txns?.h1?.sells);
  const ratio =
    buys1h !== undefined && sells1h !== undefined && sells1h > 0
      ? buys1h / sells1h
      : buys1h !== undefined && (sells1h ?? 0) === 0 && buys1h > 0
        ? Number.POSITIVE_INFINITY
        : undefined;

  return {
    ca,
    symbol: best.baseToken?.symbol,
    priceUsd: num(best.priceUsd),
    liquidityUsd: num(best.liquidity?.usd),
    mcapUsd: num(best.marketCap) ?? num(best.fdv),
    pairCreatedAt: createdAt,
    ageMinutes,
    volume1hUsd: num(best.volume?.h1),
    volume24hUsd: num(best.volume?.h24),
    priceChange1h: num(best.priceChange?.h1) !== undefined ? num(best.priceChange?.h1)! / 100 : undefined,
    priceChange5m: num(best.priceChange?.m5) !== undefined ? num(best.priceChange?.m5)! / 100 : undefined,
    buys1h,
    sells1h,
    buySellRatio1h: ratio,
    noPair: false,
  };
}
