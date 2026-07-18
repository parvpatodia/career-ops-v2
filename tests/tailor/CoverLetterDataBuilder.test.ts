import { describe, it, expect } from 'vitest';
import { CoverLetterDataBuilder, normalizeDashes, type ProfileFacts } from '../../src/tailor/CoverLetterDataBuilder.js';
import { CoverLetterVerifier } from '../../src/tailor/CoverLetterVerifier.js';

// A realistic fake: prose contains an em dash (like Parv's real best_achievement),
// which must be normalized so the verifier's no-dash check passes.
const facts: ProfileFacts = {
  getNarrative: () => ({
    superpower: 'I ship computer-vision and ML systems end to end, from data to a working product.',
    excites: 'Computer vision that works in the physical world, and AI infrastructure.',
    bestAchievement: 'Built Laksh.ai end-to-end solo — a CV pipeline for basketball biomechanics.',
  }),
  getProjects: () => [
    { name: 'Laksh.ai', summary: 'markerless pose estimation for basketball — real-time feedback', stack: ['PyTorch', 'OpenCV', 'FastAPI'] },
    { name: 'AV Planner', summary: 'diffusion policy for planning', stack: ['PyTorch'] },
  ],
  getSkills: () => ['PyTorch', 'computer vision', 'ROS', 'Kubernetes'],
};

const builder = new CoverLetterDataBuilder(facts);

describe('CoverLetterDataBuilder', () => {
  it('names the role and company across the paragraphs', () => {
    const d = builder.build({ company: 'Waymo', role: 'ML Intern', category: 'AI/ML' });
    const all = [d.companySpecificAngle, d.experienceAlignment, d.closing].join(' ');
    expect(all).toContain('Waymo');
    expect(all).toContain('ML Intern');
  });

  it('grounds the strongest-project paragraph in a real project (name + stack)', () => {
    const d = builder.build({ company: 'Waymo', role: 'ML Intern', category: 'AI/ML' });
    expect(d.strongestProject).toContain('Laksh.ai');
    expect(d.strongestProject).toContain('PyTorch');
  });

  it('normalizes dashes from profile prose (cover-letter style bans them)', () => {
    const d = builder.build({ company: 'Nuro', role: 'Robotics Intern', category: 'Robotics/AV' });
    const all = [d.companySpecificAngle, d.strongestProject, d.experienceAlignment, d.closing].join(' ');
    expect(all).not.toMatch(/[–—―]|--/); // no em/en/bar/double-hyphen survived
  });

  it('uses an honest JD skill intersection for the angle when a JD is supplied', () => {
    const withJd = builder.build({ company: 'Skild', role: 'Perception Intern', category: 'Robotics/AV', jd: 'You will work on ROS and real-time perception for our robots. '.repeat(3) });
    expect(withJd.companySpecificAngle).toContain('ROS'); // ROS is in BOTH the JD and the profile skills
    const noJd = builder.build({ company: 'Skild', role: 'Perception Intern', category: 'Robotics/AV' });
    expect(noJd.companySpecificAngle).toContain('robotics and autonomy'); // falls back to category domain
  });

  it('produces a letter that passes the CoverLetterVerifier end to end', () => {
    const d = builder.build({ company: 'Anthropic', role: 'ML Intern', category: 'AI/ML' });
    // Simulate the filled template body: the four paragraphs + an identity line
    // (the real template header carries name + university for the grounding check).
    const letter = [
      'Parv Patodia, Northeastern University',
      d.companySpecificAngle,
      d.strongestProject,
      d.experienceAlignment,
      d.closing,
    ].join('\n\n');
    const verdict = new CoverLetterVerifier().verify({
      letter, company: 'Anthropic', role: 'ML Intern', groundingFacts: ['Parv Patodia', 'Northeastern'],
    });
    const failed = verdict.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(verdict.pass).toBe(true);
  });
});

describe('normalizeDashes', () => {
  it('converts em/en/horizontal-bar/double-hyphen to a comma, leaves clean text alone', () => {
    expect(normalizeDashes('a — b')).toBe('a, b');
    expect(normalizeDashes('a – b')).toBe('a, b');
    expect(normalizeDashes('a -- b')).toBe('a, b');
    expect(normalizeDashes('already clean, text')).toBe('already clean, text');
  });
});
