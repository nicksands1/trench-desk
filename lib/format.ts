/** Display formatting helpers (UI only). */

export function usd(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(dp)}`;
}

export function usdExact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function pct(frac: number | null | undefined, dp = 1): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return "—";
  return `${(frac * 100).toFixed(dp)}%`;
}

export function signedPct(frac: number | null | undefined, dp = 1): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return "—";
  const s = (frac * 100).toFixed(dp);
  return frac > 0 ? `+${s}%` : `${s}%`;
}

export function signClass(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0 || !Number.isFinite(n)) return "";
  return n > 0 ? "pos" : "neg";
}

export function shortCa(ca: string): string {
  if (ca.length <= 12) return ca;
  return `${ca.slice(0, 4)}…${ca.slice(-4)}`;
}

export function ageLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

export function relTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  const diff = Date.now() - epochMs;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
