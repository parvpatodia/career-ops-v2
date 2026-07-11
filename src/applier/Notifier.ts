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
  | 'new_posting'
  | 'error';

export interface Notification {
  kind: NotifyKind;
  title: string;
  message: string;
  /** Urgent notifications play a sound; digests are silent. */
  urgent: boolean;
  /**
   * If set AND terminal-notifier is installed, CLICKING the banner opens this
   * URL (the apply page) — the "click the notification and start applying" flow.
   * osascript banners cannot do this (they open Script Editor), so without
   * terminal-notifier the URL is just shown in the message text.
   */
  openUrl?: string;
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
    case 'new_posting': return 'New job, apply fast';
    case 'error': return 'Error';
  }
}

/**
 * Builds the terminal-notifier args. Pure + exported so the mapping is unit-
 * tested without firing a banner. WHY -open: it makes the banner CLICKABLE —
 * clicking opens the apply URL, the "click the notification and start applying"
 * flow osascript cannot do. WHY -sender: attribute the banner to a real app so
 * it is NOT labelled "Script Editor".
 */
export function buildTerminalNotifierArgs(n: Notification): string[] {
  const args = ['-title', n.title, '-subtitle', kindLabel(n.kind), '-message', n.message];
  if (n.urgent) args.push('-sound', 'Glass');
  if (n.openUrl) args.push('-open', n.openUrl);
  args.push('-sender', 'com.googlecode.iterm2'); // any installed app id; avoids the Script-Editor label
  return args;
}

// Detect terminal-notifier ONCE per process; null = not yet checked.
let terminalNotifier: boolean | null = null;
function hasTerminalNotifier(): boolean {
  if (terminalNotifier !== null) return terminalNotifier;
  try {
    execFileSync('which', ['terminal-notifier'], { stdio: 'ignore' });
    terminalNotifier = true;
  } catch {
    terminalNotifier = false;
  }
  return terminalNotifier;
}

// WHY swallow errors: a notification is best-effort. If neither tool is present
// (non-mac CI) or Notification Center is unavailable, the pipeline must keep
// working, not crash on a failed banner. Prefer terminal-notifier (clickable +
// proper attribution); fall back to osascript (shows the URL in the text).
const defaultSink: NotifySink = (n) => {
  if (hasTerminalNotifier()) {
    try {
      execFileSync('terminal-notifier', buildTerminalNotifierArgs(n), { stdio: 'ignore', timeout: 5_000 });
      return;
    } catch {
      /* fall through to osascript */
    }
  }
  try {
    execFileSync('osascript', ['-e', buildAppleScript(n)], { stdio: 'ignore', timeout: 5_000 });
  } catch {
    /* best-effort: a failed banner never blocks the pipeline */
  }
};

export class Notifier {
  private readonly sent: Notification[] = [];

  constructor(private readonly sink: NotifySink = defaultSink) {}

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

  /** A newly-posted job the watcher caught: apply fast to be among the first. */
  newPosting(company: string, role: string, url: string): void {
    this.notify({
      kind: 'new_posting',
      title: `New: ${truncate(company, 40)}`,
      message: `${truncate(role, 60)} · apply fast: ${url}`,
      urgent: true,
      openUrl: url, // clickable-to-apply when terminal-notifier is installed
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
