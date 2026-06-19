/**
 * The auto-send gate: verify-or-abstain for cold email, the email analogue of
 * the job-apply submit gate. A draft auto-sends only when EVERY check passes;
 * any miss returns an abstain with reasons and the draft goes to the human
 * review pile instead of a stranger's inbox.
 *
 * Checks (all required):
 *  1. not suppressed   - never email a contact already sent/replied/bounced/opted-out
 *  2. email verified   - Hunter status is exactly 'valid' (no bounces to risky addresses)
 *  3. clean style      - StyleLinter finds no dash or AI-tell in subject or body
 *  4. real personalization - a non-empty hook that actually appears in the body
 *  5. grounded claims  - every self-claim quotes an approved snippet present in the body
 *
 * WHY 4 and 5 check the BODY, not just metadata: a draft that merely declares a
 * personalization field or lists claim keys, without the text being in the email,
 * is the vacuous-pass class (LESSONS 2026-06-15: [].every() === true). Zero
 * claims or empty personalization abstains, never passes by emptiness.
 */

import type { EmailDraft, GateOutcome } from './types.js';
import type { StyleLinter } from './StyleLinter.js';
import type { SnippetBook } from './SnippetBook.js';

export interface DraftGateDeps {
  linter: StyleLinter;
  snippets: SnippetBook;
  /** Reads the OutreachStore projection; injected so the gate stays pure/testable. */
  isSuppressed: (contactId: string) => boolean;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class DraftGate {
  constructor(private readonly deps: DraftGateDeps) {}

  evaluate(draft: EmailDraft): GateOutcome {
    const reasons: string[] = [];
    const bodyNorm = norm(draft.body);

    if (this.deps.isSuppressed(draft.contactId)) {
      reasons.push('contact is suppressed (already sent, replied, bounced, or opted out)');
    }

    if (draft.emailStatus !== 'valid') {
      reasons.push(`email status is "${draft.emailStatus ?? 'unknown'}", only "valid" auto-sends`);
    }

    const lint = this.deps.linter.lint(`${draft.subject}\n${draft.body}`);
    if (!lint.ok) {
      reasons.push(`style violations: ${lint.violations.map((v) => v.label).join(', ')}`);
    }

    const pers = draft.personalization.trim();
    if (pers === '') {
      reasons.push('no personalization');
    } else if (!bodyNorm.includes(norm(pers))) {
      reasons.push('personalization line is not present in the body');
    }

    if (draft.claimKeys.length === 0) {
      reasons.push('no approved self-claims (a draft with zero grounded claims cannot auto-send)');
    } else {
      for (const key of draft.claimKeys) {
        const snippet = this.deps.snippets.resolve(key);
        if (snippet === undefined) {
          reasons.push(`unknown claim snippet: "${key}"`);
        } else if (!bodyNorm.includes(norm(snippet))) {
          reasons.push(`claim snippet "${key}" is not quoted in the body`);
        }
      }
    }

    return reasons.length === 0
      ? { decision: 'send', draft }
      : { decision: 'abstain', draft, reasons };
  }
}
