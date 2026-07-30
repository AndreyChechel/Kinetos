// Kinetos configuration — edit this file to enable cloud sync.
//
// Cloud sync is OPTIONAL and OFF until you fill in a clientId below. Kinetos is
// a static app with no backend, so it authorizes from the browser using Google
// Identity Services and stores your data in one file on your own Drive. Full
// setup steps are in docs/sync.html.
//
// NO CLIENT SECRET IS NEEDED OR WANTED. Sync uses the GIS *token* model, which
// hands the access token straight to JavaScript — so there is nothing sensitive
// in this file and it is safe to publish. (Earlier builds used the
// authorization-code flow, whose token endpoint demands a client_secret; that
// secret had to be shipped encrypted, with a passphrase prompt. Both are gone.)
//
// In Google Cloud Console → Credentials → your OAuth client (Web application):
//   * Add your app's ORIGIN under "Authorized JavaScript origins" — scheme +
//     host + port, no path. e.g. https://you.github.io and http://localhost:8080
//     (the /Kinetos/ sub-path is irrelevant here, unlike redirect URIs).
//   * "Authorized redirect URIs" is no longer used by Kinetos.
//   * The client secret on that client is unused — rotate or delete it.
//
// Access tokens are kept only in this browser's localStorage, are never
// uploaded, and are erased on disconnect / "Reset app". They expire after about
// an hour; because the token model issues no refresh token, Kinetos then asks
// for one tap to re-authorize (see js/sync/gis.js for why a tap is required).

export const SYNC = {
  fileName: 'kinetos.json',
  autoEveryMinutes: 10,

  providers: {
    google: {
      enabled: true,
      label: 'Google Drive',
      flow: 'gis',
      clientId: '805781969476-d7d1avrm57rahugqdm55fv9mkfv136c1.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/drive.file'
    }
  }
};
