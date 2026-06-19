/**
 * `npm run outreach:plan` — the sourcing + drafting brain, in code. It pulls
 * real people from the target companies (Hunter), verifies their addresses,
 * drafts gate-ready cold emails, and builds the LinkedIn copy-paste pack from
 * arXiv researchers. Output: data/outreach/drafts/<date>/*.json and
 * data/outreach/linkedin-<date>.md. Then `npm run outreach:send` sends them.
 *
 *   npm run outreach:plan                 today's plan
 *   npm run outreach:plan -- --dry-run    source + draft, write nothing
 *   npm run outreach:plan -- --emails 5 --linkedin 5
 *   npm run outreach:plan -- --targets config/outreach-targets.yml
 *
 * Setup: .env needs HUNTER_API_KEY. config/outreach-targets.yml lists companies
 * + arXiv queries (copy the .example). config/outreach-snippets.yml holds the
 * approved self-claims (without it, emails cannot be grounded and are skipped).
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { HunterClient } from '../HunterClient.js';
import { CompanySourcer, type CompanyTarget } from '../sources/CompanySourcer.js';
import { ArxivSourcer, type ArxivQuery } from '../sources/ArxivSourcer.js';
import { Drafter } from '../Drafter.js';
import { SnippetBook } from '../SnippetBook.js';
import { OutreachStore } from '../OutreachStore.js';
import type { Candidate, EmailDraft, LinkedInDraft } from '../types.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

interface Targets {
  companies?: CompanyTarget[];
  arxiv?: ArxivQuery[];
}

function loadTargets(file: string): Targets {
  if (!fs.existsSync(file)) {
    console.log(`No targets file at ${file}. Copy config/outreach-targets.example.yml to config/outreach-targets.yml.`);
    process.exit(1);
  }
  return (yaml.load(fs.readFileSync(file, 'utf8')) as Targets) ?? {};
}

async function main(): Promise<void> {
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10);
  const dryRun = process.argv.includes('--dry-run');
  const emailLimit = arg('--emails') ? parseInt(arg('--emails')!, 10) : 5;
  const linkedinLimit = arg('--linkedin') ? parseInt(arg('--linkedin')!, 10) : 5;
  const targets = loadTargets(arg('--targets') ?? 'config/outreach-targets.yml');

  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey && (targets.companies?.length ?? 0) > 0) {
    console.log('No HUNTER_API_KEY in .env. Company sourcing needs it; arXiv works without it.');
  }
  const hunter = apiKey ? new HunterClient({ apiKey }) : null;
  const store = new OutreachStore();
  const drafter = new Drafter(SnippetBook.fromYaml());

  // 1. Source company contacts (real emails) and arXiv researchers (hooks only).
  const companyCandidates: Candidate[] = [];
  if (hunter) {
    const sourcer = new CompanySourcer(hunter);
    for (const t of targets.companies ?? []) {
      try {
        companyCandidates.push(...(await sourcer.source(t)));
      } catch (err) {
        console.log(`  ${t.company}: ${(err as Error).message}`);
      }
    }
  }
  const arxiv = new ArxivSourcer();
  const researchers: Candidate[] = [];
  for (const q of targets.arxiv ?? []) {
    try {
      researchers.push(...(await arxiv.source(q)));
    } catch (err) {
      console.log(`  arXiv "${q.query}": ${(err as Error).message}`);
    }
  }

  // 2. Pick up to emailLimit emailable candidates, marking `seen` ONLY for the
  //    ones we actually keep. WHY a capped loop, not filter().slice(): a filter
  //    with a seen-mutating predicate marks every candidate it inspects before
  //    the slice, so company contacts past the cap would be flagged seen and
  //    then silently dropped from the LinkedIn pool too (contacted on neither
  //    channel). Marking only the kept ones leaves the rest available below.
  const seen = new Set<string>();
  const takeFresh = (pool: Candidate[], limit: number, needEmail: boolean): Candidate[] => {
    const picked: Candidate[] = [];
    for (const c of pool) {
      if (picked.length >= limit) break;
      if (needEmail && !c.email) continue;
      const id = Drafter.contactId(c);
      if (seen.has(id) || store.isSuppressed(id)) continue;
      seen.add(id);
      picked.push(c);
    }
    return picked;
  };
  const emailable = takeFresh(companyCandidates, emailLimit, true);

  // 3. Verify each address so the gate's "valid" check has real data.
  if (hunter) {
    for (const c of emailable) {
      try {
        const v = await hunter.emailVerifier(c.email!);
        c.emailStatus = v.status as Candidate['emailStatus'];
        if (v.score) c.emailConfidence = v.score;
      } catch {
        c.emailStatus = 'unknown';
      }
    }
  }

  // 4. Compose email drafts.
  const drafts: EmailDraft[] = [];
  const skipped: string[] = [];
  for (const c of emailable) {
    // Gmail is the reliable SMTP transport; Outlook app-password SMTP is being
    // retired by Microsoft, so route everything through Gmail until OAuth lands.
    const r = drafter.email(c, 'gmail');
    if ('draft' in r) drafts.push(r.draft);
    else skipped.push(`${c.email} (${c.segment}): ${r.skip}`);
  }

  // 5. Build the LinkedIn pack from researchers and any company contacts not
  //    already emailed above (their ids are in `seen`, so they are excluded here,
  //    which prevents emailing AND DMing the same person).
  const linkedinPool = takeFresh([...researchers, ...companyCandidates], linkedinLimit, false);
  const dms: LinkedInDraft[] = linkedinPool.map((c) => drafter.linkedin(c));

  // 6. Write artifacts (unless dry-run).
  if (dryRun) {
    console.log(`Dry run for ${date}: ${drafts.length} email draft(s), ${dms.length} LinkedIn DM(s). Nothing written.\n`);
    for (const d of drafts) console.log(`  EMAIL    ${d.to}  [${d.emailStatus}]  ${d.subject}`);
    for (const m of dms) console.log(`  LINKEDIN ${m.name}  (${m.segment})`);
    if (skipped.length) console.log(`  skipped: ${skipped.join('; ')}`);
    return;
  }

  const draftsDir = path.join('data/outreach/drafts', date);
  fs.mkdirSync(draftsDir, { recursive: true });
  for (const d of drafts) {
    fs.writeFileSync(path.join(draftsDir, `${d.contactId}.json`), JSON.stringify(d, null, 2));
  }
  if (dms.length) {
    fs.mkdirSync('data/outreach', { recursive: true });
    fs.writeFileSync(path.join('data/outreach', `linkedin-${date}.md`), renderPack(date, dms));
  }

  console.log(`Wrote ${drafts.length} email draft(s) to ${draftsDir} and ${dms.length} LinkedIn DM(s).`);
  console.log(`Next: npm run outreach:send -- --dry-run --date ${date}   (then drop --dry-run to send).`);
  if (skipped.length) console.log(`Skipped: ${skipped.join('; ')}`);
}

function renderPack(date: string, dms: LinkedInDraft[]): string {
  const lines = [`# LinkedIn DMs ${date}`, '', 'Copy, open the profile, paste, send. No automation.', ''];
  for (const m of dms) {
    lines.push(`## ${m.name} (${m.segment})`, `Profile: ${m.linkedinUrl}`, '', m.message, '');
  }
  return lines.join('\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
