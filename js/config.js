// Kinetos configuration — edit this file to enable cloud sync.
//
// Cloud sync is OPTIONAL and OFF until you fill in a clientId below. Kinetos is
// a static app with no backend, so it uses the provider's OAuth from the
// browser and stores your data in a file on your own Drive. Full setup steps
// (redirect URI, scopes, creating the OAuth app) are in docs/sync.html.
//
// Only providers with `enabled: true` appear in the app. Currently: Google Drive.
//
// SECRET HANDLING (Google "Web application" clients require a client secret):
//   * clientSecret     — plaintext. Simple, but anyone who can load the deployed
//                        JS can read it. Only OK if your deployment is private.
//   * clientSecretEnc  — the secret encrypted with a passphrase (AES-256-GCM).
//                        Safe to commit even to a public repo; you enter the
//                        passphrase once and this device remembers the unlocked
//                        secret for 30 days.
//                        Generate the blob offline with tools/encrypt-secret.html.
//   Fill in ONE of them. If both are set, clientSecret wins.
//
// Access/refresh tokens and the unlocked secret are kept only in this browser's
// localStorage (never uploaded), and are erased on disconnect / "Reset app".

export const SYNC = {
  fileName: 'kinetos.json',
  autoEveryMinutes: 10,

  // Where the provider sends you back after login. Must be registered verbatim
  // with the provider. Derived from <base href>, so it is always the app BASE
  // (e.g. https://host/ or https://host/Kinetos/) — stable no matter which
  // in-app route the user starts the login from (location.pathname is not).
  redirectUri: (typeof document !== 'undefined') ? new URL('.', document.baseURI).href : '',

  providers: {
    google: {
      enabled: true,
      label: 'Google Drive',
      flow: 'pkce',
      clientId: '805781969476-d7d1avrm57rahugqdm55fv9mkfv136c1.apps.googleusercontent.com',            // Google Cloud Console → Credentials → OAuth client (Web application)
      clientSecret: '',        // plaintext secret (see note above) — or use clientSecretEnc
      clientSecretEnc: '{"v":1,"salt":"DWJezzd2tpvsjERa9XQrvA==","iv":"3ybII74vtfKxN7Tl","ct":"6kjRuVgDcE1XEFDN2+kCirPl/M6FH4JhpbM9zyf9r3hX+SR3hcL07wUJHsBSVsmQrVFe"}',     // passphrase-encrypted secret JSON (from tools/encrypt-secret.html)
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/drive.file',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' }
    },
    onedrive: {
      enabled: false,
      label: 'OneDrive',
      flow: 'pkce',
      clientId: '',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scope: 'Files.ReadWrite.AppFolder offline_access',
      extraAuthParams: {}
    },
    yandex: {
      enabled: false,
      label: 'Yandex Disk',
      flow: 'token',
      clientId: '',
      authUrl: 'https://oauth.yandex.ru/authorize',
      tokenUrl: 'https://oauth.yandex.ru/token',
      scope: 'cloud_api:disk.app_folder',
      extraAuthParams: {}
    }
  }
};
