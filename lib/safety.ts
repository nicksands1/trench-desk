import { eq } from "drizzle-orm";
import type { SafetyCheck, SafetyReport, Verdict } from "@/lib/types";
import { SAFETY_THRESHOLDS } from "@/lib/doctrine";
import { getDb } from "@/lib/db/client";
import { safetyReports, candidates } from "@/lib/db/schema";
import { isBurnAddress } from "@/lib/sources/constants";
import { checkProvenance } from "@/lib/sources/provenance";
import { getAsset } from "@/lib/sources/helius";
import { analyzeHolders, infraOwners, aggregateByOwner } from "@/lib/sources/holders";
import { analyzeFundingGraph } from "@/lib/sources/funding-graph";
import { getRugcheckReport } from "@/lib/sources/rugcheck";
import { getDexStats } from "@/lib/sources/dexscreener";
import { getTokenAccounts } from "@/lib/sources/helius";

/**
 * Safety engine → GREEN / YELLOW / RED. The verdict math is PURE (buildChecks /
 * verdictFromChecks) and unit-tested; runSafety wires the data sources in and
 * caches the result. Any DD hard-fail forces RED (mint/freeze not revoked, LP
 * not burned, top-holder concentration too high, bundled/sniper supply).
 */

export interface VerdictInputs {
  /** Confirmed genuine pump.fun origin (LP auto-burned on migration). */
  pumpOrigin?: boolean;
  provenanceIncomplete?: boolean;
  /** Mint authority revoked (null/burn). undefined = unread. */
  mintRevoked?: boolean;
  /** Freeze authority revoked. undefined = unread. */
  freezeRevoked?: boolean;
  authoritiesIncomplete?: boolean;
  /** First-N-buyers' captured supply share, 0..1. */
  earlyBuyerCapture?: number;
  /** Top-10 ex-curve concentration, 0..1. */
  top10ExCurve?: number;
  holdersIncomplete?: boolean;
  /** Size of the largest shared-funding cluster (>=2 wallets = a bundle). */
  fundingClusterSize?: number;
  fundingClusterShare?: number;
  fundingIncomplete?: boolean;
  /** rugcheck normalized score 0..100 (higher = riskier). */
  rugcheckScore?: number;
  rugged?: boolean;
  liquidityUsd?: number;
}

const T = SAFETY_THRESHOLDS;

/** Pure: map structured inputs into the list of safety checks. */
export function buildChecks(inp: VerdictInputs): SafetyCheck[] {
  const checks: SafetyCheck[] = [];

  // ── Provenance / LP burn ────────────────────────────────────────────────
  if (inp.pumpOrigin === true) {
    checks.push({
      key: "lp",
      label: "LP burned",
      verdict: "GREEN",
      hardFail: false,
      detail: "Canonical pump.fun migration — LP auto-burned.",
    });
  } else if (inp.provenanceIncomplete) {
    checks.push({
      key: "lp",
      label: "LP burn",
      verdict: "YELLOW",
      hardFail: false,
      incomplete: true,
      detail: "Pump provenance unconfirmed; LP burn not verified.",
    });
  } else {
    // Confirmed non-pump and we have no explicit LP-burn proof => treat as risk.
    checks.push({
      key: "lp",
      label: "LP burn",
      verdict: "YELLOW",
      hardFail: false,
      incomplete: true,
      detail: "Non-pump token: LP burn/lock could not be verified here — check manually.",
    });
  }

  // ── Mint authority ──────────────────────────────────────────────────────
  if (inp.mintRevoked === true) {
    checks.push({ key: "mint", label: "Mint authority revoked", verdict: "GREEN", hardFail: false, detail: "Mint authority revoked." });
  } else if (inp.mintRevoked === false) {
    checks.push({ key: "mint", label: "Mint authority", verdict: "RED", hardFail: true, detail: "Mint authority NOT revoked — supply can be inflated." });
  } else {
    checks.push({ key: "mint", label: "Mint authority", verdict: "YELLOW", hardFail: false, incomplete: true, detail: "Mint authority could not be read." });
  }

  // ── Freeze authority ────────────────────────────────────────────────────
  if (inp.freezeRevoked === true) {
    checks.push({ key: "freeze", label: "Freeze authority revoked", verdict: "GREEN", hardFail: false, detail: "Freeze authority revoked." });
  } else if (inp.freezeRevoked === false) {
    checks.push({ key: "freeze", label: "Freeze authority", verdict: "RED", hardFail: true, detail: "Freeze authority NOT revoked — holders can be frozen." });
  } else {
    checks.push({ key: "freeze", label: "Freeze authority", verdict: "YELLOW", hardFail: false, incomplete: true, detail: "Freeze authority could not be read." });
  }

  // ── Top-10 ex-curve concentration ───────────────────────────────────────
  if (inp.top10ExCurve === undefined) {
    checks.push({ key: "top10", label: "Top-10 concentration", verdict: "YELLOW", hardFail: false, incomplete: true, detail: "Holder concentration could not be read." });
  } else if (inp.top10ExCurve >= T.redTop10ExCurve) {
    checks.push({ key: "top10", label: "Top-10 concentration", verdict: "RED", hardFail: true, detail: `Top-10 ex-curve hold ${(inp.top10ExCurve * 100).toFixed(1)}% (≥ ${(T.redTop10ExCurve * 100).toFixed(0)}%).` });
  } else if (inp.top10ExCurve >= T.yellowTop10ExCurve) {
    checks.push({ key: "top10", label: "Top-10 concentration", verdict: "YELLOW", hardFail: false, detail: `Top-10 ex-curve hold ${(inp.top10ExCurve * 100).toFixed(1)}% (elevated).` });
  } else {
    checks.push({ key: "top10", label: "Top-10 concentration", verdict: "GREEN", hardFail: false, detail: `Top-10 ex-curve hold ${(inp.top10ExCurve * 100).toFixed(1)}%.` });
  }

  // ── Early-buyer capture / bundled supply ────────────────────────────────
  if (inp.earlyBuyerCapture === undefined) {
    checks.push({ key: "earlybuyers", label: "Early-buyer capture", verdict: "YELLOW", hardFail: false, incomplete: true, detail: "Early-buyer capture could not be computed." });
  } else if (inp.earlyBuyerCapture >= T.redEarlyBuyerCapture) {
    checks.push({ key: "earlybuyers", label: "Early-buyer capture", verdict: "RED", hardFail: true, detail: `First ${T.earlyBuyerN} buyers hold ${(inp.earlyBuyerCapture * 100).toFixed(1)}% (≥ ${(T.redEarlyBuyerCapture * 100).toFixed(0)}%) — sniped/bundled.` });
  } else if (inp.earlyBuyerCapture >= T.yellowEarlyBuyerCapture) {
    checks.push({ key: "earlybuyers", label: "Early-buyer capture", verdict: "YELLOW", hardFail: false, detail: `First ${T.earlyBuyerN} buyers hold ${(inp.earlyBuyerCapture * 100).toFixed(1)}% (elevated).` });
  } else {
    checks.push({ key: "earlybuyers", label: "Early-buyer capture", verdict: "GREEN", hardFail: false, detail: `First ${T.earlyBuyerN} buyers hold ${(inp.earlyBuyerCapture * 100).toFixed(1)}%.` });
  }

  // ── Funding-graph bundle (weighted highest among soft signals) ──────────
  const size = inp.fundingClusterSize ?? 0;
  if (inp.fundingIncomplete && size < 2) {
    checks.push({ key: "funding", label: "Funding bundle", verdict: "YELLOW", hardFail: false, incomplete: true, detail: "Funding graph not fully read." });
  } else if (size >= 3) {
    checks.push({ key: "funding", label: "Funding bundle", verdict: "RED", hardFail: true, detail: `Shared-funding cluster of ${size} wallets${inp.fundingClusterShare !== undefined ? ` holding ${(inp.fundingClusterShare * 100).toFixed(1)}%` : ""} — likely one entity.` });
  } else if (size === 2) {
    checks.push({ key: "funding", label: "Funding bundle", verdict: "YELLOW", hardFail: false, detail: "Two wallets share a common funder — watch for a bundle." });
  } else {
    checks.push({ key: "funding", label: "Funding bundle", verdict: "GREEN", hardFail: false, detail: "No shared-funding cluster detected." });
  }

  // ── rugcheck cross-check ────────────────────────────────────────────────
  if (inp.rugged === true) {
    checks.push({ key: "rugcheck", label: "rugcheck", verdict: "RED", hardFail: true, detail: "rugcheck flags this token as rugged." });
  } else if (inp.rugcheckScore !== undefined && inp.rugcheckScore >= 70) {
    checks.push({ key: "rugcheck", label: "rugcheck", verdict: "YELLOW", hardFail: false, detail: `rugcheck risk score ${inp.rugcheckScore.toFixed(0)}/100 (elevated).` });
  } else if (inp.rugcheckScore !== undefined) {
    checks.push({ key: "rugcheck", label: "rugcheck", verdict: "GREEN", hardFail: false, detail: `rugcheck risk score ${inp.rugcheckScore.toFixed(0)}/100.` });
  }

  return checks;
}

/** Pure: reduce checks to a single verdict. Any RED dominates; else any YELLOW. */
export function verdictFromChecks(checks: SafetyCheck[]): Verdict {
  if (checks.some((c) => c.verdict === "RED")) return "RED";
  if (checks.some((c) => c.verdict === "YELLOW")) return "YELLOW";
  return "GREEN";
}

/** Pure: assemble a full report object from inputs (no I/O). */
export function reportFromInputs(
  ca: string,
  inp: VerdictInputs,
  extras: Partial<SafetyReport> = {},
): SafetyReport {
  const checks = buildChecks(inp);
  const verdict = verdictFromChecks(checks);
  const reasons = checks
    .filter((c) => c.verdict !== "GREEN")
    .map((c) => c.detail);
  const incomplete = checks.some((c) => c.incomplete);
  return {
    ca,
    verdict,
    checks,
    reasons,
    earlyBuyerCapture: inp.earlyBuyerCapture,
    top10ExCurve: inp.top10ExCurve,
    liquidityUsd: inp.liquidityUsd,
    pumpProvenance: inp.pumpOrigin,
    rugcheckScore: inp.rugcheckScore,
    incomplete,
    computedAt: Date.now(),
    ...extras,
  };
}

// ── Cache (safety_reports table) ──────────────────────────────────────────
const SAFETY_TTL_MS = 10 * 60_000; // 10 minutes

export async function getCachedReport(ca: string): Promise<SafetyReport | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(safetyReports).where(eq(safetyReports.ca, ca)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.report;
}

async function cacheReport(report: SafetyReport): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .insert(safetyReports)
    .values({ ca: report.ca, verdict: report.verdict, report, computedAt: report.computedAt })
    .onConflictDoUpdate({
      target: safetyReports.ca,
      set: { verdict: report.verdict, report, computedAt: report.computedAt },
    });
}

/**
 * Run the full safety pipeline for a contract. Reads are bounded + Zod-validated
 * and each degrades independently; missing data lands as YELLOW/incomplete, not
 * a false GREEN. Result is cached. `force` bypasses the cache TTL.
 */
export async function runSafety(
  ca: string,
  opts: { symbol?: string; force?: boolean } = {},
): Promise<SafetyReport> {
  if (!opts.force) {
    const cached = await getCachedReport(ca);
    if (cached && Date.now() - cached.computedAt < SAFETY_TTL_MS) return cached;
  }

  // Run the independent reads concurrently.
  const [prov, asset, rug, dex] = await Promise.all([
    checkProvenance(ca),
    getAsset(ca),
    getRugcheckReport(ca),
    getDexStats(ca),
  ]);

  const supply = asset?.supply;
  const earlyBuyerN = T.earlyBuyerN;
  const holders = await analyzeHolders(ca, supply, earlyBuyerN);

  // Funding graph over the top holders (bounded suspect set).
  let fundingSize: number | undefined;
  let fundingShare: number | undefined;
  let fundingIncomplete = true;
  const tokenAccounts = await getTokenAccounts(ca, 2);
  if (tokenAccounts) {
    const byOwner = aggregateByOwner(tokenAccounts.accounts);
    const exclude = infraOwners(ca);
    const suspects = [...byOwner.entries()]
      .filter(([owner]) => !exclude.has(owner))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([owner]) => owner);
    const bundle = await analyzeFundingGraph(suspects, byOwner, supply);
    fundingIncomplete = bundle.incomplete;
    if (bundle.largestCluster) {
      fundingSize = bundle.largestCluster.wallets.length;
      fundingShare = bundle.largestCluster.combinedShare;
    } else if (!bundle.incomplete) {
      fundingSize = 0;
    }
  }

  const inputs: VerdictInputs = {
    pumpOrigin: prov.pumpOrigin,
    provenanceIncomplete: prov.incomplete,
    mintRevoked: asset ? (asset.incomplete ? undefined : isBurnAddress(asset.mintAuthority)) : undefined,
    freezeRevoked: asset ? (asset.incomplete ? undefined : isBurnAddress(asset.freezeAuthority)) : undefined,
    authoritiesIncomplete: !asset || asset.incomplete,
    earlyBuyerCapture: holders.earlyBuyerCapture,
    top10ExCurve: holders.top10ExCurve,
    holdersIncomplete: holders.incomplete,
    fundingClusterSize: fundingSize,
    fundingClusterShare: fundingShare,
    fundingIncomplete,
    rugcheckScore: rug.scoreNormalised,
    rugged: rug.rugged,
    liquidityUsd: dex?.liquidityUsd,
  };

  const report = reportFromInputs(ca, inputs, {
    symbol: opts.symbol ?? asset?.symbol ?? dex?.symbol,
    mcapUsd: dex?.mcapUsd,
  });

  await cacheReport(report);
  return report;
}

/** Upsert a candidate row from a safety report (watchlist write). */
export async function upsertCandidateFromReport(
  report: SafetyReport,
  meta: { source: SafetyReportSource; preset?: string; ageMinutes?: number },
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const now = Date.now();
  const surfaced = report.verdict === "GREEN";
  await db
    .insert(candidates)
    .values({
      ca: report.ca,
      symbol: report.symbol,
      verdict: report.verdict,
      status: "watching",
      source: meta.source,
      preset: meta.preset,
      liquidityUsd: report.liquidityUsd,
      mcapUsd: report.mcapUsd,
      earlyBuyerCapture: report.earlyBuyerCapture,
      top10ExCurve: report.top10ExCurve,
      ageMinutes: meta.ageMinutes,
      reasons: report.reasons,
      surfaced,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      target: candidates.ca,
      set: {
        symbol: report.symbol,
        verdict: report.verdict,
        liquidityUsd: report.liquidityUsd,
        mcapUsd: report.mcapUsd,
        earlyBuyerCapture: report.earlyBuyerCapture,
        top10ExCurve: report.top10ExCurve,
        reasons: report.reasons,
        surfaced,
        lastSeen: now,
        ...(meta.preset ? { preset: meta.preset } : {}),
        ...(meta.ageMinutes !== undefined ? { ageMinutes: meta.ageMinutes } : {}),
      },
    });
}

type SafetyReportSource = "scout" | "screener" | "smart-money" | "holder-velocity" | "manual";
