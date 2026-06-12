/**
 * Test group 4 (SPEC M1): the view is generated, atomic, and never
 * read-modify-written. applications.json must be byte-stable for the same
 * projection and must survive a failed write with the old content intact.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore } from '../../src/store/EventStore.js';
import { ViewWriter } from '../../src/store/ViewWriter.js';
import type { Application } from '../../src/types.js';

let dir: string;
let eventsFile: string;
let viewFile: string;

function app(id: string, company: string, role: string): Application {
  return {
    id,
    jobId: `job-${id}`,
    date: '2026-06-11',
    company,
    role,
    score: 80,
    url: `https://example.com/${id}`,
    status: 'Ready',
    resumeVariant: 'ai',
    notes: '',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viewwriter-'));
  eventsFile = path.join(dir, 'events.jsonl');
  viewFile = path.join(dir, 'applications.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ViewWriter', () => {
  it('renders the projection to applications.json sorted by id', () => {
    const store = new EventStore(eventsFile);
    store.append({ type: 'queued', appId: 'bbbbbbbbbbbb', payload: { application: app('002', 'B Corp', 'SWE') } });
    store.append({ type: 'queued', appId: 'aaaaaaaaaaaa', payload: { application: app('001', 'A Corp', 'MLE') } });

    new ViewWriter().write(store.projection(), viewFile);

    const view = JSON.parse(fs.readFileSync(viewFile, 'utf8')) as Application[];
    expect(view.map((a) => a.id)).toEqual(['001', '002']);
    expect(view[0]!.company).toBe('A Corp');
  });

  it('is byte-stable: same projection, same bytes', () => {
    const store = new EventStore(eventsFile);
    store.append({ type: 'queued', appId: 'aaaaaaaaaaaa', payload: { application: app('001', 'A Corp', 'MLE') } });

    const writer = new ViewWriter();
    writer.write(store.projection(), viewFile);
    const first = fs.readFileSync(viewFile, 'utf8');
    writer.write(store.projection(), viewFile);
    const second = fs.readFileSync(viewFile, 'utf8');
    expect(second).toBe(first);
  });

  it('writes via tmp file + rename, never directly to the view path', () => {
    const store = new EventStore(eventsFile);
    store.append({ type: 'queued', appId: 'aaaaaaaaaaaa', payload: { application: app('001', 'A Corp', 'MLE') } });

    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');
    new ViewWriter().write(store.projection(), viewFile);

    const writtenPaths = writeSpy.mock.calls.map((c) => String(c[0]));
    expect(writtenPaths.some((p) => p === viewFile)).toBe(false);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(String(renameSpy.mock.calls[0]![1])).toBe(viewFile);
  });

  it('a failed write leaves the previous view intact', () => {
    const store = new EventStore(eventsFile);
    store.append({ type: 'queued', appId: 'aaaaaaaaaaaa', payload: { application: app('001', 'A Corp', 'MLE') } });
    const writer = new ViewWriter();
    writer.write(store.projection(), viewFile);
    const before = fs.readFileSync(viewFile, 'utf8');

    store.append({ type: 'queued', appId: 'bbbbbbbbbbbb', payload: { application: app('002', 'B Corp', 'SWE') } });
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => writer.write(store.projection(), viewFile)).toThrow('disk full');

    expect(fs.readFileSync(viewFile, 'utf8')).toBe(before);
  });
});
