import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/client.js";
import { appendLedgerEntry, getUserLedgerEntries } from "./ledger.repository.js";

const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { walletAddress: `test-wallet-${crypto.randomUUID()}` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("ledger.repository (ADR-6)", () => {
  it("appends an entry and returns its id", async () => {
    const userId = await makeUser();

    const { id } = await appendLedgerEntry({
      userId,
      entryType: "deposit",
      amountUsd: "150.00",
      metadata: { source: "test" },
    });

    expect(id).toBeTruthy();
  });

  it("stores multiple entries for the same user as separate append-only rows, in order", async () => {
    const userId = await makeUser();

    await appendLedgerEntry({ userId, entryType: "deposit", amountUsd: "100.00", metadata: {} });
    await appendLedgerEntry({ userId, entryType: "invest", amountUsd: "50.00", metadata: { asset: "AAPLx" } });
    await appendLedgerEntry({ userId, entryType: "borrow", amountUsd: "20.00", metadata: {} });

    const entries = await getUserLedgerEntries(userId);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.entryType)).toEqual(["deposit", "invest", "borrow"]);
    // amountUsd is a Prisma Decimal — compare as strings to avoid a type dependency in the test.
    expect(entries.map((e) => e.amountUsd.toString())).toEqual(["100", "50", "20"]);
  });

  it("preserves arbitrary metadata (tx signatures, provider references) verbatim", async () => {
    const userId = await makeUser();
    const metadata = { txSignature: "5abc...", provider: "kamino", nested: { ok: true } };

    await appendLedgerEntry({ userId, entryType: "borrow", amountUsd: "10.00", metadata });

    const [entry] = await getUserLedgerEntries(userId);
    expect(entry?.metadata).toEqual(metadata);
  });

  it("never mutates a prior row — repeated appends only ever add new rows", async () => {
    const userId = await makeUser();

    for (let i = 0; i < 5; i++) {
      await appendLedgerEntry({ userId, entryType: "deposit", amountUsd: "1.00", metadata: { i } });
    }

    const entries = await getUserLedgerEntries(userId);
    expect(entries).toHaveLength(5);
    // Each row's own id is distinct — nothing was updated in place.
    expect(new Set(entries.map((e) => e.id.toString())).size).toBe(5);
  });
});
