/**
 * PortalRouter: the single authority for "which ATS does the verify-or-abstain
 * apply engine actually support". An application's ATS (from UrlResolver) maps
 * either to a portal that has a verified FormSource, or to `unsupported`.
 *
 * WHY only Workday + Greenhouse: those are the two portals with an
 * AtsFormSource that builds an exact IntentPayload, reads every field back, and
 * abstains on uncertainty (M3/M4). Lever, Ashby, LinkedIn, Handshake have only
 * the v1 handlers, which are NOT verify-or-abstain. Routing an unsupported ATS
 * to a guess would violate invariant 1, so it ABSTAINS instead. Adding Lever or
 * Ashby is one FormSource away (M4 noted ~one file each); register it here then.
 */

export type PortalKind = 'workday' | 'greenhouse' | 'generic';

export type PortalSupport =
  | { supported: true; kind: PortalKind }
  | { supported: false; ats: string };

const FIRST_CLASS: ReadonlySet<string> = new Set(['workday', 'greenhouse']);
// Excluded by policy, never automated even generically (LESSONS 2026-06-10:
// LinkedIn Easy Apply automation causes account bans).
const EXCLUDED: ReadonlySet<string> = new Set(['linkedin']);

export class PortalRouter {
  support(ats: string): PortalSupport {
    const a = ats.toLowerCase().trim();
    if (FIRST_CLASS.has(a)) return { supported: true, kind: a as PortalKind };
    if (EXCLUDED.has(a)) return { supported: false, ats: a };
    // Everything else: the vendor-neutral GenericFormSource. This is breadth,
    // NOT a guess — it still fills via the IntentPayload gate and abstains on a
    // read-back mismatch (verify-or-abstain). A first-class FormSource (a
    // board-API schema) is more precise; register it in FIRST_CLASS when built.
    return { supported: true, kind: 'generic' };
  }

  isSupported(ats: string): boolean {
    return this.support(ats).supported;
  }
}
