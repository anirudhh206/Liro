import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../db/client.js";
import { storeIdempotentResponse } from "./idempotency.js";

const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { walletAddress: `test-wallet-${crypto.randomUUID()}` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("storeIdempotentResponse (ADR-6)", () => {
  it("stores a response under (userId, idempotencyKey)", async () => {
    const userId = await makeUser();

    await storeIdempotentResponse(userId, "key-1", { ledgerEntryId: "42" });

    const row = await prisma.idempotencyKey.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: "key-1" } },
    });
    expect(row?.responseBody).toEqual({ ledgerEntryId: "42" });
  });

  it("is idempotent under a concurrent duplicate write for the same key — no error, first write wins", async () => {
    const userId = await makeUser();

    // Simulates two concurrent requests racing to store the same retried
    // request's result — this is the exact scenario the unique constraint
    // guards against a double-execution being recorded twice.
    await Promise.all([
      storeIdempotentResponse(userId, "race-key", { attempt: "A" }),
      storeIdempotentResponse(userId, "race-key", { attempt: "B" }),
    ]);

    const rows = await prisma.idempotencyKey.findMany({ where: { userId, idempotencyKey: "race-key" } });
    // Exactly one row exists — the unique constraint on (userId, idempotencyKey)
    // rejected the loser, and storeIdempotentResponse swallowed that as a
    // no-op rather than throwing.
    expect(rows).toHaveLength(1);
  });

  it("keeps distinct idempotency keys for the same user fully separate", async () => {
    const userId = await makeUser();

    await storeIdempotentResponse(userId, "key-a", { value: "a" });
    await storeIdempotentResponse(userId, "key-b", { value: "b" });

    const rows = await prisma.idempotencyKey.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
  });

  it("keeps the same idempotency key separate across different users", async () => {
    const userA = await makeUser();
    const userB = await makeUser();

    await storeIdempotentResponse(userA, "shared-key", { user: "A" });
    await storeIdempotentResponse(userB, "shared-key", { user: "B" });

    const rowA = await prisma.idempotencyKey.findUnique({
      where: { userId_idempotencyKey: { userId: userA, idempotencyKey: "shared-key" } },
    });
    const rowB = await prisma.idempotencyKey.findUnique({
      where: { userId_idempotencyKey: { userId: userB, idempotencyKey: "shared-key" } },
    });

    expect(rowA?.responseBody).toEqual({ user: "A" });
    expect(rowB?.responseBody).toEqual({ user: "B" });
  });
});
