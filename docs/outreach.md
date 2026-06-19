# Outreach engine (cold email + LinkedIn)

A daily loop that sources real people in Parv's fields, drafts personalized cold
emails and LinkedIn DMs, and auto-sends the emails under a verify-or-abstain
gate. It reuses the job tracker's append-only log, single-writer lock, and
maker/checker discipline.

## What it does each day

1. Source candidates per segment (researchers, PhD/MS students, industry, recruiters).
2. Resolve their emails with Hunter.io and verify deliverability.
3. Draft 5 cold emails and 5 LinkedIn DMs, personalized, no AI-tells.
4. Gate every email. Send the green ones over SMTP. Park the rest for review.
5. Reconcile replies and bounces from the inbox; never contact anyone twice.

## Safety model (why this will not embarrass you)

- **Verify-or-abstain.** An email auto-sends only if: the address is Hunter
  `valid`, the StyleLinter finds no em-dash or AI-tell, every claim about Parv
  quotes an approved snippet that is actually in the body, the personalization
  is real and present, the contact was never contacted before, and the daily
  cap is not exceeded. Any miss routes the draft to `data/outreach/review/`.
- **No fabrication.** Claims about Parv come only from
  `config/outreach-snippets.yml` (human-approved). Until you fill that file, the
  gate abstains every draft. Recipient facts carry a `sourceUrl`.
- **Never a false "sent".** A send is recorded only after the SMTP server
  confirms delivery to that exact address. An unconfirmed send records nothing
  and notifies (the 2026-06-16 LIVE-submit lesson).
- **LinkedIn is copy-paste only.** People are found through public web search,
  never by logging a bot into LinkedIn (AGENTS.md invariant 5, documented bans).
  You paste and send the DMs yourself.
- **One contact, one cold email, ever.** Enforced by the OutreachStore guard.

## Setup (one time)

1. `.env` (gitignored) needs the Gmail/Outlook app passwords `npm run inbox`
   already uses, plus a Hunter key:
   ```
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
   OUTLOOK_USER=you@outlook.com         # optional; Gmail is the reliable primary
   OUTLOOK_APP_PASSWORD=xxxxxxxxxxxxxxxx
   HUNTER_API_KEY=xxxxxxxx
   ```
2. Copy and edit the approved-claims file:
   ```
   cp config/outreach-snippets.example.yml config/outreach-snippets.yml
   ```
   Edit every line so it is true and sounds like you. Empty file = gate abstains.
3. Copy and edit the target list (companies to email, arXiv topics to source):
   ```
   cp config/outreach-targets.example.yml config/outreach-targets.yml
   ```

## Commands

```
npm run outreach:account                       # Hunter quota (free, proves the key works)
npm run outreach:plan                          # source people + draft emails + build LinkedIn pack
npm run outreach:plan -- --dry-run             # source + draft, write nothing
npm run outreach:send -- --dry-run             # gate today's drafts, send nothing
npm run outreach:send                          # send the green ones, park the rest for review
npm run outreach:daily                         # plan then send, the full autonomous loop
npm run outreach:canary                        # live: send a test email to yourself, full chain
npm run inbox                                  # reconcile replies + bounces, suppress contacts
```

`outreach:plan` is the brain, and it is code, not a prompt: `CompanySourcer` pulls
real people from each target company via Hunter, `ArxivSourcer` pulls researchers
from the free arXiv API for the LinkedIn pack, and `Drafter` composes gate-ready
emails from your approved snippets plus the sourced hook. No LLM, no agent in the
loop. Schedule `outreach:daily` with cron/launchd for the hands-off loop.

Acceptance check: `npm run outreach:canary` puts a real email in your inbox and
prints `email_verified` then `email_sent` from a temp log.

## The daily run

`npm run outreach:daily` does it all in code, no agent in the loop:

1. `outreach:plan` reads `config/outreach-targets.yml`, sources company contacts
   via Hunter and researchers via arXiv, drops anyone already contacted, verifies
   each address, drafts the emails to `data/outreach/drafts/<date>/`, and writes
   the LinkedIn pack to `data/outreach/linkedin-<date>.md`.
2. `outreach:send` gates each draft and sends the green ones, parking the rest in
   `data/outreach/review/<date>/` with reasons.
3. `npm run inbox` (run on its own schedule) reconciles replies and bounces.

To schedule it hands-off, add a launchd/cron entry that runs `npm run outreach:daily`
in this repo each morning, and `npm run inbox` once more in the evening. Review the
LinkedIn pack by hand and send those DMs yourself.

An optional Claude run can replace `outreach:plan` when you want richer, hand-tuned
personalization for a specific batch: it writes the same `EmailDraft` JSON files
(grounding self-claims only in approved snippets, recipient facts carrying a
`sourceUrl`), then hands off to the same `outreach:send` gate.

## Architecture

- `src/store/JsonlLog.ts` — shared append-only log + lock + cache (extracted from EventStore).
- `src/outreach/events.ts` — outreach event vocabulary + `contactIdFor*` idempotency keys.
- `src/outreach/OutreachStore.ts` + `OutreachProjection.ts` — the outreach log and its guard
  (no duplicate send; no send to a bounced/opted-out contact).
- `src/outreach/HunterClient.ts` — Hunter v2 (domain-search, email-finder, email-verifier, account).
- `src/outreach/StyleLinter.ts` — deterministic AI-tell / em-dash checker.
- `src/outreach/SnippetBook.ts` — approved self-claims.
- `src/outreach/DraftGate.ts` — the verify-or-abstain auto-send gate.
- `src/outreach/Mailer.ts` — SMTP send; confirmed-only verdict.
- `src/outreach/OutreachSender.ts` — gate + send + receipts, daily cap, one recording layer.
- `src/outreach/sources/CompanySourcer.ts` — Hunter domain-search to real company contacts.
- `src/outreach/sources/ArxivSourcer.ts` — keyless arXiv query to researcher hooks.
- `src/outreach/Drafter.ts` — composes a candidate into a gate-ready email or LinkedIn DM.
- `src/outreach/DraftLoader.ts` — reads and validates the daily draft JSON.
- `src/outreach/OutreachInboxMatcher.ts` + `OutreachReconciler.ts` — reply/bounce reconcile.
- `src/outreach/cli/` — `account`, `plan`, `send`, `canary`.
