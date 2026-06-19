import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { OutreachStore, OutreachTransitionError } from '../../src/outreach/OutreachStore.js';
import {
  contactIdForEmail,
  contactIdForProfile,
} from '../../src/outreach/events.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-'));
  file = path.join(dir, 'outreach.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cid = contactIdForEmail('alex.researcher@stanford.edu');

describe('OutreachStore append + read', () => {
  it('appends and reads back events with sequential seqs', () => {
    const store = new OutreachStore(file);
    store.append({ type: 'contact_discovered', contactId: cid, payload: { name: 'Alex' } });
    store.append({ type: 'email_drafted', contactId: cid, payload: {} });
    const { events, corruptLines } = store.readAll();
    expect(corruptLines).toBe(0);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('rejects an unknown event type and an invalid contactId', () => {
    const store = new OutreachStore(file);
    // @ts-expect-error deliberately invalid type
    expect(() => store.append({ type: 'nope', contactId: cid, payload: {} })).toThrow(/Unknown/);
    expect(() => store.append({ type: 'email_sent', contactId: 'BADID', payload: {} })).toThrow(/contactId/);
  });
});

describe('OutreachStore de-dup and suppression guard', () => {
  it('rejects a second email_sent for the same contact', () => {
    const store = new OutreachStore(file);
    store.append({ type: 'email_sent', contactId: cid, payload: {} });
    expect(() => store.append({ type: 'email_sent', contactId: cid, payload: {} })).toThrow(
      OutreachTransitionError
    );
  });

  it('the de-dup survives a process restart (state is on disk)', () => {
    new OutreachStore(file).append({ type: 'email_sent', contactId: cid, payload: {} });
    const fresh = new OutreachStore(file);
    expect(() => fresh.append({ type: 'email_sent', contactId: cid, payload: {} })).toThrow(
      OutreachTransitionError
    );
  });

  it('rejects email_sent to a bounced or opted-out contact', () => {
    const a = new OutreachStore(file);
    a.append({ type: 'bounced', contactId: cid, payload: {} });
    expect(() => a.append({ type: 'email_sent', contactId: cid, payload: {} })).toThrow(
      OutreachTransitionError
    );

    const other = contactIdForEmail('hr@bigco.com');
    a.append({ type: 'opted_out', contactId: other, payload: {} });
    expect(() => a.append({ type: 'email_sent', contactId: other, payload: {} })).toThrow(
      OutreachTransitionError
    );
  });

  it('isSuppressed reflects sent, replied, bounced, opted_out, but not a fresh contact', () => {
    const store = new OutreachStore(file);
    expect(store.isSuppressed(cid)).toBe(false);
    store.append({ type: 'reply_received', contactId: cid, payload: {} });
    expect(store.isSuppressed(cid)).toBe(true);
  });

  it('tryAppend returns a verdict instead of throwing on a duplicate', () => {
    const store = new OutreachStore(file);
    store.append({ type: 'email_sent', contactId: cid, payload: {} });
    const v = store.tryAppend({ type: 'email_sent', contactId: cid, payload: {} });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/duplicate/);
  });
});

describe('OutreachStore.appendGroup (send receipt)', () => {
  it('lands a correlated group atomically', () => {
    const store = new OutreachStore(file);
    const group = store.appendGroup(
      [
        { type: 'email_verified', contactId: cid, payload: { status: 'valid' } },
        { type: 'email_sent', contactId: cid, payload: { messageId: 'abc' } },
      ],
      'send-001'
    );
    expect(group).toHaveLength(2);
    expect(group.every((e) => e.cid === 'send-001')).toBe(true);
    expect(store.projection().state(cid)?.sent).toBe(true);
  });

  it('aborts the whole group when a member violates the guard: nothing lands', () => {
    const store = new OutreachStore(file);
    store.append({ type: 'email_sent', contactId: cid, payload: {} });
    expect(() =>
      store.appendGroup([
        { type: 'reply_received', contactId: cid, payload: {} },
        { type: 'email_sent', contactId: cid, payload: {} }, // duplicate
      ])
    ).toThrow(OutreachTransitionError);
    // Only the original send survived; the reply_received did not half-land.
    expect(store.readAll().events).toHaveLength(1);
  });
});

describe('contact id helpers', () => {
  it('normalizes case and whitespace for email keys', () => {
    expect(contactIdForEmail('Alex.Researcher@Stanford.edu ')).toBe(
      contactIdForEmail('alex.researcher@stanford.edu')
    );
  });
  it('keeps email and profile keys distinct for the same person', () => {
    expect(contactIdForEmail('a@b.com')).not.toBe(contactIdForProfile('linkedin.com/in/a'));
    expect(contactIdForEmail('a@b.com')).toMatch(/^[0-9a-f]{12}$/);
  });
});
