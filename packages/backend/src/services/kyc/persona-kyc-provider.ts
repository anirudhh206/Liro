import type { KycProvider, KycStatus } from "@liro/shared";
import { env, personaCredentialsConfigured } from "../../config/env.js";

/**
 * ADR-5's next layer: real identity verification via Persona
 * (https://api.withpersona.com/api/v1/inquiries — confirmed against
 * Persona's own API reference, not guessed). Gated the same way as ADR-1/
 * ADR-3: throws a named "not configured" error until a real account exists,
 * never silently re-mocked.
 */
export class KycProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "Persona credentials are not configured (PERSONA_API_KEY / PERSONA_INQUIRY_TEMPLATE_ID). " +
        "This is the named ADR-5 blocker: real KYC requires creating a Persona account and inquiry template first.",
    );
    this.name = "KycProviderNotConfiguredError";
  }
}

function requireCredentials(): { apiKey: string; inquiryTemplateId: string } {
  if (!personaCredentialsConfigured || !env.PERSONA_API_KEY || !env.PERSONA_INQUIRY_TEMPLATE_ID) {
    throw new KycProviderNotConfiguredError();
  }
  return { apiKey: env.PERSONA_API_KEY, inquiryTemplateId: env.PERSONA_INQUIRY_TEMPLATE_ID };
}

interface PersonaInquiryResponse {
  data: {
    id: string;
    attributes: {
      status: string;
    };
  };
  meta?: {
    "one-time-link"?: string;
  };
}

/**
 * Persona's inquiry status is richer than our KycStatus — this mapping is
 * from the user's-turn-perspective, not a 1:1 passthrough:
 *  - created/pending: the inquiry exists but nothing conclusive has
 *    happened yet -> "pending"
 *  - completed/needs_review: the user finished their part; Persona (or a
 *    human reviewer) hasn't decided yet -> "pending"
 *  - approved -> "approved", declined -> "declined"
 *  - expired/failed: terminal, non-recoverable without starting over ->
 *    "declined" (the caller should offer a fresh startVerification call)
 */
export function mapPersonaStatus(personaStatus: string): KycStatus {
  switch (personaStatus) {
    case "approved":
      return "approved";
    case "declined":
    case "expired":
    case "failed":
      return "declined";
    case "created":
      return "requires_input";
    default:
      // pending, completed, needs_review, and any future status Persona adds.
      return "pending";
  }
}

async function personaRequest(path: string, init: RequestInit, apiKey: string): Promise<PersonaInquiryResponse> {
  const res = await fetch(`${env.PERSONA_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Persona API request to ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PersonaInquiryResponse;
}

export const personaKycProvider: KycProvider = {
  async startVerification(params: {
    userId: string;
    declaredCountry: string;
  }): Promise<{ inquiryId: string; verificationUrl: string; status: KycStatus }> {
    const { apiKey, inquiryTemplateId } = requireCredentials();

    const response = await personaRequest(
      "/inquiries",
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            attributes: {
              "inquiry-template-id": inquiryTemplateId,
              "reference-id": params.userId,
              fields: { "declared-country": params.declaredCountry },
            },
          },
          meta: { "auto-create-one-time-link": true },
        }),
      },
      apiKey,
    );

    const verificationUrl = response.meta?.["one-time-link"];
    if (!verificationUrl) {
      throw new Error(`Persona did not return a one-time-link for userId=${params.userId}`);
    }

    return {
      inquiryId: response.data.id,
      verificationUrl,
      status: mapPersonaStatus(response.data.attributes.status),
    };
  },

  async getVerificationStatus(params: { inquiryId: string }): Promise<{ status: KycStatus }> {
    const { apiKey } = requireCredentials();

    const response = await personaRequest(`/inquiries/${params.inquiryId}`, { method: "GET" }, apiKey);
    return { status: mapPersonaStatus(response.data.attributes.status) };
  },
};
