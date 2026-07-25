export type Id = string;

export interface Player {
  id: Id;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerAlias {
  id: Id;
  playerId: Id;
  alias: string;
  normalizedAlias: string;
  createdAt: string;
}

export interface Game {
  id: Id;
  playedAt: string;
  title: string;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface Round {
  id: Id;
  gameId: Id;
  sequence: number;
  winnerId: Id;
  rawText: string;
  normalizedHash: string;
  confidence: number;
  warning: string | null;
  warningConfirmed: boolean;
  sourceImageHash: string;
  sourceImageIndex: number;
  duplicateConfirmed: boolean;
  createdAt: string;
}

export interface RoundLoss {
  id: Id;
  roundId: Id;
  playerId: Id;
  amount: number;
}

export interface GameBalance {
  id: Id;
  gameId: Id;
  playerId: Id;
  balance: number;
}

export interface Settlement {
  id: Id;
  gameId: Id;
  fromPlayerId: Id;
  toPlayerId: Id;
  amount: number;
  isPaid: boolean;
  paidAt: string | null;
  createdAt: string;
}

export interface ImageFingerprint {
  id: Id;
  gameId: Id;
  sha256: string;
  originalName: string;
  createdAt: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface EditableLoss {
  name: string;
  amount: number;
}

export interface EditableRound {
  id: Id;
  winnerName: string;
  losers: EditableLoss[];
  rawText: string;
  normalizedText: string;
  confidence: number;
  warning: string | null;
  warningConfirmed: boolean;
  sourceImageHash: string;
  sourceImageIndex: number;
  duplicateConfirmed: boolean;
}

export interface OcrToken {
  text: string;
  confidence: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  confidence: number;
  tokens: OcrToken[];
}

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface SavedGame {
  game: Game;
  rounds: Array<Round & { winnerName: string; losses: Array<RoundLoss & { playerName: string }> }>;
  balances: Array<GameBalance & { playerName: string }>;
  settlements: Array<Settlement & { fromName: string; toName: string }>;
  images: ImageFingerprint[];
}

export interface DraftGame {
  id?: Id;
  playedAt: string;
  title: string;
  memo: string;
  rounds: EditableRound[];
  images: Array<{ hash: string; name: string }>;
}
