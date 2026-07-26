import { describe, expect, it } from "vitest";
// Original: import { normalizeMessage, parseOcrText, parseSettlementLine } from "../../src/lib/parser";
import {
  canonicalizeRoundPlayerNames,
  normalizeMessage,
  parseOcrText,
  parseSettlementLine,
} from "../../src/lib/parser";
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

  it("잡채팅이 섞인 6월 22일 긴 캡처에서 9판만 찾고 OCR 이름 오타를 보정한다", () => {
    const paddleText = `2026년 6월 22일 월요일
정시현
서연/ 시현-16000
° .0 명수
역시
정시현
서연/시현-6000
· 최서연
시현/서연-13000
정시현
사연/시현-4000
정시현
서연/시현-6000
정시현
서연/시현-4500
0 최서연
시현/서연-4500
0 고지원
죽음의 고스톱 날 만들자
하루종일 고스톱만 치는거임
..0 명수
그거 최서연 엘씨 엠티잖아
고지원
고스톱 엠티 ㄱㄱ
최서연
명수에게 답장
그거 최서연 엘씨 엠티잖아
마자
ㅎ.ㅎ
시현/서연-8500
.0 명수
정시현은 차갑다
정시현
서연/시현-4000`;
    const parsed = parseOcrText(paddleText);
    const result = canonicalizeRoundPlayerNames(parsed);

    expect(parsed).toHaveLength(9);
    expect(result.corrections).toEqual([{ from: "사연", to: "서연", count: 1 }]);
    expect(Object.fromEntries(calculateBalances(result.rounds))).toEqual({
      서연: 14500,
      시현: -14500,
    });
  });

  it("앞선 한 장짜리 초장문 캡처도 잡채팅 없이 14판으로 복원한다", () => {
    const paddleText = `인후/지원-9600
명수/인후지원-600
최서연
진짜열받으니까
고스톱판 벌릴때
여기다가연락좀해라
나도할래..
정시현
8월 9일에 나랑 히게단콘서트갈사람
최서연
재믹겟다
정시현
못가니
최서연
선약
고지원
인휘/지원명수-800
최서연에게 답장
여기다가연락좀해라
ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ
명수
서연아 심심하냐
최서연
왜나빼고하냐
심심하진않윽데 나도 고스톱치고싶어
명수/인후-1600
명수/지원 인후-400
명수/인후지원-800
지원/인후 명수-2000
고지원
인휘/지원-2000 명수-1000
명수/인후-1800
고지원
인후/명수-8800 지원-2200
명수
지원/명수 인후-3200
지원/인후-4000명수-2000
명수
지원/인후명수-600
명수/지원-600인후-1200`;
    const result = canonicalizeRoundPlayerNames(parseOcrText(paddleText));

    expect(result.rounds).toHaveLength(14);
    expect(result.corrections).toEqual([{ from: "인휘", to: "인후", count: 2 }]);
    expect(Object.fromEntries(calculateBalances(result.rounds))).toEqual({
      인후: 9000,
      지원: 600,
      명수: -9600,
    });
  });

  it("잡채팅이 섞인 6월 21일 초장문 캡처에서 24판과 잔액을 복원한다", () => {
    const paddleText = `2026년 6월 21일 일요일
지원/인후-7600
지원/인후-4000 명수-2000
A 최서연
아
나랑도해
고지원
인휘/지원-2800 명수-1400
최서연에게답장
나랑도 해
번개고스톱
A 최서연
어딘데
디도야?
고지원
ㄴㄴ만화카페ㅋㅋㅋ
인휘/지원-1200 명수-600
A 최서연
ㅌㅋㅌㅋㅋㅋㅋㅋㅋㅋㅋ하
조켓더
명수/인후-1200 지원-600
지원/인후명수-1400
° 명수
인후/지원-2000
명수
인후/명수-800지원-1600
인후/명수 지원-200
지원/명수 인후-600
고지원
인휘/지원-800명수 -1600
고지원
인휘/지원명수-600
° 명수
인후/지원-4000명수-8000
명수/지원-2400
인후/명수-2400
인후/명수-2800지원-1400
지원/인후 명수-200
인후/지원명수-200
명수/지원-12000
인후/지원명수-200
A 최서연
혹시 명수는 돈 언제 벌어
아뭐야
A 최서연
지원이한테 뜯엇노
명수/지원인후-1200
명수/지원-1200 인후-600
고지원
지원/인후 명수-200
운재
아니 뭐야
ㅋㅋㅋㅋㅋ
지원/인후 명수-800`;
    const parsed = parseOcrText(paddleText);
    const result = canonicalizeRoundPlayerNames(parsed);

    expect(parsed).toHaveLength(24);
    expect(result.corrections).toEqual([{ from: "인휘", to: "인후", count: 4 }]);
    expect(Object.fromEntries(calculateBalances(result.rounds))).toEqual({
      지원: -12400,
      인후: 16000,
      명수: -3600,
    });
  });

  it("슬래시가 있는 일반 채팅도 명확한 정산 금액이 없으면 무시한다", () => {
    expect(parseOcrText("오늘/내일 어디가?\n지원 / 문의 -400원\n명수 / 지원 -400")).toHaveLength(1);
  });

  it("저장된 참가자 이름은 캡처에 정확한 표기가 한 번도 없어도 우선 보정한다", () => {
    const result = canonicalizeRoundPlayerNames(
      parseOcrText("인휘/지원-400"),
      ["인후", "지원"],
    );
    expect(result.rounds[0].winnerName).toBe("인후");
  });
});
