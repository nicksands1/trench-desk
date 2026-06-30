"use client";

import { useEffect, useState } from "react";
import type { Scoreboard, Recommendation } from "@/lib/scoreboard/aggregate";
import { PRESET_NAMES } from "@/lib/screener/presets";
import { pct, signedPct, signClass } from "@/lib/format";
import type { PresetLetter } from "@/lib/types";

const RECO_CLASS: Record<Recommendation, string> = {
  graduate: "green",
  "keep-paper": "yellow",
  kill: "red",
};

export default function ScoreboardPage() {
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const d = await fetch("/api/scoreboard").then((r) => r.json()).catch(() => null);
      if (d?.byPreset) setBoard(d);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="stack">
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Scoreboard — Forward-Test</h2>
          <span className="spacer" />
          {board && (
            <span className="dim mono" style={{ fontSize: 11 }}>
              {board.totalResolved}/{board.totalSignals} signals resolved
            </span>
          )}
        </div>
        <p className="dim" style={{ fontSize: 12 }}>
          Paper outcomes per preset. Real capital only goes on a preset that is <b>graduate</b> — positive expectancy over
          ≥20 resolved outcomes. Backtests lie; this forward-test is the validation.
        </p>

        {loading ? (
          <div className="dim mono">loading…</div>
        ) : !board || board.byPreset.length === 0 ? (
          <div className="muted-box">
            No signals yet. Run the worker with a DB + Helius key; as screeners fire and the outcome tracker resolves
            them, per-preset stats appear here.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Preset</th>
                  <th className="right">Signals</th>
                  <th className="right">Resolved</th>
                  <th className="right">Hit (2x)</th>
                  <th className="right">Rug</th>
                  <th className="right">Expectancy</th>
                  <th className="right">Avg max ×</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {board.byPreset.map((s) => (
                  <tr key={s.preset}>
                    <td>
                      <b>{s.preset}</b> <span className="dim">{PRESET_NAMES[s.preset as PresetLetter]}</span>
                    </td>
                    <td className="right">{s.total}</td>
                    <td className="right">
                      {s.resolved}
                      {s.lowSample && <span className="amber" title="under 20 — not validated"> *</span>}
                    </td>
                    <td className="right pos">{pct(s.hitRate, 0)}</td>
                    <td className="right neg">{pct(s.rugRate, 0)}</td>
                    <td className={`right ${signClass(s.expectancy)}`}>{signedPct(s.expectancy, 1)}</td>
                    <td className="right">{s.avgMaxMultiple != null ? `${s.avgMaxMultiple.toFixed(2)}×` : "—"}</td>
                    <td>
                      <span className={`pill ${RECO_CLASS[s.recommendation]}`}>{s.recommendation}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <small className="note">* under the 20-outcome minimum — keep paper-trading; nothing is validated yet.</small>
          </div>
        )}
      </section>
    </main>
  );
}
