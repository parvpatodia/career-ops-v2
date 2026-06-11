/**
 * Persists applications to both JSON (structured) and Markdown (human-readable).
 * WHY: Dual-write keeps the markdown table always up-to-date for quick review
 * while JSON enables programmatic queries without parsing markdown tables.
 */

import fs from 'fs';
import path from 'path';
import type { Application, ApplicationStatus } from '../types.js';
import { Logger } from '../utils/Logger.js';

const DEFAULT_JSON_PATH = 'data/applications.json';
const DEFAULT_MD_PATH = 'data/applications.md';

const MD_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

export class ApplicationStore {
  private log = new Logger('ApplicationStore');
  private applications: Application[] = [];
  private loaded = false;
  private readonly jsonPath: string;
  private readonly mdPath: string;

  // WHY: Injectable paths let tests write to a temp directory without process.chdir().
  constructor(jsonPath = DEFAULT_JSON_PATH, mdPath = DEFAULT_MD_PATH) {
    this.jsonPath = jsonPath;
    this.mdPath = mdPath;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.load();
    this.loaded = true;
  }

  load(): void {
    fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });

    if (fs.existsSync(this.jsonPath)) {
      try {
        this.applications = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8')) as Application[];
      } catch {
        this.log.warn('Could not parse applications.json, starting fresh');
        this.applications = [];
      }
    }

    if (!fs.existsSync(this.mdPath)) {
      fs.writeFileSync(this.mdPath, MD_HEADER);
    }
  }

  getAll(): Application[] {
    this.ensureLoaded();
    return [...this.applications];
  }

  getById(id: string): Application | undefined {
    this.ensureLoaded();
    return this.applications.find((a) => a.id === id);
  }

  findByCompanyAndRole(company: string, role: string): Application | undefined {
    this.ensureLoaded();
    const c = company.toLowerCase();
    const r = role.toLowerCase();
    return this.applications.find(
      (a) => a.company.toLowerCase() === c && a.role.toLowerCase() === r
    );
  }

  /** Add a new application. Throws if company+role already exists. */
  add(app: Application): void {
    this.ensureLoaded();
    const existing = this.findByCompanyAndRole(app.company, app.role);
    if (existing) {
      throw new Error(
        `Application already exists: ${app.company} — ${app.role} (id: ${existing.id}). Use update() instead.`
      );
    }
    this.applications.push(app);
    this.persist();
    this.log.info(`Added application: ${app.company} — ${app.role}`, { id: app.id });
  }

  /** Update status, notes, or other mutable fields on an existing application. */
  update(id: string, patch: Partial<Pick<Application, 'status' | 'notes' | 'pdfPath' | 'coverLetterPath' | 'appliedAt'>>): void {
    this.ensureLoaded();
    const idx = this.applications.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`Application not found: ${id}`);
    this.applications[idx] = { ...this.applications[idx]!, ...patch };
    this.persist();
    this.log.info(`Updated application: ${id}`, patch);
  }

  nextId(): string {
    this.ensureLoaded();
    const max = this.applications
      .map((a) => parseInt(a.id, 10))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    return String(max + 1).padStart(3, '0');
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });
    fs.writeFileSync(this.jsonPath, JSON.stringify(this.applications, null, 2));
    this.rebuildMarkdown();
  }

  private rebuildMarkdown(): void {
    const rows = this.applications
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
      .map((a) => {
        const pdf = a.pdfPath ? '✅' : '❌';
        const report = a.notes ? a.notes.slice(0, 60) : '';
        return `| ${a.id} | ${a.date} | ${a.company} | ${a.role} | ${a.score}/100 | ${a.status} | ${pdf} | | ${report} |`;
      })
      .join('\n');

    fs.writeFileSync(this.mdPath, MD_HEADER + rows + '\n');
  }

  /** Filter by status for pipeline queries. */
  getByStatus(status: ApplicationStatus): Application[] {
    this.ensureLoaded();
    return this.applications.filter((a) => a.status === status);
  }
}
