/**
 * Test group 3 (SPEC M1): two writer processes, zero lost or interleaved lines.
 * v1 had three unlocked writers doing read-modify-write on one JSON file.
 * Here two real OS processes hammer the same log; the lock must serialize
 * them so every event lands intact with a unique seq.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore } from '../../src/store/EventStore.js';

const execFileAsync = promisify(execFile);
const TSX = path.resolve('node_modules/.bin/tsx');
const WORKER = path.resolve('tests/store/helpers/append-worker.ts');
const COUNT = 25;

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventstore-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('EventStore concurrent writers', () => {
  it('two processes appending in parallel lose nothing', async () => {
    await Promise.all([
      execFileAsync(TSX, [WORKER, file, 'aaaa', String(COUNT)]),
      execFileAsync(TSX, [WORKER, file, 'bbbb', String(COUNT)]),
    ]);

    const { events, corruptLines } = new EventStore(file).readAll();
    expect(corruptLines).toBe(0);
    expect(events).toHaveLength(COUNT * 2);

    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(COUNT * 2);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(COUNT * 2);

    const fromA = events.filter((e) => e.payload.worker === 'aaaa');
    const fromB = events.filter((e) => e.payload.worker === 'bbbb');
    expect(fromA).toHaveLength(COUNT);
    expect(fromB).toHaveLength(COUNT);
  }, 60_000);
});
