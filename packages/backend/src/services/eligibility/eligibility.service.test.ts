import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "../../db/client.js";
import { evaluateEligibility } from "./eligibility.service.js";

const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { walletAddress: `test-wallet-${crypto.randomUUID()}` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  await prisma.eligibilityRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

describe("evaluateEligibility (ADR-5)", () => {
  it("rejects a declared country outside the eligible payout corridors", async () => {
    const userId = await makeUser();

    const result = await evaluateEligibility({ userId, declaredCountry: "US", ipAddress: "1.2.3.4" });

    expect(result.decision).toBe("rejected");
    expect(result.reason).toMatch(/not in an eligible payout corridor/);
  });

  it("approves an eligible declared country when IP geolocation is unavailable (no provider configured)", async () => {
    const userId = await makeUser();

    const result = await evaluateEligibility({ userId, declaredCountry: "BR", ipAddress: "1.2.3.4" });

    expect(result.decision).toBe("approved");
    expect(result.reason).toMatch(/IP geolocation unavailable/);
  });

  it("always writes an immutable eligibility_records row, on both approval and rejection", async () => {
    const userId = await makeUser();

    await evaluateEligibility({ userId, declaredCountry: "IN", ipAddress: "1.2.3.4" });
    await evaluateEligibility({ userId, declaredCountry: "US", ipAddress: "5.6.7.8" });

    const records = await prisma.eligibilityRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

    expect(records).toHaveLength(2);
    expect(records[0]?.decision).toBe("approved");
    expect(records[0]?.declaredCountry).toBe("IN");
    expect(records[1]?.decision).toBe("rejected");
    expect(records[1]?.declaredCountry).toBe("US");
  });
});
