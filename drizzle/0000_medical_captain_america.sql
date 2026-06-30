CREATE TABLE IF NOT EXISTS "candidates" (
	"ca" text PRIMARY KEY NOT NULL,
	"symbol" text,
	"verdict" text NOT NULL,
	"status" text DEFAULT 'watching' NOT NULL,
	"source" text NOT NULL,
	"preset" text,
	"liquidity_usd" double precision,
	"mcap_usd" double precision,
	"early_buyer_capture" double precision,
	"top10_ex_curve" double precision,
	"age_minutes" double precision,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"surfaced" boolean DEFAULT false NOT NULL,
	"first_seen" bigint NOT NULL,
	"last_seen" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holder_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"ca" text NOT NULL,
	"ts" bigint NOT NULL,
	"holders" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "safety_reports" (
	"ca" text PRIMARY KEY NOT NULL,
	"verdict" text NOT NULL,
	"report" jsonb NOT NULL,
	"computed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"ca" text NOT NULL,
	"symbol" text,
	"preset" text NOT NULL,
	"entry_price" double precision,
	"entry_mcap" double precision,
	"liquidity" double precision,
	"holders" integer,
	"verdict" text NOT NULL,
	"source" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"max_multiple" double precision,
	"resolved_ts" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracked_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"added_ts" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"ca" text NOT NULL,
	"ticker" text DEFAULT '' NOT NULL,
	"preset" text,
	"opened_at" bigint NOT NULL,
	"entry" double precision DEFAULT 0 NOT NULL,
	"size_usd" double precision DEFAULT 0 NOT NULL,
	"size_pct" double precision DEFAULT 0 NOT NULL,
	"phase" integer DEFAULT 0 NOT NULL,
	"thesis" text DEFAULT '' NOT NULL,
	"invalidation" text DEFAULT '' NOT NULL,
	"exit_ladder" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"exits" jsonb,
	"result_usd" double precision,
	"result_pct" double precision,
	"holding_secs" integer,
	"followed_ladder" boolean,
	"emotional_state" text,
	"rule_breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"stopped_out" boolean DEFAULT false NOT NULL,
	"closed_at" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trading_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"bankroll" double precision DEFAULT 0 NOT NULL,
	"day" text DEFAULT '' NOT NULL,
	"day_start_bankroll" double precision DEFAULT 0 NOT NULL,
	"trades_today" integer DEFAULT 0 NOT NULL,
	"pnl_today_usd" double precision DEFAULT 0 NOT NULL,
	"pnl_today_pct" double precision DEFAULT 0 NOT NULL,
	"consecutive_losses" integer DEFAULT 0 NOT NULL,
	"cooldown_until" bigint DEFAULT 0 NOT NULL,
	"daily_stop_hit" boolean DEFAULT false NOT NULL,
	"last_exited_tickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_verdict_idx" ON "candidates" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_surfaced_idx" ON "candidates" USING btree ("surfaced");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holder_snapshots_ca_ts_idx" ON "holder_snapshots" USING btree ("ca","ts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signals_ca_preset_idx" ON "signals" USING btree ("ca","preset");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_outcome_idx" ON "signals" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tracked_wallets_address_idx" ON "tracked_wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_status_idx" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_ca_idx" ON "trades" USING btree ("ca");