/**
 * `npm run outreach:suppress -- <email> [<email> ...]`
 *
 * Manually retire a contact so the planner stops SOURCING it and the gate stops
 * re-drafting it every day. WHY it exists: a Hunter-`invalid` address never sends
 * (verify-or-abstain), but it is not suppressed by an abstention, so it recycles
 * into the review pile daily. This records a `bounced` event — `isSuppressed`
 * treats bounced as "never email again" — which is the honest category for an
 * address predicted undeliverable.
 *
 * Single-writer: mutates through OutreachStore, never by hand-editing the log
 * (AGENTS.md invariant 4). Idempotent: an already-suppressed contact is skipped.
 */

import 'dotenv/config';
import { OutreachStore } from '../src/outreach/OutreachStore.js';
import { contactIdForEmail } from '../src/outreach/events.js';

function main(): void {
  const emails = process.argv.slice(2).filter((a) => a.includes('@'));
  if (emails.length === 0) {
    console.error('usage: npm run outreach:suppress -- <email> [<email> ...]');
    process.exit(1);
  }

  const store = new OutreachStore();
  for (const email of emails) {
    const contactId = contactIdForEmail(email);
    if (store.isSuppressed(contactId)) {
      console.log(`already suppressed: ${email} (${contactId})`);
      continue;
    }
    store.append({
      type: 'bounced',
      contactId,
      payload: { to: email, reason: 'manually suppressed: address invalid / undeliverable' },
    });
    console.log(`suppressed: ${email} (${contactId})`);
  }
}

main();
