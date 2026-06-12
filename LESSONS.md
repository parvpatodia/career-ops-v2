# LESSONS.md, append-only defect and decision log
> Every agent and every session reads this before building anything. One line per lesson, newest last.
> Format: date | source | lesson | enforcement

- 2026-06-10 | audit | 8,600 lines of source were never committed; work without version control does not exist | commit at every green test run
- 2026-06-10 | audit | Silent fallbacks are worse than failures: first-option dropdown clicks, hardcoded readyForSubmit:true, substring matches answering legal questions wrong | verify-or-abstain invariant; no fallback may report success
- 2026-06-10 | audit | No fill was ever read back from the DOM; success was assumed | every field read back post-fill; checker independent of filler
- 2026-06-10 | audit | Three sources of truth for personal facts disagreed (GPA 3.85 vs 3.917, YoE 1 vs 2, discipline CS vs AI) | profile.yml is the only source; tests pin its values
- 2026-06-10 | audit | One corrupt JSON parse could wipe the entire tracker via three separate code paths | event-log store, atomic writes, single writer (M1)
- 2026-06-10 | audit | Live credentials sat in un-gitignored .env on a repo with a public remote | secrets policy in AGENTS.md; rotate immediately on exposure
- 2026-06-10 | audit | Scoring ran on 2-line stub JDs so the quality gate passed everything: 349 of 370 jobs jammed the Ready queue | rankers consume full JD text or abstain from scoring
- 2026-06-10 | audit | The suite sat red for weeks on a true-data regression (GPA) and taught nothing | tests green before commit, no exceptions
- 2026-06-10 | market | Every blind auto-submitter died: AIHawk archived 5/2026, LazyApply at 1.9 stars, Sonara dead 2/2024; survivors gate on consent and receipts | submit only batch-approved plus verifier-green, write receipts
- 2026-06-10 | market | LinkedIn Easy Apply automation produces documented account bans since late 2025 | LinkedIn excluded from the automation surface
- 2026-06-10 | market | Ashby's API silently drops applications when the response success field goes unchecked | check the ATS confirmation on every submit path
- 2026-06-10 | market | Application volume is now negative-value: Greenhouse ships spam scoring (Real Talent), recruiters reject LLM boilerplate on sight | quality-gated low volume, tailored from real profile facts only
- 2026-06-11 | M0 | CI invoked a file that never existed for the project's whole life; nobody noticed because it only ran on PRs that were never opened | CI runs on push and PR and runs the exact command devs run locally
- 2026-06-11 | M0 gate | Fresh-clone gate caught 15 failures the local run hid: Evaluator and Tailor tests read gitignored cv/ files | every suite touching gitignored personal data carries a skipIf guard; the gate is a fresh clone, never the dev machine
- 2026-06-11 | M1 review | Independent review of a green, typechecked diff still found 6 real defects (lock-steal race, error-as-duplicate swallow, ambiguous-id misroute, tmp collision, falsy-zero score, submitted-flag divergence) | maker/checker on every milestone diff before commit; green tests are necessary, never sufficient
- 2026-06-11 | M1 review | The same status sets were hand-copied into four files and had already diverged within one PR | domain constants live in exactly one module (src/store/events.ts); grep for duplicates before adding any constant
- 2026-06-11 | M1 ops | vitest OOM-crashed crawling the whole home directory because the shell cwd silently reset and npx fell back to a fetched latest version | every loop command uses absolute paths or an explicit cd; never bare npx outside the repo
- 2026-06-11 | M1 deferred | Efficiency debt recorded, fine at ~1k events, wrong shape for M3 scale: per-append full-log refold, no appendMany, per-item view persist in batch loops; plus design debt: atomic multi-event append with correlation id needed for M2 receipts, append() should return a verdict instead of throwing for expected no-ops | address in M2 store extension before the Greenhouse adapter writes receipts
- 2026-06-12 | freshness | The entire 331-job Ready queue was 38+ days old: every queued application was dead inventory by the 14-day rule | hard freshness gate at the pipeline + npm run expire on the queue; queue size is a vanity metric, queue AGE is the real one
