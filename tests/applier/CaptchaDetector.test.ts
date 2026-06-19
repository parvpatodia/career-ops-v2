/**
 * CaptchaDetector: a captcha is a human touchpoint (invariant 6, never solved).
 * The selector scan runs in the browser (demo-proven); the unit tests cover the
 * pure precedence (pickCaptcha) and that detectCaptcha is crash-safe on a fake
 * or non-page (returns null = "no captcha", never throws).
 */

import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { pickCaptcha, detectCaptcha } from '../../src/applier/CaptchaDetector.js';

describe('pickCaptcha', () => {
  it('returns null when no widget is present', () => {
    expect(pickCaptcha({ turnstile: false, hcaptcha: false, recaptcha: false })).toBeNull();
  });

  it('names each kind when present', () => {
    expect(pickCaptcha({ turnstile: false, hcaptcha: false, recaptcha: true })?.kind).toBe('recaptcha');
    expect(pickCaptcha({ turnstile: false, hcaptcha: true, recaptcha: false })?.kind).toBe('hcaptcha');
    expect(pickCaptcha({ turnstile: true, hcaptcha: false, recaptcha: false })?.kind).toBe('turnstile');
  });

  it('any one widget means a human is required (precedence is just naming)', () => {
    // Multiple present: precedence picks one, but the point is it is non-null.
    expect(pickCaptcha({ turnstile: true, hcaptcha: true, recaptcha: true })).not.toBeNull();
  });
});

describe('detectCaptcha', () => {
  it('returns null on a page with no evaluate (never crashes)', async () => {
    expect(await detectCaptcha({} as unknown as Page)).toBeNull();
  });

  it('maps the scanned flags to a signal', async () => {
    const page = { evaluate: async () => ({ turnstile: false, hcaptcha: false, recaptcha: true }) } as unknown as Page;
    expect((await detectCaptcha(page))?.kind).toBe('recaptcha');
  });

  it('treats a non-object evaluate result (or throw) as no captcha', async () => {
    const boolPage = { evaluate: async () => false } as unknown as Page;
    expect(await detectCaptcha(boolPage)).toBeNull();
    const throwPage = { evaluate: async () => { throw new Error('detached'); } } as unknown as Page;
    expect(await detectCaptcha(throwPage)).toBeNull();
  });
});
