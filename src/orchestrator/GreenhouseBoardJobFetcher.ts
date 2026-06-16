/**
 * Fetches a Greenhouse job's field schema (boards-api, questions=true) at apply
 * time, so the GreenhouseFormSource knows the exact field names, required-ness,
 * and option values. The scanner fetches the JD (no questions); the apply step
 * needs the question schema, hence a separate, narrow fetch.
 * REF: https://developers.greenhouse.io/job-board.html
 *
 * WHY null-on-failure (not throw): a missing/unfetchable schema must ABSTAIN
 * the application (the factory turns null into unsupported), never crash a batch
 * or guess a form. The fetch is injectable so the URL parsing is unit-tested
 * without a network.
 */

import type { FetchLike } from '../scanner/GreenhouseBoardScanner.js';
import type { Application } from '../types.js';
import { Logger } from '../utils/Logger.js';

const API = 'https://boards-api.greenhouse.io/v1/boards';

export interface GreenhouseRef {
  token: string;
  jobId: string;
}

/**
 * Parse the board token + numeric job id from a Greenhouse application URL.
 * Handles boards.greenhouse.io and job-boards.greenhouse.io /{token}/jobs/{id}.
 * Custom domains (gh_jid= params) carry no board token, so they return null and
 * the caller abstains.
 */
export function parseGreenhouseRef(url: string): GreenhouseRef | null {
  const m = url.match(/(?:job-)?boards\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (!m) return null;
  return { token: m[1]!, jobId: m[2]! };
}

export class GreenhouseBoardJobProvider {
  private log = new Logger('gh-board-job');

  constructor(private readonly fetchFn: FetchLike = fetch) {}

  /** GreenhouseJobProvider shape: returns the job JSON, or null to abstain. */
  async provide(app: Application): Promise<Record<string, unknown> | null> {
    const ref = parseGreenhouseRef(app.url);
    if (!ref) {
      this.log.warn(`Cannot parse a Greenhouse board ref from ${app.url} — abstaining`);
      return null;
    }
    try {
      const res = await this.fetchFn(`${API}/${ref.token}/jobs/${ref.jobId}?questions=true`);
      if (!res.ok) {
        this.log.warn(`Greenhouse job ${ref.token}/${ref.jobId}: HTTP ${res.status} — abstaining`);
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.log.warn(`Greenhouse job fetch failed (${(err as Error).message}) — abstaining`);
      return null;
    }
  }
}
