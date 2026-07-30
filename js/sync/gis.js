// Google Identity Services token client — access tokens with NO client secret.
//
// Why this file exists: Google's token endpoint requires a client_secret for
// "Web application" clients, and a static app served from GitHub Pages cannot
// keep one (we used to ship it AES-encrypted with a passphrase). The GIS token
// model is the OAuth implicit flow: Google hands the access token straight to a
// JS callback, so no secret is needed anywhere and nothing sensitive is
// published. The price is that there is no refresh token — tokens last ~1h and
// the next one must be requested from a real user gesture.
//
// ── THE GESTURE RULE (read before editing) ───────────────────────────────────
// requestToken() opens a popup, so it must be reachable *synchronously* from a
// click handler. Browsers consume transient user activation across `await`, so
// any awaiting — including loading this very library — has to happen BEFORE the
// click. Call init() when the UI owning the button renders, then call
// requestToken() straight from the handler. Never `await` in between, and never
// make requestToken() (or its callers) `async`: that alone breaks the popup,
// silently and only in the browser.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = 'https://accounts.google.com/gsi/client';
// Generous: a first-ever grant can include sign-in, 2FA and a scope review.
// Only a safety valve so a lost popup can't wedge the button forever.
const PENDING_TTL_MS = 10 * 60 * 1000;
// A second tap this soon means a popup probably really is open — don't stack
// another. Later than this and GIS never reported back, so the tap takes over.
const TAKEOVER_AFTER_MS = 1500;

let loadPromise = null;
const clients = new Map(); // key -> { client, pending, timer, onToken }
const initing = new Map(); // key -> in-flight init promise

function err(message, code) { const e = new Error(message); e.code = code; return e; }

function libReady() {
  return !!(typeof window !== 'undefined' && window.google && window.google.accounts && window.google.accounts.oauth2);
}

/** Hand the outstanding request (if any) to `fn`, clearing it and its timer. */
function settle(entry, fn) {
  const p = entry.pending;
  entry.pending = null;
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (p) fn(p);
}

/** Load gsi/client once (network). Resolves immediately when already present. */
export function load() {
  if (libReady()) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC; s.async = true; s.defer = true;
    s.addEventListener('load', resolve);
    s.addEventListener('error', () => {
      s.remove(); // don't leave dead <script> tags behind on every retry
      reject(err('gis-load-failed', 'network'));
    });
    document.head.appendChild(s);
  }).then(() => {
    if (!libReady()) throw err('gis-unavailable', 'network');
  }).catch((e) => {
    loadPromise = null; // let a later attempt retry (e.g. back online)
    throw e;
  });
  return loadPromise;
}

/** True when requestToken(key) can run without awaiting anything. */
export function ready(key) { return libReady() && clients.has(key); }

/**
 * Load the library and build the token client for `key`. Async on purpose —
 * call it while rendering the sync UI, never from inside a click handler.
 * `onToken` is the single place tokens get persisted: it fires for every token
 * Google returns, including one that arrives after the caller gave up waiting.
 */
export function init(key, opts) {
  if (clients.has(key)) return Promise.resolve();
  // Concurrent callers (boot warm-up + the Profile card) must not each build a
  // client and overwrite one another in the map.
  if (initing.has(key)) return initing.get(key);
  const p = build(key, opts).finally(() => initing.delete(key));
  initing.set(key, p);
  return p;
}

async function build(key, { clientId, scope, onToken }) {
  await load();
  if (clients.has(key)) return;
  const entry = { client: null, pending: null, timer: null };

  entry.client = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    // '' means "prompt only the first time this user grants access". The
    // default ('select_account') would show the account chooser on every
    // hourly re-auth; with '' an already-granted user just sees a popup flash.
    prompt: '',
    callback: (resp) => {
      const token = resp && resp.access_token ? {
        access_token: resp.access_token,
        expires_at: Date.now() + ((Number(resp.expires_in) || 3600) * 1000),
        scope: resp.scope || scope
      } : null;
      // Persist first, unconditionally: a token that arrives late (after the
      // TTL below fired) is still a perfectly good grant and throwing it away
      // would cost the user another round of consent.
      if (token && typeof onToken === 'function') { try { onToken(token); } catch (e) { /* storage is best-effort */ } }
      settle(entry, (p) => {
        if (token) p.resolve(token);
        else p.reject(err((resp && (resp.error_description || resp.error)) || 'auth-failed', 'auth'));
      });
    },
    // Non-OAuth failures: popup blocked (we lost the gesture) or user closed it.
    error_callback: (e) => settle(entry, (p) => {
      const type = (e && e.type) || 'unknown';
      p.reject(err(type, type === 'popup_closed' ? 'cancelled' : 'popup'));
    })
  });

  clients.set(key, entry);
}

/**
 * Request an access token. MUST be called synchronously from a user gesture:
 * the popup opens inside the promise executor, which runs synchronously, so the
 * activation survives — but only if the caller didn't await first.
 * Resolves to { access_token, expires_at, scope } (already passed to onToken).
 */
export function requestToken(key) {
  const entry = clients.get(key);
  if (!entry) return Promise.reject(err('gis-not-ready', 'not-ready'));
  if (entry.pending) {
    if (Date.now() - entry.pending.startedAt < TAKEOVER_AFTER_MS) {
      return Promise.reject(err('auth-in-progress', 'busy'));
    }
    settle(entry, (p) => p.reject(err('superseded', 'cancelled')));
  }
  return new Promise((resolve, reject) => {
    entry.pending = { resolve, reject, startedAt: Date.now() };
    entry.timer = setTimeout(() => settle(entry, (p) => p.reject(err('popup_closed', 'cancelled'))), PENDING_TTL_MS);
    try {
      entry.client.requestAccessToken();
    } catch (e) {
      settle(entry, (p) => p.reject(err((e && e.message) || 'auth-failed', 'auth')));
    }
  });
}

/**
 * Revoke a grant (best effort — used on disconnect). Never throws. Note this
 * no-ops when the library isn't loaded, and Google refuses an already-expired
 * access token, so a disconnect after the hour is up only clears local state.
 */
export function revoke(accessToken) {
  return new Promise((resolve) => {
    if (!libReady() || !accessToken) return resolve(false);
    try {
      window.google.accounts.oauth2.revoke(accessToken, (r) => resolve(!!(r && r.successful)));
    } catch (e) { resolve(false); }
  });
}
