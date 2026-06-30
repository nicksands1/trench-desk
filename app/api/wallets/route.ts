import { NextResponse } from "next/server";
import { z } from "zod";
import { listWallets, addWallet, removeWallet } from "@/lib/db/wallets";

export const dynamic = "force-dynamic";

export async function GET() {
  const wallets = await listWallets();
  return NextResponse.json({ wallets, count: wallets.length });
}

const AddBody = z
  .object({ address: z.string().min(32).max(44), label: z.string().max(64).optional() })
  .strict();

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = AddBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const wallet = await addWallet(parsed.data.address, parsed.data.label ?? "");
  return NextResponse.json({ wallet });
}

const DeleteBody = z.object({ address: z.string().min(32).max(44) }).strict();

export async function DELETE(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = DeleteBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const removed = await removeWallet(parsed.data.address);
  return NextResponse.json({ removed });
}
