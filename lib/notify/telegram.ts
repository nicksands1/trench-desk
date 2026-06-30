import { env } from "@/lib/env";
import type { SafetyReport } from "@/lib/types";
import { fetchJsonRaw } from "@/lib/sources/http";

/**
 * Telegram alerts — SEND-ONLY. No bot command handling, no inline buttons that
 * could trigger anything. No-op when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are
 * absent. This NEVER executes a trade — it only notifies a human.
 */

export function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/** Send a plain message. Returns true if dispatched (best-effort). */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetchJsonRaw(url, {
    method: "POST",
    body: {
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    timeoutMs: 8000,
  });
  return res !== null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Deep link to the token in Axiom (you execute there). Base is overridable. */
function axiomUrl(ca: string): string {
  const base = (env.AXIOM_BASE_URL ?? "https://axiom.trade/meme").replace(/\/$/, "");
  return `${base}/${ca}`;
}

/** Format + send an alert for a surfaced candidate. */
export async function alertCandidate(
  report: SafetyReport,
  meta: { preset?: string; source: string },
): Promise<boolean> {
  const sym = report.symbol ? `$${esc(report.symbol)}` : "(unknown)";
  const gateUrl = env.PUBLIC_APP_URL?.replace(/\/$/, "");
  const lines = [
    `🔭 <b>${report.verdict}</b> — ${sym}`,
    `<code>${esc(report.ca)}</code>`,
    meta.preset ? `Preset: <b>${esc(meta.preset)}</b> · ${esc(meta.source)}` : `Source: ${esc(meta.source)}`,
    report.liquidityUsd !== undefined ? `Liq: $${Math.round(report.liquidityUsd).toLocaleString()}` : "",
    report.mcapUsd !== undefined ? `MC: $${Math.round(report.mcapUsd).toLocaleString()}` : "",
    report.reasons.length ? `\n${report.reasons.slice(0, 4).map((r) => `• ${esc(r)}`).join("\n")}` : "",
    // One-tap trade link (you execute there — this bot never does).
    `\n🟢 <a href="${axiomUrl(report.ca)}">Open in Axiom</a>`,
    `🔎 <a href="https://dexscreener.com/solana/${esc(report.ca)}">DexScreener</a> · <a href="https://rugcheck.xyz/tokens/${esc(report.ca)}">rugcheck</a>`,
    gateUrl ? `🎯 <a href="${gateUrl}/gate?ca=${esc(report.ca)}">Run the Gate</a>` : "",
    `\n⚠️ Vet + decide + execute yourself. This bot does not trade.`,
  ].filter(Boolean);
  return sendTelegram(lines.join("\n"));
}
