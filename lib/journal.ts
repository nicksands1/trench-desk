import { CLEAN_BREAKEVEN } from "@/lib/doctrine";
import type { TradeRow } from "@/lib/db/schema";

/**
 * Journal review aggregations — PURE and unit-tested. The win-rate line it
 * compares against is the doctrine's clean 2:1 breakeven (33.3%). "Expectancy"
 * is the mean per-trade result as a fraction of position size (so +1.0 = a 2x,
 * −0.5 = a stop). Sample honesty: under ~20 closed trades, nothing is validated.
 */

export const MIN_SAMPLE = 20;

export interface EmotionStat {
  state: string;
  n: number;
  wins: number;
  winRate: number;
}

export interface JournalReview {
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  winRate: number;
  /** winRate − 33.3% (positive = above the breakeven line). */
  edgeVsBreakeven: number;
  aboveBreakeven: boolean;
  /** Mean result fraction across closed trades (expectancy per trade). */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  totalPnlUsd: number;
  followedLadderRate: number | null;
  ruleBreakRate: number;
  byEmotion: EmotionStat[];
  /** True when there are too few closed trades to trust the numbers. */
  lowSample: boolean;
  breakevenLine: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function computeReview(trades: TradeRow[]): JournalReview {
  const closed = trades.filter((t) => t.status === "closed");
  const open = trades.filter((t) => t.status === "open");

  const results = closed.map((t) => t.resultPct ?? 0);
  const winners = closed.filter((t) => (t.resultPct ?? 0) > 0);
  const losers = closed.filter((t) => (t.resultPct ?? 0) < 0);

  const winRate = closed.length ? winners.length / closed.length : 0;
  const expectancy = mean(results);
  const avgWin = mean(winners.map((t) => t.resultPct ?? 0));
  const avgLoss = mean(losers.map((t) => t.resultPct ?? 0));
  const totalPnlUsd = closed.reduce((s, t) => s + (t.resultUsd ?? 0), 0);

  // Followed-ladder rate over trades where it was recorded.
  const withLadder = closed.filter((t) => t.followedLadder !== null && t.followedLadder !== undefined);
  const followedLadderRate = withLadder.length
    ? withLadder.filter((t) => t.followedLadder).length / withLadder.length
    : null;

  const ruleBreakRate = closed.length
    ? closed.filter((t) => (t.ruleBreaks?.length ?? 0) > 0).length / closed.length
    : 0;

  // Win rate by emotional state.
  const emotionMap = new Map<string, { n: number; wins: number }>();
  for (const t of closed) {
    const e = t.emotionalState;
    if (!e) continue;
    const cur = emotionMap.get(e) ?? { n: 0, wins: 0 };
    cur.n += 1;
    if ((t.resultPct ?? 0) > 0) cur.wins += 1;
    emotionMap.set(e, cur);
  }
  const byEmotion: EmotionStat[] = [...emotionMap.entries()]
    .map(([state, v]) => ({ state, n: v.n, wins: v.wins, winRate: v.n ? v.wins / v.n : 0 }))
    .sort((a, b) => b.n - a.n);

  return {
    closedCount: closed.length,
    openCount: open.length,
    wins: winners.length,
    losses: losers.length,
    winRate,
    edgeVsBreakeven: winRate - CLEAN_BREAKEVEN,
    aboveBreakeven: winRate >= CLEAN_BREAKEVEN,
    expectancy,
    avgWin,
    avgLoss,
    totalPnlUsd,
    followedLadderRate,
    ruleBreakRate,
    byEmotion,
    lowSample: closed.length < MIN_SAMPLE,
    breakevenLine: CLEAN_BREAKEVEN,
  };
}
