/**
 * `npm run source` — the v2 sourcing entry: turns today's scan cache into an
 * M6-tailored Ready queue through the SourcingPipeline + Orchestrator, so the
 * queue is verify-or-abstain quality by default (no --tailor needed at apply).
 *
 * The coherent v2 flow:
 *   npm run scan        find jobs (board APIs + scrapers) -> data/daily_log cache
 *   npm run source      THIS: freshness + term + score gates -> M6 tailor -> queue
 *   npm run run --approve  fill + INDEPENDENTLY verify -> gated submit
 *
 * Usage:
 *   npm run source                  process today's scan cache
 *   npm run source -- --all-days    process every cached scan file
 *   npm run source -- --dry-run     preview the gates without tailoring/queueing
 *   npm run source -- --limit 20    cap raw inputs (discovery order) before gates
 *   npm run source -- --top 10      tailor only the 10 HIGHEST-SCORING fresh jobs
 *
 * Requires config/profile.yml + config/scoring.yml + cv/ (gitignored, present on
 * Parv's machine). The legacy `npm run pipeline` (v1 tailoring) remains as a
 * fallback. No real PII ever enters the repo or tests.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { SourcingPipeline } from './SourcingPipeline.js';
import { Orchestrator } from './Orchestrator.js';
import { FreshnessFilter } from '../pipeline/FreshnessFilter.js';
import { TermFilter } from '../pipeline/TermFilter.js';
import { VariantClassifier } from '../pipeline/VariantClassifier.js';
import { Evaluator } from '../evaluator/Evaluator.js';
import { Tailor } from '../tailor/Tailor.js';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { Notifier } from '../applier/Notifier.js';
import type { Job, EvaluationResult, ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('source');
const CACHE_DIR = 'data/daily_log';

/** Load + dedupe sourced jobs from the scan cache (today, or all days). */
function loadJobs(allDays: boolean): Job[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const today = new Date().toISOString().split('T')[0]!;
  const files = fs.readdirSync(CACHE_DIR).filter((f) => {
    if (!f.endsWith('.json') || f.includes('ops')) return false;
    return allDays || f.startsWith(today);
  });

  const all: Job[] = [];
  for (const file of files) {
    try {
      all.push(...(JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8')) as Job[]));
    } catch {
      log.warn(`Could not parse cache file: ${file}`);
    }
  }
  const seen = new Set<string>();
  const unique = all.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
  log.info(`Loaded ${unique.length} unique jobs from ${files.length} cache file(s)`);
  return unique;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allDays = args.includes('--all-days');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0', 10) : 0;
  const topIdx = args.indexOf('--top');
  const topN = topIdx !== -1 ? parseInt(args[topIdx + 1] ?? '0', 10) : 0;

  let jobs = loadJobs(allDays);
  if (limit > 0) jobs = jobs.slice(0, limit);
  if (jobs.length === 0) {
    log.info('No jobs in the scan cache. Run `npm run scan` first (or use --all-days).');
    return;
  }

  // Compose evaluate = classify variant + score. Real config required.
  const classifier = new VariantClassifier();
  const evaluator = new Evaluator('config/scoring.yml');
  const evaluate = (job: Job): EvaluationResult => {
    const variant = classifier.classify(job.title, job.jd) as ResumeVariant;
    return evaluator.evaluate(job, variant);
  };

  const store = new ApplicationStore();
  const orchestrator = new Orchestrator({
    tailor: new Tailor(),                // M6 verify-or-abstain (config/profile.yml + cv/)
    apps: store,
    notifier: new Notifier(),
    inbox: new AnswerInbox(),
    // No sessions/answers: this run tailors + queues only; apply is `npm run run`.
  });

  const pipeline = new SourcingPipeline({
    freshness: new FreshnessFilter(),
    term: new TermFilter(),
    evaluate,
    orchestrator,
  });

  console.log(`\nSourcing ${jobs.length} job(s)${dryRun ? '  [DRY RUN — no tailoring/queueing]' : '  [M6 tailor -> queue]'}${topN > 0 ? `  [top ${topN} by score]` : ''}\n`);
  const s = await pipeline.run(jobs, { dryRun, ...(topN > 0 ? { topN } : {}) });

  console.log('\n─── Summary ───');
  console.log(`  ${dryRun ? 'would queue' : 'queued'}        : ${s.queued}`);
  if (!dryRun) console.log(`  tailor-abstained : ${s.tailorAbstained}`);
  console.log(`  below score      : ${s.skippedScore}`);
  console.log(`  off-term         : ${s.offTerm}`);
  console.log(`  stale (>14d)     : ${s.stale}`);
  if (s.alreadySubmitted > 0) console.log(`  already submitted: ${s.alreadySubmitted}`);
  console.log(`  total sourced    : ${s.total}`);
  if (!dryRun && s.queued > 0) console.log(`\nQueue ready. Apply with: npm run run -- --approve`);
}

main().catch((err) => { console.error(err); process.exit(1); });
