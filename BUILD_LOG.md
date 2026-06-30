# BUILD_LOG — Trench Desk

Autonomous build log. One entry per module: ✅ shipped, 🧭 decisions, ⚠️ NEEDS NICK, 🔍 how to validate.

> §0 holds throughout: this system screens, alerts, vets, logs, and enforces discipline.
> It constructs/signs/sends **no** transactions, touches **no** keys, and calls **no** trade endpoint.
> PumpPortal usage is restricted to the free `subscribeMigration` / `subscribeNewToken` streams only.

---

## Environment note (applies to the whole build)
- This build ran in a sandbox whose **network policy blocks outbound HTTPS to non-allowlisted hosts** (DexScreener, rugcheck, Helius, PumpPortal, Telegram all returned `403 CONNECT`). npm registry is allowlisted, so installs work.
- Consequence: external API **shapes could not be live re-verified**, and pollers/sockets can't reach live data **from here**. Everything is therefore built defensively — every external response is Zod-validated and every read degrades to `null`/incomplete rather than throwing. Live verification must happen in the deploy environment (see ⚠️ NEEDS NICK).

---

## Module 1 — Foundation + safety engine + scout ✅

**✅ Shipped**
- App skeleton: `package.json` (Next 15.5.19 / React 19 / TS, drizzle-orm, postgres, zod, @solana/web3.js, ws), `tsconfig.json` (`@/*`→`./*`), `next.config.mjs` (`serverExternalPackages:["postgres"]`), `drizzle.config.ts`, `.env.example`, `.gitignore`.
- Theme + shell: `app/globals.css` (instrument-panel tokens + IBM Plex Mono / Space Grotesk, green/red semantic-only), `app/layout.tsx`, `components/Nav.tsx`, `app/page.tsx` dashboard with the full status strip (bankroll, phase, size cap, today P&L, loss streak, cooldown, daily-stop, data-layer health) + the breakeven math panel.
- `lib/doctrine.ts` — single source of truth: phase ladder, sizing, real-risk, clean + rug-adjusted breakeven, exit ladders (A/B), default config, safety thresholds.
- DB layer: `lib/db/schema.ts` (trading_state, trades, signals, tracked_wallets, safety_reports, candidates, holder_snapshots), `lib/db/client.ts` (singleton that **degrades to no-op without `DATABASE_URL`**), `lib/db/state.ts` (singleton state w/ in-memory fallback + day-rollover), `lib/db/candidates.ts`.
- Safety engine: `lib/safety.ts` (pure `buildChecks` / `verdictFromChecks` / `reportFromInputs` + I/O `runSafety` + cache + candidate upsert). Sources in `lib/sources/*`, all Zod-validated: `provenance` (bonding-curve PDA, clone-proof), `helius` (getAsset authorities, getTokenAccounts, enhanced tx), `holders` (early-buyer capture + top-10-ex-curve), `funding-graph` (shared-funding bundle detection), `rugcheck`, `dexscreener`, `pumpportal` (free streams only), `constants`, `http`.
- APIs: `GET/PATCH /api/state`, `GET /api/safety/[ca]` (cached, `?refresh=1`), `GET /api/watchlist`.
- Scout worker: `lib/worker/scout.ts` (holds `subscribeMigration`), `lib/worker/throttle.ts` (concurrency + min-interval + dedupe), `lib/worker/pipeline.ts` (shared `processCandidate`: runSafety → RED dropped / YELLOW quiet / GREEN surfaced+alerted → optional signal row + Telegram), `lib/notify/telegram.ts` (send-only), `worker/index.ts` entry.

**🧭 Decisions**
- **No Tailwind / no next/font** — plain CSS with a runtime Google-Fonts `@import` + strong fallbacks. Keeps deps minimal and avoids a build-time font fetch (which the sandbox network would block anyway). Zero new heavy deps.
- **Bumped Next 15.1.6 → 15.5.19** (patched; 15.1.6 carries CVE-2025-66478). Still within the spec's "Next 15".
- **Degrade-to-no-op everywhere**: no `DATABASE_URL` ⇒ DB is null and state lives in-process; no `HELIUS_API_KEY` ⇒ safety reads return incomplete (YELLOW), never a false GREEN. Missing reads can never *upgrade* a verdict.
- Money stored as `double precision` (paper desk; exact decimal accounting unnecessary), epoch fields as `bigint(number)` ms.
- The migration handler is `handleMigration` — deliberately **not** named `process` (would shadow Node's global, per the spec's footgun warning).
- Funding-graph runs over a bounded suspect set (top ~12 holders) to protect Helius credits.

**⚠️ NEEDS NICK**
- **Set credentials** to go live: `HELIUS_API_KEY`, `DATABASE_URL` (required); `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (recommended). All optional until then — the app builds/renders without them.
- **Re-verify the live API shapes** in the deploy environment (this sandbox couldn't reach them). Especially: Helius `getTokenAccounts` cursor pagination + `getAsset.token_info`, the (deprecated) Enhanced Transactions REST response used for early-buyers + funding sources, and the exact PumpPortal migration event keys (`mint`/`txType`/`pool`). All are Zod-wrapped, so drift degrades to "incomplete" rather than crashing — but accuracy needs a live check.
- **Early-buyer capture + funding-graph depend on Helius "enhanced/parsed transfers"**, which Appendix A marks deprecated/unverified. If those endpoints are gone, these two checks will report *incomplete* (YELLOW) until rewired to the current DAS method. Run `db:push` then hit `/api/safety/<a-known-pump-ca>?refresh=1` and confirm the checks populate.

**🔍 Validate**
- `npx tsc --noEmit` → clean. `npm run build` → green. `npm test` → 26/26 pass (doctrine ladder/sizing/breakeven, safety verdict hard-fails + incomplete-degrade, holder math, funding clustering).
- `npm run dev` → dashboard renders the status strip from in-memory state; `PATCH /api/state {"bankroll":400}` then reload shows Phase 0 / $200 max / $100 real risk.
- `npm run worker` → boots, logs degraded-mode notices, opens the migration stream, reconnects on disconnect with backoff, no crash.

---

## Module 2 — Gate page + sizer ✅

**✅ Shipped**
- `lib/discipline.ts` — pure, fully-tested enforcement layer:
  - `evaluateGate(state, input, now)` returns `{ cleared, standDown, findings[], sizing, suggestedMaxUsd, ladder, rugAdjustedBreakeven }`. Encodes the 6 entry criteria (DD pass, thesis, exit-ladder + invalidation, not-on-cooldown/daily-stop, size within cap) and the tilt locks (cooldown, no-flip, FOMO attestation, loss-streak, open-position cap). RED short-circuits to a hard, non-overridable **STAND DOWN**; YELLOW halves the suggested cap.
  - `applyTradeClose(state, close, now)` — the doctrine state mutation: bankroll + today P&L, loss-streak increment/reset, 30-min cooldown on a stop-out, daily-stop recompute (down ≥ dailyStopPct **or** loss-streak limit), no-flip ticker push.
- `lib/db/trades.ts` — trades I/O with the same in-memory fallback (so gate→journal works without a DB): `listTrades`, `getTrade`, `openTradeCount`, `insertTrade`, `closeTrade` (wires `applyTradeClose` into persisted state).
- `app/gate/page.tsx` + `app/gate/GateClient.tsx` — `/gate?ca=…` prefilled; auto-runs DD via `/api/safety/[ca]`, live gate verdict, the sizer (phase, cap, real risk, rug-adj breakeven, ladder), and the decision panel. Submitting opens + logs a trade; it never executes one.
- APIs: `GET/POST /api/trades` (POST re-evaluates the gate server-side — defense in depth — and rejects a non-cleared gate with 422), `PATCH /api/trades/[id]` (close + state mutation).

**🧭 Decisions**
- The gate is evaluated **both** client-side (live UX) and server-side (authoritative). The server never trusts the client's "cleared" — it recomputes from the cached/fresh safety verdict + current state.
- "Exit ladder defined" is always true because the doctrine ladder (mode A/B) is always available from config — the criterion is satisfied by the system surfacing the ladder, with the human confirming it.
- YELLOW is *allowed at reduced size* (×0.5 cap) rather than blocked — matches the doctrine ("elevated risk, reduced size only").
- Opening a trade records the active warn-level findings into `ruleBreaks` for honest journaling.

**⚠️ NEEDS NICK**
- The gate's `openPositions` count and `lastExitedTickers` (no-flip) are only meaningful once a DB is connected or within a single running process (in-memory fallback). With no DB, "session" state resets on restart.
- Entry price isn't fetched live at open (falls back to a placeholder); for P&L you record the **result %** at close, which is what the doctrine actually needs. Wire a live price at open later if you want absolute entry tracking.

**🔍 Validate**
- `npm test` → 38/38 (adds 12: gate clears clean GREEN, RED stands down, YELLOW reduces cap, cooldown/daily-stop/loss-streak/no-flip/oversize/max-open/missing-field blocks; close mutations for win/stop-out/daily-stop/streak).
- In the app: open `/gate?ca=<ca>` → DD auto-runs; a RED shows the STAND DOWN banner and the submit stays disabled; a GREEN within cap clears and logs a trade. Close it from the journal (module 3) and watch the dashboard cooldown/daily-stop telltales react.

---

## Module 3 — Journal + review ✅

**✅ Shipped**
- `lib/journal.ts` — pure `computeReview(trades)`: win rate vs the 33.3% doctrine line (`edgeVsBreakeven`, `aboveBreakeven`), expectancy (mean result fraction), avg win / avg loss, total P&L, followed-ladder rate (only over trades where it was recorded), rule-break rate, win-rate-by-emotional-state, and a `lowSample` honesty flag under `MIN_SAMPLE` (20) closed trades.
- `app/journal/page.tsx` — review panel + open positions (each with a close form: result %, emotional state, followed-ladder, stopped-out, rule breaks, note) + the closed log table. Closing a position PATCHes the trade and refetches, so the dashboard discipline telltales update too.

**🧭 Decisions**
- "Expectancy" is expressed as a per-trade fraction of position (so +1.0 = a 2x, −0.5 = a stop) — the same unit the gate/sizer use, not an R-multiple, to stay consistent with `resultPct` everywhere.
- Win-rate-by-emotion telltales turn green/red against the breakeven line so tilt states (revenge/fomo) that drag below 33% are visible at a glance — the whole point of the panel.
- Review math is the same pure function the tests assert, imported directly by the client — no drift between displayed numbers and tested numbers.

**⚠️ NEEDS NICK**
- None specific. Review numbers are only meaningful once you've logged real paper trades — which is the forward-test the system exists to support.

**🔍 Validate**
- `npm test` → 46/46 (adds 8: win rate / expectancy / avg win-loss, the 33.3% line comparison, followed-ladder rate incl. the null case, rule-break rate, by-emotion, low-sample flag, open-exclusion).
- In the app: log a trade via the gate, close it at `+100` → journal shows a win, expectancy +100%, dashboard P&L rises; close another at `-50` with "stopped out" → cooldown telltale lights on the dashboard.

---

## Module 4 — Watchlist page ✅

**✅ Shipped**
- `app/watchlist/page.tsx` — table over `GET /api/watchlist?all=1`: verdict pill, early-buyer capture, top-10 ex-curve, liquidity, mcap, age, reasons; client-side verdict (ALL/GREEN/YELLOW) + status filters; quick links to `rugcheck.xyz/tokens/{ca}`, `dexscreener.com/solana/{ca}`, `axiom.trade`; a **Send-to-Gate** action (`/gate?ca=…`). Read-only with a clear empty state.

**🧭 Decisions**
- RED never appears because RED candidates are dropped at the pipeline (never persisted), so the watchlist is structurally incapable of showing a hard-fail — it shows GREEN (surfaced) and YELLOW (quiet) only.
- No ranking/scoring column: the doctrine forbids ranking "what to buy." Sort is by recency (`lastSeen`), not desirability.

**⚠️ NEEDS NICK**
- Rows only populate once the worker runs with a Helius key + DB. Empty-state copy says exactly that.

**🔍 Validate**
- `npm run build` → `/watchlist` route present, green. With seeded candidates, filters narrow the table and every quick link resolves to the right external token page; Send-to-Gate lands on a prefilled gate.

---

## Module 5 — Screener engine ✅

**✅ Shipped**
- `lib/screener/presets.ts` — the 6 presets A–F as **pure predicates** over a normalized `TokenSnapshot`, with a tunable `SCREENER` threshold table (starting points only). Each returns `{preset, matched, reasons[]}`; a snapshot already carrying a RED safety verdict can never match. `matchingPresets(snapshot, enabled)` filters to active + matched.
- `lib/screener/snapshot.ts` — `buildSnapshot(ca, overrides, safety)` from DexScreener stats + caller overrides (justMigrated / smartMoneyBuyers / holder velocity) + safety.
- `lib/screener/engine.ts` — `screenCandidate(ca, …)`: `runSafety` → RED dropped → build snapshot → evaluate active (or a single `only`) preset(s) → one deduped `signals` row **per matched preset** + surface/alert. Honors `SCREENER_PRESETS`.
- `lib/worker/signals.ts` — shared `writeSignalRow` (dedup on ca+preset, entry snapshot for module 8). Replaces the old single-preset `pipeline.ts` (removed).
- Acquisition loops `lib/screener/loops.ts` + `lib/screener/registry.ts`: `startNewTokenScout` (subscribeNewToken → 45s settle → preset A), `tickDexPoll` / `startDexPollInterval` (bounded re-poll of the recently-seen set → B/D), all behind the shared throttle. The migration scout now routes through the engine (preset C). Worker wires them, gated by `presetEnabled(...)`. E/F are fired by modules 7/6.

**🧭 Decisions**
- Predicates are **market-structure only**; the safety hard-fails (mint/freeze/LP/concentration/bundle) are enforced once, centrally, by the engine's RED-drop — not duplicated into each preset. Predicates additionally short-circuit on an attached RED so they're self-consistent in tests.
- Every missing metric makes a condition **fail** (never "assume true"): a screener can't match on absent data.
- B/D poll a **bounded recently-seen registry** (cap 300, oldest-evicted), not "all of Solana" — protects API credits. Single-tick `tickDexPoll` is exported so this runs under Vercel Cron without a 24/7 host.

**⚠️ NEEDS NICK**
- **No free "trending" endpoint is wired.** The spec allows "any verifiable free trending endpoint" for B/D; I could not verify one from this sandbox (network blocked), so B/D only see tokens that entered the registry via the migration/new-token streams or were otherwise remembered. If you want broader B/D coverage, add a verified trending source and call `remember(ca)` for each — the rest is automatic.
- Re-verify `subscribeNewToken` event keys live (same caveat as module 1's PumpPortal note).

**🔍 Validate**
- `npm test` → 56/56 (adds 10 preset/fixture tests: A fresh-launch incl. RED-refusal + missing-data, B spike vs baseline, C migration, D momentum, E threshold, F velocity, matchingPresets enable/disable).
- `SCREENER_PRESETS=A,B,C,D npm run worker` → boots the migration + new-token streams and the 60s dex re-poll, logs the active preset set, degrades without keys, no crash. Matches land in `signals` tagged by preset (needs DB + Helius to populate).

---

## Module 6 — Holder-velocity poller ✅

**✅ Shipped**
- `lib/screener/velocity.ts` — pure `computeVelocity(points, now)`: net-new holders over 5/15/30/60-min windows + `accel` (h0 − 2·h5 + h10), with a `holdersAt` lookup (at-or-before, earliest fallback).
- `lib/db/holders.ts` — `holder_snapshots` I/O (`insertHolderSnapshot`, `getHolderPoints`) with in-memory fallback.
- `lib/screener/velocity-job.ts` — `tickHolderVelocity(limit)` / `startHolderVelocity`: bounded over the **active watchlist only**, holder count via Helius `getTokenAccounts` → snapshot → velocity → fires preset F (via the engine with velocity overrides) on a real breakout. Throttled.
- `GET /api/velocity/[ca]` — the series + computed velocity. Worker wires the poller, gated on `presetEnabled("F")`.

**🧭 Decisions**
- Holder count is derived from distinct owners in `getTokenAccounts` (bounded to 4 pages) — no separate paid holders endpoint required.
- The poller only ever iterates the watchlist (cap `limit`), never an unbounded universe — directly honors the "bounded, throttled, don't burn credits" rule. Single-tick `tickHolderVelocity` is exported for the Vercel-Cron option.

**⚠️ NEEDS NICK**
- Holder-count accuracy depends on `getTokenAccounts` returning the full owner set within the page bound; for very large holder counts the 4-page cap under-counts (flagged as the read being bounded). Raise the cap only if credits allow.
- Velocity only accrues once the poller has been running for a while (it needs ≥2 snapshots spaced in time). Nothing fires on the first tick — expected.

**🔍 Validate**
- `npm test` → 61/61 (adds 5: holdersAt lookup + fallback, net-new over windows on a steady climb, positive/negative acceleration, empty series).
- With DB + Helius: run the worker, wait a few poll intervals, then `GET /api/velocity/<ca>` shows a rising series; a sharp accelerating climb writes an F-tagged `signals` row.
