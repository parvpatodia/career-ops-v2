import { describe, it, expect } from 'vitest';
import { extractJdText, fetchJd, MIN_JD_CHARS } from '../../src/tailor/jdFetch.js';

const longJd =
  'Machine Learning Intern. You will build and evaluate models in PyTorch, work on computer vision pipelines, and ship features to production. Required: Python, strong ML fundamentals, and experience with deep learning frameworks. This is a Fall 2026 internship based in San Francisco.';

describe('extractJdText', () => {
  it('strips tags/scripts/styles and returns the readable JD when substantial', () => {
    const html = `<html><head><style>.x{color:red}</style></head><body>
      <nav>Home Jobs</nav><script>window.__NEXT_DATA__={"junk":1}</script>
      <div class="desc">${longJd}</div><footer>Privacy</footer></body></html>`;
    const text = extractJdText(html);
    expect(text).toContain('PyTorch');
    expect(text).toContain('computer vision');
    expect(text).not.toContain('color:red'); // style block removed
    expect(text).not.toContain('__NEXT_DATA__'); // script block removed
    expect(text.length).toBeGreaterThanOrEqual(MIN_JD_CHARS);
  });

  it("returns '' for a JS shell with too little text (below the floor)", () => {
    const shell = '<html><body><div id="root"></div><script>load()</script></body></html>';
    expect(extractJdText(shell)).toBe('');
  });

  it('decodes common entities', () => {
    const html = `<body><p>${'AI &amp; ML role. '.repeat(20)}</p></body>`;
    expect(extractJdText(html)).toContain('AI & ML');
  });
});

describe('fetchJd', () => {
  const fakeFetch = (body: string, ok = true) => async () => ({ ok, text: async () => body });

  it('returns the extracted JD on a successful fetch', async () => {
    const jd = await fetchJd('https://simplify.jobs/p/abc', fakeFetch(`<body><div>${longJd}</div></body>`));
    expect(jd).toContain('PyTorch');
  });

  it("returns '' on a non-ok response, a throw, or a non-http url", async () => {
    expect(await fetchJd('https://x/1', fakeFetch('body', false))).toBe('');
    expect(await fetchJd('https://x/1', async () => { throw new Error('network'); })).toBe('');
    expect(await fetchJd('javascript:alert(1)', fakeFetch(`<body>${longJd}</body>`))).toBe('');
  });
});
