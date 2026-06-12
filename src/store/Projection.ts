/**
 * Pure fold of events into application state. No I/O in this class:
 * EventStore owns the file, Projection owns the meaning (S in SOLID).
 */

import { VALID_STATUSES } from './events.js';
import type { AppEvent } from './events.js';
import type { Application, ApplicationStatus } from '../types.js';

interface AppState {
  appId: string;
  application: Application | null;
  submitted: boolean;
  confirmed: boolean;
  eventCount: number;
}

export type CanApplyResult = { ok: true } | { ok: false; reason: string };

export class Projection {
  private states = new Map<string, AppState>();
  private legacyIdIndex = new Map<string, string>();
  // WHY: a legacy id seen on two different appIds is poison; resolving it
  // last-write-wins would route updates to the wrong application (review
  // 2026-06-11). Ambiguous ids resolve to nothing, loudly.
  private ambiguousLegacyIds = new Set<string>();

  /**
   * Transition guard, consulted by EventStore BEFORE an append lands.
   * WHY minimal rules: legacy data is messy, so strictness is limited to
   * the invariants that protect employers and the double-submit guard.
   */
  canApply(e: AppEvent): CanApplyResult {
    const state = this.states.get(e.appId);
    if (e.type === 'submitted' && state?.submitted) {
      return { ok: false, reason: `duplicate submitted for appId ${e.appId}` };
    }
    if (e.type === 'confirmed' && !state?.submitted) {
      return { ok: false, reason: `confirmed before submitted for appId ${e.appId}` };
    }
    return { ok: true };
  }

  apply(e: AppEvent): void {
    const state = this.ensure(e.appId);
    state.eventCount++;

    switch (e.type) {
      case 'queued': {
        const app = e.payload.application as Application | undefined;
        if (app && typeof app.id === 'string' && typeof app.company === 'string') {
          state.application = { ...app };
          const prior = this.legacyIdIndex.get(app.id);
          if (prior !== undefined && prior !== e.appId) this.ambiguousLegacyIds.add(app.id);
          this.legacyIdIndex.set(app.id, e.appId);
        }
        break;
      }
      case 'scored': {
        const score = e.payload.score;
        if (state.application && typeof score === 'number') state.application.score = score;
        break;
      }
      case 'note': {
        const patch = e.payload.patch;
        if (state.application && typeof patch === 'object' && patch !== null) {
          const prevStatus = state.application.status;
          Object.assign(state.application, patch);
          if (!VALID_STATUSES.has(state.application.status)) state.application.status = prevStatus;
        }
        break;
      }
      case 'submitted': {
        state.submitted = true;
        if (state.application) {
          // WHY upgrade-only: submitted never downgrades a later stage
          // (Interview, Offer) back to Applied when replaying history.
          if (state.application.status === 'Ready' || state.application.status === 'Evaluated') {
            state.application.status = 'Applied';
          }
          state.application.appliedAt =
            typeof e.payload.appliedAt === 'string' ? e.payload.appliedAt : e.ts;
        }
        break;
      }
      case 'confirmed': {
        state.confirmed = true;
        break;
      }
      case 'closed': {
        if (state.application) {
          const s = e.payload.status;
          state.application.status =
            typeof s === 'string' && VALID_STATUSES.has(s) ? (s as ApplicationStatus) : 'Closed';
        }
        break;
      }
      // discovered, fill_attempted, fill_verified, abstained,
      // answer_flagged, answer_approved: tracked via eventCount for now;
      // M2/M3 give them behavior.
      default:
        break;
    }
  }

  has(appId: string): boolean {
    return this.states.has(appId);
  }

  isSubmitted(appId: string): boolean {
    return this.states.get(appId)?.submitted ?? false;
  }

  isConfirmed(appId: string): boolean {
    return this.states.get(appId)?.confirmed ?? false;
  }

  getByAppId(appId: string): Application | undefined {
    return this.states.get(appId)?.application ?? undefined;
  }

  getByLegacyId(id: string): Application | undefined {
    if (this.ambiguousLegacyIds.has(id)) return undefined;
    const appId = this.legacyIdIndex.get(id);
    return appId ? this.getByAppId(appId) : undefined;
  }

  legacyIdIsAmbiguous(id: string): boolean {
    return this.ambiguousLegacyIds.has(id);
  }

  getByStatus(status: ApplicationStatus): Application[] {
    return this.all().filter((a) => a.status === status);
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.all()) out[a.status] = (out[a.status] ?? 0) + 1;
    return out;
  }

  all(): Application[] {
    const apps: Application[] = [];
    for (const s of this.states.values()) if (s.application) apps.push(s.application);
    return apps.sort((a, b) => {
      const na = parseInt(a.id, 10);
      const nb = parseInt(b.id, 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.id.localeCompare(b.id);
    });
  }

  nextId(): string {
    const max = this.all()
      .map((a) => parseInt(a.id, 10))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 0);
    return String(max + 1).padStart(3, '0');
  }

  private ensure(appId: string): AppState {
    let state = this.states.get(appId);
    if (!state) {
      state = { appId, application: null, submitted: false, confirmed: false, eventCount: 0 };
      this.states.set(appId, state);
    }
    return state;
  }
}
