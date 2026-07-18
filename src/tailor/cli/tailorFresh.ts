/**
 * `npm run tailor:fresh` — M9 F5a. Pre-tailors the fresh, on-field, last-24h
 * shortlist so a résumé + cover letter (dated TODAY, grounded, verified) is ready
 * to upload the moment Parv opens a role.
 *
 * Flow per role: fetch JD (best-effort) -> pick the résumé variant by category ->
 * build grounded CoverLetterData from the real profile -> Tailor.tailor (résumé
 * PDF + cover letter, verify-or-abstain) -> record a manifest entry. A role that
 * abstains (unverifiable résumé, below-threshold cover letter) is recorded with
 * its reason, never a broken doc. Idempotent: re-tailors only if not already done
 * TODAY (so the date stays current) or with --force.
 *
 *   npm run tailor:fresh                 tailor today's last-24h on-field shortlist
 *   npm run tailor:fresh -- --limit 5    cap the batch
 *   npm run tailor:fresh -- --force      re-tailor even if done today
 *   npm run tailor:fresh -- --dry-run    list what would be tailored, do nothing
 *
 * Output (gitignored): output/tailored/<jobId>-<variant>.pdf, the cover letter,
 * and output/tailored-manifest.json (read by the UI to show "docs ready").
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { ApplicationStore } from '../../tracker/ApplicationStore.js';
import { JobFeedService, type FreshRole } from '../../ui/JobFeedService.js';
import { Tailor } from '../Tailor.js';
import { CoverLetterDataBuilder } from '../CoverLetterDataBuilder.js';
import { ProfileLoader } from '../../applier/ProfileLoader.js';
import { fetchJd } from '../jdFetch.js';
import { PdfGenerator } from '../../pdf/PdfGenerator.js';
import { Notifier } from '../../applier/Notifier.js';
import { Logger } from '../../utils/Logger.js';
import type { Job, EvaluationResult, ResumeVariant } from '../../types.js';

const log = new Logger('tailor:fresh');
const MANIFEST = 'output/tailored-manifest.json';
const OUT_DIR = 'output/tailored';

// Category -> the résumé variant that best fits it (cv/<variant>.md must exist).
const CATEGORY_VARIANT: Record<string, ResumeVariant> = {
  'AI/ML': 'ml',
  'Robotics/AV': 'robotics',
  Data: 'ml',
  Software: 'ai',
  Other: 'master',
};

interface ManifestEntry {
  company: string;
  role: string;
  category?: string;
  variant: ResumeVariant;
  resumePath?: string;
  coverLetterPath?: string;
  coverLetterPdfPath?: string;
  verified: boolean;
  abstainReason?: string;
  jdChars: number;
  applyUrl?: string;
  tailoredAt: string;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/**
 * A clean, programmatic cover-letter template built from the real identity at
 * runtime. WHY not cv/cover_letter_template.md: that one was authored for manual/
 * LLM filling — it carries "[instruction]" guidance lines (some with em dashes)
 * that the programmatic CoverLetterBuilder leaves in, so its output trips the
 * no-dash gate and abstains every time. This one has ONLY the {{placeholders}} +
 * scaffolding: no dashes, no instructions, no leaked guidance. Written to a
 * gitignored path so identity/contact (PII) is never committed.
 */
export function buildCoverTemplate(id: {
  name: string;
  phone: string;
  email: string;
  location: string;
  program: string;
  university: string;
}): string {
  const contact = [id.phone, id.email, id.location].filter(Boolean).join(' | ');
  const edu = [id.program, id.university].filter(Boolean).join(', ');
  return [
    id.name,
    contact,
    edu,
    '',
    '{{DATE}}',
    '',
    'Hiring Team, {{COMPANY_NAME}}',
    'Re: {{ROLE_TITLE}}',
    '',
    '{{PARA_1_WHY_COMPANY}}',
    '',
    '{{PARA_2_STRONGEST_PROJECT}}',
    '',
    '{{PARA_3_EXPERIENCE_ALIGNMENT}}',
    '',
    '{{PARA_4_CLOSE}}',
    '',
    'Sincerely,',
    id.name,
    '',
  ].join('\n');
}

/** Render a cover-letter .md (the filled template: header + paragraphs, blank-line
 *  separated) to clean letter HTML for a PDF. Escapes HTML; the PdfGenerator does
 *  the ATS Unicode normalization. Pure + exported so it is unit-tested. */
export function coverLetterHtml(markdown: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = (markdown ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const body = blocks.map((b) => `<p>${esc(b).replace(/\n/g, '<br/>')}</p>`).join('\n');
  return (
    `<!doctype html><html><head><meta charset="utf-8"/><style>` +
    `body{font:11.5pt/1.55 Georgia,'Times New Roman',serif;color:#111;max-width:660px;margin:0 auto;}` +
    `p{margin:0 0 12px;}p:first-child{font-weight:700;line-height:1.35;}` +
    `</style></head><body>${body}</body></html>`
  );
}

/** Recent = posted within ~24h (board roles) or first-caught within 24h (email/
 *  list roles, which carry no real posting date). Matches the UI "Last 24h" rule. */
function isRecent(j: FreshRole): boolean {
  if (j.freshness) return j.freshness.postedAgeDays <= 1;
  const ms = Date.parse(j.caughtAt ?? '');
  return !Number.isNaN(ms) && Date.now() - ms < 24 * 3600 * 1000;
}

function readManifest(): Record<string, ManifestEntry> {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as Record<string, ManifestEntry>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const limit = arg('--limit') ? parseInt(arg('--limit')!, 10) : 12;
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');
  const today = new Date().toISOString().slice(0, 10);

  // fresh() already gates on-field + US + F-1-eligible; add recency + a real company.
  const feed = new JobFeedService(new ApplicationStore());
  const shortlist = feed
    .fresh(200)
    .filter((j) => isRecent(j) && (j.company ?? '').trim() !== '')
    .slice(0, limit);

  if (shortlist.length === 0) {
    console.log('No fresh, on-field, last-24h roles to tailor yet.');
    return;
  }

  const manifest = readManifest();

  if (dryRun) {
    console.log(`Dry run: ${shortlist.length} role(s) in scope for ${today}.`);
    for (const r of shortlist) {
      const done = manifest[r.id]?.tailoredAt?.slice(0, 10) === today && manifest[r.id]?.verified;
      console.log(`  ${done ? '(done today)' : 'TAILOR    '} ${r.company} — ${r.role} [${CATEGORY_VARIANT[r.category ?? 'Other'] ?? 'master'}]`);
    }
    return;
  }

  const profile = new ProfileLoader();
  const clBuilder = new CoverLetterDataBuilder(profile);
  // Generate the clean cover-letter template from the real identity (gitignored,
  // no committed PII) and point the Tailor at it instead of the manual cv/ one.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const coverTemplatePath = path.join(OUT_DIR, '.cover-template.md');
  fs.writeFileSync(coverTemplatePath, buildCoverTemplate(profile.getIdentity()));
  const tailor = new Tailor({ outputDir: OUT_DIR, coverOutputDir: path.join(OUT_DIR, 'cover_letters'), coverTemplatePath });
  const coverPdf = new PdfGenerator(path.join(OUT_DIR, 'cover_letters'));
  const notifier = new Notifier();

  let tailored = 0;
  let abstained = 0;
  let skipped = 0;

  for (const role of shortlist) {
    const prior = manifest[role.id];
    if (!force && prior && prior.verified && prior.tailoredAt.slice(0, 10) === today) {
      skipped++;
      continue;
    }

    const variant = CATEGORY_VARIANT[role.category ?? 'Other'] ?? 'master';
    const jd = await fetchJd(role.applyUrl ?? '');
    const job: Job = {
      id: role.id,
      title: role.role,
      company: role.company,
      url: role.applyUrl ?? '',
      applyUrl: role.applyUrl,
      // Tailoring never routes on platform/status (it uses id/title/company/jd);
      // a neutral valid value keeps the Job type satisfied.
      platform: 'direct',
      status: 'discovered',
      location: role.location ?? '',
      remote: /remote/i.test(role.location ?? ''),
      postedAt: role.postedAt ?? '',
      discoveredAt: role.caughtAt ?? new Date().toISOString(),
      // A fetched JD drives keyword tailoring; without one the résumé is the clean
      // category variant (still valid), and the cover letter grounds on category.
      jd: jd || `${role.role} at ${role.company}`,
    };
    // On-field shortlist: a fixed pass-threshold score so the cover letter renders
    // (it gates at >=60). This score is internal, never reaches the employer.
    const evaluation: EvaluationResult = {
      jobId: role.id,
      score: 75,
      breakdown: { skillMatch: 0, experienceMatch: 0, locationMatch: 0, visaMatch: 0, companySignal: 0, timingMatch: 0 },
      reasoning: 'auto-tailor: fresh on-field last-24h shortlist',
      resumeVariant: variant,
      topMatchingSkills: [],
      missingSkills: [],
      shouldApply: false,
      shouldGenerateCoverLetter: true,
      evaluatedAt: new Date().toISOString(),
    };
    const clData = clBuilder.build({ company: role.company, role: role.role, category: role.category ?? 'Other', jd });

    try {
      const result = await tailor.tailor(job, evaluation, clData);
      // Render the cover letter to an uploadable PDF (Tailor only writes the .md).
      let coverLetterPdfPath: string | undefined;
      if (result.coverLetterPath && fs.existsSync(result.coverLetterPath)) {
        try {
          const md = fs.readFileSync(result.coverLetterPath, 'utf8');
          const pdfOut = result.coverLetterPath.replace(/\.md$/, '.pdf');
          await coverPdf.htmlToPdf(coverLetterHtml(md), pdfOut);
          coverLetterPdfPath = pdfOut;
        } catch (err) {
          log.warn(`cover-letter PDF failed for ${role.id}: ${(err as Error).message}`);
        }
      }
      manifest[role.id] = {
        company: role.company,
        role: role.role,
        category: role.category,
        variant,
        resumePath: result.pdfPath,
        coverLetterPath: result.coverLetterPath,
        coverLetterPdfPath,
        verified: !!result.verified,
        abstainReason: result.abstainReason,
        jdChars: jd.length,
        applyUrl: role.applyUrl,
        tailoredAt: result.tailoredAt,
      };
      if (result.verified && result.pdfPath) tailored++;
      else abstained++;
    } catch (err) {
      manifest[role.id] = {
        company: role.company,
        role: role.role,
        variant,
        verified: false,
        abstainReason: (err as Error).message,
        jdChars: jd.length,
        applyUrl: role.applyUrl,
        tailoredAt: new Date().toISOString(),
      };
      abstained++;
      log.warn(`Tailoring threw for ${role.company} - ${role.role}: ${(err as Error).message}`);
    }
  }

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`tailor:fresh ${today}: ${tailored} tailored, ${abstained} abstained, ${skipped} already done today.`);
  if (tailored > 0) {
    notifier.notify({
      kind: 'batch_complete',
      title: 'Résumés + cover letters ready',
      message: `${tailored} role(s) tailored (dated ${today}). Open a role and upload from ${OUT_DIR}/.`,
      urgent: false,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
