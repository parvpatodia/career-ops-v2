/**
 * Back-fill missing fields on existing hot-list entries from the current scan.
 *
 * WHY: the watcher's hot-list is append-only and deduped by id via the seen-set,
 * so a role caught BEFORE a scanner improvement (e.g. location parsing) keeps its
 * stale, poorer record forever — a re-catch never updates it (its id is already
 * "seen", so it never re-enters the append path). This runs every cycle and
 * fills a blank `location` from the current scan's richer record for the same id.
 *
 * Scoped to `location` on purpose (a bug fix fixes only the bug): a blank
 * location both hides useful info in the UI and blinds the US/non-US read-boundary
 * filter. Pure so it is unit-tested; the watcher does the file IO.
 */

export interface HotlistEntry {
  id?: string;
  location?: string;
  remote?: boolean;
  [k: string]: unknown;
}

export interface EnrichSource {
  location?: string;
}

const has = (s: string | undefined): boolean => !!s && s.trim() !== '';

export function enrichHotlist(
  hotlist: HotlistEntry[],
  scanById: Map<string, EnrichSource>
): { list: HotlistEntry[]; enriched: number } {
  let enriched = 0;
  const list = hotlist.map((entry) => {
    if (has(entry.location)) return entry; // already has a location; leave it
    const src = entry.id ? scanById.get(entry.id) : undefined;
    const loc = src?.location?.trim();
    if (!loc) return entry; // no richer data for this id
    enriched += 1;
    return { ...entry, location: loc, remote: /remote/i.test(loc) };
  });
  return { list, enriched };
}
