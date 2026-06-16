import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CoverLetterBuilder, type CoverLetterData } from '../../src/tailor/CoverLetterBuilder.js';

// Fixture template (no PII) so the builder is exercised without cv/.
const TEMPLATE = `{{DATE}}

Dear {{COMPANY_NAME}} team,

I am applying for the {{ROLE_TITLE}} role. {{PARA_1_WHY_COMPANY}}

{{PARA_2_STRONGEST_PROJECT}}

{{PARA_3_EXPERIENCE_ALIGNMENT}}

{{PARA_4_CLOSE}}

Sincerely,
Test Candidate

## Rules for this template
- This block is stripped before the letter is verified.`;

const CLEAN_DATA: CoverLetterData = {
  company: 'Acme Robotics',
  role: 'Robotics Intern',
  companySpecificAngle: 'Your warehouse autonomy work is why I am applying here.',
  strongestProject: 'I built a diffusion-policy planner that cut planning latency.',
  experienceAlignment: 'I have shipped reinforcement learning systems end to end.',
  closing: 'I would welcome a conversation.',
};

let dir: string;
let templatePath: string;
let outputDir: string;
let builder: CoverLetterBuilder;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));
  templatePath = path.join(dir, 'template.md');
  outputDir = path.join(dir, 'out');
  fs.writeFileSync(templatePath, TEMPLATE);
  builder = new CoverLetterBuilder({ templatePath, outputDir });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CoverLetterBuilder (verify-or-abstain)', () => {
  it('writes a clean, specific letter and returns a passing verdict', () => {
    const res = builder.build('job-clean', CLEAN_DATA, { score: 80 });
    expect(res.verdict.pass).toBe(true);
    expect(fs.existsSync(res.outputPath)).toBe(true);
    expect(res.letter).toContain('Acme Robotics');
    expect(res.letter).toContain('Robotics Intern');
    expect(res.letter).not.toContain('## Rules');
  });

  it('ABSTAINS (throws, writes nothing) when a forbidden phrase is present', () => {
    const bad: CoverLetterData = {
      ...CLEAN_DATA,
      companySpecificAngle: 'I am passionate about your innovative solutions.',
    };
    expect(() => builder.build('job-forbidden', bad, { score: 80 })).toThrow(/abstain/i);
    expect(fs.existsSync(builder.getOutputPath('job-forbidden'))).toBe(false);
  });

  it('ABSTAINS when the letter does not name the company (leaked placeholder)', () => {
    // A template whose company slot is misnamed leaves {{COMPANY_NAME}} unfilled.
    const brokenTemplatePath = path.join(dir, 'broken.md');
    fs.writeFileSync(brokenTemplatePath, TEMPLATE.replace('{{COMPANY_NAME}}', '{{COMPANY_NMAE}}'));
    const broken = new CoverLetterBuilder({ templatePath: brokenTemplatePath, outputDir });
    expect(() => broken.build('job-broken', CLEAN_DATA, { score: 80 })).toThrow(/abstain/i);
    expect(fs.existsSync(broken.getOutputPath('job-broken'))).toBe(false);
  });

  it('throws (skips) below the score threshold', () => {
    expect(() => builder.build('job-lowscore', CLEAN_DATA, { score: 40 })).toThrow(/threshold/i);
  });
});
