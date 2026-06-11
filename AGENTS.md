# AGENTS.md, career-ops project rules
> Loaded via CLAUDE.md every session. Last updated: 2026-06-11.

## Mission
End-to-end autonomous job application system. Two goals, in priority order:
1. Accuracy: nothing incorrect ever reaches an employer. Enforced by verify-or-abstain, not by hope.
2. Autonomy: human intervention trends to zero as the AnswerKB and ActionCache grow. Captchas and first-occurrence unknown questions are the only designed human touchpoints.

## Project overrides (decided by Parv, 2026-06-11)
- The global "NEVER auto-submit" rule does NOT apply in this project. The system MAY submit an application when and only when: (a) the job is inside a Parv-approved batch or matches his standing approval criteria, (b) the Verifier read back every field green, (c) a receipt is written before and after submission.
- GPA is 3.917. config/profile.yml is the single source of truth for every personal fact. No personal fact may be hardcoded in source. Tests pin profile truth.

## Invariants (review these like a senior SWE: properties, not promises)
1. Verify-or-abstain: an unverified field, unmatched dropdown option, or unknown question aborts the submission and notifies Parv. Never guess, never fill the first option, never substring-match an answer.
2. Maker/checker split: the agent that fills a form never judges its own fill (external feedback per Huang et al., ICLR 2024).
3. Idempotency: one application per company+role, ever. Submission paths require an idempotency key.
4. Single writer: all state mutations go through the event-log store. data/applications.json is a generated view, kept for the global logging rule.
5. No LinkedIn Easy Apply automation. Automation surface is ATS career pages: Greenhouse, Lever, Ashby, Workday, plus direct company portals.
6. No captcha-solving services. Captcha = urgent notification + human takeover window, then resume.
7. Legal, EEO, and attestation questions are answered only from human-approved AnswerKB entries. Never auto-generated.
8. Tests green before any commit. CI runs `npx vitest run`, the same command as local.

## Secrets and personal data
- Gitignored, never commit, never echo into logs: .env, .browser-profile/, cv/, config/profile.yml, data/applications.json, files_extracted/.
- Remote `origin` must be the private repo. The public fork remote is `public-fork`; never push to it.

## Learning loop
Every defect found in review, testing, or production gets one line in LESSONS.md (append-only) and, where possible, a regression test. Read LESSONS.md before designing any new component. This file is how the system improves instead of deteriorating.

## Entry points
- `npm test` (vitest), `npm run typecheck`
- `npm run scan` / `npm run pipeline` / `npm run apply`: v1 CLIs, being replaced milestone by milestone
- `npm run demo`: fixture-form fill demo

## Plan of record
M0 hygiene (done 2026-06-11) -> M1 event-log data layer -> M2 Greenhouse adapter end-to-end with receipts -> M3 AnswerKB + batch autopilot + Lever/Ashby -> M4 generic browser agent + ActionCache + Workday -> M5 Obsidian/GitHub context ingestion + weekly eval loop. Each milestone has an exit gate; no milestone starts before the previous gate is green.
