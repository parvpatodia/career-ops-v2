/**
 * Extracts structured requirements from a raw job description.
 * WHY: Separating parsing from scoring lets us cache parsed JDs
 * and test parsing independently without needing the full scoring pipeline.
 */

import { SKILL_PATTERNS } from './skills.js';

export interface ParsedJob {
  title: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  experienceYears: number | null;  // null = not specified
  level: 'intern' | 'entry' | 'mid' | 'senior' | 'any';
  locationMentioned: string[];
  remoteAllowed: boolean;
  visaMentioned: 'sponsors' | 'requires_permanent' | 'not_mentioned';
  startDate: string | null;
  isInternship: boolean;
  keywords: string[];  // raw keywords for ATS injection
}

const SENIOR_KEYWORDS = ['senior', 'staff', 'principal', 'lead', 'architect'];
const MID_KEYWORDS = ['mid-level', 'mid level', '3+ years', '3-5 years', '4+ years'];
const INTERN_KEYWORDS = ['intern', 'internship', 'co-op', 'coop', 'student'];
const ENTRY_KEYWORDS = ['entry level', 'entry-level', '0-2 years', '1-3 years', 'new grad', 'recent grad'];

export class JobParser {
  parse(title: string, company: string, jd: string): ParsedJob {
    const jdLC = jd.toLowerCase();
    const titleLC = title.toLowerCase();

    return {
      title,
      company,
      requiredSkills: this.extractSkills(jd, 'required'),
      preferredSkills: this.extractSkills(jd, 'preferred'),
      experienceYears: this.extractExperience(jdLC),
      level: this.detectLevel(titleLC, jdLC),
      locationMentioned: this.extractLocations(jdLC),
      remoteAllowed: this.detectRemote(jdLC),
      visaMentioned: this.detectVisa(jdLC),
      startDate: this.extractStartDate(jdLC),
      isInternship: this.detectInternship(titleLC, jdLC),
      keywords: this.extractKeywords(jd),
    };
  }

  private extractSkills(jd: string, section: 'required' | 'preferred'): string[] {
    // WHY: Split on section headers so we don't treat "nice to have" skills
    // as required, which would deflate scores for strong candidates.
    const jdLC = jd.toLowerCase();
    let text = jd;

    if (section === 'required') {
      const reqIdx = Math.max(
        jdLC.indexOf('required'),
        jdLC.indexOf('must have'),
        jdLC.indexOf('qualifications')
      );
      const prefIdx = Math.max(
        jdLC.indexOf('preferred'),
        jdLC.indexOf('nice to have'),
        jdLC.indexOf('bonus')
      );
      if (reqIdx >= 0 && prefIdx > reqIdx) {
        text = jd.slice(reqIdx, prefIdx);
      } else if (reqIdx >= 0) {
        text = jd.slice(reqIdx);
      }
    } else {
      const prefIdx = Math.max(
        jdLC.indexOf('preferred'),
        jdLC.indexOf('nice to have'),
        jdLC.indexOf('bonus')
      );
      if (prefIdx >= 0) text = jd.slice(prefIdx);
      else return [];
    }

    return SKILL_PATTERNS.filter((skill) =>
      text.toLowerCase().includes(skill.toLowerCase())
    );
  }

  private extractExperience(jdLC: string): number | null {
    const match = /(\d+)\+?\s*years?\s*(?:of\s+)?experience/.exec(jdLC);
    return match ? parseInt(match[1], 10) : null;
  }

  private detectLevel(titleLC: string, jdLC: string): ParsedJob['level'] {
    if (SENIOR_KEYWORDS.some((k) => titleLC.includes(k) || jdLC.includes(k))) return 'senior';
    if (MID_KEYWORDS.some((k) => jdLC.includes(k))) return 'mid';
    if (INTERN_KEYWORDS.some((k) => titleLC.includes(k))) return 'intern';
    if (ENTRY_KEYWORDS.some((k) => jdLC.includes(k))) return 'entry';
    return 'any';
  }

  private extractLocations(jdLC: string): string[] {
    const locations = [];
    const BAY_AREA = ['san francisco', 'san jose', 'mountain view', 'palo alto', 'menlo park', 'sunnyvale', 'santa clara', 'foster city', 'redwood city', 'bay area'];
    for (const loc of BAY_AREA) {
      if (jdLC.includes(loc)) locations.push(loc);
    }
    if (jdLC.includes('new york') || jdLC.includes('nyc')) locations.push('new york');
    if (jdLC.includes('seattle')) locations.push('seattle');
    if (jdLC.includes('austin')) locations.push('austin');
    return locations;
  }

  private detectRemote(jdLC: string): boolean {
    return jdLC.includes('remote') || jdLC.includes('work from home');
  }

  private detectVisa(jdLC: string): ParsedJob['visaMentioned'] {
    if (jdLC.includes('sponsor') && (jdLC.includes('visa') || jdLC.includes('opt') || jdLC.includes('cpt'))) {
      return 'sponsors';
    }
    if (
      jdLC.includes('must be authorized to work') ||
      jdLC.includes('us citizen') ||
      jdLC.includes('us citizenship') ||
      jdLC.includes('permanent resident') ||
      jdLC.includes('green card') ||
      jdLC.includes('no sponsorship')
    ) {
      return 'requires_permanent';
    }
    return 'not_mentioned';
  }

  private extractStartDate(jdLC: string): string | null {
    const patterns = [
      /summer\s+202[56]/,
      /fall\s+202[56]/,
      /spring\s+202[56]/,
      /january|february|march|april|may|june|july|august|september|october|november|december/,
    ];
    for (const p of patterns) {
      const m = p.exec(jdLC);
      if (m) return m[0];
    }
    return null;
  }

  private detectInternship(titleLC: string, jdLC: string): boolean {
    return INTERN_KEYWORDS.some((k) => titleLC.includes(k) || jdLC.includes(k));
  }

  private extractKeywords(jd: string): string[] {
    // WHY: Returns keywords suitable for ATS injection into resume bullets.
    // Filters to multi-word technical terms that are meaningful for parsing.
    const found = SKILL_PATTERNS.filter((s) => jd.toLowerCase().includes(s.toLowerCase()));
    // Add any specific tech mentioned after common headers
    return [...new Set(found)].slice(0, 15);
  }
}
