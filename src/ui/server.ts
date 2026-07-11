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
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { JobFeedService } from './JobFeedService.js';
import { renderPage } from './page.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('ui');

export class UiServer {
  constructor(
    private readonly feed: JobFeedService,
    private readonly port: number = 4600
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

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Entry point when run directly (npm run ui). Guarded so tests can import
// UiServer without binding a port.
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const feed = new JobFeedService(new ApplicationStore());
  const port = Number(process.env.CAREER_OPS_UI_PORT ?? 4600);
  new UiServer(feed, port).start();
}
