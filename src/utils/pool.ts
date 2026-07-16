/**
 * Ordered, concurrency-capped async map. WHY: the board scanners iterate 100+
 * public-API boards; doing that sequentially is too slow for the 60s watch
 * cadence (M8). This runs up to `concurrency` at once but writes each result
 * back at its ORIGINAL index, so the flattened output is identical to a
 * sequential run — the Job id scheme (and therefore the watcher's seen-set)
 * is unaffected. A rejected task rejects the whole pool, so callers that must
 * tolerate a dead board handle errors inside `fn` (the scanners already do).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
