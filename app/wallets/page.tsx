"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrackedWalletRow } from "@/lib/db/schema";
import { shortCa, relTime } from "@/lib/format";

export default function WalletsPage() {
  const [wallets, setWallets] = useState<TrackedWalletRow[]>([]);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/wallets").then((r) => r.json()).catch(() => null);
    if (d?.wallets) setWallets(d.wallets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setErr(null);
    if (address.trim().length < 32) {
      setErr("Enter a valid wallet address.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/wallets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.trim(), label: label.trim() || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setAddress("");
      setLabel("");
      void load();
    } else {
      const d = await res.json().catch(() => null);
      setErr(d?.error ?? "add failed");
    }
  }

  async function remove(addr: string) {
    await fetch("/api/wallets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr }),
    });
    void load();
  }

  return (
    <main className="stack">
      <section className="panel">
        <h2>Smart-Money Wallets</h2>
        <p className="dim" style={{ fontSize: 12, marginTop: 0 }}>
          When ≥ 2 of these wallets buy the same token within ~45 min, preset E fires → safety → watchlist + alert.
          Tracking only — the desk flags the cluster; it never copies the trade.
        </p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 2 }}>
            Wallet address
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Solana address" spellCheck={false} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. cupsey" />
          </label>
          <button className="primary" disabled={busy} onClick={add}>{busy ? "adding…" : "Track"}</button>
        </div>
        {err && <div className="banner red" style={{ marginTop: 8 }}>{err}</div>}
      </section>

      <section className="panel">
        <h2>Tracked ({wallets.length})</h2>
        {wallets.length === 0 ? (
          <div className="muted-box">No tracked wallets yet. Add a few known sharp wallets to enable preset E.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Label</th>
                <th>Address</th>
                <th>State</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.address}>
                  <td>{w.label || <span className="dim">—</span>}</td>
                  <td className="mono">{shortCa(w.address)}</td>
                  <td>{w.active ? <span className="pos">active</span> : <span className="dim">paused</span>}</td>
                  <td className="dim">{relTime(w.addedTs)}</td>
                  <td className="right">
                    <button className="danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => remove(w.address)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
