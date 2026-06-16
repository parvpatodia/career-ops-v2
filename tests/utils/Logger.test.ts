/**
 * Logger file-output isolation.
 *
 * Regression guard for LESSONS 2026-06-12: the Logger appends an audit line to
 * data/daily_log/<date>-ops.jsonl on every emit. Under test that dirtied the
 * tracked log with fixture noise on every `npm test`. tests/setup.ts disables
 * file logging suite-wide; these tests prove the safety net is engaged and that
 * the injectable output dir works for any code that does want file logs.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Logger } from '../../src/utils/Logger.js';

const today = () => new Date().toISOString().split('T')[0];
const REAL_LOG_DIR = 'data/daily_log';

describe('Logger file output isolation', () => {
  it('is disabled suite-wide so tests never touch the real daily_log', () => {
    // If this flips, tests have started polluting tracked data again.
    expect(process.env.CAREER_OPS_LOG_DISABLE).toBe('1');

    const realLog = path.join(REAL_LOG_DIR, `${today()}-ops.jsonl`);
    const sizeOf = (p: string) => (fs.existsSync(p) ? fs.statSync(p).size : -1);
    const before = sizeOf(realLog);

    new Logger('RegressionGuard').info('must not reach the real ops log', { x: 1 });

    // Unchanged size (and not newly created): the emit wrote nothing to disk.
    expect(sizeOf(realLog)).toBe(before);
  });

  it('writes to an injected dir, not the default, when file logging is enabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-log-'));
    const prevDisable = process.env.CAREER_OPS_LOG_DISABLE;
    const prevDir = process.env.CAREER_OPS_LOG_DIR;
    delete process.env.CAREER_OPS_LOG_DISABLE;
    process.env.CAREER_OPS_LOG_DIR = dir;
    try {
      new Logger('TempWriter').info('hello temp dir');

      const written = path.join(dir, `${today()}-ops.jsonl`);
      expect(fs.existsSync(written)).toBe(true);
      expect(fs.readFileSync(written, 'utf8')).toContain('hello temp dir');
    } finally {
      if (prevDisable === undefined) delete process.env.CAREER_OPS_LOG_DISABLE;
      else process.env.CAREER_OPS_LOG_DISABLE = prevDisable;
      if (prevDir === undefined) delete process.env.CAREER_OPS_LOG_DIR;
      else process.env.CAREER_OPS_LOG_DIR = prevDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
