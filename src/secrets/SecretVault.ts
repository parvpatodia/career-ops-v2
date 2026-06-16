/**
 * AES-256-GCM secret vault — the Node equivalent of the competitor's Fernet +
 * OS-keyring profile vault. Encrypts secrets at rest with an authenticated
 * cipher (GCM tag detects tampering) under a key resolved from, in order:
 *   1. the macOS login Keychain (service "career-ops-vault")
 *   2. CAREER_OPS_VAULT_KEY (base64) in the environment
 *   3. a freshly generated key, persisted back to the Keychain (or, if no
 *      Keychain, a gitignored 0600 keyfile)
 *
 * WHY: the at-rest secrets (email app passwords, API keys) should not sit in
 * plaintext. We do NOT encrypt config/profile.yml — that stays hand-editable;
 * this guards the machine-managed credentials instead.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ALGO = 'aes-256-gcm';
const KEYCHAIN_SERVICE = 'career-ops-vault';
const KEYCHAIN_ACCOUNT = 'vault-key';
const DEFAULT_KEYFILE = '.vault.key';

export class SecretVault {
  private readonly key: Buffer;

  /** Inject a 32-byte key in tests; otherwise resolve from keychain/env/keyfile. */
  constructor(key?: Buffer) {
    this.key = key ?? SecretVault.resolveKey();
    if (this.key.length !== 32) throw new Error('SecretVault key must be 32 bytes');
  }

  /** Returns "iv:tag:ciphertext", all base64. */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  /** Throws if the blob was tampered with (GCM auth tag mismatch). */
  decrypt(blob: string): string {
    const [ivB, tagB, encB] = blob.split(':');
    if (!ivB || !tagB || encB === undefined) throw new Error('SecretVault: malformed ciphertext');
    const decipher = crypto.createDecipheriv(ALGO, this.key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
  }

  // ── Key resolution (the IO edge) ──────────────────────────────────────────

  static resolveKey(keyfile = DEFAULT_KEYFILE): Buffer {
    const fromChain = SecretVault.keychainGet();
    if (fromChain) return fromChain;

    const env = (process.env.CAREER_OPS_VAULT_KEY ?? '').trim();
    if (env) return Buffer.from(env, 'base64');

    if (fs.existsSync(keyfile)) return Buffer.from(fs.readFileSync(keyfile, 'utf8').trim(), 'base64');

    // First run: generate, persist to the Keychain if available, else a 0600 keyfile.
    const key = crypto.randomBytes(32);
    if (!SecretVault.keychainSet(key)) {
      fs.writeFileSync(keyfile, key.toString('base64'), { mode: 0o600 });
    }
    return key;
  }

  private static keychainGet(): Buffer | null {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 }
      ).toString().trim();
      return out ? Buffer.from(out, 'base64') : null;
    } catch {
      return null; // not on macOS, or not yet stored
    }
  }

  private static keychainSet(key: Buffer): boolean {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', key.toString('base64')],
        { stdio: 'ignore', timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** A file of secrets (JSON), encrypted at rest via SecretVault. Gitignored. */
export class CredentialStore {
  constructor(
    private readonly vault: SecretVault,
    private readonly filePath = path.join('config', 'credentials.enc')
  ) {}

  load(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(this.vault.decrypt(fs.readFileSync(this.filePath, 'utf8').trim()));
    } catch {
      return {};
    }
  }

  save(creds: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, this.vault.encrypt(JSON.stringify(creds)), { mode: 0o600 });
  }

  get(key: string): string | undefined {
    return this.load()[key];
  }

  set(key: string, value: string): void {
    const creds = this.load();
    creds[key] = value;
    this.save(creds);
  }
}
