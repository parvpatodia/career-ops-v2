/** Validates config files and pipeline inputs at system boundaries. */

import fs from 'fs';
import yaml from 'js-yaml';
import type { ScanQuery } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class Validator {
  /** Validate profile.yml has required fields. */
  static validateProfile(profilePath = 'config/profile.yml'): ValidationResult {
    const errors: string[] = [];
    if (!fs.existsSync(profilePath)) {
      return { valid: false, errors: [`Profile not found: ${profilePath}`] };
    }

    let profile: Record<string, unknown>;
    try {
      profile = yaml.load(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      return { valid: false, errors: [`Failed to parse profile YAML: ${String(e)}`] };
    }

    const required = ['identity', 'target_roles', 'skills', 'daily_limits'];
    for (const field of required) {
      if (!profile[field]) errors.push(`Missing required field: ${field}`);
    }

    const identity = profile['identity'] as Record<string, unknown> | undefined;
    if (identity) {
      for (const f of ['name', 'email']) {
        if (!identity[f]) errors.push(`Missing identity.${f}`);
      }
    }

    // WHY work_authorization.visa_type: the validator demanded
    // identity.visa, a key the real profile schema never had, which made
    // the scan CLI exit(1) on startup for the project's whole life
    // (2026-06-10 audit). Validators must track the real schema.
    const workAuth = profile['work_authorization'] as Record<string, unknown> | undefined;
    if (!workAuth?.['visa_type']) errors.push('Missing work_authorization.visa_type');

    return { valid: errors.length === 0, errors };
  }

  /** Validate platforms.yml has at least one enabled platform. */
  static validatePlatforms(platformsPath = 'config/platforms.yml'): ValidationResult {
    const errors: string[] = [];
    if (!fs.existsSync(platformsPath)) {
      return { valid: false, errors: [`Platforms config not found: ${platformsPath}`] };
    }

    let config: Record<string, unknown>;
    try {
      config = yaml.load(fs.readFileSync(platformsPath, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      return { valid: false, errors: [`Failed to parse platforms YAML: ${String(e)}`] };
    }

    const platforms = config['platforms'] as Record<string, { enabled: boolean }> | undefined;
    if (!platforms) {
      errors.push('Missing platforms key in platforms.yml');
    } else {
      const enabled = Object.values(platforms).filter((p) => p.enabled);
      if (enabled.length === 0) errors.push('No platforms are enabled');
    }

    return { valid: errors.length === 0, errors };
  }

  /** Validate a scan query has at least keywords or location. */
  static validateScanQuery(query: Partial<ScanQuery>): ValidationResult {
    const errors: string[] = [];
    if (!query.keywords?.length && !query.location) {
      errors.push('ScanQuery must have at least keywords or location');
    }
    return { valid: errors.length === 0, errors };
  }

  /** Assert APIFY_TOKEN env var is set before calling Apify. */
  static requireApifyToken(): void {
    if (!process.env['APIFY_TOKEN']) {
      throw new Error('APIFY_TOKEN not set. Add it to .env file.');
    }
  }

  /** Check required CV variant files exist. */
  static validateCVVariants(): ValidationResult {
    const errors: string[] = [];
    const variants = ['master', 'ai', 'ml', 'robotics', 'ta'];
    for (const v of variants) {
      if (!fs.existsSync(`cv/${v}.md`)) {
        errors.push(`Missing CV variant: cv/${v}.md`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
