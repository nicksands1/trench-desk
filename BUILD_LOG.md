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
