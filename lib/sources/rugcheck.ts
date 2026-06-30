import { z } from "zod";
import { fetchJson } from "@/lib/sources/http";
import { env } from "@/lib/env";

/**
 * rugcheck — keyless reads. https://api.rugcheck.xyz/v1/tokens/{mint}/report
 * `score_normalised` 0..100 (higher = riskier in rugcheck's convention), plus a
 * `risks` array. An optional RUGCHECK_JWT only raises rate limits. Lenient Zod.
 */

const ReportSchema = z
  .object({
    score: z.number().nullish(),
    score_normalised: z.number().nullish(),
    risks: z
      .array(
        z
          .object({
            name: z.string().optional(),
            level: z.string().optional(),
            description: z.string().optional(),
            score: z.number().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
    rugged: z.boolean().nullish(),
  })
  .passthrough();

export interface RugcheckResult {
  scoreNormalised?: number;
  rugged?: boolean;
  risks: { name: string; level?: string }[];
  /** True if the report could not be read. */
  incomplete: boolean;
}

export async function getRugcheckReport(mint: string): Promise<RugcheckResult> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
  const headers = env.RUGCHECK_JWT
    ? { authorization: `Bearer ${env.RUGCHECK_JWT}` }
    : undefined;
  const data = await fetchJson(url, ReportSchema, { headers });
  if (!data) return { risks: [], incomplete: true };
  return {
    scoreNormalised: data.score_normalised ?? undefined,
    rugged: data.rugged ?? undefined,
    risks: (data.risks ?? [])
      .map((r) => ({ name: r.name ?? "unknown", level: r.level }))
      .filter((r) => r.name !== "unknown" || true),
    incomplete: false,
  };
}
