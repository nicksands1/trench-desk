"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SafetyReport } from "@/lib/types";
import type { TradingStateRow } from "@/lib/db/schema";
import { evaluateGate, type GateState } from "@/lib/discipline";
import { DEFAULT_CONFIG } from "@/lib/doctrine";
import { usdExact, pct } from "@/lib/format";

const EMOTIONS = ["calm", "confident", "fomo", "revenge", "bored", "tilted", "fearful"] as const;

export function GateClient() {
  const params = useSearchParams();
  const initialCa = params.get("ca") ?? "";

  const [ca, setCa] = useState(initialCa);
  const [ticker, setTicker] = useState("");
  const [thesis, setThesis] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [sizeUsd, setSizeUsd] = useState<number>(0);
  const [notFomo, setNotFomo] = useState(false);

  const [state, setState] = useState<TradingStateRow | null>(null);
  const [openPositions, setOpenPositions] = useState(0);
  const [report, setReport] = useState<SafetyReport | null>(null);
  const [loadingSafety, setLoadingSafety] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load discipline state + open-position count.
  useEffect(() => {
    void (async () => {
      const [stRes, trRes] = await Promise.all([
        fetch("/api/state").then((r) => r.json()).catch(() => null),
        fetch("/api/trades?status=open").then((r) => r.json()).catch(() => null),
      ]);
      if (stRes?.state) setState(stRes.state);
      if (typeof trRes?.count === "number") setOpenPositions(trRes.count);
    })();
  }, []);

  // Fetch the safety report whenever a plausible CA is present.
  useEffect(() => {
    const c = ca.trim();
    if (c.length < 32 || c.length > 44) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoadingSafety(true);
    fetch(`/api/safety/${c}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.report) {
          setReport(d.report);
          if (!ticker && d.report.symbol) setTicker(d.report.symbol);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingSafety(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ca]);

  const gateState: GateState = useMemo(
    () => ({
      bankroll: state?.bankroll ?? 0,
      consecutiveLosses: state?.consecutiveLosses ?? 0,
      cooldownUntil: state?.cooldownUntil ?? 0,
      dailyStopHit: state?.dailyStopHit ?? false,
      lastExitedTickers: state?.lastExitedTickers ?? [],
      openPositions,
      config: state?.config ?? DEFAULT_CONFIG,
    }),
    [state, openPositions],
  );

  const gate = useMemo(
    () =>
      evaluateGate(
        gateState,
        {
          ca,
          ticker,
          verdict: report?.verdict,
          thesis,
          invalidation,
          exitLadderDefined: true,
          intendedSizeUsd: sizeUsd,
          notFomoChase: notFomo,
        },
        Date.now(),
      ),
    [gateState, ca, ticker, report, thesis, invalidation, sizeUsd, notFomo],
  );

  async function submit() {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ca, ticker, sizeUsd, thesis, invalidation, notFomoChase: notFomo }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitMsg(`✅ Trade #${data.trade.id} opened — logged. Execute in your terminal.`);
      } else {
        setSubmitMsg(`✕ ${data.error}${data.standDown ? " (STAND DOWN)" : ""}`);
      }
    } catch {
      setSubmitMsg("✕ network error");
    } finally {
      setSubmitting(false);
    }
  }

  const verdictClass = report ? report.verdict.toLowerCase() : "neutral";

  return (
    <>
      {gate.standDown && (
        <div className="banner red">
          <b>STAND DOWN.</b> Safety verdict is RED — a DD hard-fail. This is not overridable. Do not enter.
        </div>
      )}

      <div className="grid cols-2">
        {/* ── Entry form ── */}
        <section className="panel stack">
          <h2>Gate — Entry Criteria</h2>
          <label className="field">
            Contract address
            <input value={ca} onChange={(e) => setCa(e.target.value)} placeholder="mint / CA" spellCheck={false} />
          </label>
          <label className="field">
            Ticker
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="$TICKER" />
          </label>
          <label className="field">
            One-sentence thesis
            <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Why this, in one sentence." />
          </label>
          <label className="field">
            Invalidation (what kills the thesis)
            <input value={invalidation} onChange={(e) => setInvalidation(e.target.value)} placeholder="e.g. loses migration support / volume dies" />
          </label>
          <label className="field">
            Intended size (USD) — cap {usdExact(gate.suggestedMaxUsd)}
            <input
              type="number"
              min={0}
              value={sizeUsd || ""}
              onChange={(e) => setSizeUsd(Number(e.target.value))}
            />
          </label>
          <label className="row" style={{ gap: 8, color: "var(--dim)", fontSize: 12 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={notFomo}
              onChange={(e) => setNotFomo(e.target.checked)}
            />
            This is not a FOMO chase past the first major leg (fresh DD done).
          </label>
        </section>

        {/* ── Safety + sizer ── */}
        <section className="panel stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Safety</h2>
            <span className="spacer" />
            {loadingSafety ? (
              <span className="dim mono">checking…</span>
            ) : report ? (
              <span className={`pill ${verdictClass}`}>{report.verdict}</span>
            ) : (
              <span className="pill neutral">no DD</span>
            )}
          </div>
          {report ? (
            <div className="stack" style={{ gap: 6 }}>
              {report.checks.map((c) => (
                <div key={c.key} className="row" style={{ gap: 8, fontSize: 12 }}>
                  <span className={`pill ${c.verdict.toLowerCase()}`} style={{ minWidth: 58, justifyContent: "center" }}>
                    {c.verdict}
                  </span>
                  <span className="dim">{c.detail}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted-box">Enter a contract address to auto-run DD.</div>
          )}

          <hr className="hr" />
          <h3>Sizer — Phase {gate.sizing.phase.id} · {gate.sizing.phase.name}</h3>
          <div className="kvs">
            <span className="k">Bankroll</span>
            <span>{usdExact(gate.sizing.bankroll)}</span>
            <span className="k">Max position</span>
            <span>
              {usdExact(gate.sizing.maxPositionUsd)} ({pct(gate.sizing.maxPositionPct, 0)})
              {report?.verdict === "YELLOW" && (
                <span className="amber"> → reduced {usdExact(gate.suggestedMaxUsd)}</span>
              )}
            </span>
            <span className="k">Real risk @ −50%</span>
            <span className="neg">{usdExact(gate.sizing.realRiskUsd)} ({pct(gate.sizing.realRiskPct, 1)})</span>
            <span className="k">Rug-adj. breakeven</span>
            <span>{pct(gate.rugAdjustedBreakeven, 1)} (1-in-5 rugs)</span>
            <span className="k">Exit ladder ({gate.ladder.mode})</span>
            <span>{gate.ladder.description}</span>
          </div>
        </section>
      </div>

      {/* ── Gate decision ── */}
      <section className="panel stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>Decision</h2>
          <span className="spacer" />
          <span className={`pill ${gate.cleared ? "green" : "red"}`}>{gate.cleared ? "CLEARED" : "BLOCKED"}</span>
        </div>
        {gate.findings.length === 0 ? (
          <div className="banner green">All entry criteria satisfied. The gate is clear.</div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {gate.findings.map((f, i) => (
              <div key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                <span className={`pill ${f.severity === "block" ? "red" : "yellow"}`} style={{ minWidth: 58, justifyContent: "center" }}>
                  {f.severity === "block" ? "BLOCK" : "WARN"}
                </span>
                <span>{f.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button className="primary" disabled={!gate.cleared || submitting} onClick={submit}>
            {submitting ? "Opening…" : "Open trade (log it)"}
          </button>
          <small className="note">Logging a trade records discipline. You still execute in your terminal — this never trades.</small>
        </div>
        {submitMsg && <div className={`banner ${submitMsg.startsWith("✅") ? "green" : "red"}`}>{submitMsg}</div>}
        <small className="note">
          Emotional state at close is captured in the journal close form (states: {EMOTIONS.join(", ")}).
        </small>
      </section>
    </>
  );
}
