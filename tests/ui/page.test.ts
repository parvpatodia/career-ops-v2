/**
 * The UI page ships a hand-written <script> embedded in a TS template literal.
 * A regex with "\/" inside that literal collapses to "/", which silently turned
 * safeUrl's `/^https?:\/\//i` into `/^https?://i` — where `//` starts a line
 * comment and breaks the ENTIRE script (the page stuck on "Loading…", 2026-07-17).
 * These guard that class of bug without a browser.
 */
import { describe, it, expect } from 'vitest';
import { renderPage } from '../../src/ui/page.js';

describe('renderPage', () => {
  it('embeds a <script> that parses as valid JavaScript', () => {
    const html = renderPage();
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    expect(() => new Function(m![1]!)).not.toThrow();
  });

  it('preserves escaped slashes in the safeUrl regex through the template literal', () => {
    // The served regex must be /^https?:\/\// (escaped slashes), never /^https?://
    // (which the JS parser reads as a comment).
    expect(renderPage()).toContain('https?:\\/\\/');
  });
});
