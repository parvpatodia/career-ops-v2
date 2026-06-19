import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OutreachInboxMatcher, extractAddress } from '../../src/outreach/OutreachInboxMatcher.js';
import { OutreachReconciler } from '../../src/outreach/OutreachReconciler.js';
import { OutreachStore } from '../../src/outreach/OutreachStore.js';
import { contactIdForEmail } from '../../src/outreach/events.js';
import type { EmailHeader } from '../../src/inbox/EmailMatcher.js';
import type { ImapAccount } from '../../src/inbox/ImapClient.js';

const ALEX = 'alex@stanford.edu';
const alexId = contactIdForEmail(ALEX);

function header(over: Partial<EmailHeader>): EmailHeader {
  return { from: 'x@y.com', subject: '', date: '2026-06-16T10:00:00Z', account: 'gmail', ...over };
}

describe('extractAddress', () => {
  it('pulls the address from a named or bare From header', () => {
    expect(extractAddress('Alex R <alex@stanford.edu>')).toBe('alex@stanford.edu');
    expect(extractAddress('alex@stanford.edu')).toBe('alex@stanford.edu');
  });
});

describe('OutreachInboxMatcher', () => {
  const matcher = new OutreachInboxMatcher();
  const contacted = new Map([[ALEX, alexId]]);

  it('matches a reply by the sender address', () => {
    const r = matcher.match([header({ from: `Alex <${ALEX}>`, subject: 'Re: your question' })], contacted);
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0]!.contactId).toBe(alexId);
    expect(r.bounces).toHaveLength(0);
  });

  it('detects a bounce and ties it to a contacted address in the subject', () => {
    const r = matcher.match(
      [header({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: `Delivery failed: ${ALEX} not found` })],
      contacted
    );
    expect(r.bounces).toHaveLength(1);
    expect(r.bounces[0]!.contactId).toBe(alexId);
  });

  it('counts a bounce it cannot tie to a contact as unmatched (address only in the body)', () => {
    const r = matcher.match(
      [header({ from: 'postmaster@mail.com', subject: 'Delivery Status Notification (Failure)' })],
      contacted
    );
    expect(r.bounces).toHaveLength(0);
    expect(r.unmatchedBounces).toBe(1);
  });

  it('ignores inbound mail from addresses we never emailed', () => {
    const r = matcher.match([header({ from: 'newsletter@news.com', subject: 'Weekly digest' })], contacted);
    expect(r.replies).toHaveLength(0);
    expect(r.bounces).toHaveLength(0);
  });
});

describe('OutreachReconciler', () => {
  let dir: string;
  let store: OutreachStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
    store = new OutreachStore(path.join(dir, 'outreach.jsonl'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const accounts: ImapAccount[] = [{ account: 'gmail', host: 'h', user: 'u', password: 'p' }];

  it('records a reply and suppresses the contact from future cold email', async () => {
    // We emailed Alex (the `to` payload is how the reconciler learns the address).
    store.append({ type: 'email_sent', contactId: alexId, payload: { to: ALEX } });
    const fetch = async () => [header({ from: `Alex <${ALEX}>`, subject: 'Re: hi' })];

    const summary = await new OutreachReconciler(store, fetch).run(accounts);
    expect(summary.repliesRecorded).toBe(1);
    expect(store.isSuppressed(alexId)).toBe(true);
  });

  it('does not double-record a reply on a second run', async () => {
    store.append({ type: 'email_sent', contactId: alexId, payload: { to: ALEX } });
    const fetch = async () => [header({ from: ALEX, subject: 'Re: hi' })];
    const reconciler = new OutreachReconciler(store, fetch);

    expect((await reconciler.run(accounts)).repliesRecorded).toBe(1);
    expect((await reconciler.run(accounts)).repliesRecorded).toBe(0); // already replied, no-op
    expect(store.readAll().events.filter((e) => e.type === 'reply_received')).toHaveLength(1);
  });

  it('does not record a reply from a contact we only verified, never sent to', async () => {
    // email_verified carries `to` but means "passed the gate", not "emailed".
    store.append({ type: 'email_verified', contactId: alexId, payload: { to: ALEX } });
    const fetch = async () => [header({ from: ALEX, subject: 'Re: hi' })];

    const summary = await new OutreachReconciler(store, fetch).run(accounts);
    expect(summary.repliesRecorded).toBe(0);
  });

  it('records a bounce that names the address in the subject', async () => {
    store.append({ type: 'email_sent', contactId: alexId, payload: { to: ALEX } });
    const fetch = async () => [header({ from: 'mailer-daemon@x.com', subject: `Undeliverable: ${ALEX}` })];

    const summary = await new OutreachReconciler(store, fetch).run(accounts);
    expect(summary.bouncesRecorded).toBe(1);
    expect(store.isSuppressed(alexId)).toBe(true);
  });
});
