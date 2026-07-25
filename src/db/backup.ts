import { z } from "zod";
import { db } from "./database";
import { downloadBlob } from "../lib/utils";

const backupSchema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.string(),
  data: z.object({
    players: z.array(z.record(z.string(), z.unknown())),
    playerAliases: z.array(z.record(z.string(), z.unknown())),
    games: z.array(z.record(z.string(), z.unknown())),
    rounds: z.array(z.record(z.string(), z.unknown())),
    roundLosses: z.array(z.record(z.string(), z.unknown())),
    gameBalances: z.array(z.record(z.string(), z.unknown())),
    settlements: z.array(z.record(z.string(), z.unknown())),
    imageFingerprints: z.array(z.record(z.string(), z.unknown())),
    settings: z.array(z.record(z.string(), z.unknown())),
  }),
});

const tables = [
  "players",
  "playerAliases",
  "games",
  "rounds",
  "roundLosses",
  "gameBalances",
  "settlements",
  "imageFingerprints",
  "settings",
] as const;

export async function createBackup() {
  const data = Object.fromEntries(await Promise.all(tables.map(async (name) => [name, await db.table(name).toArray()])));
  return { schemaVersion: 3 as const, exportedAt: new Date().toISOString(), data };
}

export async function downloadBackup() {
  const backup = await createBackup();
  downloadBlob(
    new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    `go-stop-backup-${backup.exportedAt.slice(0, 10)}.json`,
  );
}

export async function importBackup(file: File, mode: "merge" | "replace") {
  const parsed = backupSchema.parse(JSON.parse(await file.text()));
  const playerIds = new Set(parsed.data.players.map((item) => item.id));
  const gameIds = new Set(parsed.data.games.map((item) => item.id));
  const roundIds = new Set(parsed.data.rounds.map((item) => item.id));
  if (parsed.data.rounds.some((item) => !gameIds.has(item.gameId) || !playerIds.has(item.winnerId))) {
    throw new Error("판 기록의 참조가 깨져 있습니다.");
  }
  if (parsed.data.roundLosses.some((item) => !roundIds.has(item.roundId) || !playerIds.has(item.playerId))) {
    throw new Error("패자 기록의 참조가 깨져 있습니다.");
  }
  for (const gameId of gameIds) {
    const sum = parsed.data.gameBalances
      .filter((item) => item.gameId === gameId)
      .reduce((total, item) => total + Number(item.balance), 0);
    if (sum !== 0) throw new Error("손익 합계가 0원이 아닌 게임이 있습니다.");
  }
  await db.transaction("rw", db.tables, async () => {
    if (mode === "replace") await Promise.all(db.tables.map((table) => table.clear()));
    for (const name of tables) await db.table(name).bulkPut(parsed.data[name]);
  });
}

export async function downloadCsv() {
  const games = new Map((await db.games.toArray()).map((game) => [game.id, game]));
  const players = new Map((await db.players.toArray()).map((player) => [player.id, player]));
  const rounds = await db.rounds.toArray();
  const balances = await db.gameBalances.toArray();
  const rows = balances.map((balance) => {
    const game = games.get(balance.gameId);
    const player = players.get(balance.playerId);
    const roundCount = rounds.filter((round) => round.gameId === balance.gameId && round.winnerId === balance.playerId).length;
    return [game?.playedAt ?? "", game?.title ?? "", player?.name ?? "", balance.balance, roundCount];
  });
  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [["game_date", "game_title", "player_name", "balance", "round_count"], ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), "go-stop-balances.csv");
}

export async function clearAllData() {
  await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear())));
}
