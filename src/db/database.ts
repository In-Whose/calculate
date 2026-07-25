import Dexie, { type EntityTable } from "dexie";
import type {
  DraftGame,
  Game,
  GameBalance,
  ImageFingerprint,
  Player,
  PlayerAlias,
  Round,
  RoundLoss,
  SavedGame,
  Setting,
  Settlement,
} from "../types";
import { calculateBalances, calculateTransfers, assertZeroSum } from "../lib/settlement";
import { createId, normalizeName } from "../lib/utils";
import { stableRoundKey } from "../lib/parser";

export class GoStopDatabase extends Dexie {
  players!: EntityTable<Player, "id">;
  playerAliases!: EntityTable<PlayerAlias, "id">;
  games!: EntityTable<Game, "id">;
  rounds!: EntityTable<Round, "id">;
  roundLosses!: EntityTable<RoundLoss, "id">;
  gameBalances!: EntityTable<GameBalance, "id">;
  settlements!: EntityTable<Settlement, "id">;
  imageFingerprints!: EntityTable<ImageFingerprint, "id">;
  settings!: EntityTable<Setting, "key">;

  constructor(name = "go-stop-money") {
    super(name);
    this.version(1).stores({
      players: "id,&normalizedName,createdAt",
      playerAliases: "id,playerId,&normalizedAlias",
      games: "id,playedAt,updatedAt",
      rounds: "id,gameId,winnerId,[gameId+sequence],normalizedHash,sourceImageHash",
      roundLosses: "id,roundId,playerId,[roundId+playerId]",
      gameBalances: "id,gameId,playerId,[gameId+playerId]",
      settlements: "id,gameId,fromPlayerId,toPlayerId,[gameId+isPaid]",
      imageFingerprints: "id,gameId,sha256,[gameId+sha256]",
      settings: "key",
    });
    this.version(2)
      .stores({
        players: "id,&normalizedName,createdAt,updatedAt",
        playerAliases: "id,playerId,&normalizedAlias,createdAt",
        games: "id,playedAt,updatedAt",
        rounds: "id,gameId,winnerId,[gameId+sequence],normalizedHash,sourceImageHash",
        roundLosses: "id,roundId,playerId,[roundId+playerId]",
        gameBalances: "id,gameId,playerId,[gameId+playerId]",
        settlements: "id,gameId,fromPlayerId,toPlayerId,[gameId+isPaid]",
        imageFingerprints: "id,gameId,sha256,[gameId+sha256]",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        await transaction.table("settings").put({ key: "schemaVersion", value: 2 });
      });
    this.version(3)
      .stores({
        players: "id,&normalizedName,createdAt,updatedAt",
        playerAliases: "id,playerId,&normalizedAlias,createdAt",
        games: "id,playedAt,updatedAt",
        rounds: "id,gameId,winnerId,[gameId+sequence],normalizedHash,sourceImageHash",
        roundLosses: "id,roundId,playerId,[roundId+playerId]",
        gameBalances: "id,gameId,playerId,[gameId+playerId]",
        settlements: "id,gameId,fromPlayerId,toPlayerId,[gameId+isPaid]",
        imageFingerprints: "id,gameId,sha256,[gameId+sha256]",
        settings: "key",
      })
      .upgrade(async (transaction) => {
        await transaction.table("settings").put({ key: "schemaVersion", value: 3 });
      });
  }
}

export const db = new GoStopDatabase();

async function resolvePlayer(name: string, now: string) {
  const normalized = normalizeName(name);
  const alias = await db.playerAliases.where("normalizedAlias").equals(normalized).first();
  if (alias) {
    const aliased = await db.players.get(alias.playerId);
    if (aliased) return aliased;
  }
  const existing = await db.players.where("normalizedName").equals(normalized).first();
  if (existing) return existing;
  const player: Player = { id: createId(), name: name.trim(), normalizedName: normalized, createdAt: now, updatedAt: now };
  await db.players.add(player);
  return player;
}

export async function saveDraft(draft: DraftGame) {
  const invalidDate = !/^\d{4}-\d{2}-\d{2}$/.test(draft.playedAt);
  if (invalidDate || !draft.rounds.length) throw new Error("날짜와 한 판 이상의 기록이 필요합니다.");
  const now = new Date().toISOString();
  const gameId = draft.id ?? createId();

  return db.transaction(
    "rw",
    [db.players, db.playerAliases, db.games, db.rounds, db.roundLosses, db.gameBalances, db.settlements, db.imageFingerprints],
    async () => {
      const oldSettlements = draft.id ? await db.settlements.where("gameId").equals(gameId).toArray() : [];
      const paidKeys = new Map(oldSettlements.map((item) => [`${item.fromPlayerId}:${item.toPlayerId}:${item.amount}`, item]));
      if (draft.id) {
        const oldRounds = await db.rounds.where("gameId").equals(gameId).primaryKeys();
        await db.roundLosses.where("roundId").anyOf(oldRounds).delete();
        await db.rounds.where("gameId").equals(gameId).delete();
        await db.gameBalances.where("gameId").equals(gameId).delete();
        await db.settlements.where("gameId").equals(gameId).delete();
        await db.imageFingerprints.where("gameId").equals(gameId).delete();
      }

      const existingGame = await db.games.get(gameId);
      const game: Game = {
        id: gameId,
        playedAt: draft.playedAt,
        title: draft.title.trim().slice(0, 80),
        memo: draft.memo.trim().slice(0, 500),
        createdAt: existingGame?.createdAt ?? now,
        updatedAt: now,
      };
      await db.games.put(game);

      const playerByName = new Map<string, Player>();
      for (const name of new Set(draft.rounds.flatMap((round) => [round.winnerName, ...round.losers.map((loss) => loss.name)]))) {
        playerByName.set(name, await resolvePlayer(name, now));
      }

      const namedBalances = calculateBalances(draft.rounds);
      assertZeroSum(namedBalances.values());
      const balances: GameBalance[] = [];
      for (const [name, balance] of namedBalances) {
        const player = playerByName.get(name);
        if (!player) throw new Error("참가자를 저장하지 못했습니다.");
        balances.push({ id: createId(), gameId, playerId: player.id, balance });
      }

      for (const [sequence, draftRound] of draft.rounds.entries()) {
        const winner = playerByName.get(draftRound.winnerName);
        if (!winner) throw new Error("승자를 저장하지 못했습니다.");
        const round: Round = {
          id: draftRound.id || createId(),
          gameId,
          sequence,
          winnerId: winner.id,
          rawText: draftRound.rawText,
          normalizedHash: stableRoundKey(draftRound),
          confidence: draftRound.confidence,
          warning: draftRound.warning,
          warningConfirmed: draftRound.warningConfirmed,
          sourceImageHash: draftRound.sourceImageHash,
          sourceImageIndex: draftRound.sourceImageIndex,
          duplicateConfirmed: draftRound.duplicateConfirmed,
          createdAt: now,
        };
        await db.rounds.add(round);
        await db.roundLosses.bulkAdd(
          draftRound.losers.map((loss) => ({
            id: createId(),
            roundId: round.id,
            playerId: playerByName.get(loss.name)!.id,
            amount: loss.amount,
          })),
        );
      }

      await db.gameBalances.bulkAdd(balances);
      const transfers = calculateTransfers(
        balances.map((balance) => ({
          id: balance.playerId,
          name: playerByName.get([...playerByName].find(([, player]) => player.id === balance.playerId)?.[0] ?? "")?.name ?? "",
          balance: balance.balance,
        })),
      );
      await db.settlements.bulkAdd(
        transfers.map((transfer) => {
          const previous = paidKeys.get(`${transfer.fromId}:${transfer.toId}:${transfer.amount}`);
          return {
            id: previous?.id ?? createId(),
            gameId,
            fromPlayerId: transfer.fromId,
            toPlayerId: transfer.toId,
            amount: transfer.amount,
            isPaid: previous?.isPaid ?? false,
            paidAt: previous?.paidAt ?? null,
            createdAt: previous?.createdAt ?? now,
          };
        }),
      );
      await db.imageFingerprints.bulkAdd(
        draft.images.map((image) => ({ id: createId(), gameId, sha256: image.hash, originalName: image.name, createdAt: now })),
      );
      return gameId;
    },
  );
}

export async function getSavedGames(): Promise<SavedGame[]> {
  const games = await db.games.orderBy("playedAt").reverse().toArray();
  const players = await db.players.toArray();
  const names = new Map(players.map((player) => [player.id, player.name]));
  return Promise.all(
    games.map(async (game) => {
      const rounds = await db.rounds.where("gameId").equals(game.id).sortBy("sequence");
      const enrichedRounds = await Promise.all(
        rounds.map(async (round) => ({
          ...round,
          winnerName: names.get(round.winnerId) ?? "알 수 없음",
          losses: (await db.roundLosses.where("roundId").equals(round.id).toArray()).map((loss) => ({
            ...loss,
            playerName: names.get(loss.playerId) ?? "알 수 없음",
          })),
        })),
      );
      const balances = (await db.gameBalances.where("gameId").equals(game.id).toArray()).map((balance) => ({
        ...balance,
        playerName: names.get(balance.playerId) ?? "알 수 없음",
      }));
      const settlements = (await db.settlements.where("gameId").equals(game.id).toArray()).map((item) => ({
        ...item,
        fromName: names.get(item.fromPlayerId) ?? "알 수 없음",
        toName: names.get(item.toPlayerId) ?? "알 수 없음",
      }));
      return {
        game,
        rounds: enrichedRounds,
        balances,
        settlements,
        images: await db.imageFingerprints.where("gameId").equals(game.id).toArray(),
      };
    }),
  );
}

export async function deleteGame(gameId: string) {
  await db.transaction(
    "rw",
    [db.games, db.rounds, db.roundLosses, db.gameBalances, db.settlements, db.imageFingerprints],
    async () => {
      const roundIds = await db.rounds.where("gameId").equals(gameId).primaryKeys();
      await db.roundLosses.where("roundId").anyOf(roundIds).delete();
      await db.rounds.where("gameId").equals(gameId).delete();
      await db.gameBalances.where("gameId").equals(gameId).delete();
      await db.settlements.where("gameId").equals(gameId).delete();
      await db.imageFingerprints.where("gameId").equals(gameId).delete();
      await db.games.delete(gameId);
    },
  );
}

export async function toggleSettlement(id: string, paid: boolean) {
  await db.settlements.update(id, { isPaid: paid, paidAt: paid ? new Date().toISOString() : null });
}

export async function addPlayerAlias(playerId: string, aliasValue: string) {
  const alias = aliasValue.trim();
  if (!alias) throw new Error("별칭을 입력해 주세요.");
  await db.playerAliases.add({
    id: createId(),
    playerId,
    alias,
    normalizedAlias: normalizeName(alias),
    createdAt: new Date().toISOString(),
  });
}

export async function renamePlayer(playerId: string, nameValue: string) {
  const name = nameValue.trim();
  if (!name) throw new Error("이름을 입력해 주세요.");
  await db.players.update(playerId, { name, normalizedName: normalizeName(name), updatedAt: new Date().toISOString() });
}

export async function mergePlayers(sourceId: string, targetId: string) {
  if (sourceId === targetId) return;
  await db.transaction(
    "rw",
    [db.players, db.playerAliases, db.rounds, db.roundLosses, db.gameBalances, db.settlements],
    async () => {
      const sourceWinnerRounds = await db.rounds.where("winnerId").equals(sourceId).toArray();
      const sourceLosses = await db.roundLosses.where("playerId").equals(sourceId).toArray();
      const sourceLossRounds = await db.rounds.bulkGet(sourceLosses.map((loss) => loss.roundId));
      const affectedGameIds = [
        ...new Set([...sourceWinnerRounds, ...sourceLossRounds.filter(Boolean)].map((round) => round!.gameId)),
      ];
      const historicalSettlements = affectedGameIds.length
        ? await db.settlements.where("gameId").anyOf(affectedGameIds).toArray()
        : [];
      const historicalPaid = new Map(
        historicalSettlements.map((item) => [
          `${item.gameId}:${item.fromPlayerId}:${item.toPlayerId}:${item.amount}`,
          item,
        ]),
      );
      const winnerRounds = await db.rounds.where("winnerId").equals(sourceId).toArray();
      for (const round of winnerRounds) {
        const collision = await db.roundLosses.where("[roundId+playerId]").equals([round.id, targetId]).first();
        if (collision) throw new Error("합치면 한 판의 승자와 패자가 같아집니다.");
      }
      const targetWinnerRounds = await db.rounds.where("winnerId").equals(targetId).primaryKeys();
      const lossCollision = await db.roundLosses
        .where("playerId")
        .equals(sourceId)
        .filter((loss) => targetWinnerRounds.includes(loss.roundId))
        .first();
      if (lossCollision) throw new Error("합치면 한 판의 승자와 패자가 같아집니다.");
      await db.rounds.where("winnerId").equals(sourceId).modify({ winnerId: targetId });
      await db.roundLosses.where("playerId").equals(sourceId).modify({ playerId: targetId });
      await db.playerAliases.where("playerId").equals(sourceId).modify({ playerId: targetId });
      await db.players.delete(sourceId);

      const names = new Map((await db.players.toArray()).map((player) => [player.id, player.name]));
      for (const gameId of affectedGameIds) {
        const balances = new Map<string, number>();
        const gameRounds = await db.rounds.where("gameId").equals(gameId).toArray();
        for (const round of gameRounds) {
          const losses = await db.roundLosses.where("roundId").equals(round.id).toArray();
          const winnings = losses.reduce((sum, loss) => sum + loss.amount, 0);
          balances.set(round.winnerId, (balances.get(round.winnerId) ?? 0) + winnings);
          losses.forEach((loss) =>
            balances.set(loss.playerId, (balances.get(loss.playerId) ?? 0) - loss.amount),
          );
        }
        assertZeroSum(balances.values());
        await db.gameBalances.where("gameId").equals(gameId).delete();
        await db.settlements.where("gameId").equals(gameId).delete();
        await db.gameBalances.bulkAdd(
          [...balances].map(([playerId, balance]) => ({
            id: createId(),
            gameId,
            playerId,
            balance,
          })),
        );
        const transfers = calculateTransfers(
          [...balances].map(([playerId, balance]) => ({
            id: playerId,
            name: names.get(playerId) ?? "알 수 없음",
            balance,
          })),
        );
        await db.settlements.bulkAdd(
          transfers.map((transfer) => {
            const previous = historicalPaid.get(
              `${gameId}:${transfer.fromId}:${transfer.toId}:${transfer.amount}`,
            );
            return {
              id: previous?.id ?? createId(),
              gameId,
              fromPlayerId: transfer.fromId,
              toPlayerId: transfer.toId,
              amount: transfer.amount,
              isPaid: previous?.isPaid ?? false,
              paidAt: previous?.paidAt ?? null,
              createdAt: previous?.createdAt ?? new Date().toISOString(),
            };
          }),
        );
      }
    },
  );
}

export async function findImageDuplicate(hash: string) {
  const fingerprint = await db.imageFingerprints.where("sha256").equals(hash).first();
  if (!fingerprint) return null;
  return { fingerprint, game: await db.games.get(fingerprint.gameId) };
}
