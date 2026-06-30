import { getState } from "@/lib/db/state";
import { dbAvailable } from "@/lib/db/client";
import { heliusConfigured } from "@/lib/sources/helius";
import { telegramConfigured } from "@/lib/notify/telegram";
import {
  sizing,
  exitLadder,
  rugAdjustedBreakevenWinRate,
  CLEAN_BREAKEVEN,
} from "@/lib/doctrine";
import { usdExact, pct, signedPct, signClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const state = await getState();
  const s = sizing(state.bankroll);
  const ladder = exitLadder(state.config.exitMode);
  const now = Date.now();
  const onCooldown = state.cooldownUntil > now;
  const cooldownMins = onCooldown ? Math.ceil((state.cooldownUntil - now) / 60_000) : 0;
  const dailyStopThreshold = -state.config.dailyStopPct;
  const breakevenRug20 = rugAdjustedBreakevenWinRate(0.2);

  return (
    <main className="stack">
      {/* Status strip */}
      <section className="panel">
        <h2>Desk Status</h2>
        <div className="grid cols-4">
          <div className="metric">
            <span className="label">Bankroll</span>
            <span className="value">{usdExact(state.bankroll)}</span>
            <span className="sub">day start {usdExact(state.dayStartBankroll)}</span>
          </div>
          <div className="metric">
            <span className="label">Phase</span>
            <span className="value">
              {s.phase.id} · {s.phase.name}
            </span>
            <span className="sub">{s.phase.mindset}</span>
          </div>
          <div className="metric">
            <span className="label">Max Position</span>
            <span className="value">{usdExact(s.maxPositionUsd)}</span>
            <span className="sub">
              {pct(s.maxPositionPct, 0)} cap · risk {usdExact(s.realRiskUsd)} ({pct(s.realRiskPct, 1)})
            </span>
          </div>
          <div className="metric">
            <span className="label">Today P&amp;L</span>
            <span className={`value ${signClass(state.pnlTodayUsd)}`}>
              {state.pnlTodayUsd >= 0 ? "+" : ""}
              {usdExact(state.pnlTodayUsd)}
            </span>
            <span className={`sub ${signClass(state.pnlTodayPct)}`}>{signedPct(state.pnlTodayPct)}</span>
          </div>
        </div>

        <hr className="hr" style={{ margin: "14px 0" }} />

        <div className="row">
          <span className={`telltale ${state.consecutiveLosses >= state.config.maxConsecLosses ? "on" : ""}`}>
            loss streak {state.consecutiveLosses}/{state.config.maxConsecLosses}
          </span>
          <span className={`telltale ${onCooldown ? "on" : "ok"}`}>
            {onCooldown ? `cooldown ${cooldownMins}m` : "no cooldown"}
          </span>
          <span className={`telltale ${state.dailyStopHit ? "on" : "ok"}`}>
            {state.dailyStopHit ? "DAILY STOP HIT" : `daily stop ${pct(state.config.dailyStopPct, 0)}`}
          </span>
          <span className="telltale">trades today {state.tradesToday}</span>
          <span className="telltale">exit mode {state.config.exitMode}</span>
          <span className="spacer" />
          <a className="btn" href="/gate">
            Open Gate →
          </a>
        </div>
      </section>

      <div className="grid cols-2">
        {/* The math */}
        <section className="panel">
          <h2>The Math</h2>
          <div className="kvs">
            <span className="k">Clean 2:1 breakeven</span>
            <span>{pct(CLEAN_BREAKEVEN, 1)} win rate</span>
            <span className="k">w/ 1-in-5 rugs</span>
            <span>{pct(breakevenRug20, 1)} win rate</span>
            <span className="k">Exit ladder ({ladder.mode})</span>
            <span>{ladder.description}</span>
            <span className="k">Hard stop</span>
            <span className="neg">−50% (real risk = position × 0.5)</span>
          </div>
          <small className="note">
            Every rug screened out lowers your real breakeven. Vetting is what keeps it near {pct(CLEAN_BREAKEVEN, 0)}.
          </small>
        </section>

        {/* Data layer status */}
        <section className="panel">
          <h2>Data Layer</h2>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`telltale ${dbAvailable() ? "ok" : "on"}`}>DB {dbAvailable() ? "connected" : "no-op"}</span>
            <span className={`telltale ${heliusConfigured() ? "ok" : "on"}`}>Helius {heliusConfigured() ? "keyed" : "missing"}</span>
            <span className={`telltale ${telegramConfigured() ? "ok" : ""}`}>Telegram {telegramConfigured() ? "on" : "off"}</span>
          </div>
          <div className="kvs">
            <span className="k">Scout</span>
            <span>subscribeMigration (free) → safety → watchlist</span>
            <span className="k">Pipeline</span>
            <span>RED dropped · YELLOW quiet · GREEN surfaced + alerted</span>
            <span className="k">Forward-test</span>
            <span>every signal logged + outcome-tracked (scoreboard)</span>
          </div>
          {!dbAvailable() && (
            <small className="note">
              No DATABASE_URL — state is in-memory for this process only. Set creds + run db:push to persist.
            </small>
          )}
        </section>
      </div>

      <section className="banner amber">
        This desk <b>finds and flags</b>. It does not pick coins and it does not trade — the 2x take-profit and −50% stop
        run in your terminal. The single thing that turns &ldquo;built&rdquo; into &ldquo;validated&rdquo; is the paper
        forward-test: let signals accrue, then read the scoreboard.
      </section>
    </main>
  );
}
