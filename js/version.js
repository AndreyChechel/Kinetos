// Single source of truth for the app version.
// Bump this on every deploy, then set sw.js CACHE to 'kinetos-<APP_VERSION>' to
// match. The version is shown in Profile → About, so you can confirm the build
// that's actually loaded (a stale value there means a caching/SW issue).
export const APP_VERSION = '1.6.2';
