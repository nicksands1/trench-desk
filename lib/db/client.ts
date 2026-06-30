import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

/**
 * Database singleton. DEGRADES GRACEFULLY: when DATABASE_URL is absent, getDb()
 * returns null and every caller is responsible for handling the no-DB path so
 * the app still builds and renders. We cache on globalThis to survive Next's
 * dev/hot-reload and serverless module re-evaluation.
 */

type Db = PostgresJsDatabase<typeof schema>;

interface Holder {
  client: ReturnType<typeof postgres> | null;
  db: Db | null;
  initialized: boolean;
}

const g = globalThis as unknown as { __trenchDb?: Holder };

function holder(): Holder {
  if (!g.__trenchDb) g.__trenchDb = { client: null, db: null, initialized: false };
  return g.__trenchDb;
}

export function dbAvailable(): boolean {
  return Boolean(env.DATABASE_URL);
}

/** The Drizzle handle, or null when no DATABASE_URL is configured. */
export function getDb(): Db | null {
  const h = holder();
  if (h.initialized) return h.db;
  h.initialized = true;
  if (!env.DATABASE_URL) {
    h.db = null;
    return null;
  }
  try {
    // Modest pool; the worker and API share the same DB but not the same process.
    h.client = postgres(env.DATABASE_URL, { max: 5, prepare: false });
    h.db = drizzle(h.client, { schema });
  } catch {
    // Never throw at import/use time — degrade to no-op.
    h.client = null;
    h.db = null;
  }
  return h.db;
}

export { schema };
