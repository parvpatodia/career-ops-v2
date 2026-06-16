import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ResumeBuilder } from '../../src/tailor/ResumeBuilder.js';

// Fixture CV dir (no PII). The variant is MISSING Docker/Kubernetes/Git, which
// the master corpus attests; COBOL is attested nowhere.
const ML = `## Professional Summary
ML engineer focused on applied research and shipping models to production.

## Experience
### Acme AI — ML Intern
*Jan 2025 – Present · Remote*
- Built recommendation models in Python and shipped them to production.
- Wrote data pipelines and evaluation harnesses for offline metrics.

## Skills
- Languages: Python, TypeScript
- ML: PyTorch, scikit-learn`;

const MASTER = `${ML}
- Tools: Docker, Kubernetes, Git, Linux`;

const EXPERIENCE_BULLETS = [
  '- Built recommendation models in Python and shipped them to production.',
  '- Wrote data pipelines and evaluation harnesses for offline metrics.',
];

let dir: string;
let cvDir: string;
let outputDir: string;
let builder: ResumeBuilder;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  cvDir = path.join(dir, 'cv');
  outputDir = path.join(dir, 'out');
  fs.mkdirSync(cvDir, { recursive: true });
  fs.writeFileSync(path.join(cvDir, 'ml.md'), ML);
  fs.writeFileSync(path.join(cvDir, 'master.md'), MASTER);
  builder = new ResumeBuilder({ cvDir, outputDir });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ResumeBuilder', () => {
  it('injects an attested-but-missing keyword and writes the tailored file', () => {
    const res = builder.build('job-1', 'ml', ['Docker']);
    expect(res.injections.find((i) => i.keyword === 'Docker')).toBeTruthy();
    expect(fs.existsSync(res.outputPath)).toBe(true);
    expect(fs.readFileSync(res.outputPath, 'utf8').toLowerCase()).toContain('docker');
    for (const inj of res.injections) {
      expect(inj.location).toBeTruthy();
      expect(inj.reason).toBeTruthy();
    }
  });

  it('skips a keyword attested nowhere in the corpus (no fabrication)', () => {
    const res = builder.build('job-2', 'ml', ['COBOL']);
    expect(res.injections.find((i) => i.keyword === 'COBOL')).toBeUndefined();
    expect(res.skipped.find((s) => s.keyword === 'COBOL')).toBeTruthy();
  });

  it('never alters an existing experience claim', () => {
    const res = builder.build('job-3', 'ml', ['Docker', 'Kubernetes', 'Git']);
    const written = fs.readFileSync(res.outputPath, 'utf8');
    for (const bullet of EXPERIENCE_BULLETS) expect(written).toContain(bullet);
  });

  it('reports the tailored markdown section titles', () => {
    const res = builder.build('job-4', 'ml', []);
    expect(res.sections).toEqual(['Professional Summary', 'Experience', 'Skills']);
  });

  it('throws for a nonexistent variant', () => {
    expect(() => builder.build('job-bad', 'nonexistent' as never, ['Python'])).toThrow(/not found/i);
  });
});
