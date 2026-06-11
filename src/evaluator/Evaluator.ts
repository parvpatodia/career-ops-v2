/**
 * Scores job-resume fit using a weighted formula.
 * WHY: Deterministic scoring (not AI-generated) ensures consistent results,
 * zero token cost per evaluation, and makes the threshold rules (50/100 min)
 * enforceable. AI is used only for the reasoning narrative.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { JobParser } from './JobParser.js';
import { ResumeParser } from './ResumeParser.js';
import type { Job, EvaluationResult, ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';

interface ScoringConfig {
  weights: {
    skill_match: number;
    experience_match: number;
    location_match: number;
    visa_match: number;
    company_signal: number;
    timing_match: number;
  };
  thresholds: {
    min_to_apply: number;
    min_for_cover_letter: number;
  };
}

export class Evaluator {
  private log = new Logger('Evaluator');
  private jobParser = new JobParser();
  private resumeParser = new ResumeParser();
  private config: ScoringConfig;

  constructor(configPath = 'config/scoring.yml') {
    this.config = yaml.load(fs.readFileSync(configPath, 'utf8')) as ScoringConfig;
  }

  evaluate(job: Job, cvVariant: ResumeVariant = 'master'): EvaluationResult {
    const cvPath = `cv/${cvVariant}.md`;
    const parsedJob = this.jobParser.parse(job.title, job.company, job.jd);
    const parsedResume = this.resumeParser.parse(cvPath);

    const skillMatch = this.scoreSkills(parsedJob.requiredSkills, parsedResume.skills);
    const experienceMatch = this.scoreExperience(parsedJob.level, parsedResume.yearsOfExperience);
    const locationMatch = this.scoreLocation(parsedJob.locationMentioned, parsedJob.remoteAllowed);
    const visaMatch = this.scoreVisa(parsedJob.visaMentioned);
    const companySignal = this.scoreCompany(job.company);
    const timingMatch = this.scoreTiming(job.postedAt);

    const weights = this.config.weights;
    const rawScore =
      skillMatch * weights.skill_match +
      experienceMatch * weights.experience_match +
      locationMatch * weights.location_match +
      visaMatch * weights.visa_match +
      companySignal * weights.company_signal +
      timingMatch * weights.timing_match;

    // WHY: Hard block — if permanent auth is required, Parv cannot apply regardless of other scores.
    const blocked = parsedJob.visaMentioned === 'requires_permanent';
    const score = blocked ? 0 : Math.round(rawScore * 100);

    const topMatchingSkills = parsedJob.requiredSkills
      .filter((s) => this.resumeParser.hasSkill(parsedResume, s))
      .slice(0, 5);

    const missingSkills = parsedJob.requiredSkills
      .filter((s) => !this.resumeParser.hasSkill(parsedResume, s))
      .slice(0, 5);

    const thresholds = this.config.thresholds;

    const result: EvaluationResult = {
      jobId: job.id,
      score,
      breakdown: {
        skillMatch: Math.round(skillMatch * 100),
        experienceMatch: Math.round(experienceMatch * 100),
        locationMatch: Math.round(locationMatch * 100),
        visaMatch: Math.round(visaMatch * 100),
        companySignal: Math.round(companySignal * 100),
        timingMatch: Math.round(timingMatch * 100),
      },
      reasoning: this.generateReasoning(score, skillMatch, visaMatch, parsedJob),
      resumeVariant: this.selectVariant(job.title),
      topMatchingSkills,
      missingSkills,
      shouldApply: score >= thresholds.min_to_apply,
      shouldGenerateCoverLetter: score >= thresholds.min_for_cover_letter,
      evaluatedAt: new Date().toISOString(),
    };

    this.log.info(`Evaluated ${job.company} - ${job.title}: ${score}/100`, {
      shouldApply: result.shouldApply,
    });

    return result;
  }

  selectVariant(title: string): ResumeVariant {
    const t = title.toLowerCase();
    if (/ml|machine learning|deep learning/.test(t)) return 'ml';
    if (/ai|artificial intelligence|llm|generative/.test(t)) return 'ai';
    if (/robotics|perception|autonomous|computer vision/.test(t)) return 'robotics';
    if (/campus|student|ambassador|\bta\b|teaching/.test(t)) return 'ta';
    return 'master';
  }

  private scoreSkills(required: string[], userSkills: string[]): number {
    if (required.length === 0) return 0.75; // No requirements listed = neutral
    const userSkillsLC = userSkills.map((s) => s.toLowerCase());
    const matched = required.filter((s) => userSkillsLC.includes(s.toLowerCase())).length;
    return matched / required.length;
  }

  private scoreExperience(level: string, yearsOfExperience: number): number {
    switch (level) {
      case 'intern': return 1.0;
      case 'entry': return yearsOfExperience >= 1 ? 0.85 : 0.70;
      case 'mid': return yearsOfExperience >= 3 ? 0.80 : 0.35;
      case 'senior': return 0.10;
      default: return 0.75;
    }
  }

  private scoreLocation(locations: string[], remoteAllowed: boolean): number {
    if (remoteAllowed) return 0.95;
    const bayAreaTerms = ['san francisco', 'san jose', 'mountain view', 'palo alto', 'bay area', 'sunnyvale', 'santa clara'];
    const isBayArea = locations.some((l) => bayAreaTerms.includes(l.toLowerCase()));
    if (isBayArea) return 1.0;
    if (locations.length === 0) return 0.65; // Unknown location — assume possible
    return 0.50; // Out of area
  }

  private scoreVisa(visa: string): number {
    switch (visa) {
      case 'sponsors': return 1.0;
      case 'requires_permanent': return 0.0;
      case 'not_mentioned': return 0.60;
      default: return 0.60;
    }
  }

  private scoreCompany(_company: string): number {
    // WHY: Without a company database, we return a neutral signal.
    // Future enhancement: integrate Crunchbase/Clearbit for funding stage data.
    return 0.70;
  }

  private scoreTiming(postedAt: string): number {
    const hoursAgo = (Date.now() - new Date(postedAt).getTime()) / 3_600_000;
    if (hoursAgo <= 24) return 1.0;
    if (hoursAgo <= 48) return 0.90;
    if (hoursAgo <= 168) return 0.70;
    if (hoursAgo <= 336) return 0.50;
    return 0.30;
  }

  private generateReasoning(
    score: number,
    skillMatch: number,
    visaMatch: number,
    job: ReturnType<JobParser['parse']>
  ): string {
    const parts: string[] = [];

    if (score >= 80) parts.push('Strong overall fit.');
    else if (score >= 60) parts.push('Solid fit with some gaps.');
    else if (score >= 50) parts.push('Marginal fit — apply only if interested in the company.');
    else parts.push('Below threshold — do not apply.');

    if (skillMatch >= 0.8) parts.push('Skill match is strong.');
    else if (skillMatch < 0.5) parts.push(`Missing ${Math.round((1 - skillMatch) * 100)}% of required skills.`);

    if (visaMatch === 0) parts.push('BLOCKED: Requires permanent authorization — skip.');
    else if (visaMatch === 1.0) parts.push('Explicitly sponsors F-1/OPT.');
    else parts.push('Visa status unconfirmed — apply with caution.');

    if (job.level === 'senior') parts.push('Overqualification mismatch: senior role.');

    return parts.join(' ');
  }
}
