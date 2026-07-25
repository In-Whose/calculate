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
});
