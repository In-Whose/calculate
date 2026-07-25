import type { EditableRound } from "../types";

export interface NamedBalance {
  id: string;
  name: string;
  balance: number;
}

export interface NamedTransfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
}

export function calculateBalances(rounds: EditableRound[]) {
  const balances = new Map<string, number>();
  for (const round of rounds) {
    let winnings = 0;
    for (const loss of round.losers) {
      winnings += loss.amount;
      balances.set(loss.name, (balances.get(loss.name) ?? 0) - loss.amount);
    }
    balances.set(round.winnerName, (balances.get(round.winnerName) ?? 0) + winnings);
  }
  return balances;
}

export function calculateTransfers(input: NamedBalance[]): NamedTransfer[] {
  const debtors = input
    .filter((item) => item.balance < 0)
    .map((item) => ({ ...item, remaining: -item.balance }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const creditors = input
    .filter((item) => item.balance > 0)
    .map((item) => ({ ...item, remaining: item.balance }))
    .sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id));
  const transfers: NamedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    transfers.push({
      fromId: debtor.id,
      fromName: debtor.name,
      toId: creditor.id,
      toName: creditor.name,
      amount,
    });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  const unresolved = [...debtors, ...creditors].reduce((sum, item) => sum + item.remaining, 0);
  if (unresolved !== 0) throw new Error("손익 합계가 0원이 아닙니다.");
  return transfers;
}

export function assertZeroSum(values: Iterable<number>) {
  const sum = [...values].reduce((total, value) => total + value, 0);
  if (sum !== 0) throw new Error(`손익 합계가 ${sum}원입니다.`);
}
