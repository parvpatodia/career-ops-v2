/**
 * M8 F5: parse job-alert digest emails into FreshRole candidates. Properties:
 * only on-field + junior + US + F-1-eligible job links survive; footer/social/
 * unsubscribe anchors and off-field/non-US/clearance rows are dropped; dedup by
 * URL; role/company split is best-effort.
 */
import { describe, it, expect } from 'vitest';
import { parseJobEmails, splitRoleCompany, mergeHotlist, unwrapTracker } from '../../src/inbox/emailJobs.js';
import type { EmailMessage, EmailJob } from '../../src/inbox/emailJobs.js';

const digest: EmailMessage = {
  from: 'jobs@scalar.io',
  subject: 'Your daily intern roles',
  receivedDateTime: '2026-07-16T08:00:00Z',
  bodyHtml: `
    <h1>Today's internships</h1>
    <table>
      <tr><td><a href="https://boards.greenhouse.io/acme/jobs/123?gh_jid=123">Machine Learning Engineer Intern at Acme AI</a></td><td>San Jose, CA</td></tr>
      <tr><td><a href="https://jobs.lever.co/robco/abc">RoboCo — Robotics Perception Intern</a></td></tr>
      <tr><td><a href="https://jobs.ashbyhq.com/foo/xyz">Mechanical Engineering Intern at Foo</a></td></tr>
      <tr><td><a href="https://boards.greenhouse.io/bar/jobs/9">Software Engineer Intern at Bar (London, UK)</a></td></tr>
      <tr><td><a href="https://jobs.lever.co/def/2">ML Intern (requires active security clearance) at DefenseCo</a></td></tr>
      <tr><td><a href="https://boards.greenhouse.io/acme/jobs/123?gh_jid=123">Machine Learning Engineer Intern at Acme AI</a></td></tr>
      <tr><td><a href="javascript:alert('xss')//greenhouse.io/jobs">Machine Learning Intern at Evil</a></td></tr>
    </table>
    <footer>
      <a href="https://scalar.io/unsubscribe?u=1">Unsubscribe</a>
      <a href="https://twitter.com/scalar">Follow us</a>
      <a href="https://scalar.io/blog/tips">Read our blog: interview tips</a>
    </footer>`,
};

describe('parseJobEmails', () => {
  const jobs = parseJobEmails([digest], new Date('2026-07-16T09:00:00Z'));

  it('keeps only on-field + junior + US + eligible job links', () => {
    const roles = jobs.map((j) => j.role);
    expect(roles).toContain('Machine Learning Engineer Intern');
    expect(roles).toContain('Robotics Perception Intern');
    // dropped: mechanical (off-field), London (non-US), clearance (ineligible),
    // unsubscribe/twitter/blog (not job links)
    expect(jobs.some((j) => /mechanical/i.test(j.role))).toBe(false);
    expect(jobs.some((j) => /london|\buk\b/i.test(j.role))).toBe(false);
    expect(jobs.some((j) => /clearance/i.test(j.role))).toBe(false);
    expect(jobs.some((j) => /unsubscribe|follow|blog/i.test(j.role))).toBe(false);
  });

  it('drops non-http(s) links (javascript:/data:) so no unsafe href reaches the UI', () => {
    expect(jobs.some((j) => /^javascript:/i.test(j.applyUrl))).toBe(false);
    expect(jobs.some((j) => /Evil/.test(j.company + j.role))).toBe(false);
  });

  it('dedups by apply URL (the ML role appears twice)', () => {
    expect(jobs.filter((j) => j.applyUrl.includes('acme/jobs/123'))).toHaveLength(1);
  });

  it('tags platform by sender and category by role', () => {
    const ml = jobs.find((j) => /Machine Learning/.test(j.role))!;
    expect(ml.platform).toBe('email:scalar');
    expect(ml.company).toBe('Acme AI');
    expect(ml.category).toBe('AI/ML');
    const robo = jobs.find((j) => /Robotics/.test(j.role))!;
    expect(robo.category).toBe('Robotics/AV');
    expect(robo.company).toBe('RoboCo');
  });

  it('splitRoleCompany handles "at", separators, and bare text', () => {
    expect(splitRoleCompany('ML Intern at Waymo')).toEqual({ role: 'ML Intern', company: 'Waymo' });
    expect(splitRoleCompany('Waymo — Perception Intern')).toEqual({ role: 'Perception Intern', company: 'Waymo' });
    expect(splitRoleCompany('Data Science Internship')).toEqual({ role: 'Data Science Internship', company: '' });
  });

  it('SWE List layout: simplify.jobs link + preceding <strong>Company:</strong>', () => {
    const swelist: EmailMessage = {
      from: 'noreply@swelist.com', subject: 'New Internships', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml: `<p class="internship"><strong>The Trade Desk:</strong> <a href="https://simplify.jobs/p/abc?utm_source=swelist">Software Engineer Intern - Data Platform</a></p>
                 <p class="internship"><strong>Boeing:</strong> <a href="https://simplify.jobs/p/def">Structural Analysis Intern</a></p>`,
    };
    const jobs = parseJobEmails([swelist], new Date('2026-07-16T09:00:00Z'));
    const tt = jobs.find((j) => j.applyUrl.includes('/p/abc'))!;
    expect(tt.company).toBe('The Trade Desk');           // from the bold label, not split from the role
    expect(tt.role).toBe('Software Engineer Intern - Data Platform'); // full role kept (has " - ")
    expect(jobs.some((j) => /structural/i.test(j.role))).toBe(false); // off-field dropped
  });

  it('LinkedIn layout: trims "· Location (On-site)" and rejects a salary/badge bold label as company', () => {
    const li: EmailMessage = {
      from: 'jobs-noreply@linkedin.com', subject: 'jobs', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml: `<strong>$6K / year</strong> <a href="https://www.linkedin.com/jobs/view/123">Machine Learning Engineer Intern Neuralink &middot; Fremont, CA (On-site)</a>`,
    };
    const jobs = parseJobEmails([li], new Date('2026-07-16T09:00:00Z'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.company).not.toBe('$6K / year');   // salary chip rejected as company
    expect(jobs[0]!.role).toBe('Machine Learning Engineer Intern Neuralink'); // location tail trimmed at "·"
  });

  it('unwrapTracker pulls the real job URL out of an aggregator click-tracker', () => {
    const inner = 'https://jobs.lever.co/foo/abc123';
    const tracker = `https://email.runway.com/ss/c/xyz/1/2?url=${encodeURIComponent(inner)}`;
    expect(unwrapTracker(tracker)).toBe(inner);
    // a direct job URL is returned unchanged (fast path, no behavior change)
    expect(unwrapTracker(inner)).toBe(inner);
    // a non-job tracker with no inner job URL is left as-is
    expect(unwrapTracker('https://email.runway.com/c/open?u=hello')).toBe('https://email.runway.com/c/open?u=hello');
  });

  it('parses a tracker-wrapped aggregator digest (Runway/RippleMatch-style)', () => {
    const inner = 'https://boards.greenhouse.io/acme/jobs/999';
    const msg: EmailMessage = {
      from: 'Runway <jobs@runway.com>', subject: 'New internships', receivedDateTime: '2026-07-18T08:00:00Z',
      bodyHtml: `<a href="https://email.runway.com/ss/c/aaa/bbb?url=${encodeURIComponent(inner)}">Machine Learning Intern at Acme</a>`,
    };
    const jobs = parseJobEmails([msg], new Date('2026-07-18T09:00:00Z'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.applyUrl).toBe(inner);           // the REAL posting, not the tracker
    expect(jobs[0]!.platform).toBe('email:runway');
  });

  it('rejects a season/term bold label ("Fall 2026") as the company', () => {
    const jr: EmailMessage = {
      from: 'eric@jobrightai.com', subject: 'jobs', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml: `<strong>Fall 2026:</strong> <a href="https://boards.greenhouse.io/x/jobs/1">Machine Learning Intern at Databricks</a>`,
    };
    const jobs = parseJobEmails([jr], new Date('2026-07-16T09:00:00Z'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.company).not.toBe('Fall 2026'); // term label is not a company; falls back to the split
    expect(jobs[0]!.company).toBe('Databricks');
  });

  it('LinkedIn "View job:" text block yields clean role/company/location', () => {
    const li: EmailMessage = {
      from: 'jobs-noreply@linkedin.com', subject: 'Deep Learning Intern at PlusAI', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml: [
        'Machine Learning Engineer Intern',
        'Neuralink',
        'South San Francisco',
        'View job: https://www.linkedin.com/comm/jobs/view/4416832802/?trackingId=abc',
        '',
        'Mechanical Design Intern',
        'SpaceX',
        'Hawthorne',
        'View job: https://www.linkedin.com/comm/jobs/view/999/?trackingId=xyz',
      ].join('\n'),
    };
    const jobs = parseJobEmails([li], new Date('2026-07-16T09:00:00Z'));
    const nl = jobs.find((j) => j.company === 'Neuralink')!;
    expect(nl.role).toBe('Machine Learning Engineer Intern');   // clean, no company/location mashed in
    expect(nl.location).toBe('South San Francisco');
    expect(nl.platform).toBe('email:linkedin');
    expect(jobs.some((j) => j.company === 'SpaceX')).toBe(false); // off-field (Mechanical) dropped
  });

  it('a LinkedIn job is not doubled when both the text block and the HTML card anchor appear', () => {
    const li: EmailMessage = {
      from: 'jobs-noreply@linkedin.com', subject: 'jobs', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml:
        'Deep Learning Intern\nPlusAI\nSanta Clara\nView job: https://www.linkedin.com/comm/jobs/view/4416832802/?trackingId=abc\n' +
        '<a href="https://www.linkedin.com/jobs/view/4416832802/?refId=zzz">Deep Learning Intern PlusAI · Santa Clara, CA (On-site)</a>',
    };
    const jobs = parseJobEmails([li], new Date('2026-07-16T09:00:00Z'));
    expect(jobs.filter((j) => /deep learning intern/i.test(j.role))).toHaveLength(1); // canonical job-id dedup
    expect(jobs[0]!.company).toBe('PlusAI'); // the clean text-block version won
  });

  it('mergeHotlist dedups an email role against an existing board role by company|role', () => {
    const emailJob = parseJobEmails([{
      from: 'noreply@swelist.com', subject: 's', receivedDateTime: '2026-07-16T08:00:00Z',
      bodyHtml: '<strong>Waymo:</strong> <a href="https://simplify.jobs/p/xyz">Machine Learning Intern</a>',
    }], new Date('2026-07-16T09:00:00Z'));
    // the board scanner already has the same role under a different id/url
    const existing = [{ id: 'swelist-9f9f', company: 'Waymo', role: 'Machine Learning Intern', platform: 'swelist' }];
    const merged = mergeHotlist(emailJob, existing);
    expect(merged.filter((m) => /waymo/i.test(String(m.company)))).toHaveLength(1); // not doubled
  });

  it('mergeHotlist prepends new, dedups by id, caps', () => {
    const incoming = jobs as EmailJob[];
    const existing = [{ id: jobs[0]!.id, company: 'dupe' }, { id: 'watch-1', company: 'Board Co' }];
    const merged = mergeHotlist(incoming, existing, 50);
    // the duplicate id from `existing` is dropped (incoming wins, prepended)
    expect(merged.filter((m) => m.id === jobs[0]!.id)).toHaveLength(1);
    // the board entry survives after the email entries
    expect(merged.some((m) => m.id === 'watch-1')).toBe(true);
    expect(merged.length).toBe(incoming.length + 1);
  });
});
