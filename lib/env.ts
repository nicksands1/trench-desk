/**
 * Centralized config. Everything is read from process.env here so the rest of
 * the codebase never touches process.env directly. Missing values degrade — we
 * never throw at import time, and we never print a secret.
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  // Required for live data (absent => features degrade).
  HELIUS_API_KEY: str("HELIUS_API_KEY"),
  DATABASE_URL: str("DATABASE_URL"),

  // Telegram alerts (send-only).
  TELEGRAM_BOT_TOKEN: str("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_CHAT_ID: str("TELEGRAM_CHAT_ID"),

  // Scout throttle.
  SCOUT_CONCURRENCY: int("SCOUT_CONCURRENCY", 3),
  SCOUT_MIN_INTERVAL_MS: int("SCOUT_MIN_INTERVAL_MS", 1500),
  SCOUT_DEDUPE_SEC: int("SCOUT_DEDUPE_SEC", 1800),

  // Screener.
  SCREENER_PRESETS: (str("SCREENER_PRESETS") ?? "A,B,C,D,E,F")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  // Holder velocity (module 6).
  HV_POLL_INTERVAL_SEC: int("HV_POLL_INTERVAL_SEC", 300),

  // Smart money (module 7).
  SMART_MONEY_MIN_WALLETS: int("SMART_MONEY_MIN_WALLETS", 2),
  SMART_MONEY_WINDOW_MIN: int("SMART_MONEY_WINDOW_MIN", 45),

  // Scoreboard outcome tracker (module 8).
  OUTCOME_POLL_INTERVAL_SEC: int("OUTCOME_POLL_INTERVAL_SEC", 600),
  OUTCOME_MAX_WINDOW_HRS: int("OUTCOME_MAX_WINDOW_HRS", 72),
  RUG_LIQUIDITY_FLOOR_USD: int("RUG_LIQUIDITY_FLOOR_USD", 1000),

  // Paid / optional — never required.
  BIRDEYE_API_KEY: str("BIRDEYE_API_KEY"),
  RUGCHECK_JWT: str("RUGCHECK_JWT"),

  // Optional: shared secret for the Vercel Cron per-tick endpoints.
  CRON_SECRET: str("CRON_SECRET"),
} as const;

export function heliusRpcUrl(): string | undefined {
  if (!env.HELIUS_API_KEY) return undefined;
  return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
}

export function heliusEnhancedUrl(address: string): string | undefined {
  if (!env.HELIUS_API_KEY) return undefined;
  return `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?api-key=${env.HELIUS_API_KEY}`;
}

/** True when a given preset letter is enabled via SCREENER_PRESETS. */
export function presetEnabled(letter: string): boolean {
  return env.SCREENER_PRESETS.includes(letter.toUpperCase());
}
