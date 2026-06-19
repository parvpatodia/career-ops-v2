import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DraftLoader, validateEmailDraft } from '../../src/outreach/DraftLoader.js';
import { contactIdForEmail } from '../../src/outreach/events.js';

const good = {
  contactId: contactIdForEmail('alex@stanford.edu'),
  to: 'alex@stanford.edu',
  fromAccount: 'gmail',
  subject: 'Hi',
  body: 'body',
  segment: 'researcher',
  personalization: 'your paper',
  sourceUrl: 'https://arxiv.org/abs/x',
  claimKeys: ['researcher.intro'],
  emailStatus: 'valid',
};

describe('validateEmailDraft', () => {
  it('accepts a well-formed draft', () => {
    const r = validateEmailDraft(good);
    expect('draft' in r).toBe(true);
  });

  it('rejects a bad contactId, account, segment, and email status', () => {
    expect('reason' in validateEmailDraft({ ...good, contactId: 'xyz' })).toBe(true);
    expect('reason' in validateEmailDraft({ ...good, fromAccount: 'yahoo' })).toBe(true);
    expect('reason' in validateEmailDraft({ ...good, segment: 'vc' })).toBe(true);
    expect('reason' in validateEmailDraft({ ...good, emailStatus: 'maybe' })).toBe(true);
    expect('reason' in validateEmailDraft({ ...good, to: 'not-an-email' })).toBe(true);
    expect('reason' in validateEmailDraft({ ...good, claimKeys: 'nope' })).toBe(true);
  });
});

describe('DraftLoader', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('loads valid drafts and reports malformed ones without throwing', () => {
    fs.writeFileSync(path.join(dir, '1.json'), JSON.stringify(good));
    fs.writeFileSync(path.join(dir, '2.json'), JSON.stringify({ ...good, segment: 'bad' }));
    fs.writeFileSync(path.join(dir, '3.json'), '{ not json');

    const { drafts, errors } = new DraftLoader().load(dir);
    expect(drafts).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it('returns empty for a missing directory', () => {
    const { drafts, errors } = new DraftLoader().load(path.join(dir, 'nope'));
    expect(drafts).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
