# M9 — breadth + 24h focus + auto-tailor (Parv brief, 2026-07-17)

> MODE: BUILD. Confirmed scope (Parv answered 3 scoping Qs 2026-07-17).

## Goal
For every fresh Fall-2026 internship role that lands on the platform, have a resume
AND cover letter **already tailored to that role and dated today**, ready to upload
the instant Parv clicks apply. Widen sources well beyond Simplify, and focus the
surface on the **last 24 hours** (be first, minutes after posting).

## Confirmed decisions
1. **Tailoring scope:** pre-tailor the fresh, on-field, **last-24h shortlist** (~5-15/day),
   not all ~50. Bounded volume, always regenerated dated today.
2. **Cover letter:** grounded template + role/company/date specifics (deterministic,
   verify-or-abstain, never fabricates). NOT free LLM generation.
3. **Sources:** parse every job-alert **email digest** in Apple Mail (SWE List, Jobright,
   LinkedIn, Handshake, Indeed, WellFound, **Runway**, **Scalar**, + generic) plus the
   real-time **board APIs**. NO fragile/ToS-risky direct site scraping.

## Honest constraints (recorded so we don't over-promise)
- "Within minutes" is only true for the **board APIs** (real-time). Email-digest roles
  are as fresh as the digest (sender's daily cadence).
- Genuine tailoring needs the **JD**. Board roles carry it; most list/email roles are a
  title + link, so the tailor must **fetch the JD** from the posting (best-effort) or
  tailor to title/company only. Resume keyword-injection stays attestation-gated
  (never fabricates); cover letter is grounded in profile + role/company even without a JD.
- Direct company apply links: SWE List/New Grad link to simplify.jobs (a wrapper).
  Breadth comes from other senders (Runway/Scalar link to their own boards) + boards.

## Features (each gated by a check the loop can run)
- **F1 — Last-24h recency focus (UI).** Pure `isRecent(role)` (posted <=1d, else caught
  <24h) + a "Last 24h" toggle in the command center. `passes:` filter narrows the feed,
  screenshot-verified. [SHIPPED]
- **F2 — Broaden email senders.** Confirm which digests arrive in Apple Mail; extend
  parseJobEmails sender handling (Runway/Scalar/generic) so their roles surface. `passes:`
  a fixture test per new sender layout + live mailbox check.
- **F3 — JD fetcher (best-effort).** Given a role's applyUrl, fetch + extract the JD text
  (Simplify page, direct ATS). `passes:` unit test on fixtures + graceful failure -> "" .
- **F4 — Grounded CoverLetterData builder.** Build the cover-letter specifics
  (companySpecificAngle, strongestProject, experienceAlignment, closing) from profile +
  role/company/category (+ JD when present), all grounded. `passes:` CoverLetterVerifier
  green on the output + no forbidden phrases.
- **F5 — Auto-tailor CLI (`npm run tailor:fresh`).** For each last-24h on-field role:
  fetch JD -> Tailor.tailor() (dated today) -> write resume + cover-letter PDFs to
  output/tailored/<jobId>/ + a manifest. verify-or-abstain per role. `passes:` end-to-end
  on the live shortlist, real PDFs produced or a per-role abstain reason.
- **F6 — Surface "docs ready" in the UI.** Each fresh card whose tailored docs exist shows
  a link to the resume + cover letter. `passes:` screenshot.

## Invariants (unchanged, enforced)
Never fabricate resume/cover-letter content (tailor = select + reframe real experience;
cover letter grounded + verify-or-abstain). US + F-1-eligible only. Freshness <=14d hard
gate at apply stays; 24h is only the surfacing focus. UI never writes verified application
state. No LinkedIn automation / no direct ToS-violating scraping.
