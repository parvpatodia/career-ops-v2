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

export type PortalKind = 'workday' | 'greenhouse';

export type PortalSupport =
  | { supported: true; kind: PortalKind }
  | { supported: false; ats: string };

const SUPPORTED: ReadonlySet<PortalKind> = new Set<PortalKind>(['workday', 'greenhouse']);

export class PortalRouter {
  support(ats: string): PortalSupport {
    const a = ats.toLowerCase().trim();
    if ((SUPPORTED as ReadonlySet<string>).has(a)) {
      return { supported: true, kind: a as PortalKind };
    }
    return { supported: false, ats: a };
  }

  isSupported(ats: string): boolean {
    return this.support(ats).supported;
  }
}
