import { afterEach, describe, expect, it } from "vitest";
import { db, deleteGame, getSavedGames, GoStopDatabase, saveDraft } from "../../src/db/database";
import { parseOcrText } from "../../src/lib/parser";

describe("IndexedDB 스키마", () => {
  const databases: GoStopDatabase[] = [];
  afterEach(async () => Promise.all(databases.map((database) => database.delete())));

  it("9개 저장소와 스키마 버전을 연다", async () => {
    const database = new GoStopDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();
    expect(database.verno).toBe(3);
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      "gameBalances", "games", "imageFingerprints", "playerAliases", "players", "roundLosses", "rounds", "settings", "settlements",
    ]);
  });

  it("게임을 transaction으로 저장하고 파생 손익을 다시 읽는다", async () => {
    await db.delete();
    await db.open();
    const gameId = await saveDraft({
      playedAt: "2026-07-25",
      title: "테스트 게임",
      memo: "",
      rounds: parseOcrText("명수 / 지원 인후 -400"),
      images: [{ hash: "fixture-hash", name: "fixture.png" }],
    });
    const [saved] = await getSavedGames();
    expect(saved.game.id).toBe(gameId);
    expect(Object.fromEntries(saved.balances.map((item) => [item.playerName, item.balance]))).toEqual({
      명수: 800,
      지원: -400,
      인후: -400,
    });
    expect(saved.settlements).toHaveLength(2);
    await deleteGame(gameId);
    expect(await getSavedGames()).toHaveLength(0);
    await db.delete();
  });
});
