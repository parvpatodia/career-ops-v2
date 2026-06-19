/**
 * `npm run outreach:account` — print Hunter.io quota. Free call, no credits
 * spent. Run it before a batch to confirm the key works and there are searches
 * and verifications left.
 *
 * Setup: add to .env (gitignored):  HUNTER_API_KEY=...
 */

import 'dotenv/config';
import { HunterClient } from '../HunterClient.js';

async function main(): Promise<void> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    console.log('No HUNTER_API_KEY in .env. Add it (gitignored):  HUNTER_API_KEY=...');
    process.exit(1);
  }
  const q = await new HunterClient({ apiKey }).account();
  console.log(`Hunter plan: ${q.plan}`);
  console.log(`  searches:      ${q.searchesUsed} used / ${q.searchesAvailable} available`);
  console.log(`  verifications: ${q.verificationsUsed} used / ${q.verificationsAvailable} available`);
}

main().catch((err) => { console.error(err); process.exit(1); });
