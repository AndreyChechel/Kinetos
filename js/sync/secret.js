// Resolves a provider's OAuth client secret.
//   - config.clientSecret     -> used as-is (plaintext).
//   - config.clientSecretEnc  -> AES-256-GCM ciphertext unlocked with a passphrase
//                                you type once, then remembered on this device for
//                                REMEMBER_DAYS (localStorage) so syncing isn't
//                                interrupted on every app launch.
// The passphrase itself is never stored (only the decrypted secret, which is no
// more sensitive than the OAuth refresh token already kept in localStorage), and
// nothing here is ever uploaded. Cleared on disconnect / "Reset app". Blob format
// is produced by tools/encrypt-secret.html and matches decrypt() below.
import { SYNC } from '../config.js';
import { promptDialog } from '../components.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';

const CACHE_PREFIX = 'kinetos.secret.';
const PBKDF2_ITER = 150000;
const REMEMBER_DAYS = 30;
const REMEMBER_MS = REMEMBER_DAYS * 24 * 60 * 60 * 1000;

const RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // re-stamp at most once a day

/**
 * Read a remembered secret, honouring its expiry (and clearing it once stale).
 * The window is a *sliding* one: every successful read pushes the expiry out
 * again, so the passphrase is only re-asked after REMEMBER_DAYS of not syncing.
 */
function readCached(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { raw = null; }
  if (!raw) {
    // Pre-1.8 builds cached in sessionStorage; still honour it for this session.
    try { return sessionStorage.getItem(key) || null; } catch { return null; }
  }
  let rec; try { rec = JSON.parse(raw); } catch { rec = null; }
  if (!rec || typeof rec.secret !== 'string') { clearCached(key); return null; }
  if (!(rec.exp > Date.now())) { clearCached(key); return null; }
  if (rec.exp - Date.now() < REMEMBER_MS - RENEW_AFTER_MS) writeCached(key, rec.secret);
  return rec.secret;
}

function writeCached(key, secret) {
  try { localStorage.setItem(key, JSON.stringify({ secret, exp: Date.now() + REMEMBER_MS })); } catch { /* quota / private mode */ }
}

function clearCached(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

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
  const cached = readCached(cacheKey);
  if (cached) return cached;

  const pass = await promptDialog(t('sync.passphrasePrompt'), { password: true });
  if (!pass) return null;
  try {
    const secret = await decrypt(cfg.clientSecretEnc, pass);
    writeCached(cacheKey, secret);
    return secret;
  } catch (e) {
    toast(t('sync.passphraseError'));
    return null;
  }
}

/** Forget any remembered decrypted secrets (e.g. on disconnect / reset). */
export function forgetSecrets() {
  Object.keys(SYNC.providers).forEach((p) => clearCached(CACHE_PREFIX + p));
}
