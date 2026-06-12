/**
 * Records what actually happened around a submission, in the order it
 * happened (AGENTS.md project override: a receipt is written for every
 * submission; Tsenta's receipt pattern, with the event log underneath).
 *
 * Event sequencing is honest about reality:
 * - fill_verified lands BEFORE the submit click (separate event).
 * - submitted (+ confirmed, when the ATS answered synchronously) land
 *   AFTER the click as ONE correlated group, so a receipt can never
 *   half-land. A crash between click and group-append leaves
 *   fill_verified with no submitted: the recovery signal for "outcome
 *   unknown, human must check", which is the truthful state.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { EventStore, AppendInput } from '../store/EventStore.js';
import type { FieldIntent, AbstainReason } from './IntentPayload.js';
import type { VerifierVerdict } from './Verifier.js';

export interface Receipt {
  appId: string;
  correlationId: string;
  ts: string;
  company: string;
  role: string;
  fields: Array<{ label: string; value: string }>;
  skipped: string[];
  resumeSha256?: string;
  screenshotPaths: string[];
  atsConfirmation?: string;
}

export interface SubmissionArgs {
  appId: string;
  company: string;
  role: string;
  intents: FieldIntent[];
  skipped: string[];
  resumePdfPath?: string;
  screenshotPaths: string[];
  atsConfirmation?: string;
}

const DEFAULT_RECEIPTS_DIR = 'data/receipts';

export class SubmissionRecorder {
  constructor(
    private readonly store: EventStore,
    private readonly receiptsDir: string = DEFAULT_RECEIPTS_DIR
  ) {}

  recordFillVerified(appId: string, verdict: VerifierVerdict): void {
    this.store.append({
      type: 'fill_verified',
      appId,
      payload: { pass: verdict.pass, checks: verdict.checks.length },
    });
  }

  recordAbstain(appId: string, reasons: AbstainReason[]): void {
    this.store.append({ type: 'abstained', appId, payload: { reasons } });
  }

  /**
   * Throws TransitionError on a second submission for the same appId; the
   * receipt file is only written after the group append succeeded, so a
   * rejected duplicate archives nothing.
   */
  recordSubmission(args: SubmissionArgs): Receipt {
    const correlationId = `sub-${args.appId}-${Date.now()}`;
    const receipt: Receipt = {
      appId: args.appId,
      correlationId,
      ts: new Date().toISOString(),
      company: args.company,
      role: args.role,
      fields: args.intents.map((i) => ({ label: i.field.label, value: i.value })),
      skipped: args.skipped,
      ...(args.resumePdfPath ? { resumeSha256: sha256File(args.resumePdfPath) } : {}),
      screenshotPaths: args.screenshotPaths,
      ...(args.atsConfirmation ? { atsConfirmation: args.atsConfirmation } : {}),
    };

    const group: AppendInput[] = [
      { type: 'submitted', appId: args.appId, payload: { receipt: receipt as unknown as Record<string, unknown> } },
    ];
    if (args.atsConfirmation) {
      group.push({
        type: 'confirmed',
        appId: args.appId,
        payload: { atsConfirmation: args.atsConfirmation },
      });
    }
    this.store.appendGroup(group, correlationId);

    this.archive(receipt);
    return receipt;
  }

  /** For confirmations that arrive after the fact (email, async banner). */
  recordConfirmation(appId: string, correlationId: string, atsConfirmation: string): void {
    this.store.appendGroup(
      [{ type: 'confirmed', appId, payload: { atsConfirmation } }],
      correlationId
    );
  }

  private archive(receipt: Receipt): void {
    fs.mkdirSync(this.receiptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.receiptsDir, `${receipt.correlationId}.json`),
      JSON.stringify(receipt, null, 2) + '\n'
    );
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
