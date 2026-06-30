import { Suspense } from "react";
import { GateClient } from "./GateClient";

export const dynamic = "force-dynamic";

export default function GatePage() {
  return (
    <main className="stack">
      <Suspense fallback={<div className="panel dim">Loading gate…</div>}>
        <GateClient />
      </Suspense>
    </main>
  );
}
