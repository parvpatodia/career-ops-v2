/**
 * SPEC M7: PortalRouter. Only the ATS portals with a verified FormSource are
 * supported; everything else abstains (never falls back to a guessed fill).
 */

import { describe, it, expect } from 'vitest';
import { PortalRouter } from '../../src/orchestrator/PortalRouter.js';

const router = new PortalRouter();

describe('PortalRouter', () => {
  it('supports the verify-or-abstain portals (Workday, Greenhouse)', () => {
    expect(router.support('workday')).toEqual({ supported: true, kind: 'workday' });
    expect(router.support('greenhouse')).toEqual({ supported: true, kind: 'greenhouse' });
    expect(router.isSupported('workday')).toBe(true);
  });

  it('is case/space insensitive', () => {
    expect(router.support(' Greenhouse ')).toEqual({ supported: true, kind: 'greenhouse' });
  });

  it.each(['lever', 'ashby', 'linkedin', 'handshake', 'generic', 'unknown'])(
    'abstains on %s (no verified filler — never guesses)',
    (ats) => {
      const s = router.support(ats);
      expect(s.supported).toBe(false);
      if (!s.supported) expect(s.ats).toBe(ats);
      expect(router.isSupported(ats)).toBe(false);
    }
  );
});
