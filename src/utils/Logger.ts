/** Structured logger with level filtering and file output. */

import fs from 'fs';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  data?: unknown;
}

export class Logger {
  private readonly module: string;
  private static readonly DEFAULT_LOG_DIR = 'data/daily_log';

  constructor(module: string) {
    this.module = module;
  }

  // WHY env-resolved instead of a constructor path: Logger is instantiated at
  // ~15 call sites as `new Logger('Name')`. Resolving the output dir (and a
  // hard off switch) from the environment lets tests and sandboxes redirect or
  // disable file logging process-wide without threading a path through every
  // caller. LESSONS 2026-06-12: side-effecting classes must never write into
  // the real data/ tree under test. tests/setup.ts sets CAREER_OPS_LOG_DISABLE.
  private static fileLoggingDisabled(): boolean {
    return process.env.CAREER_OPS_LOG_DISABLE === '1';
  }

  private static logDir(): string {
    return process.env.CAREER_OPS_LOG_DIR ?? Logger.DEFAULT_LOG_DIR;
  }

  debug(msg: string, data?: unknown): void {
    this.emit('debug', msg, data);
  }

  info(msg: string, data?: unknown): void {
    this.emit('info', msg, data);
  }

  warn(msg: string, data?: unknown): void {
    this.emit('warn', msg, data);
  }

  error(msg: string, data?: unknown): void {
    this.emit('error', msg, data);
  }

  private emit(level: LogLevel, msg: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module: this.module,
      msg,
      data,
    };

    // WHY: Structured console output so Claude Code can parse logs programmatically.
    const prefix = `[${entry.ts}] [${level.toUpperCase().padEnd(5)}] [${this.module}]`;
    if (level === 'error') {
      console.error(`${prefix} ${msg}`, data ?? '');
    } else if (level === 'warn') {
      console.warn(`${prefix} ${msg}`, data ?? '');
    } else {
      console.log(`${prefix} ${msg}`, data !== undefined ? JSON.stringify(data) : '');
    }

    // WHY: Append to daily log file for audit trail and efficiency reporting.
    if (Logger.fileLoggingDisabled()) return;
    try {
      const dir = Logger.logDir();
      const dateStr = new Date().toISOString().split('T')[0];
      const logFile = path.join(dir, `${dateStr}-ops.jsonl`);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Non-fatal: if log directory isn't writable, skip file logging.
    }
  }
}
