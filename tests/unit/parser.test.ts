import { describe, expect, it } from "vitest";
import { normalizeMessage, parseOcrText, parseSettlementLine } from "../../src/lib/parser";

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
});
