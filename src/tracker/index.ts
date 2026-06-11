/**
 * Tracker CLI entry point.
 * Usage:
 *   npm run track -- --status applied --id 001
 *   npm run stats -- --period week
 */

import 'dotenv/config';
import { Tracker } from './Tracker.js';
import type { ApplicationStatus } from '../types.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('tracker:index');

const VALID_STATUSES: ApplicationStatus[] = [
  'Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tracker = new Tracker();

  // stats mode
  if (args[0] === '--stats' || args[0] === 'stats') {
    const period = (args[1] as 'today' | 'week' | 'month' | 'all') ?? 'today';
    tracker.printStats(period);
    return;
  }

  // summary mode
  if (args[0] === 'summary' || args[0] === '--summary') {
    console.log(tracker.pipelineSummary());
    return;
  }

  // pending mode
  if (args[0] === 'pending' || args[0] === '--pending') {
    const pending = tracker.getPending();
    if (pending.length === 0) {
      console.log('No applications pending action.');
    } else {
      console.log(`${pending.length} evaluated, waiting for your decision:\n`);
      for (const app of pending) {
        console.log(`  [${app.id}] ${app.company} — ${app.role} (${app.score}/100)`);
        console.log(`        ${app.url}`);
      }
    }
    return;
  }

  // update mode: npm run track -- 001 Applied
  const id = args[0];
  const statusArg = args[1] as ApplicationStatus | undefined;
  const notes = args.slice(2).join(' ') || undefined;

  if (!id || !statusArg) {
    console.log('Usage:');
    console.log('  npm run track -- <id> <status> [notes]');
    console.log('  npm run stats -- [today|week|month|all]');
    console.log('  npm run track -- summary');
    console.log('  npm run track -- pending');
    console.log(`\nValid statuses: ${VALID_STATUSES.join(', ')}`);
    process.exit(0);
  }

  if (!VALID_STATUSES.includes(statusArg)) {
    log.error(`Invalid status: ${statusArg}. Valid: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  if (statusArg === 'Applied') {
    const { ok, todayCount } = tracker.checkDailyLinkedInLimit();
    if (!ok) {
      log.warn(`Daily LinkedIn limit reached (${todayCount}/25). Proceeding anyway — verify this is not LinkedIn Easy Apply.`);
    }
    tracker.markApplied(id);
  } else {
    tracker.updateStatus(id, statusArg, notes);
  }

  const updated = tracker.getApplication(id);
  if (updated) {
    console.log(`Updated: [${updated.id}] ${updated.company} — ${updated.role} → ${updated.status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
