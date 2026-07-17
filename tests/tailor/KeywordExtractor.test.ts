import { describe, it, expect } from 'vitest';
import { KeywordExtractor } from '../../src/tailor/KeywordExtractor.js';

// A realistic, full-length JD with a clear Required vs Preferred split.
const FULL_JD = `
About the role
We are hiring a Machine Learning Engineering Intern to help build our
recommendation platform. You will work across the full model lifecycle, from
data pipelines to deployment, alongside a small applied research team.

Required Qualifications
- Strong programming in Python and solid SQL fundamentals
- Hands-on experience building and shipping services with Docker and Kubernetes
- Familiarity with RAG and LLM application patterns in production
- Comfort working in a Linux environment with Git-based workflows

Preferred Qualifications
- Exposure to Go or Rust for performance-sensitive services
- Interest in NLP research

We are an EEO employer. PTO and 401K provided.
`;

describe('KeywordExtractor', () => {
  const extractor = new KeywordExtractor();

  it('extracts the real ATS keywords from a full JD and does not abstain', () => {
    const out = extractor.extract(FULL_JD);
    expect(out.abstained).toBe(false);
    const terms = out.keywords.map((k) => k.term.toLowerCase());
    for (const expected of ['python', 'sql', 'docker', 'kubernetes', 'rag', 'llm', 'linux', 'git']) {
      expect(terms).toContain(expected);
    }
  });

  it('abstains on a stub JD instead of extracting from too little text (LESSONS 2026-06-10)', () => {
    const out = extractor.extract('ML intern. Apply now.');
    expect(out.abstained).toBe(true);
    expect(out.keywords).toEqual([]);
    expect(out.reason).toBeTruthy();
  });

  it('abstains on empty/whitespace JD', () => {
    expect(extractor.extract('').abstained).toBe(true);
    expect(extractor.extract('   \n  ').abstained).toBe(true);
  });

  it('dedupes case variants into a single keyword and counts hits', () => {
    const jd =
      'Required Qualifications. ' +
      'Python is essential here. We love python. PYTHON everywhere we look. ' +
      'This team writes Python daily and reviews Python code. ' +
      'A long enough description to clear the stub guard and look like a real posting with many sentences.';
    const out = extractor.extract(jd);
    const python = out.keywords.filter((k) => k.term.toLowerCase() === 'python');
    expect(python).toHaveLength(1);
    expect(python[0].hits).toBeGreaterThanOrEqual(3);
  });

  it('ranks a required-section keyword above a preferred-only keyword with equal raw frequency', () => {
    const out = extractor.extract(FULL_JD);
    const rank = (t: string) => out.keywords.findIndex((k) => k.term.toLowerCase() === t);
    // Docker appears once in Required; Rust appears once in Preferred.
    const docker = rank('docker');
    const rust = rank('rust');
    expect(docker).toBeGreaterThanOrEqual(0);
    expect(rust).toBeGreaterThanOrEqual(0);
    expect(docker).toBeLessThan(rust);
  });

  it('marks required-region keywords as required and preferred-only as not required', () => {
    const out = extractor.extract(FULL_JD);
    const get = (t: string) => out.keywords.find((k) => k.term.toLowerCase() === t);
    expect(get('docker')?.required).toBe(true);
    expect(get('rust')?.required).toBe(false);
  });

  it('does not surface HR/grammar all-caps tokens as skills', () => {
    const out = extractor.extract(FULL_JD);
    const terms = out.keywords.map((k) => k.term.toUpperCase());
    for (const noise of ['EEO', 'PTO', '401K', 'AND', 'THE']) {
      expect(terms).not.toContain(noise);
    }
  });

  it('drops business/finance acronyms but keeps real tech acronyms', () => {
    const jd = `Machine Learning Intern building production ML systems with Python,
      PyTorch, SQL, AWS, and an ETL pipeline exposed over a REST API using an LLM.
      Our team tracks KPI and ROI, works B2B, follows an SLA, meets ARR and CAC
      goals, drives GTM, and handles the RFP and NDA process. This is an FTE role.`;
    const terms = new KeywordExtractor().extract(jd).keywords.map((k) => k.term.toUpperCase());
    // business/finance/contract noise removed
    for (const noise of ['B2B', 'ROI', 'KPI', 'SLA', 'ARR', 'CAC', 'GTM', 'RFP', 'NDA', 'FTE']) {
      expect(terms).not.toContain(noise);
    }
    // genuine tech acronyms preserved
    for (const skill of ['SQL', 'AWS', 'ETL', 'API', 'LLM', 'ML']) {
      expect(terms).toContain(skill);
    }
  });
});
