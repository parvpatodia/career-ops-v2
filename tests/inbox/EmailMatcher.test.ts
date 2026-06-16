/**
 * EmailMatcher: classify application emails + match them to applications. Pure,
 * no IMAP. Confirmation = ground-truth proof a submission was received.
 */

import { describe, it, expect } from 'vitest';
import { EmailMatcher, statusForKind } from '../../src/inbox/EmailMatcher.js';
import type { EmailHeader } from '../../src/inbox/EmailMatcher.js';
import type { Application } from '../../src/types.js';

const matcher = new EmailMatcher();

function app(id: string, company: string): Application {
  return {
    id, jobId: `j-${id}`, date: '2026-06-16', company, role: 'ML Intern', score: 80,
    url: 'https://x', status: 'Ready', resumeVariant: 'ml', notes: 'greenhouse | Remote',
  };
}
function email(subject: string, from = 'no-reply@greenhouse.io', date = '2026-06-16T10:00:00Z'): EmailHeader {
  return { subject, from, date, account: 'gmail' };
}

describe('EmailMatcher.classify', () => {
  it('classifies confirmations, rejections, interviews, and other', () => {
    expect(matcher.classify(email('Thank you for applying to Scale AI'))).toBe('confirmation');
    expect(matcher.classify(email('We have received your application'))).toBe('confirmation');
    expect(matcher.classify(email('Update on your application to Workato'))).toBe('other'); // no status verb
    expect(matcher.classify(email('Unfortunately we will not be moving forward'))).toBe('rejection');
    expect(matcher.classify(email('We would like to schedule a call'))).toBe('interview');
    expect(matcher.classify(email('Your weekly newsletter'))).toBe('other');
  });

  it('checks rejection/interview before the broad confirmation pattern', () => {
    // Contains "your application" (confirmation-ish) but is a rejection.
    expect(matcher.classify(email('Re: your application — unfortunately not moving forward'))).toBe('rejection');
  });
});

describe('EmailMatcher.match', () => {
  const apps = [app('373', 'Scale AI'), app('378', 'Tenstorrent University Jobs'), app('380', 'Workato')];

  it('matches a confirmation email to its application by company', () => {
    const emails = [email('Thank you for applying to Scale AI', 'jobs@scaleai.com')];
    const m = matcher.match(emails, apps);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ appId: '373', company: 'Scale AI', kind: 'confirmation' });
  });

  it('matches on a distinctive first company token (Tenstorrent... )', () => {
    const emails = [email('Your application to Tenstorrent has been received', 'careers@tenstorrent.com')];
    const m = matcher.match(emails, apps);
    expect(m).toHaveLength(1);
    expect(m[0]?.appId).toBe('378');
  });

  it('picks the newest status email per application', () => {
    const emails = [
      email('Thanks for applying to Workato', 'no-reply@greenhouse.io', '2026-06-14T10:00:00Z'),
      email('Workato: unfortunately we are not moving forward', 'no-reply@greenhouse.io', '2026-06-16T10:00:00Z'),
    ];
    const m = matcher.match(emails, apps);
    const workato = m.find((x) => x.appId === '380');
    expect(workato?.kind).toBe('rejection'); // newest wins
  });

  it('ignores unrelated emails', () => {
    expect(matcher.match([email('Your Amazon order shipped', 'ship@amazon.com')], apps)).toHaveLength(0);
  });
});

describe('statusForKind', () => {
  it('maps email kind to application status', () => {
    expect(statusForKind('confirmation')).toBe('Applied');
    expect(statusForKind('rejection')).toBe('Rejected');
    expect(statusForKind('interview')).toBe('Interview');
    expect(statusForKind('other')).toBeNull();
  });
});
