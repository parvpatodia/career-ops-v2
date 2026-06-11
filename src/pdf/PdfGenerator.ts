/**
 * Generates a PDF resume from a tailored markdown file via Playwright.
 * WHY: Playwright HTML-to-PDF gives pixel-perfect output with the custom
 * template fonts and layout. wkhtmltopdf/pandoc alternatives have worse
 * CSS support and don't match the visual design in cv-template.html.
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import type { ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';

const TEMPLATE_PATH = 'templates/cv-template.html';
const OUTPUT_DIR = 'output/resumes';

export class PdfGenerator {
  private log = new Logger('PdfGenerator');

  /**
   * Generate a PDF from a tailored resume markdown file.
   * Returns the path to the generated PDF.
   */
  async generate(
    jobId: string,
    variant: ResumeVariant,
    tailoredMdPath: string
  ): Promise<string> {
    if (!fs.existsSync(tailoredMdPath)) {
      throw new Error(`Tailored resume not found: ${tailoredMdPath}`);
    }
    if (!fs.existsSync(TEMPLATE_PATH)) {
      throw new Error(`CV template not found: ${TEMPLATE_PATH}`);
    }

    const mdContent = fs.readFileSync(tailoredMdPath, 'utf8');
    const html = this.injectIntoTemplate(mdContent);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const pdfPath = path.join(OUTPUT_DIR, `${jobId}-${variant}.pdf`);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();

      // Write HTML to temp file so relative font paths resolve correctly
      const tmpHtml = path.join(OUTPUT_DIR, `_tmp_${jobId}.html`);
      fs.writeFileSync(tmpHtml, html);

      await page.goto(`file://${path.resolve(tmpHtml)}`);
      await page.waitForLoadState('networkidle');

      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      });

      fs.unlinkSync(tmpHtml); // clean up temp file
    } finally {
      await browser.close();
    }

    this.log.info(`PDF generated: ${pdfPath}`);
    return pdfPath;
  }

  /**
   * Convert resume markdown to HTML and inject into the template.
   * WHY: The template handles fonts, spacing, and print layout.
   * We only need to inject the content — not rebuild the visual design.
   */
  private injectIntoTemplate(mdContent: string): string {
    let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const bodyHtml = this.markdownToHtml(mdContent);

    // Replace placeholders in the template
    template = template.replace('{{BODY}}', bodyHtml);
    template = template.replace('{{LANG}}', 'en');
    template = template.replace('{{NAME}}', this.extractName(mdContent));

    return template;
  }

  /** Minimal markdown-to-HTML converter for resume content. */
  private markdownToHtml(md: string): string {
    const lines = md.split('\n');
    const output: string[] = [];
    let inList = false;

    for (const line of lines) {
      if (line.startsWith('# ')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<h1>${this.escapeHtml(line.slice(2))}</h1>`);
      } else if (line.startsWith('## ')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<h2>${this.escapeHtml(line.slice(3))}</h2>`);
      } else if (line.startsWith('### ')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<h3>${this.escapeHtml(line.slice(4))}</h3>`);
      } else if (line.startsWith('- ')) {
        if (!inList) { output.push('<ul>'); inList = true; }
        output.push(`<li>${this.renderInline(line.slice(2))}</li>`);
      } else if (line.startsWith('**') && line.endsWith('**')) {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push(`<p><strong>${this.escapeHtml(line.slice(2, -2))}</strong></p>`);
      } else if (line.trim() === '') {
        if (inList) { output.push('</ul>'); inList = false; }
        output.push('');
      } else if (line.startsWith('|')) {
        // Skip markdown tables — not used in resume content
        if (inList) { output.push('</ul>'); inList = false; }
      } else {
        if (inList) { output.push('</ul>'); inList = false; }
        if (line.trim()) output.push(`<p>${this.renderInline(line)}</p>`);
      }
    }

    if (inList) output.push('</ul>');
    return output.join('\n');
  }

  private renderInline(text: string): string {
    return this.escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private extractName(md: string): string {
    const h1 = md.split('\n').find((l) => l.startsWith('# '));
    return h1 ? h1.slice(2).trim() : 'Resume';
  }
}
