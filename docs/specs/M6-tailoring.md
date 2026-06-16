# SPEC M6: Resume + cover-letter tailoring (precise, format-safe, ATS-verified)

> Status: planned, pre-implementation. Written 2026-06-16 to seed a fresh,
> focused session. This is the only remaining major subsystem after M3-M5
> (apply engine + multi-portal + sourcing) shipped.

## Goal
Given a job (full JD) + Parv's real profile, produce a tailored resume PDF and
cover letter that (1) NEVER fabricates, (2) preserves the template formatting so
the PDF is never broken, (3) injects the JD's real ATS keywords into existing
bullets, and (4) is VERIFIED before it is used: the output is parsed back and
checked, and any failure flags/abstains rather than shipping a damaged or
dishonest document.

## Non-negotiable constraints (from global CLAUDE.md + AGENTS.md)
- NEVER fabricate resume content. Tailoring = select the right variant + reframe
  REAL experience + inject keywords ONLY where they truthfully apply. A keyword
  with no honest home in the existing bullets is SKIPPED, never forced.
- Writing style: no em dashes; no AI filler / forbidden phrases (CoverLetterBuilder
  already has a FORBIDDEN_PHRASES gate — extend it, do not weaken it).
- Profile facts come only from config/profile.yml (GPA 3.917, etc.). No personal
  fact hardcoded in source. cv/ and config/profile.yml are gitignored: tests use
  fixtures/skipIf guards, never real personal data (M0 fresh-clone lesson).

## Apply the discipline that worked in M3-M5 (read LESSONS.md first)
- Maker/checker split: the BUILDER that writes the resume must NOT be the thing
  that judges it. A separate ATS/format Verifier parses the OUTPUT and diffs it
  against what was intended (same shape as the form Verifier).
- Verify-or-abstain: on a verification failure (a section dropped, contact info
  wrong, a claimed keyword absent, the PDF render broken), FLAG and stop, never
  ship the bad document.
- Pure core + thin IO: keep the tailoring logic (keyword extraction, injection
  decisions, no-fabrication checks) pure and unit-testable; keep Playwright PDF
  rendering as a thin, separately-exercised layer.
- One feature at a time, each gated on `npm run typecheck` + `npx vitest run`.
  Adversarial review of the diff before "done". Append LESSONS.

## What already exists (read these, build on them, do not rewrite blindly)
- src/tailor/Tailor.ts — orchestrator (resume + cover letter for a job).
- src/tailor/ResumeBuilder.ts — variant select + ATS keyword injection into
  existing bullets (MAX_INJECTIONS=3, no claim changes). The current core.
- src/tailor/CoverLetterBuilder.ts — fresh cover letter from
  cv/cover_letter_template.md, with a FORBIDDEN_PHRASES gate.
- src/pdf/PdfGenerator.ts + generate-pdf.mjs — Playwright HTML->PDF from
  templates/cv-template.html into output/resumes/.
- tests/tailor/Tailor.test.ts — existing tests (likely skipIf-guarded on cv/).
- src/evaluator/JobParser.ts — JD parsing (reuse for keyword extraction).

## Proposed work (decompose into verified features)
1. **ATS keyword extraction** (pure): JD text -> ranked, deduped skill/keyword
   list (consume FULL JD or abstain — LESSONS 2026-06-10). Unit-tested.
2. **No-fabrication injection** (pure): map each keyword to an EXISTING bullet it
   truthfully strengthens; if none, skip it. Output the injection plan + the
   skipped keywords (surfaced, like an abstain). Unit-tested with fixture bullets.
3. **Format/ATS Verifier** (maker/checker): parse the generated resume (markdown
   and/or the rendered PDF text) back and assert: every template section present,
   contact info matches profile.yml, injected keywords actually appear, no
   template placeholder leaked, length within page budget. One failure = flag.
4. **Cover-letter quality gate**: extend FORBIDDEN_PHRASES + verify the letter is
   grounded in real profile facts and names the company/role; abstain on a
   generic or rule-violating draft.
5. **PDF render check**: confirm the PDF generated (non-empty, expected page
   count), as a thin browser-exercised step (like the demo scripts).
6. A `demo:tailor` script (fixture profile, no real PII) showing tailor -> verify
   green for a sample JD, mirroring demo:autopilot.

## Tests first (vitest, pure, no real PII)
- Keyword extraction: full JD -> expected keywords; empty/stub JD -> abstain.
- Injection: a keyword with a truthful home is injected; one with none is skipped
  (no fabrication); claims are never altered.
- Verifier mutation test: a sabotaged output (dropped section / wrong contact /
  missing keyword) FAILS; a clean one passes.
- Cover-letter gate: a draft with a forbidden phrase or no company mention fails.

## Exit gate
Tailoring produces a resume + cover letter that the Verifier passes for a sample
JD; a deliberately sabotaged output fails the Verifier (mutation test); no
fabrication path exists; typecheck clean; full suite green; adversarial review
clean; lessons appended. Then the tailoring output feeds the existing pipeline
(pdfPath/coverLetterPath on the queued Application) and the apply engine.

## Out of scope
The apply engine, portals, sourcing (all done M3-M5). LinkedIn (never).
