/**
 * ImapClient pure helpers: account assembly, half-configured diagnosis, and the
 * error classifier. The network IO (fetchRecentHeaders/checkConnection) needs a
 * real server + app password, so only the pure decisions are unit-tested.
 */

import { describe, it, expect } from 'vitest';
import { accountsFromEnv, diagnoseAccounts, describeImapError } from '../../src/inbox/ImapClient.js';

describe('accountsFromEnv', () => {
  it('requires BOTH user and app password (a half-config yields no account)', () => {
    expect(accountsFromEnv({ GMAIL_USER: 'a@gmail.com' })).toEqual([]); // no password
    expect(accountsFromEnv({ GMAIL_APP_PASSWORD: 'x' })).toEqual([]); // no user
    const ok = accountsFromEnv({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x' });
    expect(ok.map((a) => a.account)).toEqual(['gmail']);
    expect(ok[0]!.host).toBe('imap.gmail.com');
  });

  it('builds both providers when fully configured', () => {
    const accts = accountsFromEnv({
      GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x',
      OUTLOOK_USER: 'b@outlook.com', OUTLOOK_APP_PASSWORD: 'y',
    });
    expect(accts.map((a) => a.account)).toEqual(['gmail', 'outlook']);
  });
});

describe('diagnoseAccounts', () => {
  it('flags the common "user set, password missing" state precisely', () => {
    const lines = diagnoseAccounts({ GMAIL_USER: 'a@gmail.com' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/gmail:.*set.*GMAIL_APP_PASSWORD MISSING/);
  });

  it('reports a fully configured account, and omits unconfigured providers', () => {
    const lines = diagnoseAccounts({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x' });
    expect(lines).toEqual(['gmail: configured (a@gmail.com)']);
  });

  it('returns nothing when no provider env is set at all', () => {
    expect(diagnoseAccounts({})).toEqual([]);
  });
});

describe('describeImapError', () => {
  it('maps an auth failure to the app-password hint', () => {
    expect(describeImapError(new Error('Invalid credentials (Failure)'))).toMatch(/APP PASSWORD/);
    expect(describeImapError(new Error('AUTHENTICATIONFAILED'))).toMatch(/APP PASSWORD/);
  });

  it('maps a network failure to a reachability hint', () => {
    expect(describeImapError(new Error('getaddrinfo ENOTFOUND imap.gmail.com'))).toMatch(/reach the mail server/);
  });

  it('passes through an unknown error (truncated)', () => {
    expect(describeImapError(new Error('some weird state'))).toBe('some weird state');
  });
});
