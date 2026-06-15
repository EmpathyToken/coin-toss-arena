import { NextResponse } from "next/server";
import { calculatePayouts, sendToken } from "@/lib/escrow";

export async function POST(req: Request) {
  try {
    const secret = req.headers.get("x-escrow-secret");

    if (!process.env.ESCROW_ADMIN_SECRET || secret !== process.env.ESCROW_ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const winnerWallet = String(body.winnerWallet || "");
    const grossPot = Number(body.grossPot || 0);

    if (!winnerWallet) {
      return NextResponse.json({ ok: false, error: "Missing winner wallet" }, { status: 400 });
    }

    if (!grossPot || grossPot <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid gross pot" }, { status: 400 });
    }

    const payouts = calculatePayouts(grossPot);

    const winnerTx = await sendToken(winnerWallet, payouts.prize);
    const devTx = await sendToken(process.env.DEV_WALLET!, payouts.devFee);
    const jackpotTx = await sendToken(process.env.JACKPOT_WALLET!, payouts.jackpotFee);

    return NextResponse.json({
      ok: true,
      payouts,
      transactions: {
        winnerTx,
        devTx,
        jackpotTx
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Payout failed" },
      { status: 500 }
    );
  }
}
