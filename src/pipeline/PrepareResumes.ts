/**
 * One-time command: generates 5 variant PDFs from cv/*.md files.
 * Run with: npm run prep
 * WHY: Pre-generate once so the pipeline never blocks on PDF generation
 * during batch apply. Each application just copies the right variant.
 */

import { PdfGenerator } from '../pdf/PdfGenerator.js';
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
  const generator = new PdfGenerator();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const { variant, mdPath, outputName } of VARIANTS) {
    const outputPath = path.join(OUTPUT_DIR, outputName);

    if (!fs.existsSync(mdPath)) {
      log.warn(`Skipping ${variant} — ${mdPath} not found`);
      continue;
    }

    log.info(`Generating ${outputName}...`);
    try {
      const generatedPath = await generator.generate(`parv-${variant}`, variant, mdPath);
      // Rename to standard name
      if (generatedPath !== outputPath) {
        fs.renameSync(generatedPath, outputPath);
      }
      log.info(`Done: ${outputPath}`);
    } catch (err) {
      log.error(`Failed to generate ${outputName}`, err);
    }
  }

  log.info('All variant PDFs ready in output/resumes/');
}
