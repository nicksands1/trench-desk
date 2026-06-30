import type { TokenSnapshot, SignalSource, PresetLetter, PresetMatch } from "@/lib/types";
import { runSafety, upsertCandidateFromReport } from "@/lib/safety";
import { alertCandidate } from "@/lib/notify/telegram";
import { writeSignalRow } from "@/lib/worker/signals";
import { buildSnapshot } from "@/lib/screener/snapshot";
import { matchingPresets } from "@/lib/screener/presets";
import { env } from "@/lib/env";

/**
 * The screener engine: safety-gate a candidate, evaluate the active presets over
 * its snapshot, and for every match write a paper signal (forward-test log,
 * deduped on ca+preset) + surface/alert. RED is dropped before any preset runs.
 *
 * §0: finds and flags. Never trades, never ranks "what to buy".
 */

export interface ScreenResult {
  ca: string;
  verdict: string;
  dropped: boolean;
  matches: PresetMatch[];
  signalsWritten: number;
}

function enabledPresets(): PresetLetter[] {
  return (["A", "B", "C", "D", "E", "F"] as PresetLetter[]).filter((l) =>
    env.SCREENER_PRESETS.includes(l),
  );
}

export async function screenCandidate(
  ca: string,
  opts: {
    source: SignalSource;
    overrides?: Partial<TokenSnapshot>;
    /** Restrict to a specific preset (E/F triggers) instead of all enabled. */
    only?: PresetLetter;
    alert?: boolean;
  },
): Promise<ScreenResult> {
  const report = await runSafety(ca, { symbol: opts.overrides?.symbol });

  if (report.verdict === "RED") {
    return { ca, verdict: report.verdict, dropped: true, matches: [], signalsWritten: 0 };
  }

  const snapshot = await buildSnapshot(ca, opts.overrides ?? {}, report);
  const active = opts.only ? [opts.only].filter((l) => enabledPresets().includes(l)) : enabledPresets();
  const matches = matchingPresets(snapshot, active);

  // Surface once (GREEN) / keep quiet (YELLOW), tagging the first matched preset.
  const tagPreset = matches[0]?.preset;
  await upsertCandidateFromReport(report, {
    source: opts.source,
    preset: tagPreset,
    ageMinutes: snapshot.ageMinutes,
  });

  // One forward-test signal per matched preset.
  let signalsWritten = 0;
  for (const m of matches) {
    const wrote = await writeSignalRow(report, {
      source: opts.source,
      preset: m.preset,
      holders: snapshot.holders,
    });
    if (wrote) signalsWritten += 1;
  }

  // Alert ONLY on a brand-new match (a freshly-written signal), so the same
  // token never re-alerts on subsequent poll cycles. GREEN + strict preset only.
  if (report.verdict === "GREEN" && signalsWritten > 0 && opts.alert !== false) {
    await alertCandidate(report, {
      preset: matches.map((m) => m.preset).join(","),
      source: opts.source,
    });
  }

  return { ca, verdict: report.verdict, dropped: false, matches, signalsWritten };
}
