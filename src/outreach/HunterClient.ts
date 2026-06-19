/**
 * Thin client for the Hunter.io v2 API: find and verify recipient email
 * addresses. Read-only against Hunter; it never sends mail. The fetch function
 * and a sleep are injectable so tests run offline and the verifier's 202 poll
 * needs no real wall-clock wait (the Notifier injectable-sink pattern).
 *
 * The API key is passed in the X-API-KEY header, never in the URL, so it cannot
 * leak into request logs (AGENTS.md secrets policy).
 */

export type HunterFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export interface HunterClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: HunterFetch;
  sleep?: (ms: number) => Promise<void>;
  /** Verifier 202 polling. */
  verifyMaxAttempts?: number;
  verifyDelayMs?: number;
}

export class HunterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HunterError';
  }
}

export interface AccountQuota {
  plan: string;
  searchesUsed: number;
  searchesAvailable: number;
  verificationsUsed: number;
  verificationsAvailable: number;
}

export interface DomainEmail {
  value: string;
  type: string; // 'personal' | 'generic'
  confidence: number;
  firstName?: string;
  lastName?: string;
  position?: string;
}

export interface FinderResult {
  email: string | null;
  score: number; // 0-100 confidence
  firstName?: string;
  lastName?: string;
}

export interface VerifyResult {
  email: string;
  status: string; // valid | invalid | accept_all | webmail | disposable | unknown
  score: number;
}

export interface DomainSearchParams {
  domain?: string;
  company?: string;
  limit?: number;
  type?: 'personal' | 'generic';
  department?: string;
  seniority?: string;
}

export interface EmailFinderParams {
  domain?: string;
  company?: string;
  linkedinHandle?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}

const DEFAULT_BASE = 'https://api.hunter.io/v2';

export class HunterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: HunterFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly verifyMaxAttempts: number;
  private readonly verifyDelayMs: number;

  constructor(opts: HunterClientOptions) {
    if (!opts.apiKey) throw new HunterError('HunterClient requires an apiKey');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as HunterFetch);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.verifyMaxAttempts = opts.verifyMaxAttempts ?? 3;
    this.verifyDelayMs = opts.verifyDelayMs ?? 1500;
  }

  /** Free call. Use it before a batch so a run never starts work it has no credits to finish. */
  async account(): Promise<AccountQuota> {
    const data = await this.get('/account', {});
    const d = data as Record<string, any>;
    return {
      plan: String(d.plan_name ?? d.plan ?? 'unknown'),
      searchesUsed: Number(d.requests?.searches?.used ?? 0),
      searchesAvailable: Number(d.requests?.searches?.available ?? 0),
      verificationsUsed: Number(d.requests?.verifications?.used ?? 0),
      verificationsAvailable: Number(d.requests?.verifications?.available ?? 0),
    };
  }

  async domainSearch(params: DomainSearchParams): Promise<DomainEmail[]> {
    const data = await this.get('/domain-search', {
      domain: params.domain,
      company: params.company,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      type: params.type,
      department: params.department,
      seniority: params.seniority,
    });
    const emails = (data as Record<string, any>).emails;
    if (!Array.isArray(emails)) return [];
    return emails.map((e: Record<string, any>) => ({
      value: String(e.value),
      type: String(e.type ?? ''),
      confidence: Number(e.confidence ?? 0),
      firstName: e.first_name ?? undefined,
      lastName: e.last_name ?? undefined,
      position: e.position ?? undefined,
    }));
  }

  async emailFinder(params: EmailFinderParams): Promise<FinderResult> {
    const data = await this.get('/email-finder', {
      domain: params.domain,
      company: params.company,
      linkedin_handle: params.linkedinHandle,
      first_name: params.firstName,
      last_name: params.lastName,
      full_name: params.fullName,
    });
    const d = data as Record<string, any>;
    return {
      email: d.email ?? null,
      score: Number(d.score ?? 0),
      firstName: d.first_name ?? undefined,
      lastName: d.last_name ?? undefined,
    };
  }

  /**
   * Verify one address. Hunter may return HTTP 202 while verification is in
   * progress; we poll up to verifyMaxAttempts before returning 'unknown' rather
   * than blocking forever.
   */
  async emailVerifier(email: string): Promise<VerifyResult> {
    for (let attempt = 1; attempt <= this.verifyMaxAttempts; attempt++) {
      const { status, data } = await this.getRaw('/email-verifier', { email });
      if (status === 202) {
        if (attempt < this.verifyMaxAttempts) await this.sleep(this.verifyDelayMs);
        continue;
      }
      const d = data as Record<string, any>;
      return {
        email: String(d.email ?? email),
        status: String(d.status ?? 'unknown'),
        score: Number(d.score ?? 0),
      };
    }
    return { email, status: 'unknown', score: 0 };
  }

  /** GET that returns the parsed `data` object, throwing HunterError on failure. */
  private async get(path: string, params: Record<string, string | undefined>): Promise<unknown> {
    const { status, data, errors } = await this.request(path, params);
    if (status >= 400 || errors) {
      throw new HunterError(`Hunter ${path} failed (${status}): ${errors ?? 'unknown error'}`);
    }
    return data;
  }

  /** GET that surfaces the raw HTTP status (for the verifier's 202 poll). */
  private async getRaw(
    path: string,
    params: Record<string, string | undefined>
  ): Promise<{ status: number; data: unknown }> {
    const { status, data, errors } = await this.request(path, params);
    if (status !== 202 && (status >= 400 || errors)) {
      throw new HunterError(`Hunter ${path} failed (${status}): ${errors ?? 'unknown error'}`);
    }
    return { status, data };
  }

  private async request(
    path: string,
    params: Record<string, string | undefined>
  ): Promise<{ status: number; data: unknown; errors?: string }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, v);
    }
    const url = `${this.baseUrl}${path}?${qs.toString()}`;
    const res = await this.fetchFn(url, { headers: { 'X-API-KEY': this.apiKey } });
    let body: Record<string, any> = {};
    try {
      body = (await res.json()) as Record<string, any>;
    } catch {
      body = {};
    }
    const errors = Array.isArray(body.errors)
      ? body.errors.map((e: Record<string, any>) => e.details ?? e.id ?? 'error').join('; ')
      : undefined;
    return { status: res.status, data: body.data ?? {}, errors };
  }
}
