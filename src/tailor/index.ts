/**
 * Tailor CLI entry point.
 * Usage: npm run tailor -- --job-id [id]
 * The cover letter data is expected as JSON via stdin or --data flag.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Tailor } from './Tailor.js';
import { Evaluator } from '../evaluator/Evaluator.js';
import { Logger } from '../utils/Logger.js';
import type { Job, EvaluationResult } from '../types.js';

const log = new Logger('tailor:index');

function loadJob(jobId: string): Job | null {
  const logDir = 'data/daily_log';
  if (!fs.existsSync(logDir)) return null;
  for (const file of fs.readdirSync(logDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(logDir, file), 'utf8')) as
        | Job[]
        | { jobs: Job[] };
      const jobs = Array.isArray(data) ? data : data.jobs;
      const job = jobs.find((j) => j.id === jobId);
      if (job) return job;
    } catch { /* skip */ }
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jobId = args.find((a) => a.startsWith('--job-id='))?.split('=')[1]
    ?? args.find((a) => !a.startsWith('--'));

  if (!jobId) {
    log.error('Usage: npm run tailor -- --job-id <id>');
    process.exit(1);
  }

  const job = loadJob(jobId);
  if (!job) {
    log.error(`Job not found: ${jobId}. Run scanner first.`);
    process.exit(1);
  }

  const evaluator = new Evaluator();
  const evaluation: EvaluationResult = evaluator.evaluate(job, evaluator.selectVariant(job.title));

  if (!evaluation.shouldApply) {
    log.warn(`Score ${evaluation.score}/100 is below threshold. Not tailoring.`);
    process.exit(0);
  }

  const tailor = new Tailor();
  const result = await tailor.tailor(job, evaluation);

  console.log('\n=== TAILORING RESULT ===');
  console.log(`Resume: ${result.tailoredResumePath}`);
  console.log(`Variant: ${result.resumeVariant}`);
  console.log(`Verified: ${result.verified}  PDF: ${result.pdfPath ?? '(abstained)'}`);
  if (result.abstainReason) console.log(`Abstain reason: ${result.abstainReason}`);
  if (result.injectedKeywords.length > 0) {
    console.log('\nKeywords injected:');
    for (const inj of result.injectedKeywords) {
      console.log(`  - "${inj.keyword}" at ${inj.location}`);
      console.log(`    WHY: ${inj.reason}`);
    }
  }
  if (result.skippedKeywords && result.skippedKeywords.length > 0) {
    console.log(`\nKeywords skipped (no honest home): ${result.skippedKeywords.join(', ')}`);
  }
  if (result.coverLetterPath) {
    console.log(`\nCover letter: ${result.coverLetterPath}`);
  } else if (evaluation.shouldGenerateCoverLetter) {
    console.log('\nNote: Cover letter needs company-specific data. Run: cover [job_id]');
  }

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
