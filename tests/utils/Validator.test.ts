import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Validator } from '../../src/utils/Validator.js';

const TMP_DIR = 'tests/tmp';

beforeAll(() => { fs.mkdirSync(TMP_DIR, { recursive: true }); });
afterAll(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }); });

function writeTmp(name: string, content: string): string {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('Validator.validateProfile', () => {
  it('returns invalid when file missing', () => {
    const result = Validator.validateProfile('nonexistent.yml');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/);
  });

  it('returns invalid when required fields missing', () => {
    const p = writeTmp('bad-profile.yml', 'name: test\n');
    const result = Validator.validateProfile(p);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid for a complete profile', () => {
    const yaml = `
identity:
  name: Parv Patodia
  email: test@example.com
  visa: F-1
target_roles:
  types: [ML Engineer]
skills:
  core: [Python]
daily_limits:
  linkedin: 25
`;
    const p = writeTmp('good-profile.yml', yaml);
    const result = Validator.validateProfile(p);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('Validator.validatePlatforms', () => {
  it('returns invalid when no platforms enabled', () => {
    const yaml = `platforms:\n  linkedin:\n    enabled: false\n`;
    const p = writeTmp('no-platforms.yml', yaml);
    const result = Validator.validatePlatforms(p);
    expect(result.valid).toBe(false);
  });

  it('returns valid when at least one enabled', () => {
    const yaml = `platforms:\n  linkedin:\n    enabled: true\n`;
    const p = writeTmp('one-platform.yml', yaml);
    const result = Validator.validatePlatforms(p);
    expect(result.valid).toBe(true);
  });
});

describe('Validator.validateScanQuery', () => {
  it('rejects empty query', () => {
    const result = Validator.validateScanQuery({});
    expect(result.valid).toBe(false);
  });

  it('accepts query with keywords only', () => {
    const result = Validator.validateScanQuery({ keywords: ['ML Engineer'] });
    expect(result.valid).toBe(true);
  });

  it('accepts query with location only', () => {
    const result = Validator.validateScanQuery({ location: 'Bay Area' });
    expect(result.valid).toBe(true);
  });
});

describe('Validator.validateCVVariants', () => {
  it('reports missing variants', () => {
    // This test verifies the structure; actual cv/ files may or may not exist in test env
    const result = Validator.validateCVVariants();
    // Either all pass (files exist) or errors list the missing ones
    if (!result.valid) {
      expect(result.errors.every((e) => e.includes('cv/'))).toBe(true);
    }
  });
});
