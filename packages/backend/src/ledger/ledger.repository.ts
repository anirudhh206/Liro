import type { LedgerEntryType } from "@liro/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";

/**
 * ADR-6: the only module allowed to write to ledger_entries. Every write is
 * an INSERT; there is no update/delete path by design. Balances are derived
 * by summing rows, never stored as a mutable field.
 */
export async function appendLedgerEntry(params: {
  userId: string;
  entryType: LedgerEntryType;
  amountUsd: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string }> {
  const row = await prisma.ledgerEntry.create({
    data: {
      userId: params.userId,
      entryType: params.entryType,
      amountUsd: params.amountUsd,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  });
  return { id: row.id.toString() };
}

/** Derived balance: signed sum of ledger rows. Deposits/borrows/payouts each carry their own sign convention in metadata/entryType semantics at the call site. */
export async function getUserLedgerEntries(userId: string) {
  return prisma.ledgerEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}
