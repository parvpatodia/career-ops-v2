/**
 * Append-only JSONL log with an advisory lock and an incremental,
 * byte-offset read cache. Domain-agnostic: it reads, validates, and appends
 * lines safely under a single-writer lock and knows nothing about what the
 * records mean. EventStore layers the event-type whitelist and the Projection
 * transition guard on top; OutreachStore layers its own.
 *
 * WHY extracted from EventStore (2026-06-16): the outreach log needs the exact
 * same lock + cache, and two write races were already caught in this code
 * during the 2026-06-11 review (lock-steal double-steal, slow-holder release).
 * Duplicating subtle concurrency code is how those bugs come back; one tested
 * base is safer than two copies.
 *
 * WHY JSONL over SQLite: append-only means a corrupt line can only ever cost
 * itself, never the file; zero native deps; diffable in git tooling.
 */

import fs from 'fs';
import path from 'path';

// WHY 30s/45s: stale must comfortably exceed any real critical section
// (sub-100ms today) so a live holder is never robbed, and timeout must
// exceed stale so waiters steal a crashed holder's lock before giving up.
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 45_000;

interface ReadCache<T> {
  /** Bytes consumed up to (and including) the last complete line's newline. */
  offset: number;
  records: T[];
  corruptLines: number;
}

/** Parse+shape check for one record. Returns the typed record, or null if the line is corrupt. */
export type Validate<T> = (raw: unknown) => T | null;

export class JsonlLog<T> {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly validate: Validate<T>;
  // WHY a parsed-record cache: every operation used to re-read and re-parse
  // the whole log (M1 review finding). Caching parsed records keyed on byte
  // offset makes reads O(new bytes). Only complete lines advance the offset,
  // so a partial tail from a crashed writer is re-examined on the next read
  // instead of being half-consumed.
  private cache: ReadCache<T> | null = null;

  constructor(filePath: string, validate: Validate<T>) {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';
    this.validate = validate;
  }

  /** Snapshot of all valid records plus the count of lines that failed to parse/validate. */
  read(): { records: T[]; corruptLines: number } {
    const c = this.ensureFresh();
    return { records: [...c.records], corruptLines: c.corruptLines };
  }

  /**
   * Run `build` under the write lock against the freshest records, then append
   * the lines it returns as ONE write. All-or-nothing: if `build` throws, the
   * lock releases and nothing is written. WHY read-build-append under one lock:
   * the caller's guard is a read-modify-append race without it, exactly the v1
   * bug class this layer exists to kill.
   *
   * Honesty note on atomicity: the lines go to disk as ONE write syscall, which
   * makes a half-landed group extremely unlikely, not impossible (a truncated
   * tail line is quarantined as corrupt on the next read).
   */
  append<R>(build: (records: readonly T[]) => { lines: string[]; value: R }): R {
    return this.withLock(() => {
      const c = this.ensureFresh();
      const { lines, value } = build(c.records);
      if (lines.length > 0) this.appendLines(lines);
      return value;
    });
  }

  private ensureFresh(): ReadCache<T> {
    if (!fs.existsSync(this.filePath)) {
      this.cache = null;
      return { offset: 0, records: [], corruptLines: 0 };
    }
    const size = fs.statSync(this.filePath).size;
    let c = this.cache;
    // size < offset means the file was replaced or truncated underneath
    // us, which append-only writers never do: rebuild from scratch.
    if (!c || size < c.offset) c = { offset: 0, records: [], corruptLines: 0 };
    if (size === c.offset) {
      this.cache = c;
      return c;
    }

    const fd = fs.openSync(this.filePath, 'r');
    let chunk: string;
    try {
      const buf = Buffer.alloc(size - c.offset);
      fs.readSync(fd, buf, 0, buf.length, c.offset);
      chunk = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline === -1) {
      // Only a partial tail so far; consume nothing.
      this.cache = c;
      return c;
    }
    const complete = chunk.slice(0, lastNewline);
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        c.corruptLines++;
        continue;
      }
      const record = this.validate(parsed);
      if (record !== null) c.records.push(record);
      else c.corruptLines++;
    }
    c.offset += Buffer.byteLength(complete, 'utf8') + 1;
    this.cache = c;
    return c;
  }

  private appendLines(lines: string[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // WHY the newline probe: a crashed writer can leave a partial line with
    // no trailing newline; appending straight onto it would swallow these
    // records into the corrupt line. A leading newline quarantines the damage.
    let prefix = '';
    if (fs.existsSync(this.filePath)) {
      const stat = fs.statSync(this.filePath);
      if (stat.size > 0) {
        const fd = fs.openSync(this.filePath, 'r');
        try {
          const buf = Buffer.alloc(1);
          fs.readSync(fd, buf, 0, 1, stat.size - 1);
          if (buf.toString('utf8') !== '\n') prefix = '\n';
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    fs.appendFileSync(this.filePath, prefix + lines.join('\n') + '\n');
  }

  // WHY an owner token: release must only remove a lock this instance holds,
  // and a stale steal must be winnable by exactly one contender. The
  // 2026-06-11 review caught both races in the token-less version: double-steal,
  // and a slow holder releasing the thief's lock.
  private readonly ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  private withLock<R>(fn: () => R): R {
    this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  private acquireLock(): void {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        // mkdir is atomic: exactly one process can create the directory.
        fs.mkdirSync(this.lockPath);
        fs.writeFileSync(path.join(this.lockPath, 'owner'), this.ownerToken);
        return;
      } catch {
        this.tryStealStaleLock();
        if (Date.now() - start > LOCK_TIMEOUT_MS) {
          throw new Error(`Could not acquire lock ${this.lockPath} within ${LOCK_TIMEOUT_MS}ms`);
        }
        sleepSync(25);
      }
    }
  }

  private releaseLock(): void {
    try {
      const owner = fs.readFileSync(path.join(this.lockPath, 'owner'), 'utf8');
      // If the token differs, our hold exceeded LOCK_STALE_MS and the lock
      // was legitimately stolen; removing it would hand a third writer a
      // free pass. Leave it to its new owner.
      if (owner === this.ownerToken) fs.rmSync(this.lockPath, { recursive: true, force: true });
    } catch {
      // Lock already gone; nothing to release.
    }
  }

  private tryStealStaleLock(): void {
    try {
      const stat = fs.statSync(this.lockPath);
      if (Date.now() - stat.mtimeMs <= LOCK_STALE_MS) return;
      // Atomic rename: exactly one contender wins; the loser's rename
      // throws and it goes back to the wait loop.
      const trash = `${this.lockPath}.stale-${this.ownerToken}`;
      fs.renameSync(this.lockPath, trash);
      fs.rmSync(trash, { recursive: true, force: true });
    } catch {
      // Someone else stole it first, or it vanished; back to waiting.
    }
  }
}

/** Synchronous sleep without spinning the CPU; keeps append() sync for callers. */
function sleepSync(ms: number): void {
  const arr = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(arr, 0, 0, ms);
}
