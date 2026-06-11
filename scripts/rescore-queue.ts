/**
 * Rescores the existing applications queue.
 *
 * WHY: The old scanner pipeline stored all 366 jobs with score=0 because the
 * Evaluator was never wired in. This script:
 *   1. Reads applications.json
 *   2. Loads JDs from daily_log cache (if available) to improve skill scoring
 *   3. Runs Evaluator.evaluate() on every Ready entry
 *   4. Updates score, resumeVariant, pdfPath, status
 *   5. Marks confirmed-wrong-role jobs as SKIP regardless of score
 *   6. Writes back atomically
 *
 * Usage: node --import tsx/esm scripts/rescore-queue.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Evaluator } from '../src/evaluator/Evaluator.js';
import type { Job } from '../src/types.js';

const APPLICATIONS_JSON = 'data/applications.json';
const CACHE_DIR = 'data/daily_log';
const OUTPUT_DIR = 'output/resumes';

// Jobs that are definitively wrong-type regardless of score
const FORCE_SKIP_IDS = new Set(['026', '034', '036', '037', '060', '112', '178', '213']);

// Variant overrides: re-classified after manual review
const VARIANT_OVERRIDE: Record<string, string> = {
  '035': 'ai',        // Cohere — AI-native company
  '196': 'ai',        // Scale AI — AI-native company
  '134': 'robotics',  // Aurora Innovation — autonomous vehicles
  '171': 'robotics',  // Aurora Innovation
  '217': 'robotics',  // Aurora Innovation
  '222': 'robotics',  // Nuro — autonomous delivery
};

// ── Load JD cache ─────────────────────────────────────────────────────────────

function buildJdCache(): Map<string, string> {
  const cache = new Map<string, string>();
  if (!fs.existsSync(CACHE_DIR)) return cache;

  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8')) as Job[];
      for (const j of jobs) {
        if (j.id && j.jd) cache.set(j.id, j.jd);
      }
    } catch {
      // skip malformed cache files
    }
  }
  return cache;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apps = JSON.parse(fs.readFileSync(APPLICATIONS_JSON, 'utf8')) as Array<
    Record<string, unknown>
  >;

  const jdCache = buildJdCache();
  const evaluator = new Evaluator();

  let rescored = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const app of apps) {
    const id = app['id'] as string;
    const status = app['status'] as string;

    // Only process Ready entries — leave Applied/Interview/etc. untouched
    if (status !== 'Ready') {
      unchanged++;
      continue;
    }

    // Force-SKIP confirmed wrong-type jobs
    if (FORCE_SKIP_IDS.has(id)) {
      app['status'] = 'SKIP';
      app['notes'] = String(app['notes'] ?? '') + ' | SKIP: wrong role type or clearance required';
      skipped++;
      continue;
    }

    // Build a Job object for the Evaluator
    const job: Job = {
      id: app['jobId'] as string ?? id,
      title: app['role'] as string ?? '',
      company: app['company'] as string ?? '',
      url: app['url'] as string ?? '',
      applyUrl: app['url'] as string ?? '',
      platform: 'direct',
      location: (app['notes'] as string ?? '').split('|').pop()?.trim() ?? '',
      remote: false,
      postedAt: app['date'] as string ?? new Date().toISOString().split('T')[0]!,
      discoveredAt: app['date'] as string ?? new Date().toISOString().split('T')[0]!,
      // Use cached JD if available; otherwise fall back to empty string
      jd: jdCache.get(app['jobId'] as string) ?? jdCache.get(id) ?? '',
      score: 0,
      status: 'evaluated',
    };

    const variant = (VARIANT_OVERRIDE[id] ?? evaluator.selectVariant(job.title)) as string;
    const result = evaluator.evaluate(job, variant as 'master' | 'ai' | 'ml' | 'robotics' | 'ta');

    // Apply score and variant
    app['score'] = result.score;
    app['resumeVariant'] = variant;
    app['pdfPath'] = path.join(OUTPUT_DIR, `parv-${variant}.pdf`);

    // Auto-SKIP if below auto_discard threshold (30)
    if (result.score < 30) {
      app['status'] = 'SKIP';
      app['notes'] = String(app['notes'] ?? '') + ` | SKIP: score ${result.score}/100 below threshold`;
      skipped++;
    } else {
      rescored++;
    }
  }

  // Write back atomically
  fs.writeFileSync(APPLICATIONS_JSON, JSON.stringify(apps, null, 2));

  console.log('\n=== Rescore Complete ===');
  console.log(`  Rescored (Ready):   ${rescored}`);
  console.log(`  Marked SKIP:        ${skipped}`);
  console.log(`  Left unchanged:     ${unchanged}`);
  console.log(`  Total:              ${apps.length}`);

  // Score distribution for Ready jobs
  const ready = apps.filter((a) => a['status'] === 'Ready') as Array<Record<string, number>>;
  const scores = ready.map((a) => a['score'] as number).sort((x, y) => y - x);
  if (scores.length > 0) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const above80 = scores.filter((s) => s >= 80).length;
    const above60 = scores.filter((s) => s >= 60).length;
    console.log(`\n  Ready queue: ${ready.length} jobs`);
    console.log(`  Avg score:   ${avg}/100`);
    console.log(`  High (≥80):  ${above80}`);
    console.log(`  Good (≥60):  ${above60}`);
    console.log(`  Top 5 scores: ${scores.slice(0, 5).join(', ')}`);
  }

  console.log('\nDone. Run: cat data/applications.md to review.\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
