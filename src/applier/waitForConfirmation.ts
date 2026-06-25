/**
 * waitForConfirmation: poll a SubmitDriver's readConfirmation() until a real ATS
 * confirmation appears or a deadline passes. This is how the background apply
 * loop (`npm run run -- --auto`) resumes WITHOUT a terminal prompt: after the
 * system fills the form and the human solves the captcha + clicks Submit in the
 * surfaced Chrome window, the page navigates to a confirmation and this detects
 * it, so the loop records + continues on its own.
 *
 * WHY this over a "did you submit? y/n" prompt: it keys off the REAL post-submit
 * confirmation the ATS renders (the same signal the Autopilot trusts), never a
 * human's self-report. No confirmation -> returns null -> the caller leaves the
 * job un-applied and moves on (verify-or-abstain: never claim a submit we cannot
 * observe). The clock and sleep are injectable so the polling is unit-tested
 * deterministically, with no real timers or browser.
 */

export interface WaitForConfirmationDeps {
  /** Reads the ATS confirmation, or null if the form has not been submitted yet. */
  readConfirmation: () => Promise<string | null>;
  /** Give up after this many ms with no confirmation (human absent / not done). */
  timeoutMs: number;
  /** Delay between polls. */
  intervalMs: number;
  /** Injectable monotonic clock (default Date.now), for tests. */
  now?: () => number;
  /** Injectable sleep (default setTimeout), for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Returns the confirmation string once observed, or null on timeout. Checks
 * once immediately (catches an already-submitted page), then every intervalMs
 * until the deadline. A throwing readConfirmation is treated as "not yet"
 * (null), never a crash, so a transient DOM read error does not abort the wait.
 */
export async function waitForConfirmation(deps: WaitForConfirmationDeps): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + deps.timeoutMs;

  for (;;) {
    const conf = await deps.readConfirmation().catch(() => null);
    if (conf && conf.trim().length > 0) return conf;
    if (now() >= deadline) return null;
    await sleep(deps.intervalMs);
  }
}

export type TransitionResult =
  | { kind: 'confirmed'; confirmation: string }
  | { kind: 'unreliable' }
  | { kind: 'timeout' };

/**
 * Confirm a submission by a null -> confirmed TRANSITION only.
 *
 * WHY: in the --auto background resume, polling starts on the still-UNSUBMITTED
 * form. Greenhouse/Generic readConfirmation has a loose body-text + URL fallback
 * that can read "confirmed" on a page that was never submitted (marketing copy,
 * a careers URL containing "success"/"thank"). Trusting that would FALSELY mark
 * the job Applied (invariant 1: never claim a submit we cannot observe).
 *
 * So we read a BASELINE first: if the page already reads confirmed before the
 * human acts, the signal is unreliable here -> 'unreliable' (the caller hands it
 * back, never auto-marks). Otherwise we poll for the real submit -> 'confirmed'
 * on the first confirmation, or 'timeout'. Pure over injectable now/sleep, so the
 * guard is unit-tested without a browser.
 */
export async function confirmViaTransition(deps: WaitForConfirmationDeps): Promise<TransitionResult> {
  const baseline = await deps.readConfirmation().catch(() => null);
  if (baseline && baseline.trim().length > 0) return { kind: 'unreliable' };
  const conf = await waitForConfirmation(deps);
  return conf ? { kind: 'confirmed', confirmation: conf } : { kind: 'timeout' };
}
