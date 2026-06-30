import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { tickDexPoll } from "@/lib/screener/loops";
import { tickHolderVelocity } from "@/lib/screener/velocity-job";
import { tickSmartMoney } from "@/lib/screener/smartmoney-job";
import { tickOutcomes } from "@/lib/scoreboard/outcome-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron per-tick entrypoints — the "no 24/7 host" deployment option. Each
 * background loop is an importable single-tick function; this route invokes one
 * per request. The live migration socket (subscribeMigration / subscribeNewToken)
 * is NOT covered here — that one strictly needs the long-lived worker.
 *
 * Auth: if CRON_SECRET is set, requests must carry `Authorization: Bearer <it>`
 * (Vercel Cron sends this automatically). Without CRON_SECRET the route is open
 * (fine for local/dev; set the secret in production).
 *
 * §0: these only screen/vet/log. They never trade.
 */
const JOBS: Record<string, () => Promise<number>> = {
  dexpoll: () => tickDexPoll(20),
  velocity: () => tickHolderVelocity(30),
  smartmoney: () => tickSmartMoney(),
  outcomes: () => tickOutcomes(100),
};

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return true;
  const header = req.headers.get("authorization");
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) {
    return NextResponse.json({ error: `unknown job '${job}'`, jobs: Object.keys(JOBS) }, { status: 404 });
  }
  const count = await fn();
  return NextResponse.json({ job, processed: count });
}
