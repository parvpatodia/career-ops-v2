import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import { ResumeBuilder } from '../../src/tailor/ResumeBuilder.js';

// Tests run from project root; cv/ files exist there.
// Outputs go to output/resumes/ which is gitignored.

afterAll(() => {
  // Clean up generated test outputs
  for (const f of ['test-001', 'test-002', 'test-003', 'test-004', 'test-006']) {
    const p = `output/resumes/${f}-ml.md`;
    const pm = `output/resumes/${f}-master.md`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(pm)) fs.unlinkSync(pm);
  }
});

describe('ResumeBuilder', () => {
  it('creates output file when given valid variant', () => {
    const builder = new ResumeBuilder();
    const result = builder.build('test-001', 'ML Engineer', 'ml', ['Kubernetes']);
    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  it('does not inject keyword already in resume', () => {
    const builder = new ResumeBuilder();
    // PyTorch is present in cv/ml.md (Parv's resume)
    const result = builder.build('test-002', 'ML Engineer', 'ml', ['PyTorch']);
    const injected = result.injections.some((i) => i.keyword === 'PyTorch');
    expect(injected).toBe(false);
  });

  it('injects at most 3 keywords', () => {
    const builder = new ResumeBuilder();
    const result = builder.build('test-003', 'ML Engineer', 'ml', [
      'Kubernetes', 'MLflow', 'Apache Spark', 'Ray', 'Triton',
    ]);
    expect(result.injections.length).toBeLessThanOrEqual(3);
  });

  it('each injection has location and reason', () => {
    const builder = new ResumeBuilder();
    const result = builder.build('test-004', 'ML Engineer', 'ml', ['MLflow']);
    for (const inj of result.injections) {
      expect(inj.location).toBeTruthy();
      expect(inj.reason).toBeTruthy();
    }
  });

  it('output file contains injected keyword text', () => {
    const builder = new ResumeBuilder();
    const keyword = 'Kubernetes';
    const result = builder.build('test-006', 'DevOps', 'master', [keyword]);
    if (result.injections.some((i) => i.keyword === keyword)) {
      const content = fs.readFileSync(result.outputPath, 'utf8');
      expect(content.toLowerCase()).toContain(keyword.toLowerCase());
    }
  });

  it('throws for nonexistent cv variant path', () => {
    const builder = new ResumeBuilder();
    // 'nonexistent' is not a real variant so cv/nonexistent.md won't exist
    expect(() =>
      builder.build('test-bad', 'Engineer', 'nonexistent' as any, ['Python'])
    ).toThrow();
  });
});
