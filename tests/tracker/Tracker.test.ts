import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { StatsEngine } from '../../src/tracker/StatsEngine.js';
import type { Application } from '../../src/types.js';

// Each test suite gets its own tmp directory — no process.chdir() needed.
let tmpDir: string;
let jsonPath: string;
let mdPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-test-'));
  jsonPath = path.join(tmpDir, 'applications.json');
  mdPath = path.join(tmpDir, 'applications.md');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeApp(overrides: Partial<Application> = {}): Application {
  return {
    id: '001',
    jobId: 'linkedin-abc123',
    date: new Date().toISOString().split('T')[0]!,
    company: 'TestCo',
    role: 'ML Engineer Intern',
    score: 78,
    url: 'https://testco.com/jobs/1',
    status: 'Evaluated',
    resumeVariant: 'ml',
    notes: 'Strong skill match.',
    ...overrides,
  };
}

describe('ApplicationStore', () => {
  it('starts empty', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    expect(store.getAll()).toHaveLength(0);
  });

  it('adds and retrieves an application', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    store.add(makeApp());
    expect(store.getAll()).toHaveLength(1);
    expect(store.getById('001')?.company).toBe('TestCo');
  });

  it('throws when adding duplicate company+role', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    store.add(makeApp());
    expect(() => store.add(makeApp({ id: '002' }))).toThrow(/already exists/);
  });

  it('updates status without losing other fields', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    store.add(makeApp());
    store.update('001', { status: 'Applied' });
    const updated = store.getById('001');
    expect(updated?.status).toBe('Applied');
    expect(updated?.company).toBe('TestCo');
  });

  it('throws when updating non-existent id', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    expect(() => store.update('999', { status: 'Applied' })).toThrow(/not found/);
  });

  it('assigns sequential IDs', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    expect(store.nextId()).toBe('001');
    store.add(makeApp({ id: '001' }));
    expect(store.nextId()).toBe('002');
  });

  it('persists to disk and reloads', () => {
    const store1 = new ApplicationStore(jsonPath, mdPath);
    store1.add(makeApp());

    const store2 = new ApplicationStore(jsonPath, mdPath);
    store2.load();
    expect(store2.getAll()).toHaveLength(1);
    expect(store2.getById('001')?.role).toBe('ML Engineer Intern');
  });

  it('creates markdown file on first write', () => {
    const store = new ApplicationStore(jsonPath, mdPath);
    store.add(makeApp());
    expect(fs.existsSync(mdPath)).toBe(true);
    const md = fs.readFileSync(mdPath, 'utf8');
    expect(md).toContain('TestCo');
  });
});

describe('StatsEngine', () => {
  const engine = new StatsEngine();

  const apps: Application[] = [
    makeApp({ id: '001', status: 'Applied', score: 80, company: 'A' }),
    makeApp({ id: '002', status: 'Interview', score: 90, company: 'B' }),
    makeApp({ id: '003', status: 'Applied', score: 70, company: 'A' }),
    makeApp({ id: '004', status: 'Rejected', score: 60, company: 'C' }),
  ];

  it('counts total applications', () => {
    const stats = engine.compute(apps, 'all');
    expect(stats.totalApplications).toBe(4);
  });

  it('groups by status correctly', () => {
    const stats = engine.compute(apps, 'all');
    expect(stats.byStatus['Applied']).toBe(2);
    expect(stats.byStatus['Interview']).toBe(1);
    expect(stats.byStatus['Rejected']).toBe(1);
  });

  it('computes average score', () => {
    const stats = engine.compute(apps, 'all');
    expect(stats.averageScore).toBe(Math.round((80 + 90 + 70 + 60) / 4));
  });

  it('identifies top company', () => {
    const stats = engine.compute(apps, 'all');
    expect(stats.topCompanies[0]?.company).toBe('A');
    expect(stats.topCompanies[0]?.count).toBe(2);
  });

  it('format returns a non-empty string', () => {
    const stats = engine.compute(apps, 'all');
    const formatted = engine.format(stats);
    expect(formatted).toContain('Stats');
    expect(formatted).toContain('Applied');
  });
});
