/**
 * Maps the apply-engine IdentityProfile (from config/profile.yml via
 * ProfileLoader, the single source of truth) to the ContactFacts the resume
 * renderer/verifier consume. Centralized so the contact projection is defined
 * once for PrepareResumes, the Tailor orchestrator, and the demo.
 */

import type { IdentityProfile } from '../applier/ProfileLoader.js';
import type { ContactFacts } from './ResumeVerifier.js';

export function contactFacts(id: IdentityProfile): ContactFacts {
  return {
    name: id.name,
    email: id.email,
    phone: id.phone,
    linkedin: id.linkedin,
    github: id.github,
    portfolio: id.portfolio,
    location: id.location,
  };
}
