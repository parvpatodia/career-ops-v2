/**
 * SecretVault (AES-256-GCM) + CredentialStore. Tests inject a fixed key (no
 * Keychain), verify round-trip, tamper detection, and the encrypted file store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SecretVault, CredentialStore } from '../../src/secrets/SecretVault.js';

const KEY = crypto.randomBytes(32);

describe('SecretVault', () => {
  it('round-trips a secret', () => {
    const v = new SecretVault(KEY);
    const blob = v.encrypt('im_live_supersecret');
    expect(blob).not.toContain('im_live_supersecret'); // ciphertext, not plaintext
    expect(v.decrypt(blob)).toBe('im_live_supersecret');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const v = new SecretVault(KEY);
    expect(v.encrypt('x')).not.toBe(v.encrypt('x'));
  });

  it('detects tampering (GCM auth tag) and refuses to decrypt', () => {
    const v = new SecretVault(KEY);
    const [iv, tag, ct] = v.encrypt('secret').split(':');
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => v.decrypt([iv, tag, flipped].join(':'))).toThrow();
  });

  it('a different key cannot decrypt', () => {
    const blob = new SecretVault(KEY).encrypt('secret');
    expect(() => new SecretVault(crypto.randomBytes(32)).decrypt(blob)).toThrow();
  });

  it('rejects a non-32-byte key', () => {
    expect(() => new SecretVault(crypto.randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('CredentialStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('stores credentials encrypted on disk and reads them back', () => {
    const file = path.join(dir, 'credentials.enc');
    const store = new CredentialStore(new SecretVault(KEY), file);
    store.set('GMAIL_APP_PASSWORD', 'abcd efgh ijkl mnop');
    store.set('GMAIL_USER', 'parv@gmail.com');

    // On-disk content is ciphertext, never the plaintext password.
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('abcd efgh');

    const reopened = new CredentialStore(new SecretVault(KEY), file);
    expect(reopened.get('GMAIL_APP_PASSWORD')).toBe('abcd efgh ijkl mnop');
    expect(reopened.get('GMAIL_USER')).toBe('parv@gmail.com');
    expect(reopened.get('MISSING')).toBeUndefined();
  });

  it('returns empty when the file does not exist', () => {
    expect(new CredentialStore(new SecretVault(KEY), path.join(dir, 'none.enc')).load()).toEqual({});
  });
});
