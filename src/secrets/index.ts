/**
 * `npm run secrets` — manage the encrypted credential vault (AES-256-GCM, key in
 * the macOS Keychain). Store email app passwords + API keys encrypted at rest
 * instead of plaintext .env.
 *
 * Usage:
 *   npm run secrets -- set GMAIL_USER you@gmail.com
 *   npm run secrets -- set GMAIL_APP_PASSWORD "abcd efgh ijkl mnop"
 *   npm run secrets -- set OUTLOOK_USER you@northeastern.edu
 *   npm run secrets -- set OUTLOOK_APP_PASSWORD "...."
 *   npm run secrets -- list        # key names only, never values
 */

import { SecretVault, CredentialStore } from './SecretVault.js';

function main(): void {
  const [cmd, key, ...rest] = process.argv.slice(2);
  const store = new CredentialStore(new SecretVault());

  if (cmd === 'set' && key && rest.length > 0) {
    store.set(key, rest.join(' '));
    console.log(`Stored ${key} (encrypted). config/credentials.enc is gitignored.`);
    return;
  }
  if (cmd === 'list') {
    const keys = Object.keys(store.load());
    console.log(keys.length ? `Stored secrets (names only):\n  ${keys.join('\n  ')}` : 'Vault is empty.');
    return;
  }
  console.log('Usage:\n  npm run secrets -- set <KEY> <VALUE>\n  npm run secrets -- list');
}

main();
