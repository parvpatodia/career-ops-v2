/**
 * Pipeline CLI — scan output → quality gate → cover letters → apply queue.
 *
 * Usage:
 *   npm run prep           → generate 5 variant PDFs once
 *   npm run pipeline       → process today's scan into apply queue
 *   npm run pipeline -- --dry-run   → preview without writing
 *   npm run pipeline -- --all-days  → process all cached scan files, not just today
 *
 * WHY Evaluator is now called here:
 * Previously score was hardcoded to 0 for every job, which meant:
 * (a) the citizenship/ITAR keyword filter had no quality signal backing it,
 * (b) shouldApply was never computed, so sub-threshold jobs flooded the queue,
 * (c) AnswerGenerator in the apply loop had no JD context for answers.
 *
 * Now we evaluate each job, gate on shouldApply, and store score + jd in
 * applications.json so the apply loop can use them.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { VariantClassifier } from './VariantClassifier.js';
import { FreshnessFilter } from './FreshnessFilter.js';
import { CoverLetterPersonalizer } from './CoverLetterPersonalizer.js';
import { prepareResumes } from './PrepareResumes.js';
import { Evaluator } from '../evaluator/Evaluator.js';
import type { Job } from '../types.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('pipeline');

const CACHE_DIR = 'data/daily_log';
const OUTPUT_DIR = 'output/resumes';
const APPLICATIONS_JSON = 'data/applications.json';
const APPLICATIONS_MD = 'data/applications.md';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const allDays = args.includes('--all-days');

  if (args[0] === 'prep') {
    await prepareResumes();
    return;
  }

  // Ensure variant PDFs exist
  const missingPdfs = ['parv-master', 'parv-ai', 'parv-ml', 'parv-robotics', 'parv-ta']
    .filter((name) => !fs.existsSync(path.join(OUTPUT_DIR, `${name}.pdf`)));
  if (missingPdfs.length > 0) {
    log.info(`Missing variant PDFs: ${missingPdfs.join(', ')} — running prep...`);
    await prepareResumes();
  }

  // Load jobs from scan cache
  const today = new Date().toISOString().split('T')[0]!;
  const allJobs: Job[] = [];
  const cacheFiles = fs.readdirSync(CACHE_DIR)
    .filter((f) => {
      if (!f.endsWith('.json') || f.includes('ops')) return false;
      return allDays || f.startsWith(today);
    });

  for (const file of cacheFiles) {
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8')) as Job[];
      allJobs.push(...jobs);
    } catch {
      log.warn(`Could not parse cache file: ${file}`);
    }
  }

  // Deduplicate by ID across all cache files
  const seen = new Set<string>();
  const unique = allJobs.filter((j) => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });
  log.info(`Loaded ${unique.length} unique jobs from ${cacheFiles.length} cache file(s)`);

  // Freshness filter — stale jobs are not worth applying to
  const filter = new FreshnessFilter();
  const { fresh, stale } = filter.filter(unique);
  log.info(`Fresh (≤14d, MAANG/AI firms ≤60d): ${fresh.length} | Stale (skipped): ${stale.length}`);

  // Skip jobs already tracked
  const existingIds = loadExistingJobIds();
  const toProcess = fresh.filter((j) => !existingIds.has(j.id));
  log.info(`New jobs to process: ${toProcess.length} (${fresh.length - toProcess.length} already tracked)`);

  if (toProcess.length === 0) {
    log.info('Nothing new to process. Run npm run scan first, or use --all-days to reprocess.');
    return;
  }

  // ── Evaluate + gate ─────────────────────────────────────────────────────
  const evaluator = new Evaluator('config/scoring.yml');
  const classifier = new VariantClassifier();
  const personalizer = new CoverLetterPersonalizer();

  const results: ProcessedJob[] = [];
  let skippedByScore = 0;

  for (const job of toProcess) {
    const variant = classifier.classify(job.title, job.jd);

    // WHY evaluate before classify: The evaluator picks the same variant
    // internally but we keep VariantClassifier as the authoritative source
    // for the filename (parv-ai.pdf etc.). Evaluator.selectVariant is used
    // for the evaluation reasoning only.
    const evaluation = evaluator.evaluate(job, variant);

    if (!evaluation.shouldApply) {
      log.info(
        `SKIP ${job.company} — ${job.title}: score ${evaluation.score}/100 — ${evaluation.reasoning}`
      );
      skippedByScore++;
      continue;
    }

    const pdfPath = path.join(OUTPUT_DIR, `parv-${variant}.pdf`);
    let coverLetterPath: string | undefined;

    if (!isDryRun) {
      try {
        coverLetterPath = personalizer.personalize(job.id, job.title, job.company, variant);
      } catch (err) {
        log.warn(`Cover letter failed for ${job.id}: ${(err as Error).message}`);
      }
    }

    results.push({ job, variant, pdfPath, coverLetterPath, score: evaluation.score });

    if (isDryRun) {
      log.info(`[DRY RUN] ${job.company} — ${job.title} → variant=${variant} score=${evaluation.score}/100`);
    }
  }

  log.info(`Quality gate: ${results.length} passed, ${skippedByScore} skipped (below threshold)`);

  if (isDryRun) {
    printVariantSummary(results);
    return;
  }

  if (results.length === 0) {
    log.info('No jobs passed the quality gate. Lower scoring.yml thresholds or run a new scan.');
    return;
  }

  // ── Persist to queue ─────────────────────────────────────────────────────
  const today2 = new Date().toISOString().split('T')[0]!;
  const nextNum = loadNextApplicationNumber();

  const newApplications = results.map((r, i) => ({
    id: String(nextNum + i).padStart(3, '0'),
    jobId: r.job.id,
    date: today2,
    company: r.job.company,
    role: r.job.title,
    score: r.score,
    url: r.job.applyUrl ?? r.job.url,
    jd: r.job.jd,                   // stored for AnswerGenerator context in apply loop
    status: 'Ready' as const,
    resumeVariant: r.variant,
    pdfPath: r.pdfPath,
    coverLetterPath: r.coverLetterPath,
    notes: `${r.job.platform} | ${r.job.location || 'Remote'}`,
    tailoredAt: new Date().toISOString(),
  }));

  saveApplications(newApplications);
  log.info(`Added ${newApplications.length} applications to queue`);
  printVariantSummary(results);
  console.log(`\nApply queue ready. Run: npm run apply`);
  console.log(`Review queue: cat data/applications.md`);
}

// ── Types ─────────────────────────────────────────────────────────────────

interface ProcessedJob {
  job: Job;
  variant: string;
  pdfPath: string;
  coverLetterPath?: string;
  score: number;
}

// ── Persistence ───────────────────────────────────────────────────────────

function loadExistingJobIds(): Set<string> {
  if (!fs.existsSync(APPLICATIONS_JSON)) return new Set();
  try {
    const apps = JSON.parse(fs.readFileSync(APPLICATIONS_JSON, 'utf8')) as Array<{ jobId: string }>;
    return new Set(apps.map((a) => a.jobId));
  } catch { return new Set(); }
}

function loadNextApplicationNumber(): number {
  if (!fs.existsSync(APPLICATIONS_JSON)) return 1;
  try {
    const apps = JSON.parse(fs.readFileSync(APPLICATIONS_JSON, 'utf8')) as Array<{ id: string }>;
    if (apps.length === 0) return 1;
    return Math.max(...apps.map((a) => parseInt(a.id, 10))) + 1;
  } catch { return 1; }
}

function saveApplications(newApps: unknown[]): void {
  fs.mkdirSync(path.dirname(APPLICATIONS_JSON), { recursive: true });
  let existing: unknown[] = [];
  if (fs.existsSync(APPLICATIONS_JSON)) {
    try { existing = JSON.parse(fs.readFileSync(APPLICATIONS_JSON, 'utf8')); } catch {}
  }
  const all = [...existing, ...newApps];
  fs.writeFileSync(APPLICATIONS_JSON, JSON.stringify(all, null, 2));
  rebuildMarkdown(all as Array<Record<string, string | number>>);
}

// Single canonical markdown schema — matches CLAUDE.md data contract.
// Columns: # | Date | Company | Role | Score | Status | PDF | Cover Letter | URL
function rebuildMarkdown(apps: Array<Record<string, string | number>>): void {
  const header =
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Cover Letter | URL |\n' +
    '|---|------|---------|------|-------|--------|-----|--------------|-----|\n';

  const rows = apps.map((a) => {
    const pdf = a['pdfPath'] ? '✅' : '❌';
    const cl = a['coverLetterPath'] ? `[CL](${a['coverLetterPath']})` : '';
    const scoreDisplay = typeof a['score'] === 'number' && a['score'] > 0
      ? `${a['score']}/100`
      : a['score'] ?? '—';
    return (
      `| ${a['id']} | ${a['date']} | ${a['company']} | ${a['role']} | ` +
      `${scoreDisplay} | ${a['status']} | ${pdf} | ${cl} | [Apply](${a['url']}) |`
    );
  }).join('\n');

  fs.mkdirSync(path.dirname(APPLICATIONS_MD), { recursive: true });
  fs.writeFileSync(APPLICATIONS_MD, header + rows + '\n');
}

function printVariantSummary(results: ProcessedJob[]): void {
  const counts: Record<string, number> = {};
  const scores: number[] = [];
  for (const r of results) {
    counts[r.variant] = (counts[r.variant] ?? 0) + 1;
    scores.push(r.score);
  }
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  console.log(`\nVariant breakdown (avg score: ${avg}/100):`);
  for (const [v, n] of Object.entries(counts).sort()) {
    console.log(`  ${v}: ${n}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
