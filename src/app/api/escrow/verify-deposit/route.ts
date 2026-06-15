import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const signature = String(body.signature || "");
    const wallet = String(body.wallet || "");
    const roomId = String(body.roomId || "");
    const amount = Number(body.amount || 0);

    if (!signature || !wallet || !roomId || !amount) {
      return NextResponse.json({ ok: false, error: "Missing deposit data" }, { status: 400 });
    }

    const connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
      "confirmed"
    );

    const tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      return NextResponse.json({ ok: false, error: "Transaction not found or not confirmed yet" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      signature,
      wallet,
      roomId,
      amount,
      verified: true
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Deposit verification failed" },
      { status: 500 }
    );
  }
}
