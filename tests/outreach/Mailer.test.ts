import { describe, it, expect } from 'vitest';
import { Mailer, type SentInfo } from '../../src/outreach/Mailer.js';
import { contactIdForEmail } from '../../src/outreach/events.js';
import type { EmailDraft } from '../../src/outreach/types.js';

function draft(to = 'alex@stanford.edu'): EmailDraft {
  return {
    contactId: contactIdForEmail(to),
    to,
    fromAccount: 'gmail',
    subject: 's',
    body: 'b',
    segment: 'researcher',
    personalization: 'p',
    sourceUrl: 'u',
    claimKeys: [],
  };
}

function mailerThatReturns(info: SentInfo): Mailer {
  return new Mailer({ gmail: { from: 'me@gmail.com', send: async () => info } }, 'Parv Patodia');
}

describe('Mailer.send confirmation', () => {
  it('confirms only when the recipient is accepted and nobody was rejected', async () => {
    const m = mailerThatReturns({ accepted: ['alex@stanford.edu'], rejected: [], messageId: '<id>' });
    const r = await m.send(draft());
    expect(r.confirmed).toBe(true);
    if (r.confirmed) expect(r.messageId).toBe('<id>');
  });

  it('does NOT confirm when the recipient landed in rejected', async () => {
    const m = mailerThatReturns({ accepted: [], rejected: ['alex@stanford.edu'], response: '550 no such user' });
    const r = await m.send(draft());
    expect(r.confirmed).toBe(false);
  });

  it('does NOT confirm when nobody was accepted', async () => {
    const m = mailerThatReturns({ accepted: [], rejected: [] });
    expect((await m.send(draft())).confirmed).toBe(false);
  });

  it('matches the recipient case-insensitively', async () => {
    const m = mailerThatReturns({ accepted: ['Alex@Stanford.edu'], rejected: [] });
    expect((await m.send(draft('alex@stanford.edu'))).confirmed).toBe(true);
  });

  it('returns unconfirmed (not a throw) when the account has no transport', async () => {
    const m = new Mailer({}, 'Parv Patodia');
    const r = await m.send(draft());
    expect(r.confirmed).toBe(false);
    if (!r.confirmed) expect(r.reason).toMatch(/no transport/);
  });

  it('treats an SMTP exception as unconfirmed', async () => {
    const m = new Mailer(
      { gmail: { from: 'me@gmail.com', send: async () => { throw new Error('connection reset'); } } },
      'Parv'
    );
    const r = await m.send(draft());
    expect(r.confirmed).toBe(false);
    if (!r.confirmed) expect(r.reason).toMatch(/connection reset/);
  });
});
