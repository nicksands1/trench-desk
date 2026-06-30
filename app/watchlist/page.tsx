"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CandidateRow } from "@/lib/db/schema";
import { usd, pct, shortCa, ageLabel, relTime } from "@/lib/format";

type VerdictFilter = "ALL" | "GREEN" | "YELLOW";

export default function WatchlistPage() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verdict, setVerdict] = useState<VerdictFilter>("ALL");
  const [status, setStatus] = useState<string>("ALL");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      // ?all=1 returns surfaced (GREEN) + quiet (YELLOW); RED is never persisted.
      const d = await fetch("/api/watchlist?all=1").then((r) => r.json()).catch(() => null);
      if (d?.candidates) setRows(d.candidates);
      setLoading(false);
    })();
  }, []);

  const statuses = useMemo(
    () => ["ALL", ...Array.from(new Set(rows.map((r) => r.status)))],
    [rows],
  );

  const filtered = rows.filter(
    (r) => (verdict === "ALL" || r.verdict === verdict) && (status === "ALL" || r.status === status),
  );

  return (
    <main className="stack">
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Watchlist</h2>
          <span className="dim mono" style={{ fontSize: 11 }}>
            candidates that pass safety — RED is dropped, never shown
          </span>
          <span className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            {(["ALL", "GREEN", "YELLOW"] as VerdictFilter[]).map((v) => (
              <button
                key={v}
                className={verdict === v ? "primary" : ""}
                onClick={() => setVerdict(v)}
                style={{ padding: "5px 10px" }}
              >
                {v}
              </button>
            ))}
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
              {statuses.map((s) => (
                <option key={s} value={s}>{s === "ALL" ? "all status" : s}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="dim mono" style={{ marginTop: 12 }}>loading…</div>
        ) : filtered.length === 0 ? (
          <div className="muted-box" style={{ marginTop: 12 }}>
            No candidates yet. Start the worker (<span className="mono">npm run worker</span>) with a Helius key + DB,
            and surfaced tokens will land here as the scout and screeners run.
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Verdict</th>
                  <th>Ticker</th>
                  <th>Src</th>
                  <th className="right">Early-buyer</th>
                  <th className="right">Top-10</th>
                  <th className="right">Liquidity</th>
                  <th className="right">MCap</th>
                  <th className="right">Age</th>
                  <th>Reasons</th>
                  <th>Seen</th>
                  <th>Links</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.ca}>
                    <td><span className={`pill ${r.verdict.toLowerCase()}`}>{r.verdict}</span></td>
                    <td>{r.symbol ? `$${r.symbol}` : <span className="dim">{shortCa(r.ca)}</span>}</td>
                    <td className="dim">{r.preset ?? r.source}</td>
                    <td className="right">{r.earlyBuyerCapture != null ? pct(r.earlyBuyerCapture, 1) : "—"}</td>
                    <td className="right">{r.top10ExCurve != null ? pct(r.top10ExCurve, 1) : "—"}</td>
                    <td className="right">{usd(r.liquidityUsd)}</td>
                    <td className="right">{usd(r.mcapUsd)}</td>
                    <td className="right">{ageLabel(r.ageMinutes)}</td>
                    <td className="dim" style={{ maxWidth: 240, whiteSpace: "normal", fontSize: 11 }}>
                      {r.reasons?.length ? r.reasons.slice(0, 2).join("; ") : "clean"}
                    </td>
                    <td className="dim">{relTime(r.lastSeen)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <a href={`https://rugcheck.xyz/tokens/${r.ca}`} target="_blank" rel="noreferrer" title="rugcheck">rug</a>
                        <a href={`https://dexscreener.com/solana/${r.ca}`} target="_blank" rel="noreferrer" title="dexscreener">dex</a>
                        <a href="https://axiom.trade" target="_blank" rel="noreferrer" title="axiom (you execute here)">ax</a>
                      </div>
                    </td>
                    <td>
                      <Link className="btn" href={`/gate?ca=${r.ca}`} style={{ padding: "4px 8px", fontSize: 11 }}>
                        → Gate
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <small className="note">
        Read-only. The watchlist surfaces what passed safety; it does not rank &ldquo;what to buy.&rdquo; You run final
        judgment in the Gate and execute in Axiom — this never trades.
      </small>
    </main>
  );
}
