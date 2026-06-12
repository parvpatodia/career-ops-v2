/**
 * Event-log schema for the application tracker.
 * WHY events, not CRUD: v1 lost data via read-modify-write of one JSON file
 * from three unlocked writers (LESSONS.md 2026-06-10). An append-only log
 * cannot lose prior records, and every state change keeps its history.
 */

import { createHash } from 'crypto';
import type { ApplicationStatus } from '../types.js';

/**
 * The status lifecycle lives HERE and only here. Projection, the store
 * facade, and the migration all import these sets; the 2026-06-11 review
 * caught them hand-duplicated in four files, already diverging.
 */
export const APPLICATION_STATUSES = [
  'Ready', 'Evaluated', 'Applied', 'Responded', 'Interview', 'Offer',
  'Rejected', 'Discarded', 'Closed', 'SKIP',
] as const satisfies readonly ApplicationStatus[];

export const VALID_STATUSES: ReadonlySet<string> = new Set(APPLICATION_STATUSES);

/** Statuses that imply an application went out: the submitted flag must be set. */
export const SUBMITTED_STATUSES: ReadonlySet<string> = new Set([
  'Applied', 'Responded', 'Interview', 'Offer',
]);

/** Statuses that end the lifecycle. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'Rejected', 'Discarded', 'Closed', 'SKIP',
]);

export const EVENT_TYPES = [
  'discovered',
  'scored',
  'queued',
  'fill_attempted',
  'fill_verified',
  'abstained',
  'submitted',
  'confirmed',
  'closed',
  'answer_flagged',
  'answer_approved',
  'note',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface AppEvent {
  seq: number;
  ts: string;
  type: EventType;
  appId: string;
  payload: Record<string, unknown>;
  /** Correlation id: present when the event landed as part of an atomic group (e.g. a submit receipt). */
  cid?: string;
}

const APP_ID_RE = /^[0-9a-f]{12}$/;

/**
 * Idempotency key for one application: stable across runs, platforms, and
 * URL changes. WHY company+role: the rule is one application per company
 * and role, ever; URLs and job ids vary per board for the same opening.
 */
export function appIdFor(company: string, role: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${norm(company)}|${norm(role)}`).digest('hex').slice(0, 12);
}

export function isValidAppId(appId: string): boolean {
  return APP_ID_RE.test(appId);
}

/** Returns the event if the raw value has a valid envelope, else null. */
export function validateEvent(raw: unknown): AppEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) return null;
  if (typeof e.ts !== 'string') return null;
  if (typeof e.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(e.type)) return null;
  if (typeof e.appId !== 'string' || !APP_ID_RE.test(e.appId)) return null;
  if (typeof e.payload !== 'object' || e.payload === null) return null;
  if (e.cid !== undefined && typeof e.cid !== 'string') return null;
  return e as unknown as AppEvent;
}
