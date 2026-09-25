/**
 * ADR-6: append-only ledger. Balances are always a derived view over these
 * rows — no code anywhere should hold or mutate a stored "balance" field.
 */
export const LEDGER_ENTRY_TYPES = [
  "deposit",
  "invest",
  "borrow",
  "payout",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntry {
  id: string;
  userId: string;
  entryType: LedgerEntryType;
  amountUsd: string; // decimal-as-string over the wire; never a float
  metadata: Record<string, unknown>;
  createdAt: string; // ISO 8601
}
