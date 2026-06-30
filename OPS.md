# OPS.md — running Trench Desk

This is the operator runbook for **Trench Desk**: a Solana / pump.fun screening,
vetting, logging, and discipline-enforcement desk. It **screens, alerts, vets,
logs, and enforces**. It does **not** pick coins and it does **not** trade — the
2x take-profit and −50% stop run in your external terminal (Axiom), never here.

> **§0 reminder.** Nothing in this system constructs/signs/sends a transaction,
> handles keys, or calls a trade endpoint. Keep it that way. If a future change
> seems to "need" execution to be useful, it's finished without it.

Two things to deploy:

1. **The Next.js app** (dashboard, gate, journal, watchlist, wallets, scoreboard, read/vet APIs) → **Vercel**.
2. **The background work** (migration socket + pollers) → **either** a small always-on host **or** Vercel Cron for the poll loops.

---

## 0. Prerequisites

- A **Postgres** database (Neon / Supabase / Railway — all fine).
- A **Helius** API key (free tier works; the desk throttles aggressively).
- *(Recommended)* a **Telegram bot** for alerts.

Copy `.env.example` and fill in what you have. Everything degrades: with no
`DATABASE_URL` the app still builds and renders (state is in-memory, non-persistent);
with no `HELIUS_API_KEY` safety reads return *incomplete* (YELLOW), never a false GREEN.

---

## 1. Database (Neon / Supabase / Railway)

1. Create a Postgres database and copy its connection string into `DATABASE_URL`.
   - Neon: use the **pooled** connection string. Supabase: Settings → Database →
     Connection string (URI). Add `?sslmode=require` if your host needs it.
2. Push the schema (additive — never destructive):
   ```bash
   DATABASE_URL=... npm run db:push
   ```
   `drizzle-kit push` creates `trading_state`, `trades`, `signals`,
   `tracked_wallets`, `safety_reports`, `candidates`, `holder_snapshots`.
   It only adds; it never drops. If it ever prompts about data loss, **abort**.
3. *(Optional)* generate SQL migrations to review instead of pushing:
   ```bash
   npm run db:generate   # writes ./drizzle/*.sql
   ```

---

## 2. Deploy the app to Vercel

1. Import the repo into Vercel. Framework preset: **Next.js** (auto-detected).
   Build command `next build`, output handled by Vercel.
2. Set **Environment Variables** in the Vercel project (Production + Preview):

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Postgres (pooled). |
   | `HELIUS_API_KEY` | ✅ for live data | RPC + enhanced tx. |
   | `TELEGRAM_BOT_TOKEN` | recommended | Alerts (no-op if absent). |
   | `TELEGRAM_CHAT_ID` | recommended | Destination chat. |
   | `SCREENER_PRESETS` | optional | Default `A,B,C,D,E,F`. |
   | `CRON_SECRET` | if using Vercel Cron | Protects `/api/cron/*`. |
   | scout/screener tunables | optional | See `.env.example` for the full list + defaults. |

   Never paste secrets into the repo or the client — the app reads everything via
   `process.env` server-side only.
3. Deploy. The dashboard should render with the **Data Layer** panel showing
   DB connected / Helius keyed.

> `postgres` (postgres-js) is declared in `serverExternalPackages` so Vercel's
> server build doesn't bundle it. No extra config needed.

---

## 3. Run the background work

The migration socket needs persistence; the pollers don't. Pick one:

### Option A — Always-on worker (recommended; full coverage)

Runs the live `subscribeMigration` + `subscribeNewToken` sockets **and** every
poller in one process.

On a small host (Railway service / Fly machine / a VPS / even a Raspberry Pi):

```bash
git clone <repo> && cd trench-desk
npm ci
# provide env (DATABASE_URL, HELIUS_API_KEY, TELEGRAM_*, SCREENER_PRESETS, …)
npm run worker
```

- Railway: add a second service from the same repo with start command `npm run worker`.
- Fly: a `[processes]` entry `worker = "npm run worker"`.
- Keep it as a long-lived process; it reconnects the sockets automatically with backoff.

This is the only way to catch migrations/new-tokens **in real time** (the socket
events aren't pollable).

### Option B — Vercel Cron (no extra host; poll loops only)

The repo ships `vercel.json` with cron schedules hitting per-tick endpoints:

| Endpoint | Default schedule | Loop |
|---|---|---|
| `/api/cron/dexpoll` | every 2 min | DexScreener re-poll → presets B/D |
| `/api/cron/velocity` | every 5 min | holder-velocity → preset F |
| `/api/cron/smartmoney` | every 5 min | tracked-wallet buys → preset E |
| `/api/cron/outcomes` | every 10 min | resolve pending signals (scoreboard) |

1. Set `CRON_SECRET` in Vercel — the cron requests carry
   `Authorization: Bearer <CRON_SECRET>` automatically; the routes reject anything else.
2. Deploy. Vercel registers the crons from `vercel.json`.

**Limitation:** Cron mode does **not** hold the migration/new-token sockets, so
it misses real-time fresh launches (preset A) and migrations (preset C) — it only
re-screens the bounded *recently-seen* working set and resolves outcomes. For full
coverage run Option A. You can also run a **hybrid**: the always-on worker for the
sockets + let Vercel Cron drive nothing (or run only the worker). Don't double-run
the same poller in both places.

---

## 4. Telegram alerts (optional, send-only)

1. Create a bot via **@BotFather** → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Get your chat id (DM the bot, then check `getUpdates`, or use **@userinfobot**) →
   `TELEGRAM_CHAT_ID`.
3. Set both in the worker's env **and** Vercel (so server routes can alert too).

Alerts are **send-only**: the bot pushes a message when a GREEN candidate is
surfaced. It has no command handler and no buttons — there is no path from a
Telegram message to any action. If the vars are absent, alerting is a silent no-op.

---

## 5. "Going live" checklist — gating real capital

Real money is **written-off risk capital**, but the system's whole job is to keep
you from blowing up on rugs and tilt. Do **not** size up on a preset until it has
earned it on the forward-test.

Before any real-capital trade on a given preset:

- [ ] **Schema pushed** and the app shows DB connected + Helius keyed.
- [ ] **Worker running** (Option A) for long enough to accrue signals — days, not hours.
- [ ] On `/scoreboard`, the preset reads **graduate** — i.e. **≥ 20 resolved
      outcomes** *and* **positive expectancy**. A `keep-paper` (low sample) or
      `kill` (negative expectancy) preset gets **no** real capital.
- [ ] **Rug rate** on the preset is sane — a high rug rate raises your real
      breakeven well above 33% and quietly eats the edge.
- [ ] You're using the **Gate** for every entry: DD verdict not RED, thesis +
      invalidation + exit ladder defined, size within the phase cap, not on
      cooldown / daily-stop.
- [ ] Exits (2x take-profit, −50% stop) are pre-set **in Axiom** before you buy.
- [ ] Bankroll in the desk matches reality so the phase ladder sizes correctly.

Per-trade discipline (the Gate enforces these; don't override):

- [ ] RED = **stand down**, no exceptions.
- [ ] After a full-loss stop-out: **30-min cooldown** before the next entry.
- [ ] **No flip** — a ticker you exited this session is dead for the session.
- [ ] **Daily stop** — when down ~30–40% on the day (or N consecutive losses), the day is over.

**Backtests lie** (survivorship, fill fantasy, non-stationarity). The paper
forward-test on `/scoreboard` is the validation. Until a preset graduates there,
it is not trading-ready — and this system never implies otherwise.

---

## 6. Operational notes

- **Credits.** Helius is the scarce resource. Pollers are bounded (watchlist/seen
  set only) and throttled (`SCOUT_CONCURRENCY`, `SCOUT_MIN_INTERVAL_MS`). Keep the
  tracked-wallet set small (Option B's smart-money poll cost scales with it).
- **Tuning.** Preset thresholds in `lib/screener/presets.ts` (`SCREENER`) and the
  safety thresholds in `lib/doctrine.ts` (`SAFETY_THRESHOLDS`) are starting points.
  Tune them from the **scoreboard**, never by guessing.
- **Webhooks (future).** Smart-money tracking polls today. For many wallets,
  migrate to **Helius webhooks** (push) to cut credit cost — feed them into the same
  `screenCandidate(..., { only: 'E' })` path.
- **Re-verify the data layer.** External API shapes drift; everything is
  Zod-validated and degrades, but confirm the live shapes (Helius getAsset /
  getTokenAccounts / enhanced tx, PumpPortal event keys) after deploy.
- **Do not** run destructive DB commands. Schema changes go through additive
  `db:push` / reviewed `db:generate` only.
