import { describe, it, expect } from 'vitest';
import { enrichHotlist, type EnrichSource } from '../../src/watch/enrichHotlist.js';

const scan = (pairs: Array<[string, string]>): Map<string, EnrichSource> =>
  new Map(pairs.map(([id, location]) => [id, { location }]));

describe('enrichHotlist', () => {
  it('back-fills a blank location from the current scan for the same id', () => {
    const hot = [
      { id: 'a', company: 'A', location: '' },
      { id: 'b', company: 'B', location: '   ' },
    ];
    const { list, enriched } = enrichHotlist(hot, scan([['a', 'San Francisco, CA'], ['b', 'Remote']]));
    expect(enriched).toBe(2);
    expect(list[0]!.location).toBe('San Francisco, CA');
    expect(list[1]!.location).toBe('Remote');
    expect(list[1]!.remote).toBe(true); // derived from a "remote" location
    expect(list[0]!.remote).toBe(false);
  });

  it('never overwrites a location the entry already has', () => {
    const hot = [{ id: 'a', company: 'A', location: 'Austin, TX' }];
    const { list, enriched } = enrichHotlist(hot, scan([['a', 'New York, NY']]));
    expect(enriched).toBe(0);
    expect(list[0]!.location).toBe('Austin, TX');
  });

  it('leaves an entry untouched when the scan has no record or no location for its id', () => {
    const hot = [
      { id: 'x', company: 'X', location: '' },              // not in scan
      { id: 'y', company: 'Y', location: '' },              // in scan but blank there too
    ];
    const { list, enriched } = enrichHotlist(hot, new Map([['y', { location: '' }]]));
    expect(enriched).toBe(0);
    expect(list[0]!.location).toBe('');
    expect(list[1]!.location).toBe('');
  });

  it('preserves all other fields on the entry (only fills location/remote)', () => {
    const hot = [{ id: 'a', company: 'A', role: 'ML Intern', applyUrl: 'https://x/a', platform: 'newgrad', location: '' }];
    const { list } = enrichHotlist(hot, scan([['a', 'Boston, MA']]));
    expect(list[0]).toMatchObject({ id: 'a', company: 'A', role: 'ML Intern', applyUrl: 'https://x/a', platform: 'newgrad', location: 'Boston, MA' });
  });
});
