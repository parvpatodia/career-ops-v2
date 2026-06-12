/**
 * Facade over the append-only event log, keeping the v1 tracker API.
 * WHY a facade: Tracker, the apply CLI, and the pipeline all spoke this
 * interface. They now share the single locked write path (AGENTS.md
 * invariant 4) instead of three unlocked fs writers; v1's parse-error
 * wipe is impossible by construction because nothing rewrites the log.
 */

import fs from 'fs';
import path from 'path';
import type { Application, ApplicationStatus } from '../types.js';
import { EventStore, TransitionError } from '../store/EventStore.js';
import { ViewWriter } from '../store/ViewWriter.js';
import { appIdFor, SUBMITTED_STATUSES, TERMINAL_STATUSES } from '../store/events.js';
import type { Projection } from '../store/Projection.js';
import { Logger } from '../utils/Logger.js';

const DEFAULT_JSON_PATH = 'data/applications.json';
const DEFAULT_MD_PATH = 'data/applications.md';

export class DuplicateApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateApplicationError';
  }
}

const MD_HEADER =
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Cover Letter | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------------|-----|\n';

export class ApplicationStore {
  private log = new Logger('ApplicationStore');
  private readonly jsonPath: string;
  private readonly mdPath: string;
  private readonly events: EventStore;
  private readonly viewWriter = new ViewWriter();

  // WHY injectable paths: tests write to a temp directory. The event log
  // lives next to the view it generates.
  constructor(jsonPath = DEFAULT_JSON_PATH, mdPath = DEFAULT_MD_PATH) {
    this.jsonPath = jsonPath;
    this.mdPath = mdPath;
    this.events = new EventStore(path.join(path.dirname(jsonPath), 'events.jsonl'));
  }

  /** Kept for API compatibility: regenerates both views from the log. */
  load(): void {
    this.persist(this.projection());
  }

  getAll(): Application[] {
    return this.projection().all();
  }

  getById(id: string): Application | undefined {
    return this.projection().getByLegacyId(id);
  }

  findByCompanyAndRole(company: string, role: string): Application | undefined {
    return this.projection().getByAppId(appIdFor(company, role));
  }

  getByStatus(status: ApplicationStatus): Application[] {
    return this.projection().getByStatus(status);
  }

  nextId(): string {
    return this.projection().nextId();
  }

  /** Add a new application. Throws if company+role already exists. */
  add(app: Application): void {
    const appId = appIdFor(app.company, app.role);
    const existing = this.projection().getByAppId(appId);
    if (existing) {
      throw new DuplicateApplicationError(
        `Application already exists: ${app.company} - ${app.role} (id: ${existing.id}). Use update() instead.`
      );
    }
    this.events.append({ type: 'queued', appId, payload: { application: app } });
    this.persist(this.projection());
    this.log.info(`Added application: ${app.company} - ${app.role}`, { id: app.id });
  }

  /** Update status, notes, or other mutable fields on an existing application. */
  update(
    id: string,
    patch: Partial<Pick<Application, 'status' | 'notes' | 'pdfPath' | 'coverLetterPath' | 'appliedAt'>>
  ): void {
    const proj = this.projection();
    const existing = proj.getByLegacyId(id);
    if (!existing) {
      if (proj.legacyIdIsAmbiguous(id)) {
        throw new Error(
          `Application id ${id} is ambiguous (shared by multiple company+role pairs); update by company+role instead`
        );
      }
      throw new Error(`Application not found: ${id}`);
    }
    const appId = appIdFor(existing.company, existing.role);
    const { status, appliedAt, ...rest } = patch;
    let appended = 0;

    // WHY SUBMITTED_STATUSES, not just 'Applied': marking Interview or
    // Offer directly still means an application went out; the submitted
    // flag feeds the double-submit guard (review 2026-06-11: this diverged
    // from the migration's mapping and would have let M2 re-apply to a
    // company already interviewing).
    if (status && SUBMITTED_STATUSES.has(status)) {
      try {
        this.events.append({
          type: 'submitted',
          appId,
          payload: { appliedAt: appliedAt ?? new Date().toISOString() },
        });
        appended++;
      } catch (err) {
        // Re-marking an already-submitted job from the CLI is a no-op, not
        // a violation. The hard guard protects the autopilot submit path.
        if (err instanceof TransitionError) {
          this.log.warn(`Already submitted, ignoring repeat: ${existing.company} - ${existing.role}`);
        } else {
          throw err;
        }
      }
    } else if (status && TERMINAL_STATUSES.has(status)) {
      this.events.append({ type: 'closed', appId, payload: { status } });
      appended++;
    }

    const notePatch: Record<string, unknown> = { ...rest };
    if (appliedAt && !(status && SUBMITTED_STATUSES.has(status))) notePatch.appliedAt = appliedAt;
    // Submitted upgrades only to Applied; later stages set their exact
    // status here. Unknown-to-lifecycle statuses also land here.
    if (status && status !== 'Applied' && !TERMINAL_STATUSES.has(status)) notePatch.status = status;
    if (Object.keys(notePatch).length > 0) {
      this.events.append({ type: 'note', appId, payload: { patch: notePatch } });
      appended++;
    }

    if (appended === 0) return; // Nothing changed: no view rewrite, no log line claiming otherwise.
    this.persist(this.projection());
    this.log.info(`Updated application: ${id}`, patch as Record<string, unknown>);
  }

  private projection(): Projection {
    return this.events.projection();
  }

  private persist(proj: Projection): void {
    this.viewWriter.write(proj, this.jsonPath);
    this.writeMarkdown(proj);
  }

  private writeMarkdown(proj: Projection): void {
    const rows = proj
      .all()
      .map((a) => {
        const pdf = a.pdfPath ? '✅' : '❌';
        const cl = a.coverLetterPath ? `[CL](${a.coverLetterPath})` : '';
        // WHY no falsy check: score 0 is a real evaluated score, not
        // "unscored" (review 2026-06-11).
        const score = typeof a.score === 'number' ? `${a.score}/100` : '-';
        return `| ${a.id} | ${a.date} | ${a.company} | ${a.role} | ${score} | ${a.status} | ${pdf} | ${cl} | [Apply](${a.url}) |`;
      })
      .join('\n');

    fs.mkdirSync(path.dirname(this.mdPath), { recursive: true });
    fs.writeFileSync(this.mdPath, MD_HEADER + rows + '\n');
  }
}
