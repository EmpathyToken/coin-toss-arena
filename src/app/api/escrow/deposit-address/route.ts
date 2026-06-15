import { NextResponse } from "next/server";
import { getEscrowPublicKey } from "@/lib/escrow";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      escrowWallet: getEscrowPublicKey(),
      tokenMint: process.env.TOKEN_MINT || process.env.NEXT_PUBLIC_TOKEN_MINT,
      devWallet: process.env.DEV_WALLET,
      jackpotWallet: process.env.JACKPOT_WALLET
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Escrow not configured" },
      { status: 500 }
    );
  }
}
