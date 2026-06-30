# BUILD.md — Trench Desk, complete build spec (self-contained)
You are building **Trench Desk** from scratch in this repo, autonomously, with auto-accept on. This file is the *only* context you have — everything you need is below. Read it fully, then build modules 1→9 in order, committing as you go, and push when done.
A personal **Solana / pump.fun meme-coin trading desk**: it **screens, alerts, vets, logs, and enforces trading discipline.** It is the rigor layer around a high-variance, written-off-risk-capital trading practice. It does **not** pick coins and it does **not** trade.
---
## §0 — THE NON-NEGOTIABLE (read before writing any code)
**Screen, alert, log, vet, and enforce = automated. Buy / sell execution = NEVER.**
- No file may construct, sign, simulate-for-submission, or send a Solana transaction.
- No handling of private keys or seed phrases; no generating trading keypairs; no wallet-connect for trading.
- No calling any swap/trade endpoint: Jupiter, Raydium, PumpPortal `/api/trade` or `/api/trade-local`, any DEX/terminal trade API.
- No "auto-buy", "auto-sell", "sniper", or auto-take-profit/stop **execution**. The 2x take-profit and −50% stop run in the user's *external* terminal (Axiom), never here.
- PumpPortal: **only** the free, keyless data streams `subscribeMigration` and `subscribeNewToken`. Never the metered trade streams (`subscribeTokenTrade`/`subscribeAccountTrade`) or the trade API.
- The bot finds and flags; the human decides and executes. A scout that can pull the trigger is a drained wallet at machine speed.
- The system also **never generates buy signals or ranks "what to buy."** It surfaces candidates that pass safety, and the human runs final judgment. (An "AI that picks meme coins" is a rug.)
- If any feature seems to require the above to be "finished," it is finished without it. Note the boundary and move on.
---
## Autonomous operating rules (auto-accept is on — no human will catch a mistake mid-run)
- **Stay local and reversible.** Commit locally often. Do **not** force-push or rewrite history. Pushing the final branch is fine (that's the deliverable); never `git push --force`. Do **not** deploy anywhere (Vercel/Railway/Fly) — module 9 is a doc only.
- **Never touch secrets.** Read config via `process.env` only. If a key is missing, the feature degrades and you log it under NEEDS NICK. Never invent or hardcode a secret. Never print env values.
- **No destructive commands.** `drizzle-kit push`/`generate` for additive schema is fine; never `DROP`, never delete data, never `rm -rf` outside the repo. If a push prompts for a data-loss confirmation, abort and log it.
- **Don't burn money or credits.** Free tiers only; never require a paid API. Helius credits are scarce — throttle every call, cache, poll only bounded relevant sets, and never leave a poller running to "test" it (start a process for seconds, observe, kill it).
- **Verify the data layer; don't guess.** It drifts fast. Web-search and confirm any endpoint shape before coding it; Zod-validate every external response. Appendix A has shapes verified in mid-2026 — treat them as the starting point and re-verify, don't assume they're still exact.
- **Zero new heavy deps.** Stick to the stack below. If one is genuinely required, pin it and justify it in BUILD_LOG.md.
- **When blocked, skip and log — never stall.** Missing credential, unverifiable API, a §0 wall, a real judgment call → record it under **NEEDS NICK** in BUILD_LOG.md and move to the next module.
### Operating loop (per module)
read this spec → build → `npx tsc --noEmit` (fix every error) → `npm run build` (must pass) → add + run unit tests for pure logic (`npx tsx --test "**/*.test.ts"`) → `git add -A && git commit -m "module N: ..."` → append a BUILD_LOG.md entry (✅ shipped + files, 🧭 decisions, ⚠️ NEEDS NICK, 🔍 how the user validates it). Don't advance until tsc + build are green.
---
## Stack & architecture
- **Next.js 15 (App Router) + React 19 + TypeScript** — dashboard, gate, journal, scoreboard, wallets, and the read/vet APIs. Deploys to Vercel.
- **A separate always-on worker** — holds the migration websocket and runs the background pollers. Runs on Railway/Fly/VPS, **not** Vercel. Build every background loop as an importable module so it can run *either* in the long-lived worker *or* be invoked once per tick by a scheduler (Vercel Cron) — this keeps deployment possible without a 24/7 host. Only the live migration socket strictly needs persistence.
- **Postgres + Drizzle** (`postgres-js` driver) — shared state. Neon/Supabase/Railway all work. All DB access must degrade gracefully to a no-op when `DATABASE_URL` is absent (so the app builds and renders without a DB).
```
DATA (Helius / DexScreener / rugcheck / PumpPortal)
  → SCREENER (6 presets, parallel)
  → SAFETY PRE-CHECK (verdict GREEN/YELLOW/RED; RED = hard-fail, dropped)
  → OUTPUT (Telegram alert + watchlist)
  → FORWARD-TEST LOG (every signal + its tracked outcome)
        │
        ▼
  THE GATE (deterministic discipline check)  →  [ human decides + executes in their terminal ]
```
Aesthetic: a dark **instrument-panel** terminal, not a SaaS page. Tokens — bg `#0F1419`, panel `#161C24`, line `#28323E`, ink `#E8ECEF`, dim `#8A96A3`, amber `#E8B339`, green `#3FB950`, red `#F25555`; fonts IBM Plex Mono (data) + Space Grotesk (UI). Green/red are **semantic only** (verdict, P&L sign, stop telltales), never decoration. Mobile-responsive throughout.
---
## THE DOCTRINE (the rules the code enforces — this is the whole point)
**Capital is written-off risk money.** High variance is intentional and accepted. Do **not** add generic risk warnings anywhere in the UI or copy — that's explicitly unwanted. The system's value is *defense* (not getting rugged) and *discipline* (not blowing up on tilt).
**Phase ladder** (bankroll → sizing). `maxPositionPct` is the hard cap; real risk = position × 0.5 (the −50% stop).
| Phase | Band | Max position | Real risk | Open pos | Mindset |
|---|---|---|---|---|---|
| 0 Trenches | $0–500 | 50% | 25% | 1 | Escape velocity. Convexity hunting. |
| 1 Escape | $500–2k | 25% | 12.5% | 1–2 | Compound, more selective. |
| 2 Establishment | $2k–10k | 15% | 7.5% | 2–3 | Base hits. Size is real. |
| 3 Preservation | $10k+ | 5% | 2.5% | — | Protect the bag; pull to cold storage. |
**The math:** clean 2:1 payoff (win +100%, loss −50%) → breakeven win rate **33.3%**. Rugs blow through the stop to ~−100% and raise the needed win rate (1-in-5 losses being rugs → ~37%; 2-in-5 → ~40%). So every rug the DD screens out lowers your real breakeven. Vetting isn't optional — it's what keeps breakeven near 33% instead of drifting to 45%.
**Exit:** sell-all at 2x, hard −50% stop (mode A, default). Optional mode B: sell 85% at 2x (+70% locked) and ride a 15% moonbag on a pre-set trailing stop. Both legs automated **in the terminal**, not here.
**Tilt locks** (the gate enforces these; they override sizing):
1. After any **full-loss exit → 30-minute cooldown** before the next entry.
2. **No FOMO chase** — no entry on anything past its first major leg without fresh full DD.
3. **No flip** — a ticker you exited is dead for the rest of the session.
4. **Hard daily stop** — when down ~30–40% on the day (or N consecutive losses), the day is over.
**Entry criteria (all five required):** (1) passes full DD, (2) one-sentence thesis, (3) exit ladder + invalidation defined before buying, (4) not on cooldown / daily-stop not hit, (5) size within phase cap.
**DD hard-fails — any one = RED:** mint authority not revoked; freeze authority not revoked; LP not burned/locked; top-holder concentration too high; bundled/sniper supply. YELLOW = elevated risk, reduced size only. GREEN = passed (still risky).
**The 6 screener presets** (run in parallel; params are *starting points*, tuned later via the scoreboard, never by guessing):
- **A Fresh Launch:** age <30–60min, liquidity >$10–20k, mint+freeze revoked + LP burned (hard), holders >50 & climbing, buy-dominant, mcap <~$200k.
- **B Volume Spike:** age >24–72h, 1h volume >3–5× the token's own trailing baseline, 1h price positive, liquidity >$30k.
- **C Graduation/Migration:** just migrated; post-migration liquidity above threshold; active volume; holders not hyper-concentrated.
- **D Mid-Cap Momentum:** age 6–48h, mcap $100k–$2M, liquidity >$50k w/ healthy liq/mcap, sustained volume, accelerating holders, healthy buy/sell.
- **E Smart-Money Trigger:** ≥2–3 tracked smart-money wallets buy the same token within a short window. (Needs module 7.)
- **F Holder Velocity Breakout:** net new holders / 5min crosses a threshold and is accelerating; liquidity floor + clean safety; corroborate with volume + price. (Needs module 6.)
**Validation reality:** meme backtesting lies (survivorship bias, fill fantasy, non-stationarity, reconstruction gaps). **Forward-testing in paper mode is the validation.** Real capital only goes on presets with positive expectancy over 20+ logged outcomes. You are building the apparatus; the forward-test is the user's to run after. Never imply the system is "trading-ready."
---
## BUILD ORDER — modules 1→9
Each module: build to acceptance, typecheck, build, unit-test the pure logic, commit, log.
### Module 1 — Foundation + safety engine + scout (build first; everything mounts on it)
- **App skeleton:** `package.json` (Next 15, React 19, drizzle-orm, postgres, zod, @solana/web3.js, ws; dev: typescript, tsx, drizzle-kit, @types/*), `tsconfig.json` with `@/*`→`./*`, `next.config.mjs` (`serverExternalPackages:["postgres"]`), `drizzle.config.ts`, `.env.example`, `.gitignore`, `app/globals.css` (the theme above), `app/layout.tsx` + nav, `app/page.tsx` dashboard with a status strip (bankroll, phase, size cap, today P&L, loss streak, cooldown, daily stop).
- **`lib/doctrine.ts` — single source of truth** for the phase ladder, sizing, real-risk, and breakeven math. Nothing else hardcodes these numbers.
- **DB schema (Drizzle):** `trading_state` (singleton: bankroll, day, dayStartBankroll, tradesToday, pnlToday$/%, consecutiveLosses, cooldownUntil, dailyStopHit, lastExitedTickers, config{dailyStopPct, maxConsecLosses, cooldownMin, exitMode}), `trades` (the journal: ca, ticker, preset, openedAt, entry, size$/%, phase, thesis, invalidation, exitLadder, status, exits, result$/%, holdingSecs, followedLadder, emotionalState, ruleBreaks, note, stoppedOut, closedAt), `signals` (forward-test log: ts, ca, symbol, preset, entry price/mcap, liquidity, holders, verdict, source, outcome[pending/2x/stop/rug/expired], maxMultiple, resolvedTs), `tracked_wallets` (address, label, addedTs, active), `safety_reports` (cache, keyed by ca), `candidates` (watchlist). A shared `lib/db/client.ts` singleton + `lib/db/state.ts` helper.
- **`GET/PATCH /api/state`** — read/update bankroll + config.
- **Safety engine (`lib/safety.ts` → GREEN/YELLOW/RED):** the differentiated piece. Sources in `lib/sources/*` (Appendix A), all Zod-validated:
  - `provenance` — confirm genuine pump.fun origin via the bonding-curve PDA (clone-proof). For canonical pump migrations, LP is auto-burned → satisfies the LP hard-fail; for non-pump tokens, check LP explicitly.
  - authorities — mint + freeze must be revoked (via Helius `getAsset` token_info).
  - `holders` — early-buyer capture % (first N=20 buyers' share) and top-10-ex-curve concentration; traverse toward curve start or flag the read incomplete.
  - `funding-graph` — shared-funding bundle detection (wallets funded by a common source ≈ one entity). This is the edge over rugcheck/Bubblemaps.
  - Cross-check `rugcheck` (keyless) and `dexscreener` (liquidity/mcap/volume).
  - Weighting: funding-graph > dev-history; any hard-fail = RED. Thresholds (tunable, in a `DOCTRINE`/types constant): redEarlyBuyerCapture 0.25 / yellow 0.15; redTop10ExCurve 0.35 / yellow 0.22; earlyBuyerN 20.
  - **`GET /api/safety/[ca]`** serves a cached report.
- **Scout worker:** subscribe to PumpPortal `subscribeMigration` (free) → throttled queue (concurrency ~3, min-interval ~1.5s, dedupe ~30min) → `runSafety` → cache report + upsert candidate + (RED dropped, GREEN surfaced+alerted, YELLOW quiet) → optional Telegram (send-only, `lib/notify/telegram.ts`). **`GET /api/watchlist`** returns surfaced candidates. ⚠️ Do **not** name any local function `process` (it shadows Node's global) — a real footgun here.
- **Acceptance:** tsc + build green; doctrine math + safety verdict logic unit-tested with fixtures; scout builds and, on a brief smoke start, ingests without crashing; `/api/safety/[ca]` returns a verdict shape.
### Module 2 — Gate page + §7 sizer (`/gate`)
- Deterministic discipline gate (the 6 entry criteria + tilt locks), pure `evaluateGate` using `lib/doctrine.ts`. **DD-cleared input auto-fills from `GET /api/safety/[ca]`:** RED → STAND DOWN (hard, not overridable); YELLOW → allowed, flagged, sizer suggests reduced size; GREEN → clean.
- Sizer shows phase, max position $/%, real risk at −50%, rug-adjusted breakeven; validates intended size vs the phase cap; respects exitMode and shows the matching ladder.
- **`POST /api/trades`** (open a trade from a cleared gate) and **`PATCH /api/trades/:id`** (close: result %, emotional state, rule-breaks, note). Closing mutates `trading_state` per doctrine: increment/reset consecutive losses; set 30-min cooldown on a stop-out; recompute daily-stop; push to lastExitedTickers; update bankroll + today P&L.
- **Acceptance:** entering a CA blocks RED; a cleared gate logs an open trade; closing correctly fires cooldown/daily-stop. Unit-test the gate predicate + sizer + state mutation.
### Module 3 — Journal + review (`/journal`)
Open positions (with the close form), closed log, and a review panel: win rate vs the 33% line, expectancy, avg win/avg loss, followed-ladder rate, rule-break rate, **win-rate-by-emotional-state**, and a sample-size honesty flag under ~20 trades. **Acceptance:** trades render, closing flows through, review math matches `lib/doctrine.ts`; unit-test the aggregations.
### Module 4 — Watchlist page (`/watchlist`)
Table over `GET /api/watchlist`: verdict pill, early-buyer capture, top-10, liquidity, mcap, age, reasons; filter by verdict/status; quick links to `rugcheck.xyz/tokens/{ca}`, `dexscreener.com/solana/{ca}`, `axiom.trade`; a "Send to Gate" action → `/gate?ca=...` prefilled. Read-only. **Acceptance:** renders rows, links resolve, clear empty state.
### Module 5 — Screener engine (the big one)
Normalized `TokenSnapshot` + each preset A–F as a **pure predicate** over it (`lib/screener/presets.ts`), unit-tested with fixtures. Acquisition: C from the migration stream; A from `subscribeNewToken` (free) + settle delay → safety + stats; B/D poll DexScreener over the recently-seen set + any verifiable free trending endpoint; E/F fire from modules 7/6. Pipeline per match: `runSafety` → RED dropped → else write a `signals` row (paper, tagged by preset, deduped on (ca,preset)) + upsert candidate + optional alert. `SCREENER_PRESETS` env toggles which are active. Fold loops into the worker behind the shared throttle. **Acceptance:** predicates unit-tested; worker builds and smoke-ingests; matches land in `signals` tagged by preset; log any unverifiable source under NEEDS NICK.
### Module 6 — Holder-velocity poller
New `holder_snapshots` table (ca, ts, holders). Job: every `HV_POLL_INTERVAL_SEC` (default 300), for the **active watchlist only** (bounded), pull holder count via Helius, store a snapshot, compute net-new per 5/15/30/60 min + acceleration. `GET /api/velocity/:ca`. Feeds Preset F. **Acceptance:** velocity math unit-tested on synthetic series; job bounded + throttled.
### Module 7 — Smart-money tracking
`/wallets` CRUD over `tracked_wallets` (`GET/POST/DELETE /api/wallets`). Job: poll tracked wallets' recent buys via Helius parsed transfers; when ≥ `SMART_MONEY_MIN_WALLETS` (default 2) distinct tracked wallets buy the same token within `SMART_MONEY_WINDOW_MIN` (default 45), fire Preset E → safety → `signals` + alert. (Polling, not webhooks; note webhooks as a future upgrade.) **Acceptance:** wallet CRUD works; cluster detection unit-tested with synthetic events; job throttled.
### Module 8 — Scoreboard (validation backbone)
Outcome tracker job: for each `signals` row with `outcome='pending'`, track price vs entry via DexScreener and resolve `2x` (hit 2× before −50%), `stop` (−50% first), `rug` (liquidity < `RUG_LIQUIDITY_FLOOR_USD` default 1000, or pair gone), `expired` (neither within `OUTCOME_MAX_WINDOW_HRS` default 72); record `maxMultiple`. Poll every `OUTCOME_POLL_INTERVAL_SEC` (default 600), pending only, throttled. `/scoreboard` + `GET /api/scoreboard`: per-preset hit rate, rug rate, expectancy, sample size + honesty flag, and a graduate/keep-paper/kill recommendation per preset. **Acceptance:** resolver unit-tested against synthetic price paths (incl. a rug + an expiry); page renders per-preset stats.
### Module 9 — Ops runbook (DOC ONLY — do not deploy)
Write `OPS.md`: deploying the Next app to Vercel (env to set there), running the worker on an always-on host *or* via Vercel Cron (the per-tick option), Neon/Supabase + `db:push`, the Telegram bot, and a **"going live" checklist that gates real capital on positive forward-test expectancy.** You do not deploy or push beyond the build branch.
---
## Environment variables (read all via `process.env`; keep `.env.example` current)
**Required:** `HELIUS_API_KEY`, `DATABASE_URL`.
**Recommended (alerts):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (no-op if absent).
**Optional, defaulted:** `SCOUT_CONCURRENCY=3`, `SCOUT_MIN_INTERVAL_MS=1500`, `SCOUT_DEDUPE_SEC=1800`, `SCREENER_PRESETS=A,B,C,D,E,F`, `HV_POLL_INTERVAL_SEC=300`, `SMART_MONEY_MIN_WALLETS=2`, `SMART_MONEY_WINDOW_MIN=45`, `OUTCOME_POLL_INTERVAL_SEC=600`, `OUTCOME_MAX_WINDOW_HRS=72`, `RUG_LIQUIDITY_FLOOR_USD=1000`.
**Optional, paid (never require; degrade):** `BIRDEYE_API_KEY`, `RUGCHECK_JWT` (rugcheck reads are keyless without it).
---
## Appendix A — verified API shapes (mid-2026; RE-VERIFY before trusting, then Zod-validate)
- **Helius RPC** `https://mainnet.helius-rpc.com/?api-key=KEY` (JSON-RPC):
  - `getAsset({ id, displayOptions:{ showFungible:true } })` → `result.token_info { supply, decimals, mint_authority, freeze_authority, ... }`.
  - `getTokenAccounts({ mint, limit≤1000, cursor })` → `{ token_accounts:[{ owner, amount }], cursor }` (paginate via cursor).
  - `getAccountInfo`, `getSignaturesForAddress` standard.
- **Helius Enhanced Transactions (REST)** `https://api-mainnet.helius-rpc.com/v0/addresses/{addr}/transactions?api-key=&type=SWAP&before=` — **deprecated but functional**; wrap leniently. Newer DAS methods (`getTransactionsForAddress`, transfers, funded-by, identity) are unverified — wrap defensively.
- **rugcheck** `https://api.rugcheck.xyz/v1/tokens/{mint}/report` — keyless reads; `score_normalised` 0–100, `risks:[...]`.
- **pump.fun** program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; **PumpSwap AMM** `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; bonding-curve PDA seed `"bonding-curve"`; pump tokens use **6 decimals**; migrated tokens auto-burn LP.
- **DexScreener** `https://api.dexscreener.com/latest/dex/tokens/{ca}` — keyless; pairs with priceUsd, liquidity.usd, fdv, volume, txns.
- **PumpPortal** `wss://pumpportal.fun/api/data` — FREE keyless `subscribeMigration` / `subscribeNewToken` ONLY. **Never** `subscribeTokenTrade`/`subscribeAccountTrade` (cost SOL) or the trade API.
- **Burn addresses** to recognize (LP burned): `1nc1nerator11111111111111111111111111111111` and the system program / null address patterns.
---
## When you finish
Leave the repo type-checking, building, committed, and pushed, with BUILD_LOG.md current and a **"Start here in the morning"** summary: overall status, done vs stubbed, what to verify first, and the single most important next step — which is: set creds, `db:push`, run, and **begin the paper-trade forward-test**, the thing that turns "built" into "validated." Begin with module 1.
