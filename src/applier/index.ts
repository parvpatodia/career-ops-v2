/**
 * Apply CLI — reads the Ready queue, opens each job's form, fills it,
 * stops before submit. User clicks Submit.
 *
 * Usage:
 *   npm run apply                             → fill next 5 Ready jobs
 *   npm run apply -- --batch 20              → fill next 20
 *   npm run apply -- --job 007               → fill one specific ID
 *   npm run apply -- --from 026              → start queue from ID 026
 *   npm run apply -- --mark-applied 001,002  → mark IDs as Applied (no browser)
 *   npm run apply -- --stats                 → show queue breakdown
 *
 * HARD RULE: This CLI NEVER submits. It fills + stops. User clicks Submit.
 */

import 'dotenv/config';
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { Applier } from './Applier.js';
import { GreenhouseHandler } from './GreenhouseHandler.js';
import { LeverHandler } from './LeverHandler.js';
import { WorkdayHandler } from './WorkdayHandler.js';
import { EasyApplyHandler } from './EasyApplyHandler.js';
import { GenericHandler } from './GenericHandler.js';
import { AshbyHandler } from './AshbyHandler.js';
import { HandshakeHandler } from './HandshakeHandler.js';
import { UrlResolver } from './UrlResolver.js';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import type { Application, Job, TailoringResult } from '../types.js';
import type { ApplyContext } from './Applier.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('apply');
const store = new ApplicationStore();
const resolver = new UrlResolver();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    printStats();
    return;
  }

  const markIdx = args.indexOf('--mark-applied');
  if (markIdx !== -1) {
    const ids = (args[markIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    markApplied(ids);
    return;
  }

  const jobIdx = args.indexOf('--job');
  const targetId = jobIdx !== -1 ? (args[jobIdx + 1] ?? null) : null;

  const batchIdx = args.indexOf('--batch');
  const batchSize = batchIdx !== -1 ? parseInt(args[batchIdx + 1] ?? '5', 10) : 5;

  const fromIdx = args.indexOf('--from');
  const fromId = fromIdx !== -1 ? (args[fromIdx + 1] ?? null) : null;

  const allApps = loadApplications();

  // F-1 visa cannot qualify for US-Person roles (ITAR, security clearances, etc.)
  const INELIGIBLE_KEYWORDS = [
    'us citizen', 'u.s. citizen', 'united states citizen',
    'security clearance', 'secret clearance', 'top secret', 'ts/sci',
    'itar', 'ear compliance', 'us person', 'u.s. person',
    'must be eligible to work on itar', 'export control',
  ];
  const isIneligible = (app: Application): boolean => {
    const notes = ((app as unknown as Record<string, unknown>)['notes'] as string) ?? '';
    const haystack = `${app.role} ${app.company} ${notes}`.toLowerCase();
    return INELIGIBLE_KEYWORDS.some((kw) => haystack.includes(kw));
  };

  let queue: Application[];
  if (targetId) {
    const found = allApps.find((a) => a.id === targetId || a.jobId === targetId);
    if (!found) { log.error(`Application "${targetId}" not found`); process.exit(1); }
    if (isIneligible(found)) {
      log.warn(`Skipping ${found.id} (${found.company}): requires US citizenship/clearance — F-1 not eligible`);
      process.exit(0);
    }
    queue = [found];
  } else {
    let ready = allApps.filter((a) => a.status === 'Ready');
    const skipped = ready.filter(isIneligible);
    if (skipped.length > 0) {
      log.info(`Auto-skipping ${skipped.length} job(s) requiring US citizenship/clearance: ${skipped.map((a) => a.id).join(', ')}`);
    }
    ready = ready.filter((a) => !isIneligible(a));
    if (fromId) {
      const fi = ready.findIndex((a) => a.id === fromId);
      if (fi !== -1) ready = ready.slice(fi);
    }
    queue = ready.slice(0, batchSize);
  }

  if (queue.length === 0) {
    log.info('Queue is empty. Run npm run pipeline first to populate it.');
    printStats();
    return;
  }

  log.info(`Opening ${queue.length} application(s) (batch size: ${batchSize})`);
  console.log('\nREMINDER: Forms will be filled and STOPPED. YOU click Submit.\n');

  const isInteractive = process.stdin.isTTY === true;
  const rl = isInteractive ? createInterface({ input: stdin, output: stdout }) : null;
  const appliedIds: string[] = [];

  for (let i = 0; i < queue.length; i++) {
    const app = queue[i]!;

    // Resolve URL before detecting ATS — converts Handshake search pages
    // to posting URLs, adds Greenhouse detection for custom domains, etc.
    const resolved = resolver.resolve(app.url);
    const atsType = resolved.ats;

    if (resolved.wasResolved) {
      log.info(`URL resolved: ${app.url.slice(0, 80)} → ${resolved.url}`);
    }

    console.log(`\n─────────────────────────────────────────`);
    console.log(`[${i + 1}/${queue.length}] ${app.company} — ${app.role}`);
    console.log(`  ID:      ${app.id}`);
    console.log(`  ATS:     ${atsType.toUpperCase()}`);
    console.log(`  Resume:  ${app.pdfPath ?? 'none'}`);
    console.log(`  Cover:   ${app.coverLetterPath ?? 'none'}`);
    console.log(`  URL:     ${resolved.url}`);
    console.log(`─────────────────────────────────────────`);

    const context = buildContext(app, resolved.url);
    const handler = getHandler(atsType);

    let result: Awaited<ReturnType<typeof handler.fillAndStop>> | null = null;
    try {
      result = await handler.fillAndStop(context);
    } catch (err) {
      log.warn(`Fill failed for ${app.id} (${app.company}): ${(err as Error).message}`);
      console.log('  ⚠  Automatic fill failed. Open URL manually:');
      console.log(`     ${resolved.url}`);
    }

    // Posting was taken down — mark Closed and move on without prompting.
    if (result?.closed) {
      console.log(`  ✗  Posting no longer exists — marked Closed, moving to next.\n`);
      markClosed([app.id]);
      continue;
    }

    if (rl) {
      if (i < queue.length - 1) {
        const answer = await rl.question('\nDid you submit this application? (y/n) ').catch(() => '');
        if (answer.trim().toLowerCase() === 'y') {
          appliedIds.push(app.id);
          markApplied([app.id]);
          console.log(`  ✓ ${app.id} marked as Applied`);
        }
        const cont = await rl.question('Open next? (Enter = yes, q = stop) ').catch(() => '');
        if (cont.trim().toLowerCase() === 'q') { log.info('Session paused.'); break; }
      } else {
        const answer = await rl.question('\nDid you submit this last application? (y/n) ').catch(() => '');
        if (answer.trim().toLowerCase() === 'y') {
          appliedIds.push(app.id);
          markApplied([app.id]);
          console.log(`  ✓ ${app.id} marked as Applied`);
        }
      }
    }
  }

  rl?.close();

  const pending = queue.filter((a) => !appliedIds.includes(a.id));
  console.log('\n═══════════════════════════════════════');
  console.log('Session complete.');
  console.log(`  Applied this session   : ${appliedIds.length}`);
  console.log(`  Pending (not submitted): ${pending.length}`);
  if (pending.length > 0) {
    console.log(`\nTo mark pending as applied later:`);
    console.log(`  npm run apply -- --mark-applied ${pending.map((a) => a.id).join(',')}`);
  }
  console.log('═══════════════════════════════════════\n');
}

function buildContext(app: Application, resolvedUrl: string): ApplyContext {
  const noteParts = ((app as unknown as Record<string, unknown>)['notes'] as string ?? '').split(' | ');
  const platform = (noteParts[0]?.trim() ?? 'direct') as Job['platform'];
  const location = noteParts[1]?.trim() ?? '';

  const job: Job = {
    id: app.jobId,
    title: app.role,
    company: app.company,
    url: resolvedUrl,
    applyUrl: resolvedUrl,
    platform,
    location,
    remote: location.toLowerCase().includes('remote'),
    postedAt: app.date,
    discoveredAt: app.date,
    // WHY empty jd: The pipeline currently stores a stub JD. This is used
    // by AnswerGenerator for contextual answers. After the pipeline fix
    // (score + jd fields), this will be populated.
    jd: (app as unknown as Record<string, unknown>)['jd'] as string ?? '',
    score: app.score,
    status: 'evaluated',
  };

  const tailoring: TailoringResult = {
    jobId: app.jobId,
    resumeVariant: app.resumeVariant,
    injectedKeywords: [],
    tailoredResumePath: app.pdfPath ?? '',
    pdfPath: app.pdfPath,
    coverLetterPath: app.coverLetterPath,
    tailoredAt: app.tailoredAt ?? new Date().toISOString(),
  };

  return { job, tailoring, pdfPath: app.pdfPath };
}

function getHandler(atsType: string): Applier {
  switch (atsType) {
    case 'greenhouse': return new GreenhouseHandler();
    case 'lever':      return new LeverHandler();
    case 'workday':    return new WorkdayHandler();
    case 'linkedin':   return new EasyApplyHandler();
    case 'ashby':      return new AshbyHandler();
    case 'handshake':  return new HandshakeHandler();
    default:           return new GenericHandler();
  }
}

// WHY no direct fs here anymore: all tracker writes go through the event
// log behind ApplicationStore (AGENTS.md invariant 4). v1's three unlocked
// writers could wipe the tracker on one corrupt parse.
function loadApplications(): Application[] {
  return store.getAll();
}

function markApplied(ids: string[]): void {
  if (ids.length === 0) return;
  let updated = 0;
  for (const id of ids) {
    try {
      store.update(id, { status: 'Applied', appliedAt: new Date().toISOString() });
      updated++;
    } catch (err) {
      log.warn(`Could not mark ${id} as Applied: ${(err as Error).message}`);
    }
  }
  log.info(`Marked ${updated}/${ids.length} as Applied`);
}

function markClosed(ids: string[]): void {
  if (ids.length === 0) return;
  for (const id of ids) {
    try {
      store.update(id, { status: 'Closed' });
    } catch (err) {
      log.warn(`Could not mark ${id} as Closed: ${(err as Error).message}`);
    }
  }
  log.info(`Marked ${ids.join(', ')} as Closed`);
}

function printStats(): void {
  const apps = loadApplications();
  const byStatus: Record<string, number> = {};
  const byAts: Record<string, number> = {};
  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
    const ats = resolver.resolve(app.url).ats;
    byAts[ats] = (byAts[ats] ?? 0) + 1;
  }
  console.log('\nApplication Queue:');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`  ${status.padEnd(12)} ${String(count).padStart(4)}  ${bar}`);
  }
  console.log('\nBy ATS:');
  for (const [ats, count] of Object.entries(byAts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ats.padEnd(12)} ${count}`);
  }
  console.log(`\n  Total: ${apps.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
