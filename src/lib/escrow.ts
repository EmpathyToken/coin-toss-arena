import {
  Connection,
  Keypair,
  PublicKey
} from "@solana/web3.js";

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  transferChecked
} from "@solana/spl-token";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
}

export function getEscrowKeypair() {
  const raw = required("ESCROW_PRIVATE_KEY");

  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    throw new Error("ESCROW_PRIVATE_KEY must be a Solana secret key JSON array.");
  }
}

export function getEscrowPublicKey() {
  return getEscrowKeypair().publicKey.toBase58();
}

export function getTokenMint() {
  return new PublicKey(process.env.TOKEN_MINT || process.env.NEXT_PUBLIC_TOKEN_MINT || "");
}

export async function ensureAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  const ata = await getAssociatedTokenAddress(mint, owner);

  try {
    await getAccount(connection, ata);
  } catch {
    const tx = new (await import("@solana/web3.js")).Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint
      )
    );

    await connection.sendTransaction(tx, [payer], {
      skipPreflight: false,
      preflightCommitment: "confirmed"
    });
  }

  return ata;
}

export async function sendToken(
  toWallet: string,
  amountUi: number
) {
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    throw new Error("Invalid payout amount");
  }

  const connection = getConnection();
  const escrow = getEscrowKeypair();
  const mint = getTokenMint();
  const receiver = new PublicKey(toWallet);

  const mintInfo = await getMint(connection, mint);
  const decimals = mintInfo.decimals;

  const sourceAta = await getAssociatedTokenAddress(mint, escrow.publicKey);
  const destAta = await ensureAta(connection, escrow, mint, receiver);

  const rawAmount = BigInt(Math.floor(amountUi * 10 ** decimals));

  const sig = await transferChecked(
    connection,
    escrow,
    sourceAta,
    mint,
    destAta,
    escrow,
    rawAmount,
    decimals
  );

  return sig;
}

export function calculatePayouts(grossPot: number) {
  const devFee = Math.floor(grossPot * 0.02);
  const jackpotFee = Math.floor(grossPot * 0.05);
  const prize = grossPot - devFee - jackpotFee;

  return {
    grossPot,
    prize,
    devFee,
    jackpotFee,
    totalFee: devFee + jackpotFee
  };
}
