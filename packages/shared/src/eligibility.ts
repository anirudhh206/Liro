/**
 * ADR-5: eligibility is decided once at onboarding and recorded immutably —
 * never re-derived from a live boolean check with no paper trail.
 */
export type EligibilityDecision = "approved" | "rejected";

export interface EligibilityRecord {
  id: string;
  userId: string;
  declaredCountry: string; // ISO 3166-1 alpha-2
  ipGeolocatedCountry: string | null;
  decision: EligibilityDecision;
  reason: string;
  createdAt: string;
}
