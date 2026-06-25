import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OutreachSender } from '../../src/outreach/OutreachSender.js';
import { DraftGate } from '../../src/outreach/DraftGate.js';
import { StyleLinter } from '../../src/outreach/StyleLinter.js';
import { SnippetBook } from '../../src/outreach/SnippetBook.js';
import { Mailer, type SentInfo } from '../../src/outreach/Mailer.js';
import { OutreachStore } from '../../src/outreach/OutreachStore.js';
import { contactIdForEmail } from '../../src/outreach/events.js';
import type { EmailDraft } from '../../src/outreach/types.js';

const SNIPPET = "I build AI systems end to end, most recently a from-scratch ViT and a diffusion policy.";
const snippets = new SnippetBook({ intro: SNIPPET });

let dir: string;
let store: OutreachStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sender-'));
  store = new OutreachStore(path.join(dir, 'outreach.jsonl'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function draftTo(email: string): EmailDraft {
  const personalization = `I saw your work at ${email.split('@')[1]}.`;
  return {
    contactId: contactIdForEmail(email),
    to: email,
    fromAccount: 'gmail',
    subject: 'Quick question',
    body: `Hi,\n\n${personalization}\n\n${SNIPPET}\n\n15 minutes?\n\nParv`,
    segment: 'industry',
    personalization,
    sourceUrl: 'https://example.com/profile',
    claimKeys: ['intro'],
    emailStatus: 'valid',
  };
}

function makeGate() {
  return new DraftGate({ linter: new StyleLinter(), snippets, isSuppressed: (id) => store.isSuppressed(id) });
}

/** A Mailer whose send result and call log are controlled per test. */
function fakeMailer(result: (to: string) => SentInfo, calls: string[] = []): Mailer {
  return new Mailer(
    { gmail: { from: 'me@gmail.com', send: async (msg) => { calls.push(msg.to); return result(msg.to); } } },
    'Parv Patodia'
  );
}

const confirmAll = (to: string): SentInfo => ({ accepted: [to], rejected: [], messageId: '<ok>' });

describe('OutreachSender', () => {
  it('sends a green draft and writes email_verified then email_sent', async () => {
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll), store });
    const summary = await sender.sendBatch([draftTo('eng@startup.ai')]);

    expect(summary.sent).toHaveLength(1);
    const types = store.readAll().events.map((e) => e.type);
    expect(types).toEqual(['email_verified', 'email_sent']);
  });

  it('abstains a draft that fails the gate and never calls the mailer', async () => {
    const calls: string[] = [];
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll, calls), store });
    const bad = draftTo('eng@startup.ai');
    bad.emailStatus = 'accept_all'; // gate abstains: not Hunter-valid

    const summary = await sender.sendBatch([bad]);
    expect(summary.sent).toHaveLength(0);
    expect(summary.abstained).toHaveLength(1);
    expect(calls).toHaveLength(0);
    expect(store.readAll().events.map((e) => e.type)).toEqual(['email_abstained']);
  });

  it('NEVER records email_sent for an unconfirmed send (no false green)', async () => {
    const notes: string[] = [];
    const sender = new OutreachSender({
      gate: makeGate(),
      mailer: fakeMailer((to) => ({ accepted: [], rejected: [to], response: '550 blocked' })),
      store,
      notify: (n) => notes.push(n.title),
    });

    const summary = await sender.sendBatch([draftTo('eng@startup.ai')]);
    expect(summary.sent).toHaveLength(0);
    const types = store.readAll().events.map((e) => e.type);
    expect(types).toContain('email_verified');
    expect(types).not.toContain('email_sent');
    expect(notes).toContain('Outreach send failed');
  });

  it('respects the daily cap and reports cap-skipped drafts', async () => {
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll), store, dailyCap: 1 });
    const summary = await sender.sendBatch([draftTo('a@x.ai'), draftTo('b@y.ai')]);

    expect(summary.sent).toHaveLength(1);
    expect(summary.capSkipped).toHaveLength(1);
    expect(store.readAll().events.filter((e) => e.type === 'email_sent')).toHaveLength(1);
  });

  it('counts emails already sent earlier today toward the cap', async () => {
    // Pre-seed one send dated today, then a cap of 1 must skip everything.
    store.append({ type: 'email_sent', contactId: contactIdForEmail('earlier@today.com'), payload: { sentAt: new Date().toISOString() } });
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll), store, dailyCap: 1 });

    const summary = await sender.sendBatch([draftTo('c@z.ai')]);
    expect(summary.sent).toHaveLength(0);
    expect(summary.capSkipped).toHaveLength(1);
  });

  it('counts the cap by sentAt, not the append wall-clock, under an injected clock', async () => {
    // A send dated on the injected day must count even though its event ts is real-now.
    const clock = () => new Date('2020-01-01T12:00:00.000Z');
    store.append({ type: 'email_sent', contactId: contactIdForEmail('seed@x.ai'), payload: { sentAt: '2020-01-01T09:00:00.000Z' } });
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll), store, dailyCap: 1, clock });

    const summary = await sender.sendBatch([draftTo('d@w.ai')]);
    expect(summary.sent).toHaveLength(0); // cap already used by the seeded send
    expect(summary.capSkipped).toHaveLength(1);
  });

  it('abstains (never sends) when a draft promises a resume but the file is missing', async () => {
    const calls: string[] = [];
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll, calls), store, resumeDir: path.join(dir, 'no-resumes') });
    const d = draftTo('eng@startup.ai');
    d.resumeVariant = 'ai'; // body says "attached", but no parv-ai.pdf exists
    const summary = await sender.sendBatch([d]);
    expect(summary.sent).toHaveLength(0);
    expect(calls).toHaveLength(0); // never reached SMTP
    expect(summary.abstained[0]!.reasons.join(' ')).toMatch(/resume attachment missing/);
    expect(store.readAll().events.map((e) => e.type)).toEqual(['email_abstained']);
  });

  it('sends when the promised resume file is present', async () => {
    const resumeDir = path.join(dir, 'resumes');
    fs.mkdirSync(resumeDir, { recursive: true });
    fs.writeFileSync(path.join(resumeDir, 'parv-ai.pdf'), '%PDF-1.4 fake');
    const sender = new OutreachSender({ gate: makeGate(), mailer: fakeMailer(confirmAll), store, resumeDir });
    const d = draftTo('eng2@startup.ai');
    d.resumeVariant = 'ai';
    const summary = await sender.sendBatch([d]);
    expect(summary.sent).toHaveLength(1);
    expect(store.readAll().events.map((e) => e.type)).toEqual(['email_verified', 'email_sent']);
  });
});
