/**
 * Append-only JSONL event log with an advisory lock and an append-time
 * transition guard. The single write path for all tracker state
 * (AGENTS.md invariant 4).
 *
 * WHY JSONL over SQLite: append-only means a corrupt line can only ever
 * cost itself, never the file; zero native deps; diffable in git tooling.
 * Revisit if query needs grow (SPEC M1 non-goals).
 */

import fs from 'fs';
import path from 'path';
import { Projection } from './Projection.js';
import { validateEvent, isValidAppId, EVENT_TYPES } from './events.js';
import type { AppEvent, EventType } from './events.js';

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export interface AppendInput {
  type: EventType;
  appId: string;
  payload?: Record<string, unknown>;
}

// WHY 30s/45s: stale must comfortably exceed any real critical section
// (sub-100ms today) so a live holder is never robbed, and timeout must
// exceed stale so waiters steal a crashed holder's lock before giving up.
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 45_000;

export class EventStore {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(filePath = 'data/events.jsonl') {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';
  }

  readAll(): { events: AppEvent[]; corruptLines: number } {
    if (!fs.existsSync(this.filePath)) return { events: [], corruptLines: 0 };
    const events: AppEvent[] = [];
    let corruptLines = 0;
    for (const line of fs.readFileSync(this.filePath, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        corruptLines++;
        continue;
      }
      const event = validateEvent(parsed);
      if (event) events.push(event);
      else corruptLines++;
    }
    return { events, corruptLines };
  }

  projection(): Projection {
    const proj = new Projection();
    for (const e of this.readAll().events) proj.apply(e);
    return proj;
  }

  /**
   * Validate, guard, and append one event. Throws TransitionError when the
   * projection rejects the transition (e.g. duplicate submitted).
   * WHY read-fold-append under one lock: the guard is a read-modify-append
   * race without it, exactly the v1 bug class this layer exists to kill.
   */
  append(input: AppendInput): AppEvent {
    if (!(EVENT_TYPES as readonly string[]).includes(input.type)) {
      throw new Error(`Unknown event type: ${input.type}`);
    }
    if (!isValidAppId(input.appId)) {
      throw new Error(`Invalid appId (want 12 hex chars): ${input.appId}`);
    }
    const payload = input.payload ?? {};

    return this.withLock(() => {
      const { events } = this.readAll();
      const proj = new Projection();
      for (const e of events) proj.apply(e);

      const event: AppEvent = {
        seq: (events[events.length - 1]?.seq ?? 0) + 1,
        ts: new Date().toISOString(),
        type: input.type,
        appId: input.appId,
        payload,
      };
      const verdict = proj.canApply(event);
      if (!verdict.ok) throw new TransitionError(verdict.reason);

      this.appendLine(JSON.stringify(event));
      return event;
    });
  }

  private appendLine(line: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // WHY the newline probe: a crashed writer can leave a partial line with
    // no trailing newline; appending straight onto it would swallow this
    // event into the corrupt line. A leading newline quarantines the damage.
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
    fs.appendFileSync(this.filePath, prefix + line + '\n');
  }

  // WHY an owner token: release must only remove a lock this instance
  // holds, and a stale steal must be winnable by exactly one contender.
  // The 2026-06-11 review caught both races in the token-less version:
  // double-steal, and a slow holder releasing the thief's lock.
  private readonly ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  private withLock<T>(fn: () => T): T {
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
