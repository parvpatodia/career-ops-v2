/**
 * `npm run ui` — a local web UI for the "be first to apply" flow. Serves one page
 * (the fresh-roles hot-list + the Ready queue) and one JSON endpoint (/api/feed).
 *
 * Design: routing only. Data comes from JobFeedService (read model over the event
 * log + the watcher hot-list); the HTML comes from renderPage. Node's built-in
 * http, so there is NO web framework dependency and no build step.
 *
 * Shareable, on-device (Tsenta-style): each person runs this from their own clone
 * with their own config/answers/cv — nothing is hosted, no auth, no shared server,
 * and personal data never leaves the machine. The UI is a VIEW + launcher: it
 * opens the real ATS page; applying + solving the captcha stays the human step.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { JobFeedService } from './JobFeedService.js';
import { renderPage } from './page.js';
import { roleOutreachPacks } from '../outreach/roleOutreach.js';
import { SnippetBook } from '../outreach/SnippetBook.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('ui');

export class UiServer {
  constructor(
    private readonly feed: JobFeedService,
    private readonly port: number = 4600,
    private readonly manifestPath = 'output/tailored-manifest.json'
  ) {}

  start(): http.Server {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.listen(this.port, () => {
      log.info(`career-ops UI: http://localhost:${this.port}`);
    });
    return server;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage());
      return;
    }

    if (path === '/api/feed') {
      try {
        const snapshot = this.feed.snapshot();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshot));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // Weekly LinkedIn outreach packs, derived from the SAME fresh roles the feed
    // shows (one read boundary). Read-only + lazy: the Outreach tab fetches this.
    if (path === '/api/outreach') {
      try {
        const packs = roleOutreachPacks(this.feed.fresh(200), SnippetBook.fromYaml(), { maxCompanies: 20 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ packs, generatedAt: new Date().toISOString() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // Serve a pre-tailored, uploadable PDF: /docs/resume/<id> | /docs/cover/<id>.
    // The id is looked up in the tailor:fresh manifest and the resolved path is
    // confined to output/tailored/ (no traversal, only tailored docs served).
    const docMatch = path.match(/^\/docs\/(resume|cover)\/(.+)$/);
    if (docMatch) {
      this.serveDoc(docMatch[1] as 'resume' | 'cover', decodeURIComponent(docMatch[2]!), res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }

  /** Stream a tailored PDF by job id, confined to output/tailored/. */
  private serveDoc(kind: 'resume' | 'cover', id: string, res: http.ServerResponse): void {
    const notFound = (): void => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };
    try {
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as Record<
        string,
        { resumePath?: string; coverLetterPdfPath?: string }
      >;
      const entry = manifest[id];
      const file = kind === 'resume' ? entry?.resumePath : entry?.coverLetterPdfPath;
      if (!file) return notFound();
      // Confine to output/tailored/ so a poisoned manifest path can't escape.
      const base = path.resolve('output/tailored');
      const resolved = path.resolve(file);
      if (resolved !== base && !resolved.startsWith(base + path.sep)) return notFound();
      if (!fs.existsSync(resolved)) return notFound();
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(fs.readFileSync(resolved));
    } catch {
      notFound();
    }
  }
}

// Entry point when run directly (npm run ui). Guarded so tests can import
// UiServer without binding a port.
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const feed = new JobFeedService(new ApplicationStore());
  const port = Number(process.env.CAREER_OPS_UI_PORT ?? 4600);
  new UiServer(feed, port).start();
}
