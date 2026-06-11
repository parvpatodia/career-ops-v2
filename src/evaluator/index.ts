/**
 * Evaluator CLI entry point.
 * Usage: npm run eval -- --job-id [id] | --top [n] | --batch
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Evaluator } from './Evaluator.js';
import { Logger } from '../utils/Logger.js';
import type { Job, EvaluationResult } from '../types.js';

const log = new Logger('evaluator:index');
const evaluator = new Evaluator();

function loadTodayJobs(): Job[] {
  const today = new Date().toISOString().split('T')[0];
  const logDir = 'data/daily_log';
  if (!fs.existsSync(logDir)) return [];

  const files = fs.readdirSync(logDir)
    .filter((f) => f.startsWith(today) && f.endsWith('.json'));

  const jobs: Job[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(logDir, file), 'utf8')) as
        | Job[]
        | { jobs: Job[] };
      const arr = Array.isArray(data) ? data : data.jobs;
      jobs.push(...arr);
    } catch {
      // skip malformed cache files
    }
  }
  return jobs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topN = args.includes('--top')
    ? parseInt(args[args.indexOf('--top') + 1] ?? '10', 10)
    : null;
  const jobId = args.find((a) => a.startsWith('--job-id='))?.split('=')[1];
  const batch = args.includes('--batch');

  const jobs = loadTodayJobs();
  if (jobs.length === 0) {
    log.warn('No jobs found. Run scanner first: npm run scan');
    process.exit(0);
  }

  let targets: Job[] = jobs;

  if (jobId) {
    targets = jobs.filter((j) => j.id === jobId);
    if (targets.length === 0) {
      log.error(`Job ID not found: ${jobId}`);
      process.exit(1);
    }
  }

  const results: EvaluationResult[] = [];

  for (const job of targets) {
    const variant = evaluator.selectVariant(job.title);
    const result = evaluator.evaluate(job, variant);
    results.push(result);
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Apply top N filter
  const output = topN ? results.slice(0, topN) : results;

  // Print ranked results
  console.log('\n=== EVALUATION RESULTS ===\n');
  for (const r of output) {
    const job = jobs.find((j) => j.id === r.jobId);
    const status = r.shouldApply ? 'APPLY' : 'SKIP';
    console.log(`[${r.score}/100] ${status} — ${job?.company} | ${job?.title}`);
    console.log(`  Variant: ${r.resumeVariant} | Skills: ${r.breakdown.skillMatch}% | Visa: ${r.breakdown.visaMatch}%`);
    console.log(`  ${r.reasoning}`);
    if (r.topMatchingSkills.length > 0) {
      console.log(`  Matching: ${r.topMatchingSkills.join(', ')}`);
    }
    if (r.missingSkills.length > 0) {
      console.log(`  Missing: ${r.missingSkills.join(', ')}`);
    }
    console.log();
  }

  console.log(JSON.stringify({ count: output.length, results: output }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
