/**
 * Generates cover letter PDFs from markdown source files.
 *
 * WHY Playwright page.pdf() instead of a dedicated PDF library:
 * The project already depends on Playwright for browser automation.
 * page.pdf() gives us full CSS control, proper font rendering, and
 * exact page sizing (US Letter) without adding another dependency.
 *
 * WHY inline HTML template instead of an external file:
 * The cover letters have a simple, fixed structure. Keeping the template
 * here makes the script self-contained and easy to maintain.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

interface CoverLetterSpec {
  mdPath:  string;
  pdfPath: string;
  label:   string;
}

const SPECS: CoverLetterSpec[] = [
  {
    mdPath:  path.join(ROOT, 'cv/cover_letter_ai.md'),
    pdfPath: path.join(ROOT, 'cv/cover_letter_ai.pdf'),
    label:   'AI / ML',
  },
  {
    mdPath:  path.join(ROOT, 'cv/cover_letter_robotics.md'),
    pdfPath: path.join(ROOT, 'cv/cover_letter_robotics.pdf'),
    label:   'Robotics',
  },
];

// ── Markdown to styled HTML ──────────────────────────────────────────────────

function mdToHtml(md: string): string {
  // Minimal markdown processing: strip #headings used for structure,
  // preserve paragraph breaks, convert **bold**, and line breaks.
  const withoutH = md.replace(/^#+\s+.+$/gm, '').trim();

  // Split into paragraphs on blank lines
  const paragraphs = withoutH.split(/\n{2,}/).map((p) => {
    const lines = p
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('<br>');
    return `<p>${lines}</p>`;
  });

  return paragraphs.join('\n');
}

function buildHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #1a1a1a;
    }
    p {
      margin-bottom: 0.9em;
    }
    p:last-child {
      margin-bottom: 0;
    }
    strong {
      font-weight: bold;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Launching browser for PDF generation...');
  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext();
  const page    = await ctx.newPage();

  for (const spec of SPECS) {
    if (!fs.existsSync(spec.mdPath)) {
      console.error(`  SKIP: ${spec.label} — source not found: ${spec.mdPath}`);
      continue;
    }

    console.log(`  Generating: ${spec.label}  →  ${path.relative(ROOT, spec.pdfPath)}`);

    const md   = fs.readFileSync(spec.mdPath, 'utf8');
    const body = mdToHtml(md);
    const html = buildHtml(body);

    await page.setContent(html, { waitUntil: 'networkidle' });

    await page.pdf({
      path: spec.pdfPath,
      format: 'Letter',
      printBackground: false,
      // Margins are handled by @page CSS above; set to 0 here to avoid doubling
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    console.log(`  Done: ${path.basename(spec.pdfPath)}`);
  }

  await browser.close();
  console.log('\nCover letter PDFs generated successfully.');
}

main().catch((err: unknown) => {
  console.error('generate-cover-letters failed:', err);
  process.exit(1);
});
