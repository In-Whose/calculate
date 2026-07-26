import type { OcrToken } from "../types";

export function groupTokensIntoLines(tokens: OcrToken[]) {
  const sorted = [...tokens].sort((a, b) => {
    const ay = (a.box.y0 + a.box.y1) / 2;
    const by = (b.box.y0 + b.box.y1) / 2;
    return ay - by || a.box.x0 - b.box.x0;
  });
  const lines: OcrToken[][] = [];

  for (const token of sorted) {
    const centerY = (token.box.y0 + token.box.y1) / 2;
    const height = Math.max(1, token.box.y1 - token.box.y0);
    const target = lines.find((line) => {
      const averageY =
        line.reduce((sum, item) => sum + (item.box.y0 + item.box.y1) / 2, 0) / line.length;
      const averageHeight =
        line.reduce((sum, item) => sum + Math.max(1, item.box.y1 - item.box.y0), 0) / line.length;
      return Math.abs(averageY - centerY) <= Math.max(height, averageHeight) * 0.55;
    });
    if (target) target.push(token);
    else lines.push([token]);
  }

  return lines
    .map((line) => line.sort((a, b) => a.box.x0 - b.box.x0))
    .sort((a, b) => a[0].box.y0 - b[0].box.y0);
}

/*
 * Original OCR text reconstruction:
 *
export function reconstructText(tokens: OcrToken[]) {
  return groupTokensIntoLines(tokens)
    .map((line) => line.map((token) => token.text).join(" "))
    .join("\n");
}
 */
function isKakaoInterfaceToken(token: OcrToken) {
  const compact = token.text.replace(/\s+/g, "");
  if (/^(?:오전|오후)\d{1,2}:\d{2}$/i.test(compact)) return true;
  if (compact === "수정됨") return true;

  const width = Math.max(1, token.box.x1 - token.box.x0);
  const height = Math.max(1, token.box.y1 - token.box.y0);
  return /^[12]$/.test(compact) && width <= 32 && height <= 36;
}

export function reconstructText(tokens: OcrToken[]) {
  return groupTokensIntoLines(tokens.filter((token) => !isKakaoInterfaceToken(token)))
    .map((line) => line.map((token) => token.text).join(" "))
    .join("\n");
}

/*
 * Original date search, which also matched dates mentioned inside ordinary chat:
 *
export function detectDates(text: string) {
  const dates = new Set<string>();
  const year = new Date().getFullYear();
  for (const match of text.matchAll(/(?:(\d{4})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})일?/g)) {
    const candidate = `${match[1] ?? year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    if (!Number.isNaN(new Date(`${candidate}T00:00:00`).getTime())) dates.add(candidate);
  }
  return [...dates];
}
 */
export function detectDates(text: string) {
  const dates = new Set<string>();
  // Original strict-line draft also accepted date-only chat such as "8월 9일":
  // const currentYear = new Date().getFullYear();
  // const dateSeparator =
  //   /^\s*[^\p{L}\p{N}]{0,3}\s*(?:(\d{4})[.\-/년]\s*)?(\d{1,2})[.\-/월]\s*(\d{1,2})일?(?:\s*(?:월|화|수|목|금|토|일)요일)?\s*$/u;
  const dateSeparator =
    /^\s*[^\p{L}\p{N}]{0,3}\s*(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\s*(?:월|화|수|목|금|토|일)요일\s*$/u;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(dateSeparator);
    if (!match) continue;
    const candidate =
      `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00`);
    if (
      !Number.isNaN(parsed.getTime())
      && parsed.getFullYear() === Number(match[1])
      && parsed.getMonth() + 1 === Number(match[2])
      && parsed.getDate() === Number(match[3])
    ) {
      dates.add(candidate);
    }
  }
  return [...dates];
}
