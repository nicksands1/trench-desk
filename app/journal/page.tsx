"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradeRow } from "@/lib/db/schema";
import { computeReview } from "@/lib/journal";
import { usd, usdExact, pct, signedPct, signClass, shortCa, relTime } from "@/lib/format";

const EMOTIONS = ["calm", "confident", "fomo", "revenge", "bored", "tilted", "fearful"] as const;

export default function JournalPage() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch("/api/trades").then((r) => r.json()).catch(() => null);
    if (d?.trades) setTrades(d.trades);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");
  const review = computeReview(trades);

  return (
    <main className="stack">
      {/* Review panel */}
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Review</h2>
          <span className="spacer" />
          {review.lowSample && (
            <span className="pill yellow">
              low sample — {review.closedCount}/20 closed, nothing validated yet
            </span>
          )}
        </div>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div className="metric">
            <span className="label">Win rate vs 33.3%</span>
            <span className={`value ${review.aboveBreakeven ? "pos" : "neg"}`}>{pct(review.winRate, 1)}</span>
            <span className={`sub ${signClass(review.edgeVsBreakeven)}`}>
              {signedPct(review.edgeVsBreakeven)} vs breakeven
            </span>
          </div>
          <div className="metric">
            <span className="label">Expectancy / trade</span>
            <span className={`value ${signClass(review.expectancy)}`}>{signedPct(review.expectancy)}</span>
            <span className="sub">{review.wins}W · {review.losses}L</span>
          </div>
          <div className="metric">
            <span className="label">Avg win / avg loss</span>
            <span className="value">
              <span className="pos">{signedPct(review.avgWin)}</span> / <span className="neg">{signedPct(review.avgLoss)}</span>
            </span>
            <span className="sub">total {usdExact(review.totalPnlUsd)}</span>
          </div>
          <div className="metric">
            <span className="label">Discipline</span>
            <span className="value">
              {review.followedLadderRate === null ? "—" : pct(review.followedLadderRate, 0)}
            </span>
            <span className="sub">followed ladder · {pct(review.ruleBreakRate, 0)} broke a rule</span>
          </div>
        </div>

        {review.byEmotion.length > 0 && (
          <>
            <hr className="hr" style={{ margin: "14px 0" }} />
            <h3>Win rate by emotional state</h3>
            <div className="row">
              {review.byEmotion.map((e) => (
                <span key={e.state} className={`telltale ${e.winRate >= review.breakevenLine ? "ok" : "on"}`}>
                  {e.state} {pct(e.winRate, 0)} ({e.n})
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Open positions */}
      <section className="panel">
        <h2>Open Positions ({open.length})</h2>
        {loading ? (
          <div className="dim mono">loading…</div>
        ) : open.length === 0 ? (
          <div className="muted-box">No open positions. Clear a trade through the Gate to log one.</div>
        ) : (
          <div className="stack">
            {open.map((t) => (
              <OpenPosition key={t.id} trade={t} onClosed={load} />
            ))}
          </div>
        )}
      </section>

      {/* Closed log */}
      <section className="panel">
        <h2>Closed Log ({closed.length})</h2>
        {closed.length === 0 ? (
          <div className="muted-box">No closed trades yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Preset</th>
                  <th className="right">Size</th>
                  <th className="right">Result</th>
                  <th className="right">P&amp;L</th>
                  <th>Emotion</th>
                  <th>Ladder</th>
                  <th>Breaks</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr key={t.id}>
                    <td>{t.ticker || shortCa(t.ca)}</td>
                    <td className="dim">{t.preset ?? "—"}</td>
                    <td className="right">{usd(t.sizeUsd)}</td>
                    <td className={`right ${signClass(t.resultPct)}`}>{signedPct(t.resultPct ?? 0)}</td>
                    <td className={`right ${signClass(t.resultUsd)}`}>{t.resultUsd != null ? usdExact(t.resultUsd) : "—"}</td>
                    <td className="dim">{t.emotionalState ?? "—"}</td>
                    <td>{t.followedLadder == null ? "—" : t.followedLadder ? <span className="pos">yes</span> : <span className="neg">no</span>}</td>
                    <td className="dim">{t.ruleBreaks?.length ? t.ruleBreaks.join(",") : "—"}</td>
                    <td className="dim">{relTime(t.closedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function OpenPosition({ trade, onClosed }: { trade: TradeRow; onClosed: () => void }) {
  const [resultPctInput, setResultPctInput] = useState("");
  const [emotion, setEmotion] = useState<string>("");
  const [followedLadder, setFollowedLadder] = useState(true);
  const [stoppedOut, setStoppedOut] = useState(false);
  const [ruleBreaks, setRuleBreaks] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function close() {
    const num = Number(resultPctInput);
    if (!Number.isFinite(num)) {
      setErr("Enter a result %");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/trades/${trade.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resultPct: num / 100,
        emotionalState: emotion || undefined,
        followedLadder,
        stoppedOut,
        ruleBreaks: ruleBreaks.trim() ? ruleBreaks.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        note: note || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) onClosed();
    else {
      const d = await res.json().catch(() => null);
      setErr(d?.error ?? "close failed");
    }
  }

  return (
    <div className="panel" style={{ background: "var(--bg)" }}>
      <div className="row">
        <b className="mono">{trade.ticker || shortCa(trade.ca)}</b>
        <span className="pill neutral">{trade.preset ?? "manual"}</span>
        <span className="dim mono">{usdExact(trade.sizeUsd)} · phase {trade.phase}</span>
        <span className="spacer" />
        <span className="dim mono" style={{ fontSize: 11 }}>opened {relTime(trade.openedAt)}</span>
      </div>
      {trade.thesis && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>“{trade.thesis}”</div>}
      <hr className="hr" style={{ margin: "10px 0" }} />
      <div className="grid cols-3">
        <label className="field">
          Result %
          <input
            type="number"
            value={resultPctInput}
            onChange={(e) => setResultPctInput(e.target.value)}
            placeholder="+100 = 2x, -50 = stop"
          />
        </label>
        <label className="field">
          Emotional state
          <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
            <option value="">—</option>
            {EMOTIONS.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Rule breaks (comma)
          <input value={ruleBreaks} onChange={(e) => setRuleBreaks(e.target.value)} placeholder="e.g. oversize, chase" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--dim)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={followedLadder} onChange={(e) => setFollowedLadder(e.target.checked)} />
          followed ladder
        </label>
        <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--dim)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={stoppedOut} onChange={(e) => setStoppedOut(e.target.checked)} />
          stopped out (fires cooldown)
        </label>
        <span className="spacer" />
        <button className="primary" disabled={busy} onClick={close}>{busy ? "closing…" : "Close trade"}</button>
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what happened / what to learn" />
      </label>
      {err && <div className="banner red" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
