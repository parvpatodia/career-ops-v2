/**
 * Reads and validates the email-draft JSON files the daily Claude run writes to
 * data/outreach/drafts/<date>/. Validation is strict: a malformed draft is
 * reported, never silently sent. One file, one draft, named <contactId>.json.
 */

import fs from 'fs';
import path from 'path';
import { isValidContactId } from './events.js';
import { SEGMENTS } from './types.js';
import type { EmailDraft, HunterStatus, SendAccount, Segment } from './types.js';

const ACCOUNTS: readonly SendAccount[] = ['gmail', 'outlook'];
const STATUSES: readonly HunterStatus[] = ['valid', 'invalid', 'accept_all', 'webmail', 'disposable', 'unknown'];

export interface LoadResult {
  drafts: EmailDraft[];
  errors: Array<{ file: string; reason: string }>;
}

/** Validate one parsed object into an EmailDraft, or return the reason it is invalid. */
export function validateEmailDraft(raw: unknown): { draft: EmailDraft } | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: 'not an object' };
  const d = raw as Record<string, unknown>;

  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);

  if (!str('contactId') || !isValidContactId(d.contactId as string)) return { reason: 'contactId must be 12 hex chars' };
  const to = str('to');
  if (!to || !to.includes('@')) return { reason: 'to must be an email address' };
  if (!ACCOUNTS.includes(d.fromAccount as SendAccount)) return { reason: `fromAccount must be one of ${ACCOUNTS.join('/')}` };
  if (!str('subject')) return { reason: 'subject is required' };
  if (!str('body')) return { reason: 'body is required' };
  if (!SEGMENTS.includes(d.segment as Segment)) return { reason: `segment must be one of ${SEGMENTS.join('/')}` };
  if (typeof d.personalization !== 'string') return { reason: 'personalization is required (string)' };
  if (!str('sourceUrl')) return { reason: 'sourceUrl is required (evidence for the personalization)' };
  if (!Array.isArray(d.claimKeys) || !d.claimKeys.every((k) => typeof k === 'string')) {
    return { reason: 'claimKeys must be a string array' };
  }
  if (d.emailStatus !== undefined && !STATUSES.includes(d.emailStatus as HunterStatus)) {
    return { reason: `emailStatus must be one of ${STATUSES.join('/')}` };
  }

  return {
    draft: {
      contactId: d.contactId as string,
      to,
      fromAccount: d.fromAccount as SendAccount,
      subject: d.subject as string,
      body: d.body as string,
      segment: d.segment as Segment,
      personalization: d.personalization as string,
      sourceUrl: d.sourceUrl as string,
      claimKeys: d.claimKeys as string[],
      resumeVariant: d.resumeVariant as EmailDraft['resumeVariant'],
      emailStatus: d.emailStatus as HunterStatus | undefined,
      emailConfidence: typeof d.emailConfidence === 'number' ? d.emailConfidence : undefined,
    },
  };
}

export class DraftLoader {
  /** Load every *.json draft in `dir`, sorted by filename. Missing dir = empty. */
  load(dir: string): LoadResult {
    const out: LoadResult = { drafts: [], errors: [] };
    if (!fs.existsSync(dir)) return out;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (err) {
        out.errors.push({ file, reason: `invalid JSON: ${(err as Error).message}` });
        continue;
      }
      const result = validateEmailDraft(parsed);
      if ('draft' in result) out.drafts.push(result.draft);
      else out.errors.push({ file, reason: result.reason });
    }
    return out;
  }
}
