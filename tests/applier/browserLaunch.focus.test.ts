/**
 * M8 F6: the background-fill flow must not steal the user's screen. The osascript
 * strings are the only thing that can silently break, so they are pure + tested
 * (mirrors the Notifier AppleScript-builder pattern). frontmostApp/restoreApp
 * themselves are best-effort, darwin-only, and no-op elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { frontmostAppScript, restoreAppScript, restoreApp } from '../../src/applier/browserLaunch.js';

describe('focus restore scripts', () => {
  it('reads the frontmost process name', () => {
    expect(frontmostAppScript()).toBe(
      'tell application "System Events" to get name of first process whose frontmost is true'
    );
  });

  it('restores focus by process name via System Events', () => {
    expect(restoreAppScript('Code')).toBe(
      'tell application "System Events" to set frontmost of (first process whose name is "Code") to true'
    );
  });

  it('strips quotes/backslashes from the name so the literal cannot break', () => {
    expect(restoreAppScript('Ev"il\\App')).toContain('name is "EvilApp"');
  });

  it('restoreApp is a no-op (never throws) for a null name', async () => {
    await expect(restoreApp(null)).resolves.toBeUndefined();
  });
});
