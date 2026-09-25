import { describe, it, expect } from "vitest";
import { mapPersonaStatus, personaKycProvider, KycProviderNotConfiguredError } from "./persona-kyc-provider.js";

describe("mapPersonaStatus", () => {
  it("maps approved and declined 1:1", () => {
    expect(mapPersonaStatus("approved")).toBe("approved");
    expect(mapPersonaStatus("declined")).toBe("declined");
  });

  it("maps the terminal negative statuses (expired, failed) to declined", () => {
    expect(mapPersonaStatus("expired")).toBe("declined");
    expect(mapPersonaStatus("failed")).toBe("declined");
  });

  it("maps 'created' to requires_input — the user hasn't completed the flow yet", () => {
    expect(mapPersonaStatus("created")).toBe("requires_input");
  });

  it("maps in-progress and under-review statuses to pending", () => {
    expect(mapPersonaStatus("pending")).toBe("pending");
    expect(mapPersonaStatus("completed")).toBe("pending");
    expect(mapPersonaStatus("needs_review")).toBe("pending");
  });

  it("falls back to pending for an unrecognized status rather than throwing", () => {
    expect(mapPersonaStatus("some_future_status_persona_adds")).toBe("pending");
  });
});

describe("personaKycProvider (not configured — no PERSONA_API_KEY in test env)", () => {
  it("startVerification throws KycProviderNotConfiguredError", async () => {
    await expect(personaKycProvider.startVerification({ userId: "test-user", declaredCountry: "BR" })).rejects.toThrow(
      KycProviderNotConfiguredError,
    );
  });

  it("getVerificationStatus throws KycProviderNotConfiguredError", async () => {
    await expect(personaKycProvider.getVerificationStatus({ inquiryId: "inq_test" })).rejects.toThrow(
      KycProviderNotConfiguredError,
    );
  });
});
