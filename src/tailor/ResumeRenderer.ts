/**
 * Renders tailored resume markdown into the final HTML (the MAKER half of the
 * resume maker/checker pair). Pure: markdown + contact facts in, HTML string
 * out. The browser PDF step (PdfGenerator) is a separate thin IO layer; this
 * stays unit-testable without launching Chromium.
 *
 * Two invariants this enforces:
 *   - profile.yml is the single source of contact truth: the name and contact
 *     row come from the passed identity, NEVER from the markdown. Any name /
 *     contact preamble in the markdown (everything before the first "## ") is
 *     dropped, so a stale contact line in a CV file can't reach the employer.
 *   - no placeholder leaks: the template's {{LANG}}, {{NAME}}, {{CONTACT_ROW}}
 *     and {{BODY}} are all filled here; the ResumeVerifier asserts none survive.
 */

import fs from 'fs';
import type { ContactFacts } from './ResumeVerifier.js';

const DEFAULT_TEMPLATE = 'templates/cv-template.html';
const SECTION_RE = /^##\s+(.*)$/;

export class ResumeRenderer {
  constructor(private readonly templatePath = DEFAULT_TEMPLATE) {}

  renderHtml(markdown: string, identity: ContactFacts): string {
    if (!fs.existsSync(this.templatePath)) {
      throw new Error(`CV template not found: ${this.templatePath}`);
    }
    const template = fs.readFileSync(this.templatePath, 'utf8');
    const body = ResumeRenderer.markdownToHtml(ResumeRenderer.stripPreamble(markdown));

    return template
      .replace(/\{\{LANG\}\}/g, 'en')
      .replace(/\{\{NAME\}\}/g, this.escapeHtml(identity.name))
      .replace(/\{\{CONTACT_ROW\}\}/g, this.contactRow(identity))
      .replace(/\{\{BODY\}\}/g, body);
  }

  /** The "## " section titles of the resume body, preamble ignored. */
  static sectionTitles(markdown: string): string[] {
    const titles: string[] = [];
    for (const line of ResumeRenderer.stripPreamble(markdown).split('\n')) {
      const m = SECTION_RE.exec(line);
      if (m) titles.push(m[1].trim());
    }
    return titles;
  }

  // WHY drop the preamble: a CV markdown file may open with "# Name" + a contact
  // line. Contact truth lives in profile.yml, so anything before the first
  // section header is discarded rather than rendered into the body.
  static stripPreamble(markdown: string): string {
    const lines = markdown.split('\n');
    const firstSection = lines.findIndex((l) => SECTION_RE.test(l));
    return firstSection <= 0 ? markdown : lines.slice(firstSection).join('\n');
  }

  private contactRow(id: ContactFacts): string {
    const sep = '<span class="separator">|</span>';
    const parts: string[] = [];
    if (id.phone) parts.push(`<span>${this.escapeHtml(id.phone)}</span>`);
    if (id.email) parts.push(`<a href="mailto:${this.escapeAttr(id.email)}">${this.escapeHtml(id.email)}</a>`);
    if (id.linkedin) parts.push(this.link(id.linkedin));
    if (id.github) parts.push(this.link(id.github));
    if (id.portfolio) parts.push(this.link(id.portfolio));
    if (id.location) parts.push(`<span>${this.escapeHtml(id.location)}</span>`);
    return parts.join(`\n      ${sep}\n      `);
  }

  private link(url: string): string {
    const display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `<a href="${this.escapeAttr(url)}">${this.escapeHtml(display)}</a>`;
  }

  // ── Markdown → HTML (the body styling lives in the template's .body CSS) ──

  static markdownToHtml(md: string): string {
    const renderer = new ResumeRenderer();
    const lines = md.split('\n');
    const out: string[] = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

    for (const line of lines) {
      if (line.startsWith('### ')) {
        closeList();
        out.push(`<h3>${renderer.escapeHtml(line.slice(4))}</h3>`);
      } else if (line.startsWith('## ')) {
        closeList();
        out.push(`<h2>${renderer.escapeHtml(line.slice(3))}</h2>`);
      } else if (line.startsWith('# ')) {
        // Drop a top-level H1: the candidate name comes from profile.yml in the
        // header, never from the body, so a stray "# Name" must not duplicate it.
        closeList();
      } else if (line.startsWith('- ')) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${renderer.renderInline(line.slice(2))}</li>`);
      } else if (line.startsWith('**') && line.trimEnd().endsWith('**')) {
        closeList();
        out.push(`<p><strong>${renderer.escapeHtml(line.trim().slice(2, -2))}</strong></p>`);
      } else if (line.trim() === '') {
        closeList();
      } else if (line.startsWith('|')) {
        closeList(); // skip markdown tables — not used in resume content
      } else {
        closeList();
        if (line.trim()) out.push(`<p>${renderer.renderInline(line)}</p>`);
      }
    }
    closeList();
    return out.join('\n');
  }

  private renderInline(text: string): string {
    return this.escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text).replace(/"/g, '&quot;');
  }
}
