/**
 * UrlResolver tests — canonical URL conversion for each ATS platform.
 *
 * WHY: The single most common reason for empty form fields is navigating
 * to the wrong page (search results instead of application form).
 * Every URL transformation MUST have a test.
 */

import { describe, it, expect } from 'vitest';
import { UrlResolver } from '../../src/applier/UrlResolver.js';

describe('UrlResolver', () => {
  const resolver = new UrlResolver();

  // ── Handshake ─────────────────────────────────────────────────────────────

  it('converts Handshake job-search URL to posting URL', () => {
    const raw =
      'https://app.joinhandshake.com/job-search/10977226?query=machine+learning&page=1';
    const r = resolver.resolve(raw);
    expect(r.url).toBe('https://app.joinhandshake.com/stu/postings/10977226');
    expect(r.ats).toBe('handshake');
    expect(r.wasResolved).toBe(true);
  });

  it('leaves a Handshake posting URL unchanged', () => {
    const url = 'https://app.joinhandshake.com/stu/postings/12345';
    const r = resolver.resolve(url);
    expect(r.url).toBe(url);
    expect(r.ats).toBe('handshake');
    expect(r.wasResolved).toBe(false);
  });

  it('preserves the numeric job ID from Handshake search URL', () => {
    const raw = 'https://app.joinhandshake.com/job-search/9999999?foo=bar';
    const r = resolver.resolve(raw);
    expect(r.url).toContain('9999999');
  });

  // ── Greenhouse ────────────────────────────────────────────────────────────

  it('identifies Greenhouse board URL', () => {
    const r = resolver.resolve(
      'https://job-boards.greenhouse.io/acme/jobs/7654321'
    );
    expect(r.ats).toBe('greenhouse');
    expect(r.wasResolved).toBe(false);
  });

  it('identifies Greenhouse via gh_jid query param (custom domain)', () => {
    const r = resolver.resolve(
      'https://careers.example.com/apply?gh_jid=5182538008'
    );
    expect(r.ats).toBe('greenhouse');
  });

  // ── Lever ─────────────────────────────────────────────────────────────────

  it('identifies Lever URL', () => {
    const r = resolver.resolve(
      'https://jobs.lever.co/anthropic/abc-123'
    );
    expect(r.ats).toBe('lever');
    expect(r.wasResolved).toBe(false);
  });

  // ── Workday ───────────────────────────────────────────────────────────────

  it('identifies Workday URL', () => {
    const r = resolver.resolve(
      'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Remote/AI-Intern_JR1970783'
    );
    expect(r.ats).toBe('workday');
  });

  // ── Ashby ─────────────────────────────────────────────────────────────────

  it('identifies Ashby URL', () => {
    const r = resolver.resolve(
      'https://jobs.ashbyhq.com/cohere/abc123'
    );
    expect(r.ats).toBe('ashby');
  });

  // ── LinkedIn ──────────────────────────────────────────────────────────────

  it('identifies LinkedIn jobs URL', () => {
    const r = resolver.resolve(
      'https://www.linkedin.com/jobs/view/4233946786'
    );
    expect(r.ats).toBe('linkedin');
  });

  // ── Generic fallback ─────────────────────────────────────────────────────

  it('returns generic for custom career portals', () => {
    const r = resolver.resolve('https://lifeattiktok.com/search/7572665884');
    expect(r.ats).toBe('generic');
    expect(r.wasResolved).toBe(false);
  });

  it('returns generic for iCIMS URLs', () => {
    const r = resolver.resolve(
      'https://careers-jobyaviation.icims.com/jobs/4413/intern/job'
    );
    expect(r.ats).toBe('generic');
  });

  it('trims whitespace from the input URL', () => {
    const r = resolver.resolve(
      '  https://jobs.ashbyhq.com/openai/abc  '
    );
    expect(r.url).not.toContain(' ');
    expect(r.ats).toBe('ashby');
  });
});
