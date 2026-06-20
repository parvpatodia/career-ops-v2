/**
 * Desktop notifications for the application autopilot (AGENTS.md mission:
 * captchas and first-occurrence unknown questions are the only designed human
 * touchpoints; both need an immediate, visible signal on Parv's laptop).
 *
 * WHY osascript: it is built into macOS, needs no install, and posts a real
 * Notification Center banner. WHY an injectable sink: tests must NOT pop real
 * banners (non-deterministic, noisy), and the demo MUST. The delivery function
 * is a constructor dependency, so the default fires osascript and tests inject
 * a recorder.
 *
 * WHY execFileSync (not exec): no shell is spawned, so the message text cannot
 * be interpreted as a shell command. The only escaping needed is for the
 * AppleScript string literal itself, done by buildAppleScript().
 */

import { execFileSync } from 'child_process';

export type NotifyKind =
  | 'unknown_question'
  | 'captcha'
  | 'abstain'
  | 'batch_complete'
  | 'error';

export interface Notification {
  kind: NotifyKind;
  title: string;
  message: string;
  /** Urgent notifications play a sound; digests are silent. */
  urgent: boolean;
}

export type NotifySink = (n: Notification) => void;

/**
 * Builds the AppleScript for `osascript -e`. Pure and exported so the escaping
 * is unit-tested without firing a real banner. A double-quote or backslash in
 * a job title or question must not break the AppleScript string literal.
 */
export function buildAppleScript(n: Notification): string {
  const lit = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const sound = n.urgent ? ` sound name "Glass"` : '';
  return `display notification ${lit(n.message)} with title ${lit(n.title)} subtitle ${lit(kindLabel(n.kind))}${sound}`;
}

function kindLabel(kind: NotifyKind): string {
  switch (kind) {
    case 'unknown_question': return 'Answer needed';
    case 'captcha': return 'Captcha — take over';
    case 'abstain': return 'Abstained — review';
    case 'batch_complete': return 'Batch complete';
    case 'error': return 'Error';
  }
}

// WHY swallow errors: a notification is best-effort. If osascript is missing
// (non-mac CI) or Notification Center is unavailable, the autopilot must keep
// working, not crash on a failed banner.
const osascriptSink: NotifySink = (n) => {
  try {
    execFileSync('osascript', ['-e', buildAppleScript(n)], { stdio: 'ignore', timeout: 5_000 });
  } catch {
    /* best-effort: a failed banner never blocks the pipeline */
  }
};

export class Notifier {
  private readonly sent: Notification[] = [];

  constructor(private readonly sink: NotifySink = osascriptSink) {}

  notify(n: Notification): void {
    this.sent.push(n);
    this.sink(n);
  }

  /** A genuinely-unknown question that needs a human answer (then auto-resume). */
  unknownQuestion(label: string, company: string): void {
    this.notify({
      kind: 'unknown_question',
      title: 'Career-Ops: answer needed',
      message: `${company}: "${truncate(label, 80)}"`,
      urgent: true,
    });
  }

  captcha(company: string): void {
    this.notify({
      kind: 'captcha',
      // Do NOT tell Parv to click the banner: an osascript notification opens
      // Script Editor, not the browser. Attended mode raises the Chrome window.
      title: 'Career-Ops: captcha',
      message: `${company}: switch to the Chrome window and solve the captcha (don't click this banner).`,
      urgent: true,
    });
  }

  abstained(company: string, count: number): void {
    this.notify({
      kind: 'abstain',
      title: 'Career-Ops: abstained',
      message: `${company}: ${count} field(s) need review before submit.`,
      urgent: true,
    });
  }

  batchComplete(summary: string): void {
    this.notify({
      kind: 'batch_complete',
      title: 'Career-Ops: batch complete',
      message: summary,
      urgent: false,
    });
  }

  error(message: string): void {
    this.notify({ kind: 'error', title: 'Career-Ops: error', message: truncate(message, 120), urgent: true });
  }

  /** Notifications sent so far (for tests and digest summaries). */
  history(): readonly Notification[] {
    return this.sent;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
