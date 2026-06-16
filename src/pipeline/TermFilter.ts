/**
 * Target-term gate (AGENTS.md invariant 10: intern/co-op for Summer/Fall 2026).
 * The scanner's title filter keeps intern/co-op roles; this excludes the ones
 * whose stated term is the WRONG one (a "Summer 2025" or "Spring 2026"
 * internship passes a title filter but is not a role Parv can take).
 *
 * Verify-or-abstain applied to sourcing: exclude only a PROVABLY off-term
 * posting. A posting that states a target term, or states no term at all, is
 * kept — most legit postings name no season, and over-excluding them would
 * drop good roles (the opposite failure of the stale-queue problem).
 *
 * Precision rules (chosen to avoid false excludes):
 * - Season+year bigrams ("summer 2025", "fall 2026") are unambiguous term
 *   statements; read them from the title AND the JD.
 * - Bare 4-digit years are read from the TITLE only. JDs are full of stray
 *   years ("founded in 2019", "by 2027 we will") that are not term signals;
 *   scanning them would wrongly exclude. Titles rarely carry a stray year.
 */

import type { Job } from '../types.js';

export interface TermConfig {
  /** Target seasons, lowercased. Invariant 10 default: summer/fall. */
  seasons: string[];
  /** Target years. Default: 2026. */
  years: number[];
}

export interface TermResult {
  /** Target term stated, or no decidable term: kept. */
  matched: Job[];
  /** A non-target term explicitly stated, with no target term: excluded. */
  offTerm: Job[];
}

const DEFAULT_CONFIG: TermConfig = { seasons: ['summer', 'fall', 'autumn'], years: [2026] };

const SEASON_YEAR = /(spring|summer|fall|autumn|winter)\s+(20\d\d)/gi;
const YEAR = /\b(20\d\d)\b/g;

export class TermFilter {
  private readonly seasons: ReadonlySet<string>;
  private readonly years: ReadonlySet<number>;

  constructor(cfg: TermConfig = DEFAULT_CONFIG) {
    this.seasons = new Set(cfg.seasons.map((s) => s.toLowerCase()));
    this.years = new Set(cfg.years);
  }

  filter(jobs: Job[]): TermResult {
    const matched: Job[] = [];
    const offTerm: Job[] = [];
    for (const job of jobs) {
      if (this.isOffTerm(job)) offTerm.push(job);
      else matched.push(job);
    }
    return { matched, offTerm };
  }

  /** Off-term iff a non-target term is stated AND no target term is stated. */
  private isOffTerm(job: Job): boolean {
    const title = job.title ?? '';
    const jd = job.jd ?? '';
    let target = false;
    let off = false;

    const noteSeasonYear = (text: string): void => {
      for (const m of text.matchAll(SEASON_YEAR)) {
        const season = m[1]!.toLowerCase();
        const year = Number(m[2]);
        if (this.seasons.has(season) && this.years.has(year)) target = true;
        else off = true;
      }
    };
    noteSeasonYear(title);
    noteSeasonYear(jd);

    // Bare years from the title, EXCLUDING those already inside a season+year
    // bigram: the bigram is the more specific signal ("Spring 2026" is off-term
    // even though 2026 is a target YEAR), so the bare 2026 must not relabel it
    // as on-target.
    //
    // A bare year only marks OFF when it is PAST a target year. A bare FUTURE
    // year in a title is ambiguous ("Class of 2027", "apply by 2027" — a
    // deadline or grad class, not a term) and must NOT exclude a good role.
    // An explicit future TERM ("Fall 2027") is still caught by the bigram path.
    const minYear = this.years.size > 0 ? Math.min(...this.years) : 0;
    const titleNoBigrams = title.replace(SEASON_YEAR, ' ');
    for (const m of titleNoBigrams.matchAll(YEAR)) {
      const year = Number(m[1]);
      if (this.years.has(year)) target = true;
      else if (year < minYear) off = true;
    }

    return off && !target;
  }
}
