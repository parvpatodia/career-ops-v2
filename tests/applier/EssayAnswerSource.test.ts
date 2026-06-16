/**
 * EssayAnswerSource: company-specific, grounded, rule-following essay answers,
 * with a maker/checker gate that abstains rather than ship boilerplate or a
 * style violation. Uses a fixture profile (no PII).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProfileLoader } from '../../src/applier/ProfileLoader.js';
import { EssayAnswerSource } from '../../src/applier/EssayAnswerSource.js';
import { FORBIDDEN_PHRASES } from '../../src/tailor/CoverLetterVerifier.js';
import { containsTerm } from '../../src/tailor/text.js';
import type { AnswerContext } from '../../src/applier/AnswerGenerator.js';
import type { LlmClient } from '../../src/applier/GeminiClient.js';

const fakeLlm = (text: string | null, throws = false): LlmClient => ({
  enabled: true,
  generate: async () => { if (throws) throw new Error('boom'); return text; },
});

const PROFILE = `identity:
  name: "Demo Candidate"
  email: "demo@example.com"
  phone: "408-555-0100"
  linkedin: "linkedin.com/in/demo"
  github: "github.com/demo"
projects:
  flagship:
    name: "Laksh.ai"
    summary: "A computer vision platform for basketball biomechanics using markerless pose estimation and LLM coaching"
    stack: ["Python", "MediaPipe", "ChromaDB"]
  vit:
    name: "ViT Change Detection"
    summary: "A Vision Transformer written from scratch for satellite imagery change detection"
    stack: ["PyTorch", "Transformers"]
narrative:
  excites: "Computer vision systems that work in the physical world."
experience:
  - role: "Graduate Teaching Assistant"
    company: "Northeastern University"
skills:
  languages: ["Python", "C++"]`;

let dir: string;
let profile: ProfileLoader;
let essay: EssayAnswerSource;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-'));
  const p = path.join(dir, 'profile.yml');
  fs.writeFileSync(p, PROFILE);
  profile = new ProfileLoader(p);
  essay = new EssayAnswerSource(profile);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = (over: Partial<AnswerContext> = {}): AnswerContext => ({
  company: 'Globex', role: 'Machine Learning Intern', jd: 'We use Python and PyTorch for computer vision.', ...over,
});

describe('EssayAnswerSource', () => {
  it('answers a "why this company" essay: names the company, grounded, clean style', () => {
    const a = essay.generate('Why do you want to work at Globex?', ctx());
    expect(a).not.toBeNull();
    const v = a!.value;
    expect(a!.confidence).toBe('high');
    expect(a!.needsReview).toBe(false);
    expect(v.toLowerCase()).toContain('globex');               // company-specific
    expect(/Laksh\.ai|ViT Change Detection/.test(v)).toBe(true); // grounded in a real project
    expect(v).not.toContain('—');                              // no em dash
    expect(v).not.toContain(':');                              // no colon (Parv's rule)
    for (const p of FORBIDDEN_PHRASES) expect(containsTerm(v, p)).toBe(false);
  });

  it('selects the JD-most-relevant project', () => {
    // A PyTorch/transformer JD should surface the ViT project over the flagship.
    const a = essay.generate('Why are you interested in this role?', ctx({
      jd: 'Vision Transformer research in PyTorch with Transformers.',
    }));
    expect(a?.value).toContain('ViT Change Detection');
  });

  it('returns null for non-essay questions (falls through to other sources)', () => {
    expect(essay.generate('First Name', ctx())).toBeNull();
    expect(essay.generate('What is your GPA?', ctx())).toBeNull();
  });

  it('abstains when it cannot make the answer company-specific', () => {
    expect(essay.generate('Why do you want to work here?', ctx({ company: '' }))).toBeNull();
  });

  // ── LLM path (fake client; no network) ──────────────────────────────────
  it('after prewarm, serves the verified LLM essay', async () => {
    const llmText =
      'Globex builds recommendation systems and I want to help ship them with your platform team. ' +
      'At Laksh.ai I built a markerless pose estimation pipeline with vector search, end to end. ' +
      'That hands-on computer vision is the work I want to keep doing at Globex.';
    const e = new EssayAnswerSource(profile, fakeLlm(llmText));
    await e.prewarm(ctx());
    const a = e.generate('Why do you want to work at Globex?', ctx());
    expect(a?.value).toContain('recommendation systems'); // the LLM text, not the deterministic skeleton
    expect(a?.value).not.toContain('—');
    expect(a?.value).not.toContain(':');
  });

  it('falls back to deterministic when the LLM essay fails the gate (forbidden phrase)', async () => {
    const e = new EssayAnswerSource(profile, fakeLlm('I am passionate about Globex and innovative solutions.'));
    await e.prewarm(ctx());
    const a = e.generate('Why do you want to work at Globex?', ctx());
    expect(a).not.toBeNull();
    for (const p of FORBIDDEN_PHRASES) expect(containsTerm(a!.value, p)).toBe(false);
    expect(a!.value).not.toContain('passionate');               // not the bad LLM text
    expect(/Laksh\.ai|ViT Change Detection/.test(a!.value)).toBe(true); // deterministic, grounded
  });

  it('falls back to deterministic when the LLM throws (never errors the run)', async () => {
    const e = new EssayAnswerSource(profile, fakeLlm(null, true));
    await expect(e.prewarm(ctx())).resolves.toBeUndefined(); // prewarm never throws
    const a = e.generate('Why are you interested in this role?', ctx());
    expect(a).not.toBeNull();
    expect(a!.value.toLowerCase()).toContain('globex');
  });
});
