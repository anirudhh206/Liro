import type { EligibilityDecision } from "@liro/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";

/** ADR-5: countries this product is eligible in (Brazil for PIX, India for UPI, per ADR-3's payout corridors). */
const ELIGIBLE_COUNTRIES = new Set(["BR", "IN"]);

async function geolocateIp(ipAddress: string): Promise<string | null> {
  if (!env.IP_GEOLOCATION_API_URL || !env.IP_GEOLOCATION_API_KEY) {
    return null; // named blocker: no IP geolocation provider configured yet
  }
  const url = `${env.IP_GEOLOCATION_API_URL}?ip=${encodeURIComponent(ipAddress)}&key=${env.IP_GEOLOCATION_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { country_code?: string };
  return body.country_code ?? null;
}

/**
 * ADR-5: combines user-declared residency with an IP cross-check, and
 * always writes an immutable eligibility_records row — never just a
 * pass/fail boolean that vanishes after the check.
 */
export async function evaluateEligibility(params: {
  userId: string;
  declaredCountry: string;
  ipAddress: string;
}): Promise<{ decision: EligibilityDecision; reason: string }> {
  const ipGeolocatedCountry = await geolocateIp(params.ipAddress);

  let decision: EligibilityDecision;
  let reason: string;

  if (!ELIGIBLE_COUNTRIES.has(params.declaredCountry)) {
    decision = "rejected";
    reason = `Declared country ${params.declaredCountry} is not in an eligible payout corridor`;
  } else if (
    ipGeolocatedCountry &&
    ipGeolocatedCountry !== params.declaredCountry
  ) {
    decision = "rejected";
    reason = `Declared country ${params.declaredCountry} does not match IP-geolocated country ${ipGeolocatedCountry}`;
  } else {
    decision = "approved";
    reason = ipGeolocatedCountry
      ? "Declared country matches IP geolocation"
      : "Declared country eligible; IP geolocation unavailable (provider not configured)";
  }

  await prisma.eligibilityRecord.create({
    data: {
      userId: params.userId,
      declaredCountry: params.declaredCountry,
      ipGeolocatedCountry,
      decision,
      reason,
    },
  });

  return { decision, reason };
}
