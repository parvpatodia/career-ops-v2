/**
 * `npm run outreach:linkedin` — the weekly "who to contact on LinkedIn for the
 * roles that are actually open" pack. It reads the SAME fresh, on-field, US,
 * F-1-eligible roles the command-center UI shows (JobFeedService.fresh — the one
 * accurate read boundary), groups them by company, and writes a copy-paste
 * markdown pack: per company, LinkedIn people-search links + a connection note +
 * a follow-up, all grounded in approved snippets.
 *
 *   npm run outreach:linkedin                  this week's pack
 *   npm run outreach:linkedin -- --dry-run     print a summary, write nothing
 *   npm run outreach:linkedin -- --companies 20
 *
 * No automation and no fabricated people (invariant 5 + the global no-LinkedIn
 * rule): Parv opens each search, finds the person, pastes, and sends himself.
 * Output goes to data/outreach/ (gitignored — third-party context stays local).
 */

import fs from 'fs';
import path from 'path';
import { ApplicationStore } from '../../tracker/ApplicationStore.js';
import { JobFeedService } from '../../ui/JobFeedService.js';
import { SnippetBook } from '../SnippetBook.js';
import { roleOutreachPacks, type RoleOutreachPack } from '../roleOutreach.js';
import { Notifier } from '../../applier/Notifier.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function renderPack(date: string, packs: RoleOutreachPack[]): string {
  const lines = [
    `# LinkedIn outreach — week of ${date}`,
    '',
    `${packs.length} compan${packs.length === 1 ? 'y' : 'ies'} hiring for roles you match. ` +
      'For each: open a search, find a recruiter or engineer, send the connection note, ' +
      'then the follow-up once they accept. No automation — you paste and send.',
    '',
  ];
  for (const p of packs) {
    lines.push(`## ${p.company} — ${p.category}`);
    lines.push(`Open roles: ${p.roles.join('; ')}`);
    if (p.applyUrl) lines.push(`Posting: ${p.applyUrl}`);
    lines.push('', 'Find people:');
    for (const s of p.searches) lines.push(`- ${s.label}: ${s.url}`);
    lines.push('', '**Connection note** (copy-paste):', '', `> ${p.connectionNote}`);
    lines.push('', '**Follow-up after they accept** (copy-paste):', '', `> ${p.followUp}`, '');
  }
  return lines.join('\n');
}

function main(): void {
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10);
  const dryRun = process.argv.includes('--dry-run');
  const maxCompanies = arg('--companies') ? parseInt(arg('--companies')!, 10) : 15;

  // Reuse the UI's read boundary so outreach targets are exactly the accurate,
  // on-field, US, fresh roles shown in the command center (fresh() ignores the
  // store, so no queue state is touched here).
  const fresh = new JobFeedService(new ApplicationStore()).fresh(200);
  const packs = roleOutreachPacks(fresh, SnippetBook.fromYaml(), { maxCompanies });

  if (packs.length === 0) {
    console.log('No fresh on-field roles to build outreach from yet. Let the watcher catch some, then re-run.');
    return;
  }

  if (dryRun) {
    console.log(`Dry run for ${date}: ${packs.length} company pack(s). Nothing written.\n`);
    for (const p of packs) console.log(`  ${p.company} (${p.category}) — ${p.roles.length} role(s)`);
    return;
  }

  fs.mkdirSync('data/outreach', { recursive: true });
  const packPath = path.join('data/outreach', `linkedin-roles-${date}.md`);
  fs.writeFileSync(packPath, renderPack(date, packs));
  new Notifier().notify({
    kind: 'batch_complete',
    title: 'Outreach: weekly LinkedIn pack ready',
    message: `${packs.length} companies for ${date}. Open ${packPath}, copy, connect.`,
    urgent: false,
  });
  console.log(`Wrote ${packs.length} company pack(s) to ${packPath}. Open it, copy, and connect.`);
}

main();
