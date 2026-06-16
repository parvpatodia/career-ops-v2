/**
 * One-time command: generates 5 variant PDFs from cv/*.md files.
 * Run with: npm run prep
 * WHY: Pre-generate once so the pipeline never blocks on PDF generation
 * during batch apply. Each application just copies the right variant.
 */

import { PdfGenerator } from '../pdf/PdfGenerator.js';
import { ResumeRenderer } from '../tailor/ResumeRenderer.js';
import { ProfileLoader } from '../applier/ProfileLoader.js';
import { contactFacts } from '../tailor/identity.js';
import type { ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';
import fs from 'fs';
import path from 'path';

const log = new Logger('PrepareResumes');

const VARIANTS: Array<{ variant: ResumeVariant; mdPath: string; outputName: string }> = [
  { variant: 'master',   mdPath: 'cv/master.md',   outputName: 'parv-master.pdf' },
  { variant: 'ai',       mdPath: 'cv/ai.md',        outputName: 'parv-ai.pdf' },
  { variant: 'ml',       mdPath: 'cv/ml.md',        outputName: 'parv-ml.pdf' },
  { variant: 'robotics', mdPath: 'cv/robotics.md',  outputName: 'parv-robotics.pdf' },
  { variant: 'ta',       mdPath: 'cv/ta.md',        outputName: 'parv-ta.pdf' },
];

const OUTPUT_DIR = 'output/resumes';

export async function prepareResumes(): Promise<void> {
  const generator = new PdfGenerator(OUTPUT_DIR);
  const renderer = new ResumeRenderer();
  const identity = contactFacts(new ProfileLoader().getIdentity());
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const { variant, mdPath, outputName } of VARIANTS) {
    const outputPath = path.join(OUTPUT_DIR, outputName);

    if (!fs.existsSync(mdPath)) {
      log.warn(`Skipping ${variant} — ${mdPath} not found`);
      continue;
    }

    log.info(`Generating ${outputName}...`);
    try {
      const html = renderer.renderHtml(fs.readFileSync(mdPath, 'utf8'), identity);
      const result = await generator.htmlToPdf(html, outputPath);
      log.info(`Done: ${result.pdfPath} (${result.pageCount}p, ${(result.bytes / 1024).toFixed(1)}KB)`);
    } catch (err) {
      log.error(`Failed to generate ${outputName}`, err);
    }
  }

  log.info('All variant PDFs ready in output/resumes/');
}
