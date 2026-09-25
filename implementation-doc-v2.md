# Implementation Doc v2: Enterprise-Grade Architecture

## Liro — Pushback, Resolution, and What's Actually Real

**Status:** Supersedes the v1 architecture doc **Date:** 2026-09-17

---

## 0. The standard this doc holds itself to

Every decision below follows the same structure: **what we said before → the honest problem with it → the real resolution → what it now requires from you.** Nothing gets marked "done" unless it's real code against a real, documented API — and where something genuinely can't be real without an external account or a licensed partner, that's stated as a named blocker, not quietly re-mocked.

One fact doesn't change no matter how hard we push: **we cannot become a licensed money transmitter this week.** But — and this is the correction to my last message — that does **not** mean the payout leg has to stay fake. It means we integrate a real, already-licensed payments partner's real API. That's not a compromise; it's literally how every fintech that isn't itself a bank does this. More below.

---

## 1. Requirements (revised)

### Functional (unchanged from v1, restated)

Onboard → own a real tokenized-equity position → borrow against it → cash out locally, end to end.

### Non-functional (this is what changed)

- **No component fakes a financial outcome it isn't actually capable of producing.** A number on screen must trace to a real computation against real external state, or be explicitly labeled as a partner-sandbox response — never a hardcoded value pretending to be either.
- **Every money-moving action is idempotent and auditable.** A retried request must not double-borrow or double-payout. Every state change has an immutable ledger entry, because a regulator, a partner, or your own reconciliation will eventually ask "prove this happened once."
- **Every request is authenticated.** No endpoint trusts a bare `userId` in the request body — that was a real v1 hole.
- **No secret lives in code.** API keys for every third party are runtime configuration, never committed.
- **No single external data source drives a financial decision unchecked.** Oracle and lending-provider reads get sanity-checked, not blindly trusted.

---

## 2. Architecture Decision Records — Revisited

### ADR-1: Custody model

**Original decision:** embedded non-custodial wallet (Privy/Turnkey).

**Pushback:** true non-custodial means the user signs every transaction — onboard, invest, borrow, cash-out — which is a terrible UX for someone who isn't crypto-native, and was never actually resolved in v1. Handing the backend a standing private key to sign on the user's behalf, to fix the UX, quietly reintroduces full custodial risk through the back door — the worst of both models.

**Resolution:** use **policy-scoped session signers**, a real, documented feature of both Privy and Turnkey (Turnkey calls these "policies"; Privy calls them "session signers"). The backend holds a delegated signing key that can _only_ execute a pre-declared, allow-listed set of actions — swap USDC for the fixed basket via Jupiter, deposit that basket as Kamino collateral, borrow up to a policy-defined limit — and cannot withdraw to an arbitrary address or exceed the user's own collateral. This is real, currently-shipping functionality, not a workaround: it's the same pattern real Solana consumer fintechs use to get one-click UX without full custody.

**What this requires from you:** a real Privy or Turnkey account, and a decision on which provider (Turnkey's policy engine is more granular; Privy's is simpler to integrate — worth 30 minutes of comparing their docs before committing).

---

### ADR-2: Lending engine

**Original decision:** use Kamino directly, never rebuild lending/liquidation logic.

**Pushback:** this was right, but incomplete. Hard-wiring the backend directly to Kamino's SDK means if Kamino pauses xStocks collateral, changes LTV parameters, or the reserve has thin liquidity, the entire credit product breaks with no warning — and we'd only find out when a user's borrow call fails.

**Resolution:** keep "don't rebuild the risk math" as the rule, but wrap Kamino behind a small `LendingProvider` interface in the backend (deposit, borrow, getReserveHealth). Kamino is the only implementation for now — this isn't a hedge toward building our own engine, it's just not letting one vendor's specific SDK shape leak through the entire codebase. Before every borrow, the backend calls `getReserveHealth()` and reads Kamino's _own_ published reserve status (paused / active / liquidity available) via their SDK. If the reserve isn't healthy, the backend blocks new borrows with a clear message — this is a health check gating an existing decision, not a new risk-scoring product, so it doesn't reopen the "custom risk engine" trap we ruled out earlier.

**What this requires from you:** nothing new — this uses the Kamino SDK you were already going to integrate, just behind a thin interface.

---

### ADR-3: Local-currency payout — **this is the one that actually changes**

**Original decision:** simulate the PIX/UPI leg indefinitely; label it as a roadmap item.

**Pushback (yours, correctly):** "enterprise-level, nothing dummy" cannot tolerate a permanently fake core feature. I was too quick to treat "we can't get a money-transmitter license this week" as equivalent to "this has to stay fake forever" — those aren't the same problem.

**Resolution:** integrate a **real, currently-licensed payment-as-a-service provider's sandbox API.** This is how every non-bank fintech does last-mile local payout — you don't become the bank, you plug into one that already is. Current, real, documented options (all live in 2026, all with public sandbox environments):

- **BlindPay** — LatAm-focused (YC-backed), converts USDC/USDT to BRL and pays out over PIX, non-custodial for the business, published pricing, JS/Python SDKs. Best fit if Brazil is the first corridor.
- **Lightspark Grid** — one API covering PIX (Brazil), UPI (India), SEPA Instant, and FedNow, with a production-mirror sandbox. Best fit if you want both corridors behind one integration.
- **Alchemy Pay** — 173-country coverage including both UPI and PIX specifically.

The backend calls a **real** sandbox API — real HTTP requests, real response handling, real webhook confirmation — exactly like it would in production. The only difference between sandbox and production is the partner's own environment flag and the fact that no real money moves in sandbox mode. That's not a dummy integration; that's how every serious fintech tests this exact flow before going live.

**What this requires from you (this is a real business step, not something I can do):** sign up for one provider's developer account and go through their **KYB (know-your-business)** process to get sandbox API credentials. This typically takes days, not months, for sandbox access specifically (production access, which needs your own compliance posture in the corridor, is the slower, later step). This is the one piece of the whole system that genuinely cannot be "real code first, business step later" — the account has to exist before the integration code can call anything real.

---

### ADR-4: Asset universe

**Original decision:** fixed basket (AAPLx, NVDAx, SPYx).

**Pushback:** none, this holds. Diversification story stays true, keeps swap-routing simple. Not touching this.

---

### ADR-5: Compliance/eligibility

**Original decision:** app-layer IP-based geo-gating.

**Pushback:** IP geolocation alone is trivially bypassed with a VPN, and — more importantly for "enterprise" — a bare pass/fail check with no record of _why_ a user was approved is worthless the moment a regulator or partner (see ADR-3) asks you to prove your eligibility process.

**Resolution:** combine declared residency (user-asserted at onboarding) with IP geolocation as a cross-check, and — critically — write an **immutable eligibility record** for every user: what they declared, what the IP check returned, what decision was made, and when. This doesn't require new infrastructure, just a real audit-log table instead of a boolean that vanishes after the check. Real KYC provider integration (Persona, Sumsub) is the next layer, gated the same way as ADR-3 — real code, blocked on you creating a real account.

---

## 3. New ADRs (gaps v1 didn't cover at all)

### ADR-6: Idempotency and the audit ledger

**Context:** v1's in-memory store had no protection against a retried `/borrow` or `/payout` call executing twice — a real, dangerous gap for anything that moves money.

**Decision:** every mutating endpoint (`/invest`, `/borrow`, `/payout`) requires an `Idempotency-Key` header. The backend stores a unique constraint on `(user_id, idempotency_key)` — a retried request with the same key returns the original result instead of re-executing. Every state change also writes an **append-only ledger row** (never mutated, only inserted) — balances are a _derived view_ over the ledger, not a mutable field. This is standard double-entry-adjacent fintech practice, not over-engineering: it's the difference between "we think the balance is correct" and "we can reconstruct exactly how it got there."

### ADR-7: Authentication and session model

**Context:** v1 trusted a bare `userId` string in every request body — anyone could impersonate any user by guessing an ID.

**Decision:** onboarding issues a signed session token (JWT or equivalent) tied to the user's embedded-wallet identity from ADR-1's provider. Every subsequent request authenticates via that token; the backend derives `userId` from the verified token, never from client-supplied data.

### ADR-8: Oracle cross-validation

**Context:** the pricing service was set to trust Pyth alone for values that drive real borrow decisions.

**Decision:** before using a Pyth price to compute a borrow quote, sanity-check it against Kamino's own oracle reading for the same collateral (Kamino uses Chainlink internally). If the two diverge beyond a defined tolerance, block new borrows with a clear "price feeds disagree, try again shortly" message rather than acting on a possibly-bad read. This is input validation on an existing decision, not the standalone "risk engine" product we correctly ruled out earlier — the distinction matters and is worth holding onto.

### ADR-9: Secrets management

**Decision:** every third-party API key (Privy/Turnkey, the payout provider, KYC provider) is loaded from environment variables via a `.env` file that is git-ignored from commit one, with a `.env.example` documenting every required key with no real values. No exceptions, no "just for now" hardcoding.

---

## 4. Updated component diagram

```text
┌───────────────────────────────────────────────────────────────────┐
│                         CLIENT (mobile-first)                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTPS + session token (ADR-7)
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│                      BACKEND SERVICE (dedicated, not               │
│                      collapsed into frontend routes)                │
│                                                                      │
│  Auth Middleware (ADR-7) → verifies session, derives userId         │
│  Idempotency Middleware (ADR-6) → dedupes on Idempotency-Key        │
│                                                                      │
│  ┌────────────┐ ┌─────────────┐ ┌──────────────┐ ┌───────────────┐ │
│  │ Eligibility│ │  Pricing    │ │  Lending      │ │  Payout        │ │
│  │ Service    │ │  Service    │ │  Provider     │ │  Service        │ │
│  │ (ADR-5)    │ │ (ADR-8:     │ │  Interface    │ │  (ADR-3: real   │ │
│  │            │ │  Pyth +     │ │  (ADR-2:      │ │  provider        │ │
│  │            │ │  cross-check│ │  wraps Kamino)│ │  sandbox)        │ │
│  └─────┬──────┘ └──────┬──────┘ └──────┬───────┘ └───────┬─────────┘ │
└────────┼───────────────┼───────────────┼─────────────────┼───────────┘
         │               │               │                 │
         ▼               ▼               ▼                 ▼
   Declared          Pyth Hermes    Kamino klend-sdk    BlindPay /
   residency +       + Chainlink    (real, on-chain)    Lightspark Grid
   IP check          cross-check                        sandbox API
                                                          (real, KYB-gated)
                                 │
                                 ▼
                   ┌─────────────────────────────┐
                   │   POSTGRES                   │
                   │   users, eligibility_records │
                   │   (ADR-5), ledger (ADR-6,     │
                   │   append-only), idempotency_  │
                   │   keys                        │
                   └───────────────────────────────┘
```

---

## 5. Data model (sketch — Postgres via Prisma or raw SQL, either is fine)

```sql
-- Balances are DERIVED from ledger, never stored/mutated directly.
CREATE TABLE ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  entry_type TEXT NOT NULL, -- 'deposit' | 'invest' | 'borrow' | 'payout'
  amount_usd NUMERIC(18,2) NOT NULL,
  metadata JSONB NOT NULL,   -- tx signatures, provider references, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE eligibility_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  declared_country TEXT NOT NULL,
  ip_geolocated_country TEXT,
  decision TEXT NOT NULL, -- 'approved' | 'rejected'
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 6. External dependencies — what's blocked on you, not on code

| Dependency                          | Why it's blocked on you                                     | What I can do right now                                                                                    |
| ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Postgres instance                   | Needs real infra (Supabase/Neon/Railway free tier all work) | Write the full schema + queries the moment I have a connection string                                      |
| Privy or Turnkey account            | Needs a real signup + API key issuance                      | Write the full policy-scoped session-signer integration the moment I have credentials                      |
| BlindPay or Lightspark Grid account | Needs real KYB approval before sandbox keys issue           | Write the full real API integration (quote, payout, webhook handling) the moment sandbox credentials exist |
| KYC provider (Persona/Sumsub)       | Same — real account                                         | Same — real integration ready to wire in                                                                   |

**Everything else — Pyth, Jupiter, Kamino, the ledger schema, auth middleware, idempotency handling — needs nothing from you and can be written as real, correct code right now.**

---

## 7. Build plan (revised)

1. **Now:** real Pyth, Jupiter, and Kamino integration code (including ADR-8's cross-validation and ADR-2's health check), the Postgres schema, auth middleware, and idempotency handling — all real, all written against actual current SDKs.
2. **Once you provide a Postgres connection string:** wire the schema in and run real migrations.
3. **Once you provide Privy/Turnkey credentials:** replace the wallet stub with real policy-scoped signing.
4. **Once you provide payout-provider sandbox credentials:** replace the payout simulator with a real BlindPay/Lightspark Grid sandbox integration — genuinely real, genuinely testable, genuinely not dummy.
5. **KYC integration** follows the same pattern as step 4.

---

## 8. What I need from you to actually start

Three real decisions, not code:

1. **Postgres provider** — Supabase, Neon, or Railway (any is fine; pick one and create a free instance).
2. **Wallet provider** — Privy or Turnkey.
3. **Payout provider** — BlindPay (Brazil-first, simpler) or Lightspark Grid (both corridors, one integration).

Once you've picked, I can start writing the real integration code for whichever pieces you already have credentials for, and stub _only_ the pieces still waiting on account approval — each one clearly marked with exactly what's blocking it, not silently treated as done.
