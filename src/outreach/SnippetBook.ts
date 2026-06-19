/**
 * Parv's human-approved self-claims, written once in config/outreach-snippets.yml,
 * resolved by key. This is the anti-fabrication mechanism for cold email, the
 * same role config/answers.yml plays for form fields: the drafter may only make
 * a claim about Parv by quoting an approved snippet, and the DraftGate proves
 * the quoted text is actually in the body. The recipient-specific personalization
 * is the free part; the claims about Parv are not.
 *
 * Injectable map for tests; file loader for production. Hard-fails on a malformed
 * entry rather than silently dropping an approved claim (the AnswerKB pattern).
 */

import fs from 'fs';
import yaml from 'js-yaml';

export class SnippetBook {
  constructor(private readonly snippets: Record<string, string>) {}

  static fromYaml(filePath = 'config/outreach-snippets.yml'): SnippetBook {
    if (!fs.existsSync(filePath)) return new SnippetBook({});
    const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) as { snippets?: unknown[] } | null;
    const list = raw?.snippets ?? [];
    const map: Record<string, string> = {};
    for (const [i, item] of list.entries()) {
      const e = item as { key?: unknown; text?: unknown };
      if (typeof e.key !== 'string' || e.key.trim() === '') {
        throw new Error(`outreach-snippets.yml entry ${i}: "key" must be a non-empty string`);
      }
      if (typeof e.text !== 'string' || e.text.trim() === '') {
        throw new Error(`outreach-snippets.yml entry ${i} (${e.key}): "text" must be a non-empty string`);
      }
      map[e.key] = e.text;
    }
    return new SnippetBook(map);
  }

  resolve(key: string): string | undefined {
    return this.snippets[key];
  }

  has(key: string): boolean {
    return key in this.snippets;
  }

  size(): number {
    return Object.keys(this.snippets).length;
  }
}
