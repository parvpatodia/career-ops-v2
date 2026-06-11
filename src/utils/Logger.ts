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
  private static logDir = 'data/daily_log';

  constructor(module: string) {
    this.module = module;
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
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const logFile = path.join(Logger.logDir, `${dateStr}-ops.jsonl`);
      fs.mkdirSync(Logger.logDir, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Non-fatal: if log directory isn't writable, skip file logging.
    }
  }
}
