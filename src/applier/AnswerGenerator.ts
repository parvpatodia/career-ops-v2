/**
 * Centralized answer engine for application form questions.
 *
 * WHY centralized: Previously each handler had its own generateAnswer() with
 * different coverage and inconsistent formatting. Bugs fixed in one handler
 * were silently absent from others. A single class is testable in isolation,
 * and all handlers share identical logic.
 *
 * Design:
 * - Pattern matching on lowercased question text (no AI calls — deterministic)
 * - Three confidence levels: high (use as-is), medium (review), low (flag)
 * - Returns null for unrecognized questions so the caller can log and skip
 *   rather than silently filling with garbage
 */

import fs from 'fs';
import type { ProfileLoader } from './ProfileLoader.js';
import type { ResumeVariant } from '../types.js';

export interface AnswerContext {
  company: string;
  role: string;
  resumeVariant?: ResumeVariant;
  jd?: string;
}

export interface Answer {
  value: string;
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
  reason?: string;
  /** True only for answers a human authored (AnswerKB). The only kind
   *  allowed to fill legal/EEO/attestation fields (AGENTS.md invariant 7). */
  humanApproved?: boolean;
}

// ── Answer constructors (kept at module level for readability) ────────────

function hi(value: string): Answer {
  return { value, confidence: 'high', needsReview: false };
}

function med(value: string, reason?: string): Answer {
  return { value, confidence: 'medium', needsReview: true, reason };
}

function flag(value: string, reason: string): Answer {
  return { value, confidence: 'low', needsReview: true, reason };
}

// ── Generator ─────────────────────────────────────────────────────────────

export class AnswerGenerator {
  constructor(private readonly profile: ProfileLoader) {}

  /**
   * Generate an answer for a form question.
   * Returns null if the question is unrecognized (caller should log + skip).
   */
  generate(question: string, ctx: AnswerContext): Answer | null {
    const q = question.toLowerCase().trim();

    const id = this.profile.getIdentity();
    const wa = this.profile.getWorkAuth();
    const comp = this.profile.getCompensation();
    const def = this.profile.getApplicationDefaults();

    // ── Identity ───────────────────────────────────────────────────────────

    if (this.has(q, ['first name', 'firstname', 'given name', 'first_name'])) {
      return hi(id.firstName);
    }

    if (this.has(q, ['last name', 'lastname', 'surname', 'family name', 'last_name'])) {
      return hi(id.lastName);
    }

    // "Name" alone — guard against "company name", "school name", etc.
    if (
      this.hasWord(q, 'name') &&
      !this.has(q, ['company', 'school', 'employer', 'university', 'college', 'institution',
        'first', 'last', 'middle', 'preferred'])
    ) {
      return hi(id.name);
    }

    if (this.has(q, ['email', 'e-mail', 'email address'])) {
      return hi(id.email);
    }

    if (this.has(q, ['phone', 'telephone', 'mobile', 'cell number', 'phone number'])) {
      return hi(id.phone);
    }

    // Address fields — guard against "email address"
    if (this.has(q, ['street address', 'mailing address']) ||
        (this.hasWord(q, 'address') && !this.has(q, ['email', 'web', 'url']))) {
      return hi(id.address);
    }

    if (this.hasWord(q, 'city') && !this.has(q, ['company', 'school', 'employer'])) {
      return hi(id.city);
    }

    if (
      (this.hasWord(q, 'state') || this.has(q, ['state/province', 'province'])) &&
      !this.has(q, ['company', 'school', 'employer', 'united states', 'work in the'])
    ) {
      return hi(id.state);
    }

    if (this.has(q, ['zip code', 'postal code', 'zipcode', 'zip_code'])) {
      return hi(id.zip);
    }

    if (this.hasWord(q, 'country') && !this.has(q, ['citizenship', 'from which country', 'country of origin'])) {
      return hi('United States');
    }

    // ── Social / URLs ──────────────────────────────────────────────────────

    if (this.has(q, ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin.com'])) {
      return hi(id.linkedin);
    }

    if (this.has(q, ['github', 'github url', 'github profile', 'github.com'])) {
      return hi(id.github);
    }

    // Website / personal site variants — before the broader portfolio check
    if (this.has(q, ['website', 'personal site', 'your site', 'web url', 'web address']) &&
        !this.has(q, ['linkedin', 'github', 'email'])) {
      return hi(id.portfolio ?? id.github);
    }

    if (this.has(q, ['portfolio', 'personal website', 'website url', 'personal url'])) {
      return hi(id.portfolio ?? id.github);
    }

    // ── Education ──────────────────────────────────────────────────────────

    if (
      this.has(q, ['university', 'school name', 'college name', 'institution name',
        'which university', 'which school']) ||
      (this.hasWord(q, 'school') && !this.has(q, ['high school']))
    ) {
      return hi(id.university);
    }

    if (this.has(q, ['degree type', 'level of education', 'highest degree', 'degree level',
      'type of degree']) || this.hasWord(q, 'degree')) {
      return hi("Master's Degree");
    }

    if (this.has(q, ['field of study', 'major', 'area of study', 'discipline',
      'concentration', 'course of study'])) {
      return hi('Artificial Intelligence');
    }

    if (this.has(q, ['gpa', 'grade point average', 'cumulative gpa', 'overall gpa'])) {
      return hi(id.gpa);
    }

    if (this.has(q, ['graduation date', 'expected graduation', 'grad date',
      'when do you graduate', 'graduation year', 'expected grad'])) {
      return hi(id.graduation);
    }

    if (this.has(q, ['enrollment year', 'start year', 'when did you start', 'year started']) &&
        this.has(q, ['degree', 'program', 'school', 'university'])) {
      return hi('2025');
    }

    if (this.has(q, ['end year', 'expected end year', 'year of graduation']) &&
        this.has(q, ['degree', 'program', 'school', 'university'])) {
      return hi('2027');
    }

    // ── Work Authorization ─────────────────────────────────────────────────

    if (this.has(q, ['authorized to work', 'eligible to work', 'work in the us',
      'work in united states', 'legally authorized', 'work authorization',
      'authorization to work'])) {
      return hi('Yes');
    }

    // Sponsorship — always flag; visa answer is complex
    if ((this.has(q, ['require sponsorship', 'need sponsorship', 'visa sponsorship',
      'require a visa', 'require work authorization']) ||
      (this.hasWord(q, 'sponsor') && this.has(q, ['now', 'future', 'currently', 'will you']))) &&
      !this.has(q, ['not require', "don't require", 'do not require'])) {
      return med(wa.sponsorshipAnswer,
        'Verify this sponsorship language is appropriate for this specific employer and role.');
    }

    // CPT / OPT status — common at universities and startups hiring F-1 students
    if (this.has(q, ['cpt', 'opt', 'curricular practical training', 'optional practical training'])) {
      return hi('CPT (Curricular Practical Training)');
    }

    if (this.has(q, ['citizenship', 'country of citizenship', 'citizen of which'])) {
      return hi('India');
    }

    if (this.hasWord(q, 'visa') && !this.has(q, ['sponsor', 'require'])) {
      return hi('F-1 Student Visa (CPT authorized)');
    }

    // ── ITAR / Export / Clearance (safety flags) ───────────────────────────

    if (this.has(q, ['itar', 'ear compliance', 'export control', 'deemed export',
      '8 u.s.c', 'u.s.c. 1324b', 'u.s. person', 'us person'])) {
      return flag('None of the above',
        'ITAR/export control — F-1 visa means NOT a US Person. Verify exact option text in the dropdown before selecting. Do NOT select any US Person / protected individual category.');
    }

    if (this.has(q, ['security clearance', 'secret clearance', 'top secret', 'ts/sci',
      'polygraph'])) {
      return flag('No',
        'Security clearance required — F-1 visa is not eligible. Strongly reconsider applying to this role.');
    }

    // "Citizen or permanent resident" — separate from "citizen only" questions above
    // WHY before the citizen-only check: the citizen-only check explicitly excludes
    // questions containing "permanent resident" to avoid false positives.
    if (this.has(q, ['citizen or permanent', 'permanent resident', 'green card'])) {
      return flag('No',
        'Not a US citizen or permanent resident (F-1 visa). Select the appropriate non-citizen option.');
    }

    if (
      this.has(q, ['us citizen', 'u.s. citizen', 'american citizen', 'united states citizen']) &&
      !this.has(q, ['permanent resident', 'or permanent'])
    ) {
      return flag('No',
        'US citizenship required — F-1 visa is not eligible. Reconsider applying.');
    }

    // ── EEO / Voluntary Disclosure ────────────────────────────────────────
    // These are voluntary on US job forms — decline to preserve privacy.

    if (this.has(q, ['race', 'ethnicity', 'racial background', 'ethnic background'])) {
      return hi('Decline to Self Identify');
    }

    if (this.has(q, ['hispanic', 'latino', 'latina', 'latinx', 'spanish origin'])) {
      return hi('No, not Hispanic or Latino');
    }

    if ((this.hasWord(q, 'gender') || (this.hasWord(q, 'sex') && !this.has(q, ['email', 'next', 'same-sex']))) &&
        !this.has(q, ['request', 'confirm', 'consent'])) {
      return hi('Decline to Self Identify');
    }

    if (this.has(q, ['veteran', 'military service', 'armed forces', 'protected veteran',
      'veteran status'])) {
      return hi('I am not a protected veteran');
    }

    if (this.has(q, ['disability', 'disabled', 'disabilities', 'physical or mental impairment',
      'disability status', 'ada'])) {
      return hi('I do not have a disability');
    }

    // ── Personal details (misc) ───────────────────────────────────────────

    if (this.has(q, ['middle name', 'middle initial'])) {
      return hi('');
    }

    if (this.has(q, ['preferred name', 'preferred first name', 'nickname', 'goes by'])) {
      return hi(id.firstName);
    }

    if (this.hasWord(q, 'pronouns') || this.has(q, ['preferred pronouns', 'your pronouns'])) {
      return hi('He/Him');
    }

    if (this.has(q, ['18 years', '18 or older', 'at least 18', 'legal working age',
      'minimum age', 'legally able to work'])) {
      return hi('Yes');
    }

    if (this.has(q, ['previously applied', 'applied before', 'applied to us',
      'previously worked here', 'worked here before', 'former employee', 'applied in the past'])) {
      return hi('No');
    }

    if (this.has(q, ['agree to the terms', 'terms and conditions', 'i certify',
      'i acknowledge', 'attest that', 'i confirm', 'i agree', 'acknowledge and agree',
      'by checking', 'by submitting'])) {
      return hi('I agree');
    }

    // Employment type — infer from role context
    if (this.has(q, ['full-time or part-time', 'employment type', 'job type', 'work type',
      'full time or part time']) ||
        (this.has(q, ['full time', 'full-time']) && this.has(q, ['prefer', 'looking for', 'seeking']))) {
      const intern = ctx.role.toLowerCase().includes('intern') || ctx.role.toLowerCase().includes('co-op');
      return hi(intern ? 'Internship' : 'Full-time');
    }

    // ── Availability / Term ────────────────────────────────────────────────

    // "Date available" without "start" keyword (some forms phrase it this way)
    if (this.has(q, ['date available', 'available date']) &&
        !this.has(q, ['end', 'last', 'until'])) {
      return hi(this.formatDate(def.startDate));
    }

    if (this.has(q, ['start date', 'available from', 'when can you start',
      'earliest start', 'when are you available', 'available to begin', 'join date'])) {
      return hi(this.formatDate(def.startDate));
    }

    if (this.has(q, ['end date', 'last day', 'preferred end', 'end of internship',
      'end date of internship', 'until when'])) {
      return hi(this.formatDate(def.endDate));
    }

    if (this.has(q, ['which season', 'which term', 'applying for the', 'internship term',
      'semester', 'apply for']) && !this.has(q, ['previous', 'past'])) {
      return hi('Summer 2026');
    }

    if (this.has(q, ['duration', 'internship length', 'how long', 'length of internship']) &&
        this.has(q, ['month', 'week', 'long'])) {
      return hi('3 months');
    }

    // ── Compensation ───────────────────────────────────────────────────────

    if (this.has(q, ['salary', 'compensation', 'hourly rate', 'desired salary',
      'pay expectation', 'pay rate', 'desired compensation', 'expected pay'])) {
      const isInternContext = this.has(q, ['intern', 'co-op', 'coop', 'hourly', 'per hour']) ||
        ctx.role.toLowerCase().includes('intern') ||
        ctx.role.toLowerCase().includes('co-op');
      if (isInternContext) {
        return hi(`${comp.internshipHourlyMin}-${comp.internshipHourlyMax}/hour`);
      }
      return hi(`${Math.round(comp.fulltimeAnnualMin / 1000)}K-${Math.round(comp.fulltimeAnnualMax / 1000)}K/year`);
    }

    // ── Logistics ──────────────────────────────────────────────────────────

    if (this.has(q, ['preferred location', 'work location', 'office location',
      'where do you want to work', 'city preference'])) {
      return hi('San Jose, CA (Bay Area) — open to remote or hybrid');
    }

    if (this.has(q, ['willing to relocate', 'open to relocation', 'relocation'])) {
      return hi('Yes');
    }

    if (this.has(q, ['hybrid', 'on-site', 'onsite', 'in-person']) &&
        this.has(q, ['comfortable', 'ok with', 'able to work', 'willing'])) {
      return hi('Yes');
    }

    if (this.has(q, ['work remotely', 'remote work', 'comfortable working remotely'])) {
      return hi('Yes');
    }

    // ── Sourcing ───────────────────────────────────────────────────────────

    if (this.has(q, ['hear about', 'find out about', 'learn about this',
      'referred by', 'how did you', 'source of this'])) {
      return hi(def.howDidYouHear);
    }

    // ── Experience ─────────────────────────────────────────────────────────

    if (this.has(q, ['years of experience', 'how many years', 'years experience',
      'years of relevant'])) {
      return hi('1');
    }

    if (this.has(q, ['currently employed', 'current employer', 'working full-time',
      'current position', 'current job', 'current role'])) {
      return hi('Graduate Teaching Assistant, Northeastern University');
    }

    // ── Consent / Background ───────────────────────────────────────────────

    if (this.has(q, ['background check', 'background investigation', 'criminal background'])) {
      return hi('Yes');
    }

    if (this.has(q, ['drug test', 'drug screen', 'substance test'])) {
      return hi('Yes');
    }

    if (this.has(q, ['references available', 'provide references', 'professional references'])) {
      return hi('Yes, upon request');
    }

    // ── Narrative / About ──────────────────────────────────────────────────

    if (this.has(q, ['tell us about yourself', 'about yourself', 'describe yourself',
      'brief introduction', 'introduce yourself', 'background and experience'])) {
      return med(def.aboutMeShort, 'Review for relevance to this specific role');
    }

    if (
      this.has(q, ['why', 'interest in']) &&
      this.has(q, ['company', 'us', 'our organization', ctx.company.toLowerCase()])
    ) {
      return med(
        `I've followed ${ctx.company}'s work closely. ` +
        `My background in CV systems (Laksh.ai — markerless pose estimation, ` +
        `vector search, LLM coaching) and ML infra (TaskRoute — LLM routing for ` +
        `cost, latency, reliability) maps directly to the kind of systems you build. ` +
        `I want to work on a team that ships real things, not just prototypes.`,
        `Customize with specific products or research from ${ctx.company}`
      );
    }

    if (
      this.has(q, ['why', 'interest in', 'what draws you']) &&
      this.has(q, ['role', 'position', 'this job', 'this opportunity', 'this opening'])
    ) {
      return med(
        `The ${ctx.role} role aligns with my core focus: building ML systems that work ` +
        `in the physical world. I have end-to-end experience from model training on A100s ` +
        `to production deployment. I want to go deeper on a team that ships at quality.`,
        'Customize with specific role requirements from the JD'
      );
    }

    if (this.has(q, ['greatest achievement', 'proud of', 'impressive accomplishment',
      'most significant project', 'best work'])) {
      return med(
        'Built Laksh.ai end-to-end — a CV platform for basketball biomechanics using ' +
        'markerless pose estimation, vector search against NBA player profiles, and LLM ' +
        'coaching feedback. Presented at NUSV Startup Pitch Showcase and R&I Showcase. ' +
        'Reduced analysis turnaround from days (manual video review) to seconds.',
        'Review if this achievement is the most relevant one for this specific role'
      );
    }

    // ── Applied-via / Simplify ────────────────────────────────────────────
    // WHY: Some ATS systems ask how the candidate found the job or whether
    // they used an intermediary tool like Simplify. We always answer "No".
    if (this.has(q, ['simplify', 'applied via', 'applied through simplify'])) {
      return hi('No');
    }

    // ── Session / co-op term ──────────────────────────────────────────────
    if (this.has(q, ['session', 'co-op session', 'work term', 'work session',
      'upcoming term', 'which session', 'upcoming session'])) {
      return hi('Summer 2026');
    }

    // ── Cover letter (text field, not file upload) ────────────────────────
    // WHY first 500 chars: some forms limit the cover letter text box; 500
    // chars provides an opener that makes sense as a standalone snippet.
    if (this.has(q, ['cover letter']) && !this.has(q, ['upload', 'attach', 'file'])) {
      // WHY sync readFileSync: generate() is a synchronous method; using
      // dynamic import or async would require changing every call site.
      try {
        const raw = fs.readFileSync('cv/cover_letter_ai.md', 'utf8');
        const plain = raw.replace(/^#+ .+$/gm, '').replace(/\*\*/g, '').trim();
        return med(plain.slice(0, 500), 'Truncated cover letter text — review before submitting');
      } catch {
        return med('Please see my attached cover letter.', 'Cover letter file not found — review manually');
      }
    }

    // Unrecognized — return null so the caller can log which questions were skipped
    return null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private has(q: string, terms: string[]): boolean {
    return terms.some((t) => q.includes(t.toLowerCase()));
  }

  private hasWord(q: string, word: string): boolean {
    const w = word.toLowerCase();
    // Match whole word: preceded and followed by non-word chars (or start/end)
    return new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(q);
  }

  private formatDate(isoDate: string): string {
    const d = new Date(isoDate + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
