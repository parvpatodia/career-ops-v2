/**
 * SPEC M3.5: the Notifier fires macOS banners for the designed human
 * touchpoints. Tested through a dry-run sink (no real banners) and a pure
 * AppleScript-string builder (escaping is the only thing that can break).
 */

import { describe, it, expect } from 'vitest';
import { Notifier, buildAppleScript, buildTerminalNotifierArgs } from '../../src/applier/Notifier.js';
import type { Notification } from '../../src/applier/Notifier.js';

function recorder(): { sink: (n: Notification) => void; sent: Notification[] } {
  const sent: Notification[] = [];
  return { sink: (n) => sent.push(n), sent };
}

describe('Notifier', () => {
  it('unknownQuestion sends an urgent unknown_question notification with company + label', () => {
    const r = recorder();
    new Notifier(r.sink).unknownQuestion('What is your favorite tensor library?', 'NVIDIA');

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.kind).toBe('unknown_question');
    expect(r.sent[0]!.urgent).toBe(true);
    expect(r.sent[0]!.message).toContain('NVIDIA');
    expect(r.sent[0]!.message).toContain('favorite tensor library');
  });

  it('captcha and abstained are urgent; batchComplete is a silent digest', () => {
    const r = recorder();
    const n = new Notifier(r.sink);
    n.captcha('Stripe');
    n.abstained('Stripe', 2);
    n.batchComplete('3 verified, 1 abstained');

    expect(r.sent.map((x) => [x.kind, x.urgent])).toEqual([
      ['captcha', true],
      ['abstain', true],
      ['batch_complete', false],
    ]);
  });

  it('records history for digest/summary use', () => {
    const r = recorder();
    const n = new Notifier(r.sink);
    n.unknownQuestion('q', 'Co');
    n.batchComplete('done');
    expect(n.history()).toHaveLength(2);
  });

  it('buildAppleScript escapes double quotes and backslashes so the literal cannot break', () => {
    const script = buildAppleScript({
      kind: 'unknown_question',
      title: 'Career-Ops',
      message: 'Role: "ML \\ Eng" intern',
      urgent: true,
    });
    // The message becomes a valid AppleScript string literal: " and \ escaped.
    expect(script).toContain('display notification "Role: \\"ML \\\\ Eng\\" intern"');
    expect(script).toContain('with title "Career-Ops"');
    expect(script).toContain('sound name "Glass"'); // urgent => sound
  });

  it('non-urgent notifications omit the sound', () => {
    const script = buildAppleScript({ kind: 'batch_complete', title: 't', message: 'm', urgent: false });
    expect(script).not.toContain('sound name');
  });

  it('newPosting is an urgent new_posting alert carrying the apply URL as openUrl', () => {
    const r = recorder();
    new Notifier(r.sink).newPosting('Wayve', 'Perception Intern', 'https://x.com/apply/1');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.kind).toBe('new_posting');
    expect(r.sent[0]!.urgent).toBe(true);
    expect(r.sent[0]!.openUrl).toBe('https://x.com/apply/1');
    expect(r.sent[0]!.message).toContain('Perception Intern');
  });

  it('buildTerminalNotifierArgs adds -open (clickable to apply) when openUrl is set', () => {
    const args = buildTerminalNotifierArgs({
      kind: 'new_posting', title: 'New: Wayve', message: 'Perception Intern',
      urgent: true, openUrl: 'https://x.com/apply/1',
    });
    const openIdx = args.indexOf('-open');
    expect(openIdx).toBeGreaterThan(-1);
    expect(args[openIdx + 1]).toBe('https://x.com/apply/1');
    expect(args).toContain('-message');
    expect(args[args.indexOf('-message') + 1]).toBe('Perception Intern');
    expect(args).toContain('-sound'); // urgent
  });

  it('buildTerminalNotifierArgs omits -open when there is no URL, and -sound when not urgent', () => {
    const args = buildTerminalNotifierArgs({ kind: 'batch_complete', title: 't', message: 'm', urgent: false });
    expect(args).not.toContain('-open');
    expect(args).not.toContain('-sound');
  });
});
