import { describe, expect, it } from "vitest";
import { calculateBalances, calculateTransfers } from "../../src/lib/settlement";
import { parseOcrText } from "../../src/lib/parser";

describe("손익과 정산 계산", () => {
  it("요구사항 샘플의 손익과 송금을 계산한다", () => {
    const rounds = parseOcrText(`명수 / 지원 인후 -400
명수 / 인후 지원 -800
지원 / 인후 명수 -2000
인후 / 명수 -8800 지원 -2200`);
    const balances = calculateBalances(rounds);
    // The source requirements' displayed total for these four exact rounds is
    // arithmetically inconsistent; per-round zero-sum rules yield these totals.
    expect(Object.fromEntries(balances)).toEqual({ 명수: -8400, 지원: 600, 인후: 7800 });
    expect([...balances.values()].reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(calculateTransfers([...balances].map(([name, balance]) => ({ id: name, name, balance })))).toEqual([
      { fromId: "명수", fromName: "명수", toId: "인후", toName: "인후", amount: 7800 },
      { fromId: "명수", fromName: "명수", toId: "지원", toName: "지원", amount: 600 },
    ]);
  });

  it("동률에서 참가자 ID로 결정적 정렬한다", () => {
    const result = calculateTransfers([
      { id: "b", name: "B", balance: -100 },
      { id: "a", name: "A", balance: -100 },
      { id: "c", name: "C", balance: 200 },
    ]);
    expect(result.map((item) => item.fromId)).toEqual(["a", "b"]);
  });
});
