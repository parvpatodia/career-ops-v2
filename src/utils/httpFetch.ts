/**
 * A `fetch` with a hard per-request timeout, for the board scanners on the 60s
 * watch cadence (M8 spec constraint). WHY: bare `fetch` can hang indefinitely on
 * a slow/dead board; on the parallel sweep one hung request would keep its pool
 * worker (and the whole cycle's Promise.all) pending forever, so launchd would
 * stack overlapping runs. AbortSignal.timeout rejects the fetch, which the
 * scanners already catch -> warn -> skip that board. Returns Response, which
 * structurally satisfies each scanner's FetchLike ({ ok, status, json }).
 */
export function timeoutFetch(ms = 9_000): (url: string) => Promise<Response> {
  return (url) => fetch(url, { signal: AbortSignal.timeout(ms) });
}
