/**
 * Scanner CLI entry point.
 * Usage: npm run scan -- --platform [all|linkedin|wellfound|handshake|swelist|googlejobs]
 */

import 'dotenv/config';
import { SWEListScanner } from './SWEListScanner.js';
import { NewGradScanner } from './NewGradScanner.js';
import { GreenhouseBoardScanner } from './GreenhouseBoardScanner.js';
import { LinkedInScanner } from './LinkedInScanner.js';
import { HandshakeScanner } from './HandshakeScanner.js';
import { WellfoundScanner } from './WellfoundScanner.js';
import { GoogleJobsScanner } from './GoogleJobsScanner.js';
import { Scanner } from './Scanner.js';
import { Validator } from '../utils/Validator.js';
import { Logger } from '../utils/Logger.js';
import type { ScanQuery, Platform, Job } from '../types.js';
import fs from 'fs';
import yaml from 'js-yaml';

const log = new Logger('scanner:index');

const SCANNERS: Record<string, () => Scanner> = {
  // Primary: free, no auth, real posting dates (first_published), full JDs
  greenhouse: () => GreenhouseBoardScanner.fromConfig(),
  // Primary: free, no auth, high volume
  swelist: () => new SWEListScanner(),       // Summer 2026 internships (GitHub)
  newgrad: () => new NewGradScanner(),        // Full-time new grad roles (GitHub)
  // Authenticated: requires APIFY_TOKEN
  linkedin: () => new LinkedInScanner(),
  // Campus: requires Handshake login
  handshake: () => new HandshakeScanner(),
  // Legacy (kept for direct invocation, may be blocked)
  wellfound: () => new WellfoundScanner(),
  googlejobs: () => new GoogleJobsScanner(),
  direct: () => { throw new Error('Use scan url [url] for direct scans'); },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const platformArg = (args.find((a) => a.startsWith('--platform='))?.split('=')[1])
    ?? args[0]
    ?? 'all';

  // Load profile for default query construction
  const profileValidation = Validator.validateProfile();
  if (!profileValidation.valid) {
    log.error('Profile invalid', profileValidation.errors);
    process.exit(1);
  }

  const profile = yaml.load(fs.readFileSync('config/profile.yml', 'utf8')) as {
    target_roles: { types: string[] };
    target_roles_location: { preferred: string };
  };

  const query: ScanQuery = {
    keywords: [
      'machine learning',
      'AI engineer',
      'computer vision',
      'software engineer',
      'deep learning',
    ],
    location: 'San Francisco Bay Area',
    // Invariant 9: the hard freshness window. Scanners must not fetch
    // anything they could never apply to.
    postedWithinDays: 14,
    jobTypes: ['internship', 'co-op'],
  };

  let allJobs: Job[] = [];

  if (platformArg === 'all') {
    // swelist + newgrad: free, fast, no rate limits
    // linkedin: Apify-backed, requires APIFY_TOKEN
    // handshake: requires visible browser (headless blocked by Cloudflare)
    const enabledPlatforms: string[] = ['greenhouse', 'swelist', 'newgrad', 'linkedin', 'handshake'];
    for (const platform of enabledPlatforms) {
      try {
        const scanner = SCANNERS[platform]();
        const jobs = await scanner.scanWithCache(query);
        allJobs.push(...jobs);
        log.info(`${platform}: ${jobs.length} jobs`);
      } catch (err) {
        log.error(`${platform} scanner failed`, err);
      }
    }
  } else {
    const platform = platformArg;
    if (!SCANNERS[platform]) {
      log.error(`Unknown platform: ${platform}`);
      process.exit(1);
    }
    const scanner = SCANNERS[platform]();
    allJobs = await scanner.scanWithCache(query);
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  allJobs = allJobs.filter((j) => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });

  // Output results as JSON for pipeline consumption
  console.log(JSON.stringify({ count: allJobs.length, jobs: allJobs }, null, 2));
  log.info(`Total: ${allJobs.length} unique jobs discovered`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
