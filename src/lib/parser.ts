import type { EditableRound } from "../types";
import { createId } from "./utils";

const MINUS = /[−–—﹣－]/g;
// Original: const AMOUNT = /^-?(\d[\d,]*)$/;
const IGNORED = /^(오전|오후|\d{1,2}:\d{2}|수정됨|\d+|계산\s*플리즈|이누야\s*해줘)$/i;

export function normalizeMessage(input: string) {
  return input
    .replace(MINUS, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Original whitespace-token settlement parser:
 *
export function parseSettlementLine(
  input: string,
  options: { confidence?: number; sourceImageHash?: string; sourceImageIndex?: number } = {},
): EditableRound | null {
  const normalizedText = normalizeMessage(input);
  if (!normalizedText.includes("/") || IGNORED.test(normalizedText)) return null;
  const [winnerPart, loserPart, ...rest] = normalizedText.split("/");
  const winnerName = winnerPart.trim();
  if (!winnerName || !loserPart || rest.length) return null;

  const tokens = loserPart.trim().split(/\s+/).filter(Boolean);
  const losers: Array<{ name: string; amount: number }> = [];
  let pendingNames: string[] = [];
  let warning: string | null = null;

  for (const token of tokens) {
    const amountMatch = token.match(AMOUNT);
    if (amountMatch) {
      const amount = Number(amountMatch[1].replaceAll(",", ""));
      if (!Number.isSafeInteger(amount) || amount <= 0 || pendingNames.length === 0) {
        warning = "금액 또는 패자 이름을 확인해 주세요.";
        continue;
      }
      losers.push(...pendingNames.map((name) => ({ name, amount })));
      pendingNames = [];
    } else {
      pendingNames.push(token);
    }
  }

  if (pendingNames.length) warning = "금액이 없는 패자가 있습니다.";
  if (!losers.length) warning = warning ?? "패자와 금액을 확인해 주세요.";
  if (losers.some((loser) => loser.name === winnerName)) warning = "승자와 패자가 같습니다.";
  const confidence = options.confidence ?? 1;
  if (confidence < 0.72) warning = warning ?? "OCR 인식 신뢰도가 낮습니다.";

  return {
    id: createId(),
    winnerName,
    losers,
    rawText: input,
    normalizedText,
    confidence,
    warning,
    warningConfirmed: !warning,
    sourceImageHash: options.sourceImageHash ?? "",
    sourceImageIndex: options.sourceImageIndex ?? 0,
    duplicateConfirmed: false,
  };
}
 */
interface ParseOptions {
  confidence?: number;
  sourceImageHash?: string;
  sourceImageIndex?: number;
  knownPlayerNames?: string[];
}

interface SettlementParts {
  winnerName: string;
  loserPart: string;
  normalizedText: string;
}

function cleanPlayerName(input: string) {
  return input.replace(/[^\p{L}\p{N}_.]/gu, "");
}

function extractSettlementParts(input: string): SettlementParts | null {
  const normalized = normalizeMessage(input);
  if (!normalized.includes("/") || IGNORED.test(normalized)) return null;
  const [winnerPart, loserPart, ...rest] = normalized.split("/");
  if (!loserPart || rest.length) return null;

  const cleanedWinnerPart = winnerPart
    .replace(/(?:오전|오후)\s*\d{1,2}:\d{2}/gi, " ")
    .replace(/^[12]\s*/, " ")
    .trim();
  const winnerName = cleanPlayerName(cleanedWinnerPart.split(/\s+/).at(-1) ?? "");
  if (!winnerName) return null;

  return {
    winnerName,
    loserPart: loserPart.trim(),
    normalizedText: `${winnerName}/${loserPart.trim()}`,
  };
}

function segmentKnownNames(input: string, knownNames: string[]) {
  const memo = new Map<number, string[] | null>();
  const visit = (offset: number): string[] | null => {
    if (offset === input.length) return [];
    if (memo.has(offset)) return memo.get(offset) ?? null;
    for (const name of knownNames) {
      if (!input.startsWith(name, offset)) continue;
      const remaining = visit(offset + name.length);
      if (remaining) {
        const result = [name, ...remaining];
        memo.set(offset, result);
        return result;
      }
    }
    memo.set(offset, null);
    return null;
  };
  return visit(0);
}

function splitLoserNames(input: string, knownPlayerNames: string[]) {
  const knownNames = [...new Set(knownPlayerNames.map(cleanPlayerName).filter(Boolean))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b, "ko-KR"));

  return input
    .trim()
    .split(/\s+/)
    .map(cleanPlayerName)
    .filter(Boolean)
    .flatMap((name) => {
      if (knownNames.includes(name)) return [name];
      return segmentKnownNames(name, knownNames) ?? [name];
    });
}

function hasMeaningfulRemainder(input: string) {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => {
      const compact = token.replace(/\s+/g, "");
      return !/^[12]$/.test(compact)
        && compact !== "수정됨"
        && !/^(?:오전|오후)\d{1,2}:\d{2}$/i.test(compact);
    });
}

export function inferWinnerNames(text: string) {
  return [...new Set(
    text
      .split(/\r?\n/)
      .map((line) => extractSettlementParts(line)?.winnerName)
      .filter((name): name is string => Boolean(name)),
  )];
}

export function parseSettlementLine(
  input: string,
  options: ParseOptions = {},
): EditableRound | null {
  const parts = extractSettlementParts(input);
  if (!parts) return null;

  const knownPlayerNames = [
    ...(options.knownPlayerNames ?? []),
    parts.winnerName,
  ];
  const losers: Array<{ name: string; amount: number }> = [];
  const amountPattern = /-\s*(\d[\d,]*)/g;
  let cursor = 0;
  let warning: string | null = null;

  for (const match of parts.loserPart.matchAll(amountPattern)) {
    const names = splitLoserNames(
      parts.loserPart.slice(cursor, match.index).trim(),
      knownPlayerNames,
    );
    const amount = Number(match[1].replaceAll(",", ""));
    if (!Number.isSafeInteger(amount) || amount <= 0 || names.length === 0) {
      warning = "금액 또는 패자 이름을 확인해 주세요.";
    } else {
      losers.push(...names.map((name) => ({ name, amount })));
    }
    cursor = (match.index ?? 0) + match[0].length;
  }

  // Original warning order:
  // if (hasMeaningfulRemainder(parts.loserPart.slice(cursor))) {
  //   warning = warning ?? "해석하지 못한 문자가 있습니다.";
  // }
  // if (!losers.length) warning = warning ?? "패자와 금액을 확인해 주세요.";
  if (!losers.length) warning = warning ?? "패자와 금액을 확인해 주세요.";
  if (losers.length && hasMeaningfulRemainder(parts.loserPart.slice(cursor))) {
    warning = warning ?? "해석하지 못한 문자가 있습니다.";
  }
  if (losers.some((loser) => loser.name === parts.winnerName)) {
    warning = "승자와 패자가 같습니다.";
  }
  const confidence = options.confidence ?? 1;
  if (confidence < 0.72) warning = warning ?? "OCR 인식 신뢰도가 낮습니다.";

  return {
    id: createId(),
    winnerName: parts.winnerName,
    losers,
    rawText: input,
    normalizedText: parts.normalizedText,
    confidence,
    warning,
    warningConfirmed: !warning,
    sourceImageHash: options.sourceImageHash ?? "",
    sourceImageIndex: options.sourceImageIndex ?? 0,
    duplicateConfirmed: false,
  };
}

/*
 * Original line-by-line OCR parser:
 *
export function parseOcrText(
  text: string,
  options: { confidence?: number; sourceImageHash?: string; sourceImageIndex?: number } = {},
) {
  return text
    .split(/\r?\n/)
    .map((line) => parseSettlementLine(line, options))
    .filter((round): round is EditableRound => Boolean(round));
}
 */
export function parseOcrText(text: string, options: ParseOptions = {}) {
  const knownPlayerNames = [
    ...(options.knownPlayerNames ?? []),
    ...inferWinnerNames(text),
  ];
  return text
    .split(/\r?\n/)
    .map((line) => parseSettlementLine(line, { ...options, knownPlayerNames }))
    .filter((round): round is EditableRound => Boolean(round));
}

export function stableRoundKey(round: Pick<EditableRound, "winnerName" | "losers">) {
  const losses = [...round.losers]
    .map((loss) => `${loss.name.trim()}:${loss.amount}`)
    .sort()
    .join("|");
  return `${round.winnerName.trim()}::${losses}`;
}

export function validateRound(round: EditableRound) {
  if (!round.winnerName.trim()) return "승자를 입력해 주세요.";
  if (!round.losers.length) return "패자를 한 명 이상 입력해 주세요.";
  if (round.losers.some((loss) => !loss.name.trim())) return "패자 이름을 입력해 주세요.";
  if (round.losers.some((loss) => !Number.isInteger(loss.amount) || loss.amount <= 0)) {
    return "금액은 0보다 큰 정수여야 합니다.";
  }
  if (round.losers.some((loss) => loss.name.trim() === round.winnerName.trim())) {
    return "승자와 패자는 같을 수 없습니다.";
  }
  if (round.warning && !round.warningConfirmed) return "확인이 필요한 판이 있습니다.";
  return null;
}
