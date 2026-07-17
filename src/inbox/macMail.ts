/**
 * `npm run inbox:mac` — Mac-local email ingestion. Runs the Apple Mail JXA reader
 * (scripts/read-mail-mac.js), decodes each message's raw source, extracts on-field
 * junior US job links via parseJobEmails, and merges them into the watcher's
 * hot-list (data/new-jobs.json) so they show in the UI beside board-API roles.
 *
 * WHY this instead of the ms365 MCP: Northeastern blocks third-party Graph apps
 * (admin consent), so we read the mail already synced to Apple Mail — no OAuth,
 * no tenant approval. WHY not in the 60s watch loop: reading raw source over the
 * AppleScript bridge takes ~60s for 40 messages, and digests are daily, so this
 * runs on a slower cadence (launchd, ~30 min) or on demand.
 *
 * Dedup is by id AND company|role, so SWE List roles (which link to Simplify,
 * already sourced by the swelist scanner) are not shown twice.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseJobEmails, mergeHotlist } from './emailJobs.js';
import type { EmailMessage } from './emailJobs.js';
import { Notifier } from '../applier/Notifier.js';
import { Logger } from '../utils/Logger.js';

const HOTLIST = 'data/new-jobs.json';
const READER = 'scripts/read-mail-mac.js';

/**
 * Decode a quoted-printable + UTF-8 email source. WHY byte-wise then UTF-8: the
 * HTML part is QP-encoded ("=3D", soft "=\n" line breaks) over UTF-8, so decoding
 * each "=XX" to a BYTE and then interpreting the whole buffer as UTF-8 preserves
 * multibyte characters (a naive String.fromCharCode mangles them to "â¦").
 */
export function qpDecodeUtf8(s: string): string {
  const nosoft = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < nosoft.length; i++) {
    const ch = nosoft[i]!;
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(nosoft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(nosoft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

interface RawMsg { from: string; subject: string; received: string; source: string; }
type ReaderResult = { count: number; scanned: number; messages: RawMsg[] } | { error: string; detail?: string };

/** Run the JXA reader. Throws if Mail is not open / Automation is not permitted. */
export function runReader(max = 40, days = 4): ReaderResult {
  const buf = execFileSync('osascript', ['-l', 'JavaScript', READER, String(max), String(days)], {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 150_000,
  });
  return JSON.parse(buf.toString('utf8')) as ReaderResult;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main(): Promise<void> {
  const log = new Logger('mac-mail');
  const max = Number(process.argv[2] ?? 40);
  const days = Number(process.argv[3] ?? 4);

  let res: ReaderResult;
  try {
    res = runReader(max, days);
  } catch (err) {
    log.error(`reader failed — is Mail.app open and Automation allowed? ${(err as Error).message}`);
    process.exit(1);
  }
  if ('error' in res) {
    log.error(`reader error: ${res.error} ${res.detail ?? ''}`);
    process.exit(1);
  }

  const emails: EmailMessage[] = res.messages.map((m) => ({
    from: m.from,
    subject: m.subject,
    receivedDateTime: m.received,
    bodyHtml: qpDecodeUtf8(m.source),
  }));
  const candidates = parseJobEmails(emails);

  let existing: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(HOTLIST, 'utf8'));
    if (Array.isArray(parsed)) existing = parsed;
  } catch { /* no hot-list yet is fine */ }

  const existingIds = new Set(existing.map((e) => String((e as { id?: string }).id ?? '')));
  const existingCR = new Set(existing.map((e) => `${norm((e as { company?: string }).company)}|${norm((e as { role?: string }).role)}`));
  const fresh = candidates.filter(
    (c) => !existingIds.has(c.id) && !existingCR.has(`${norm(c.company)}|${norm(c.role)}`)
  );

  const merged = mergeHotlist(candidates, existing);
  fs.mkdirSync(path.dirname(HOTLIST), { recursive: true });
  fs.writeFileSync(HOTLIST, JSON.stringify(merged, null, 2) + '\n');

  // Alert only on genuinely-new email roles (capped), same style as the watcher.
  const notifier = new Notifier();
  for (const j of fresh.slice(0, 8)) notifier.newPosting(j.company, j.role, j.applyUrl);

  log.info(
    `scanned ${res.scanned} msgs -> ${candidates.length} job candidate(s), ${fresh.length} new (added + alerted); hot-list now ${merged.length}.`
  );
}

if (process.argv[1] && process.argv[1].endsWith('macMail.ts')) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
