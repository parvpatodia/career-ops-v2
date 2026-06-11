/**
 * Filters jobs by posting age.
 * WHY: Applying to 2-month-old listings wastes applications — most are filled.
 * MAANG/big AI exception: these firms post long cycles and are always worth applying.
 */

import type { Job } from '../types.js';

const DEFAULT_MAX_DAYS = 14;
const MAANG_MAX_DAYS = 60;

// Companies where we apply regardless of posting age
const PRIORITY_COMPANIES = new Set([
  // MAANG
  'google', 'alphabet', 'apple', 'amazon', 'aws', 'meta', 'facebook',
  'netflix', 'microsoft',
  // Big AI labs
  'openai', 'anthropic', 'deepmind', 'google deepmind', 'xai', 'x.ai',
  'nvidia', 'databricks', 'scale ai', 'hugging face', 'cohere', 'mistral',
  'character.ai', 'perplexity', 'inflection', 'together ai',
  // Big robotics / AV
  'waymo', 'tesla', 'figure', 'figure ai', 'boston dynamics', 'isomorphic',
  'physical intelligence', '1x technologies', 'agility robotics',
  // Big tech / cloud
  'apple', 'salesforce', 'adobe', 'oracle', 'intel', 'qualcomm', 'amd',
  'ibm', 'palantir', 'stripe', 'airbnb', 'uber', 'lyft', 'snapchat', 'snap',
  'twitter', 'x corp', 'linkedin', 'pinterest', 'reddit', 'coinbase',
]);

export class FreshnessFilter {
  filter(jobs: Job[]): { fresh: Job[]; stale: Job[] } {
    const now = Date.now();
    const fresh: Job[] = [];
    const stale: Job[] = [];

    for (const job of jobs) {
      const postedMs = new Date(job.postedAt).getTime();
      const ageDays = (now - postedMs) / 86_400_000;

      const isPriority = this.isPriorityCompany(job.company);
      const maxDays = isPriority ? MAANG_MAX_DAYS : DEFAULT_MAX_DAYS;

      if (ageDays <= maxDays) {
        fresh.push(job);
      } else {
        stale.push(job);
      }
    }

    return { fresh, stale };
  }

  private isPriorityCompany(company: string): boolean {
    const normalized = company.toLowerCase().trim();
    return PRIORITY_COMPANIES.has(normalized) ||
      [...PRIORITY_COMPANIES].some((name) => normalized.includes(name));
  }
}
