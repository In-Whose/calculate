import { describe, expect, it } from "vitest";
import { detectDates, reconstructText } from "../../src/lib/ocrPostprocess";

describe("OCR 후처리", () => {
  it("y가 가까운 토큰을 줄로 묶고 x 순서로 정렬한다", () => {
    const text = reconstructText([
      { text: "-400", confidence: 1, box: { x0: 80, y0: 12, x1: 120, y1: 30 } },
      { text: "명수", confidence: 1, box: { x0: 2, y0: 10, x1: 30, y1: 31 } },
      { text: "/", confidence: 1, box: { x0: 35, y0: 11, x1: 42, y1: 30 } },
      { text: "지원", confidence: 1, box: { x0: 48, y0: 10, x1: 75, y1: 31 } },
      { text: "다음줄", confidence: 1, box: { x0: 2, y0: 60, x1: 50, y1: 80 } },
    ]);
    expect(text).toBe("명수 / 지원 -400\n다음줄");
  });

  it("카카오톡 날짜 구분선을 현지 날짜로 찾는다", () => {
    expect(detectDates("2026년 7월 25일 토요일")).toEqual(["2026-07-25"]);
  });

  it("일반 채팅에 포함된 날짜는 카카오톡 날짜 구분선으로 오인하지 않는다", () => {
    expect(detectDates("8월 9일에 나랑 허세단 콘서트 갈 사람")).toEqual([]);
    expect(detectDates("8월 9일")).toEqual([]);
    expect(detectDates("잡담\n2026년 6월 22일 월요일\n다른 대화")).toEqual(["2026-06-22"]);
  });

  it("카카오톡 시간·수정 표시·작은 읽음 숫자를 OCR 문장에서 제거한다", () => {
    const text = reconstructText([
      { text: "명수/지원 인후-400", confidence: 1, box: { x0: 128, y0: 166, x1: 357, y1: 197 } },
      { text: "2", confidence: 1, box: { x0: 384, y0: 158, x1: 400, y1: 180 } },
      { text: "오후9:54", confidence: 1, box: { x0: 382, y0: 181, x1: 483, y1: 211 } },
      { text: "수정됨", confidence: 1, box: { x0: 617, y0: 281, x1: 682, y1: 315 } },
      { text: "인후/지원-2000명수-1000", confidence: 1, box: { x0: 130, y0: 494, x1: 451, y1: 521 } },
    ]);

    expect(text).toBe("명수/지원 인후-400\n인후/지원-2000명수-1000");
  });
});
