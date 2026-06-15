import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { sendToken } from "@/lib/escrow";
import { supabase } from "@/lib/supabase";

type Side = "HEADS" | "TAILS";

type Player = {
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
  totalWon: number;
  achievements?: string[];
  xp?: number;
  level?: number;
  gamesPlayed?: number;
  winRate?: number;
  leaderboardScore?: number;
  lastSeen?: string;
  lastPlayedAt?: string;
  jackpotEligible?: boolean;
};

type Room = {
  id: string;
  wager: number;
  status: "waiting" | "picking" | "ready" | "finished";
  creator: string;
  joiner?: string;
  creatorChoice?: Side;
  joinerChoice?: Side;
  creatorAssigned?: Side;
  joinerAssigned?: Side;
  creatorDepositSig?: string;
  joinerDepositSig?: string;
  creatorDeposited?: boolean;
  joinerDeposited?: boolean;
  escrowReady?: boolean;
  winner?: string;
  result?: Side;
  demo?: boolean;
  createdAt?: string;
  expiresAt?: string;
  creatorRefunded?: boolean;
  joinerRefunded?: boolean;
  payoutStatus?: string;
};

type Economy = {
  jackpotPool: number;
  devFees: number;
  lastJackpotAt?: string;
  nextJackpotAt?: string;
};

type DB = {
  players: Player[];
  rooms: Room[];
  messages: any[];
  matches: any[];
  economy?: Economy;
};

const dbPath = path.join(process.cwd(), "data", "db.json");

function readDB(): DB {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ players: [], rooms: [], messages: [], matches: [] }, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  db.economy ||= {
    jackpotPool: 0,
    devFees: 0,
    nextJackpotAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
  return db;
}

function writeDB(db: DB) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function assignSides(room: Room) {
  if (!room.creatorChoice || !room.joinerChoice) return;

  if (room.creatorChoice !== room.joinerChoice) {
    room.creatorAssigned = room.creatorChoice;
    room.joinerAssigned = room.joinerChoice;
  } else {
    const creatorGetsHeads = Math.random() < 0.5;
    room.creatorAssigned = creatorGetsHeads ? "HEADS" : "TAILS";
    room.joinerAssigned = creatorGetsHeads ? "TAILS" : "HEADS";
  }

  room.status = "ready";
}

function applyXp(player: Player, amount: number) {
  player.xp = Math.max(0, Number(player.xp || 0) + amount);
  player.level = Math.max(1, Math.floor(Number(player.xp || 0) / 250) + 1);
  return player;
}

function updatePlayerMeta(player: Player) {
  const wins = player.wins || 0;
  const losses = player.losses || 0;
  const games = wins + losses;
  const xp = player.xp || 0;
  const level = player.level || 1;
  const currentStreak = player.currentStreak || 0;
  const bestStreak = player.bestStreak || 0;

  player.gamesPlayed = games;
  if (!player.lastSeen && player.lastPlayedAt) player.lastSeen = player.lastPlayedAt;
  player.winRate = games ? Math.round((wins / games) * 100) : 0;
  player.leaderboardScore =
    wins * 100 +
    currentStreak * 50 +
    bestStreak * 25 +
    xp;

  const last = player.lastPlayedAt ? new Date(player.lastPlayedAt).getTime() : 0;
  const playedWithin24h = last > Date.now() - 24 * 60 * 60 * 1000;

  player.jackpotEligible =
    wins >= 5 &&
    level >= 3 &&
    playedWithin24h;

  return player;
}

function rankPlayers(players: Player[]) {
  return [...players]
    .map((p) => updatePlayerMeta(p))
    .sort((a, b) => (b.leaderboardScore || 0) - (a.leaderboardScore || 0));
}

function getPlayer(db: DB, name: string) {
  let player = db.players.find((p) => p.name === name);

  if (!player && name && name !== "Guest") {
    player = {
      playerId: `auto-${name}`,
      name,
      wins: 0,
      losses: 0,
      currentStreak: 0,
      bestStreak: 0,
      totalWon: 0,
      achievements: [],
      xp: 0,
      level: 1,
      gamesPlayed: 0,
      winRate: 0,
      leaderboardScore: 0,
      jackpotEligible: false,
      lastPlayedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    db.players.push(player);
  }

  return player;
}

async function syncPlayersToSupabase(db: DB) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;

  for (const player of db.players) {
    const p = updatePlayerMeta(player);

    const payload = {
      player_id: p.playerId,
      name: p.name,
      wins: Number(p.wins || 0),
      losses: Number(p.losses || 0),
      current_streak: Number(p.currentStreak || 0),
      best_streak: Number(p.bestStreak || 0),
      total_won: Number(p.totalWon || 0),
      xp: Number(p.xp || 0),
      level: Number(p.level || 1),
      achievements: p.achievements || [],
      games_played: Number(p.gamesPlayed || 0),
      win_rate: Number(p.winRate || 0),
      leaderboard_score: Number(p.leaderboardScore || 0),
      last_played_at: p.lastPlayedAt || p.lastSeen || null,
      jackpot_eligible: Boolean(p.jackpotEligible)
    };

    const { error } = await supabase
      .from("players")
      .upsert(payload, { onConflict: "player_id" });

    if (error) {
      console.error("SUPABASE PLAYER UPSERT ERROR", error);
      console.error("SUPABASE PLAYER PAYLOAD KEYS", Object.keys(payload));
    }
  }
}

async function loadSupabasePlayers() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return [];

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("total_won", { ascending: false });

  if (error || !data) return [];

  return data.map((p:any) => ({
    playerId: p.player_id,
    name: p.name,
    wins: p.wins || 0,
    losses: p.losses || 0,
    currentStreak: p.current_streak || 0,
    bestStreak: p.best_streak || 0,
    totalWon: Number(p.total_won || 0),
    achievements: p.achievements || [],
    xp: Number(p.xp || 0),
    level: Number(p.level || 1),
    gamesPlayed: p.games_played || 0,
    winRate: p.win_rate || 0,
    leaderboardScore: p.leaderboard_score || 0,
    lastPlayedAt: p.last_played_at || undefined,
    lastSeen: p.last_played_at || undefined,
    jackpotEligible: Boolean(p.jackpot_eligible)
  }));
}


function jsonState(db: DB) {
  db.players = db.players.map((p) => updatePlayerMeta(p));

  const leaderboard = rankPlayers(db.players).slice(0, 20);
  const jackpotContenders = leaderboard.filter((p) => p.jackpotEligible).slice(0, 2);

  return NextResponse.json({
    ...db,
    leaderboard,
    jackpot: {
      pool: db.economy?.jackpotPool || 0,
      devFees: db.economy?.devFees || 0,
      nextJackpotAt: db.economy?.nextJackpotAt,
      contenders: jackpotContenders,
      devWallet: process.env.NEXT_PUBLIC_DEV_WALLET || "",
      jackpotWallet: process.env.NEXT_PUBLIC_JACKPOT_WALLET || "",
      feeModel: {
        winnerPercent: 93,
        devPercent: 2,
        jackpotPercent: 5
      }
    }
  });
}

export async function GET() {
  const db = readDB();

  const supabasePlayers = await loadSupabasePlayers();
  if (supabasePlayers.length > 0) {
    db.players = supabasePlayers;
  } else {
    await syncPlayersToSupabase(db);
  }

  return jsonState(db);
}

export async function POST(req: Request) {
  const db = readDB();
  const body = await req.json();

  if (body.type === "nickname") {
    const name = String(body.name || "").trim();
    const playerId = String(body.playerId || "").trim();

    if (!playerId) return NextResponse.json({ ok: false, error: "Missing player ID" });
    if (name.length < 3) return NextResponse.json({ ok: false, error: "Nickname must be 3+ characters" });

    const taken = db.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.playerId !== playerId
    );

    if (taken) return NextResponse.json({ ok: false, error: "Nickname already taken" });

    let player = db.players.find((p) => p.playerId === playerId);

    if (player) {
      player.name = name;
      player.lastSeen = new Date().toISOString();
    } else {
      player = {
        playerId,
        name,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        totalWon: 0,
        achievements: [],
        xp: 0,
        level: 1,
        gamesPlayed: 0,
        winRate: 0,
        leaderboardScore: 0,
        jackpotEligible: false,
        lastSeen: new Date().toISOString()
      };
      db.players.push(player);
    }

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  if (body.type === "room") {
    const creator = String(body.creator || "Guest");
    const wager = Math.max(1, Number(body.wager || 0));

    const now = Date.now();

    db.rooms.unshift({
      id: `room-${now}`,
      wager,
      status: "waiting",
      creator,
      demo: Boolean(body.demo),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
      creatorDeposited: false,
      joinerDeposited: false,
      creatorRefunded: false,
      joinerRefunded: false,
      escrowReady: false
    });

    const creatorProfile = getPlayer(db, creator);
    if (creatorProfile) creatorProfile.lastSeen = new Date().toISOString();

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  if (body.type === "join") {
    const room = db.rooms.find((r) => r.id === body.roomId);

    if (!room) return NextResponse.json({ ok: false, error: "Room not found" });
    if (room.status !== "waiting") return NextResponse.json({ ok: false, error: "Room already started" });
    if (room.joiner) return NextResponse.json({ ok: false, error: "Room already full" });
    if (room.creator === body.joiner) return NextResponse.json({ ok: false, error: "You cannot join your own room" });
    if (room.expiresAt && Date.now() > new Date(room.expiresAt).getTime()) {
      return NextResponse.json({ ok: false, error: "Room expired" });
    }

    room.joiner = String(body.joiner || "Joiner");
    room.status = "picking";

    const joinerProfile = getPlayer(db, room.joiner);
    if (joinerProfile) joinerProfile.lastSeen = new Date().toISOString();

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  if (body.type === "choose") {
    const room = db.rooms.find((r) => r.id === body.roomId);
    const choice: Side = body.choice === "TAILS" ? "TAILS" : "HEADS";

    if (!room) return NextResponse.json({ ok: false, error: "Room not found" });
    if (room.status !== "picking") return NextResponse.json({ ok: false, error: "Room is not accepting picks" });

    if (body.player === "creator") {
      if (room.creatorChoice) return NextResponse.json({ ok: false, error: "Creator already picked" });
      room.creatorChoice = choice;
    }

    if (body.player === "joiner") {
      if (room.joinerChoice) return NextResponse.json({ ok: false, error: "Joiner already picked" });
      room.joinerChoice = choice;
    }

    assignSides(room);

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }


  if (body.type === "deposit-confirm") {
    const room = db.rooms.find((r) => r.id === body.roomId);
    if (!room) return NextResponse.json({ ok: false, error: "Room not found" });

    const wallet = String(body.wallet || "");
    const signature = String(body.signature || "");

    if (!signature) return NextResponse.json({ ok: false, error: "Missing transaction signature" });

    if (wallet === room.creator) {
      room.creatorDepositSig = signature;
      room.creatorDeposited = true;
    } else if (wallet === room.joiner) {
      room.joinerDepositSig = signature;
      room.joinerDeposited = true;
    } else {
      return NextResponse.json({ ok: false, error: "Wallet is not in this room" });
    }

    room.escrowReady = Boolean(room.creatorDeposited && room.joinerDeposited);

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }


  if (body.type === "refund-room") {
    const room = db.rooms.find((r) => r.id === body.roomId);
    const wallet = String(body.wallet || "");

    if (!room) return NextResponse.json({ ok: false, error: "Room not found" });
    if (!wallet) return NextResponse.json({ ok: false, error: "Missing wallet" });
    if (room.status === "finished") return NextResponse.json({ ok: false, error: "Finished rooms cannot be refunded" });

    const expired = room.expiresAt ? Date.now() > new Date(room.expiresAt).getTime() : false;
    if (!expired) return NextResponse.json({ ok: false, error: "Room has not expired yet" });

    let canRefund = false;
    let alreadyRefunded = false;

    if (wallet === room.creator && room.creatorDeposited) {
      canRefund = true;
      alreadyRefunded = Boolean(room.creatorRefunded);
    }

    if (wallet === room.joiner && room.joinerDeposited) {
      canRefund = true;
      alreadyRefunded = Boolean(room.joinerRefunded);
    }

    if (!canRefund) return NextResponse.json({ ok: false, error: "No refundable deposit found for this wallet" });
    if (alreadyRefunded) return NextResponse.json({ ok: false, error: "Already refunded" });

    let refundTx = "";
    let refundStatus = "pending";

    try {
      const tokenMint = process.env.TOKEN_MINT || process.env.NEXT_PUBLIC_TOKEN_MINT || "";
      const escrowReadyForRefund =
        tokenMint &&
        !tokenMint.includes("PASTE_") &&
        process.env.ESCROW_PRIVATE_KEY &&
        !process.env.ESCROW_PRIVATE_KEY.includes("PASTE_");

      if (escrowReadyForRefund) {
        refundTx = await sendToken(wallet, Number(room.wager || 0));
        refundStatus = "refunded";
      } else {
        refundStatus = "not_configured";
      }
    } catch (e) {
      console.error("REFUND FAILED", e);
      refundStatus = "failed";
    }

    if (wallet === room.creator) room.creatorRefunded = refundStatus === "refunded" || refundStatus === "not_configured";
    if (wallet === room.joiner) room.joinerRefunded = refundStatus === "refunded" || refundStatus === "not_configured";

    room.status = "finished";
    room.payoutStatus = refundStatus;

    db.matches.unshift({
      id: `refund-${Date.now()}`,
      winner: wallet,
      loser: "ROOM EXPIRED",
      prize: Number(room.wager || 0),
      grossPot: Number(room.wager || 0),
      devFee: 0,
      jackpotFee: 0,
      totalFee: 0,
      result: "REFUND" as any,
      demo: Boolean(room.demo),
      createdAt: new Date().toISOString(),
      payoutStatus: refundStatus,
      winnerTx: refundTx,
      devTx: "",
      jackpotTx: ""
    });

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  if (body.type === "flip") {
    const room = db.rooms.find((r) => r.id === body.roomId);

    if (!room) return NextResponse.json({ ok: false, error: "Room not found" });
    if (room.status === "finished") return jsonState(db);
    if (room.status !== "ready") return NextResponse.json({ ok: false, error: "Room is not ready" });
    if (room.expiresAt && Date.now() > new Date(room.expiresAt).getTime()) {
      return NextResponse.json({ ok: false, error: "Room expired. Refund available if you deposited." });
    }
    if (!room.escrowReady) return NextResponse.json({ ok: false, error: "Both players must deposit to escrow before flipping" });
    if (!room.escrowReady) return NextResponse.json({ ok: false, error: "Both players must deposit to escrow before flipping" });

    const result: Side = crypto.randomInt(0, 2) === 0 ? "HEADS" : "TAILS";
    room.result = result;
    room.winner = room.creatorAssigned === result ? room.creator : room.joiner || "Joiner";
    room.status = "finished";

    const loser = room.winner === room.creator ? room.joiner : room.creator;
    const grossPot = room.wager * 2;
    const devFee = Math.floor(grossPot * 0.02);
    const jackpotFee = Math.floor(grossPot * 0.05);
    const prize = grossPot - devFee - jackpotFee;

    db.economy ||= {
      jackpotPool: 0,
      devFees: 0,
      nextJackpotAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    db.economy.jackpotPool = Number(db.economy.jackpotPool || 0) + jackpotFee;
    db.economy.devFees = Number(db.economy.devFees || 0) + devFee;
    db.economy.nextJackpotAt ||= new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const winnerProfile = getPlayer(db, room.winner);
    if (winnerProfile) {
      winnerProfile.wins += 1;
      winnerProfile.currentStreak += 1;
      winnerProfile.bestStreak = Math.max(winnerProfile.bestStreak, winnerProfile.currentStreak);
      winnerProfile.totalWon += prize;
      winnerProfile.achievements ||= [];

      if (winnerProfile.wins >= 1 && !winnerProfile.achievements.includes("FIRST WIN")) {
        winnerProfile.achievements.push("FIRST WIN");
      }

      if (winnerProfile.wins >= 5 && !winnerProfile.achievements.includes("5 WINS")) {
        winnerProfile.achievements.push("5 WINS");
      }

      if (winnerProfile.currentStreak >= 3 && !winnerProfile.achievements.includes("HOT STREAK")) {
        winnerProfile.achievements.push("HOT STREAK");
      }

      applyXp(winnerProfile, 100);
      winnerProfile.lastPlayedAt = new Date().toISOString();
      winnerProfile.lastSeen = new Date().toISOString();
    }

    if (loser) {
      const loserProfile = getPlayer(db, loser);
      if (loserProfile) {
        loserProfile.losses += 1;
        loserProfile.currentStreak = 0;
        applyXp(loserProfile, 25);
        loserProfile.lastPlayedAt = new Date().toISOString();
        loserProfile.lastSeen = new Date().toISOString();
      }
    }

    let winnerTx = "";
    let devTx = "";
    let jackpotTx = "";
    let payoutStatus = "pending";

    const winnerWallet =
      room.winner === room.creator ? room.creator : room.joiner || "";

    try {
      const tokenMint =
        process.env.TOKEN_MINT ||
        process.env.NEXT_PUBLIC_TOKEN_MINT ||
        "";

      const escrowReadyForPayout =
        tokenMint &&
        !tokenMint.includes("PASTE_") &&
        process.env.ESCROW_PRIVATE_KEY &&
        !process.env.ESCROW_PRIVATE_KEY.includes("PASTE_");

      if (escrowReadyForPayout && winnerWallet) {
        winnerTx = await sendToken(winnerWallet, prize);
        devTx = await sendToken(process.env.DEV_WALLET || process.env.NEXT_PUBLIC_DEV_WALLET || "", devFee);
        jackpotTx = await sendToken(process.env.JACKPOT_WALLET || process.env.NEXT_PUBLIC_JACKPOT_WALLET || "", jackpotFee);
        payoutStatus = "paid";
      } else {
        payoutStatus = "not_configured";
      }
    } catch (e: any) {
      console.error("AUTO PAYOUT FAILED", e);
      payoutStatus = "failed";
    }

    db.matches.unshift({
      id: `match-${Date.now()}`,
      winner: room.winner,
      loser,
      prize,
      grossPot,
      devFee,
      jackpotFee,
      totalFee: devFee + jackpotFee,
      result,
      demo: Boolean(room.demo),
      createdAt: new Date().toISOString(),
      payoutStatus,
      winnerTx,
      devTx,
      jackpotTx
    });

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  if (body.type === "chat") {
    db.messages.push({
      id: Date.now(),
      wallet: body.wallet || "Guest",
      message: body.message || "",
      createdAt: new Date().toISOString()
    });

    writeDB(db);
    await syncPlayersToSupabase(db);
    return jsonState(db);
  }

  return jsonState(db);
}
