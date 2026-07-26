import { describe, expect, it } from "vitest";
import { normalizeMessage, parseOcrText, parseSettlementLine } from "../../src/lib/parser";
import { calculateBalances } from "../../src/lib/settlement";

describe("정산 메시지 파서", () => {
  it("여러 패자의 공통 금액을 각각 적용한다", () => {
    expect(parseSettlementLine("명수 / 지원 인후 -400")?.losers).toEqual([
      { name: "지원", amount: 400 },
      { name: "인후", amount: 400 },
    ]);
  });

  it("패자별 다른 금액을 적용한다", () => {
    expect(parseSettlementLine("지원 / 인후 -4,000 명수 -2000")?.losers).toEqual([
      { name: "인후", amount: 4000 },
      { name: "명수", amount: 2000 },
    ]);
  });

  it("공백, 쉼표, 유니코드 마이너스를 정규화한다", () => {
    expect(normalizeMessage("명수/  지원   −1,200")).toBe("명수/지원 -1,200");
    expect(parseSettlementLine("명수/지원 −1,200")?.losers[0].amount).toBe(1200);
  });

  it("금액 없음과 동일 승패를 경고한다", () => {
    expect(parseSettlementLine("명수 / 지원")?.warning).toContain("금액");
    expect(parseSettlementLine("명수 / 명수 -400")?.warning).toContain("같습니다");
  });

  it("카카오톡 UI 문장은 판으로 만들지 않는다", () => {
    expect(parseOcrText("오전 10:32\n계산 플리즈\n명수 / 지원 -400")).toHaveLength(1);
  });

  it("실제 PaddleOCR의 붙은 이름·금액과 읽음 숫자를 13판으로 복원한다", () => {
    const paddleText = `인후/지원-9600
1
오후9:38 명수/인후지원-600
2 명수/인후-1600
오후9:51
..0 명수
명수/지원 인후-400 2
오후9:54
명수/인후지원-800
2 수정됨
오후9:58
2 지원/인후 명수-2000
오후10:04
C 고지원
인후/지원-2000명수-1000 2
오후10:10
2 명수/인후-1800
오후10:18
· · 고지원
인후/명수-8800지원-2200 2
오후10:29
ㅇ 명수
지원/명수 인후-3200 2
오후10:36
2 지원/인후-4000명수-2000
오후10:42
6 명수
지원/인후명수-600 2
오후10:46
2 명수/지원-600인후-1200
오후10:51`;
    const rounds = parseOcrText(paddleText);

    expect(rounds).toHaveLength(13);
    expect(rounds.map(({ winnerName, losers }) => ({ winnerName, losers }))).toEqual([
      { winnerName: "인후", losers: [{ name: "지원", amount: 9600 }] },
      { winnerName: "명수", losers: [{ name: "인후", amount: 600 }, { name: "지원", amount: 600 }] },
      { winnerName: "명수", losers: [{ name: "인후", amount: 1600 }] },
      { winnerName: "명수", losers: [{ name: "지원", amount: 400 }, { name: "인후", amount: 400 }] },
      { winnerName: "명수", losers: [{ name: "인후", amount: 800 }, { name: "지원", amount: 800 }] },
      { winnerName: "지원", losers: [{ name: "인후", amount: 2000 }, { name: "명수", amount: 2000 }] },
      { winnerName: "인후", losers: [{ name: "지원", amount: 2000 }, { name: "명수", amount: 1000 }] },
      { winnerName: "명수", losers: [{ name: "인후", amount: 1800 }] },
      { winnerName: "인후", losers: [{ name: "명수", amount: 8800 }, { name: "지원", amount: 2200 }] },
      { winnerName: "지원", losers: [{ name: "명수", amount: 3200 }, { name: "인후", amount: 3200 }] },
      { winnerName: "지원", losers: [{ name: "인후", amount: 4000 }, { name: "명수", amount: 2000 }] },
      { winnerName: "지원", losers: [{ name: "인후", amount: 600 }, { name: "명수", amount: 600 }] },
      { winnerName: "명수", losers: [{ name: "지원", amount: 600 }, { name: "인후", amount: 1200 }] },
    ]);
    expect(Object.fromEntries(calculateBalances(rounds))).toEqual({
      인후: 7400,
      지원: 1400,
      명수: -8800,
    });
  });
});
