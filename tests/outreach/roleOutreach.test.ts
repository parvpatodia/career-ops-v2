import { describe, it, expect } from 'vitest';
import { roleOutreachPacks, LINKEDIN_NOTE_MAX, type RoleSeed } from '../../src/outreach/roleOutreach.js';
import { SnippetBook } from '../../src/outreach/SnippetBook.js';
import { StyleLinter } from '../../src/outreach/StyleLinter.js';

const snippets = new SnippetBook({ 'linkedin.intro': "I'm an MS AI student at Northeastern building ML systems." });

function seed(company: string, role: string, applyUrl = 'https://x/1'): RoleSeed {
  return { company, role, applyUrl };
}

describe('roleOutreachPacks', () => {
  it('groups roles by company, dedups titles, preserves newest-first order', () => {
    const packs = roleOutreachPacks(
      [
        seed('Waymo', 'ML Intern'),
        seed('Figure', 'Robotics Intern'),
        seed('Waymo', 'ML Intern'), // exact dup -> one role
        seed('Waymo', 'Software Engineer Intern'), // second distinct role
      ],
      snippets
    );
    expect(packs.map((p) => p.company)).toEqual(['Waymo', 'Figure']);
    expect(packs[0]!.roles).toEqual(['ML Intern', 'Software Engineer Intern']);
  });

  it('picks the category-appropriate engineer search from the top role', () => {
    const packs = roleOutreachPacks([seed('Skild', 'Robotics Perception Intern')], snippets);
    expect(packs[0]!.category).toBe('Robotics/AV');
    // Two searches: recruiter + engineer; engineer keyword follows the category.
    expect(packs[0]!.searches).toHaveLength(2);
    expect(packs[0]!.searches[1]!.url).toContain(encodeURIComponent('robotics engineer'));
    expect(packs[0]!.searches[0]!.url).toContain(encodeURIComponent('university recruiter'));
  });

  it('grounds the message in the approved snippet, and the note fits LinkedIn cap', () => {
    const packs = roleOutreachPacks([seed('OpenAI', 'ML Intern')], snippets);
    expect(packs[0]!.connectionNote).toContain('MS AI student at Northeastern');
    expect(packs[0]!.connectionNote.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
    expect(packs[0]!.followUp).toContain("OpenAI's ML Intern");
  });

  it('keeps the connection note within the cap even for a very long company/role', () => {
    const longCo = 'Some Extremely Long Company Name Incorporated Worldwide Holdings';
    const longRole = 'Senior Staff Machine Learning Research Engineer Intern (Foundation Models, Multimodal)';
    const packs = roleOutreachPacks([seed(longCo, longRole)], new SnippetBook({}));
    expect(packs[0]!.connectionNote.length).toBeLessThanOrEqual(LINKEDIN_NOTE_MAX);
  });

  it('falls back to the true identity line when no snippet is configured', () => {
    const packs = roleOutreachPacks([seed('Nuro', 'ML Intern')], new SnippetBook({}));
    expect(packs[0]!.connectionNote).toContain('MS AI student at Northeastern');
  });

  it('skips blank, "(via ...)", and term-label companies (not searchable targets)', () => {
    const packs = roleOutreachPacks(
      [
        seed('', 'ML Intern'),
        seed('(via email:linkedin)', 'ML Intern'),
        seed('Fall 2026', 'ML Intern'), // term label mis-captured as company
        seed('Summer 2026', 'ML Intern'),
        seed('2026', 'ML Intern'),
        seed('Anthropic', 'ML Intern'),
      ],
      snippets
    );
    expect(packs.map((p) => p.company)).toEqual(['Anthropic']);
  });

  it('builds a cold email: names role + company, grounded, framing is StyleLinter-clean', () => {
    const full = new SnippetBook({
      'industry.intro': "I'm an MS AI student at Northeastern building ML systems.",
      'industry.detail': 'At my last role I shipped a perception model to production.',
      'industry.coop': "I'm looking for a Fall 2026 co-op and would value a conversation.",
      'common.signature': 'Parv Patodia',
    });
    const p = roleOutreachPacks([seed('Waymo', 'ML Intern')], full)[0]!;
    expect(p.coldEmail.subject).toContain('Waymo');
    expect(p.coldEmail.subject).toContain('ML Intern');
    expect(p.coldEmail.body).toContain("Waymo's ML Intern");
    expect(p.coldEmail.body).toContain('perception model'); // grounded in the snippet
    expect(p.coldEmail.body).toContain('Parv Patodia');      // signature
    // The email must NOT assert an attached file it lacks (LESSONS 2026-06-19).
    expect(p.coldEmail.body.toLowerCase()).not.toContain('attached');
    // The generated framing carries no banned vocabulary (reuse the outreach checker).
    const lint = new StyleLinter().lint(p.coldEmail.subject + '\n' + p.coldEmail.body);
    expect(lint.ok).toBe(true);
  });

  it('cold email omits missing detail/coop snippets instead of leaving blank gaps', () => {
    const p = roleOutreachPacks([seed('Nuro', 'ML Intern')], snippets)[0]!; // only linkedin.intro set
    expect(p.coldEmail.body).not.toMatch(/\n\n\n/);       // no empty paragraph gaps
    expect(p.coldEmail.body).toContain('MS AI student at Northeastern'); // intro fallback used
    expect(new StyleLinter().lint(p.coldEmail.body).ok).toBe(true);
  });

  it('caps companies and roles-per-company', () => {
    const roles: RoleSeed[] = [];
    for (let i = 0; i < 20; i++) roles.push(seed(`Co${i}`, 'ML Intern'));
    const c1 = roleOutreachPacks(roles, snippets, { maxCompanies: 5 });
    expect(c1).toHaveLength(5);

    const many = [seed('Co', 'A Intern'), seed('Co', 'B Intern'), seed('Co', 'C Intern'), seed('Co', 'D Intern')];
    const cap = roleOutreachPacks(many, snippets, { maxRolesPerCompany: 2 });
    expect(cap[0]!.roles).toEqual(['A Intern', 'B Intern']);
  });
});
