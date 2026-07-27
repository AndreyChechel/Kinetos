// Resolves a provider's OAuth client secret.
//   - config.clientSecret     -> used as-is (plaintext).
//   - config.clientSecretEnc  -> AES-256-GCM ciphertext unlocked with a passphrase
//                                you type once per session (kept in sessionStorage).
// The passphrase itself is never stored. Blob format is produced by
// tools/encrypt-secret.html and matches decrypt() below.
import { SYNC } from '../config.js';
import { promptDialog } from '../components.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';

const CACHE_PREFIX = 'kinetos.secret.';
const PBKDF2_ITER = 150000;

function b64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
}

/** Decrypt a blob JSON string ({v,salt,iv,ct}) with a passphrase. */
export async function decrypt(blobJson, passphrase) {
  const blob = JSON.parse(blobJson);
  const key = await deriveKey(passphrase, b64ToBytes(blob.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct));
  return new TextDecoder().decode(plain);
}

/** Get the plaintext client secret for a provider, prompting to unlock if encrypted. */
export async function getClientSecret(providerId) {
  const cfg = SYNC.providers[providerId];
  if (!cfg) return null;
  if (cfg.clientSecret) return cfg.clientSecret;
  if (!cfg.clientSecretEnc) return null; // no secret configured (PKCE-only client)

  const cacheKey = CACHE_PREFIX + providerId;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return cached;

  const pass = await promptDialog(t('sync.passphrasePrompt'), { password: true });
  if (!pass) return null;
  try {
    const secret = await decrypt(cfg.clientSecretEnc, pass);
    sessionStorage.setItem(cacheKey, secret);
    return secret;
  } catch (e) {
    toast(t('sync.passphraseError'));
    return null;
  }
}

/** Forget any cached decrypted secrets (e.g. on disconnect). */
export function forgetSecrets() {
  Object.keys(SYNC.providers).forEach((p) => sessionStorage.removeItem(CACHE_PREFIX + p));
}
