import type { Config } from "drizzle-kit";

// Additive schema only. Never DROP / delete data (see BUILD.md autonomous rules).
// `DATABASE_URL` is read at push time; absent here on purpose during the build.
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/trench_desk",
  },
} satisfies Config;
