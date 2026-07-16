/**
 * M8 F5: parse job-alert digest emails into FreshRole candidates. Properties:
 * only on-field + junior + US + F-1-eligible job links survive; footer/social/
 * unsubscribe anchors and off-field/non-US/clearance rows are dropped; dedup by
 * URL; role/company split is best-effort.
 */
import { describe, it, expect } from 'vitest';
import { parseJobEmails, splitRoleCompany, mergeHotlist } from '../../src/inbox/emailJobs.js';
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
