/**
 * Whitelist of files INSIDE a Chromium profile (userDataDir) that we sync to
 * the cloud. Everything not on this list is considered cache and skipped.
 *
 * The goal is "essential identity": logged-in cookies, saved passwords,
 * extensions, bookmarks, preferences. We deliberately skip things like the
 * GPU shader cache, code cache, and Service Worker cache — they're disposable
 * and would balloon storage by 100x without changing anti-detection behavior.
 *
 * Patterns are tested with `minimatch`-style globs against the path RELATIVE
 * to the profile directory, using forward slashes.
 */

export const PROFILE_FILE_WHITELIST: string[] = [
  // ---- account identity ----
  'Default/Cookies',
  'Default/Cookies-journal',
  'Default/Network/Cookies',
  'Default/Network/Cookies-journal',
  'Default/Network/Trust Tokens',
  'Default/Network/Trust Tokens-journal',
  'Default/Network/Reporting and NEL',
  'Default/Network/Reporting and NEL-journal',

  // ---- per-origin storage (the big one for SPAs/dashboards) ----
  'Default/Local Storage/leveldb/**',
  'Default/Session Storage/**',
  'Default/IndexedDB/**',
  'Default/databases/**',
  'Default/databases.db',
  'Default/databases.db-journal',
  'Default/Local State',
  'Local State',

  // ---- chrome:// data ----
  'Default/Preferences',
  'Default/Secure Preferences',
  'Default/Login Data',
  'Default/Login Data-journal',
  'Default/Login Data For Account',
  'Default/Login Data For Account-journal',
  'Default/Web Data',
  'Default/Web Data-journal',
  'Default/Bookmarks',
  'Default/Bookmarks.bak',
  'Default/History',
  'Default/History-journal',
  'Default/Favicons',
  'Default/Favicons-journal',
  'Default/Top Sites',
  'Default/Top Sites-journal',
  'Default/Shortcuts',
  'Default/Shortcuts-journal',
  'Default/Visited Links',

  // ---- extensions & their data ----
  'Default/Extensions/**',
  'Default/Extension Rules/**',
  'Default/Extension State/**',
  'Default/Local Extension Settings/**',
  'Default/Sync Extension Settings/**',
  'Default/Managed Extension Settings/**',
];

/**
 * Things we EXPLICITLY skip even if they happen to match a whitelist glob
 * (e.g. inside Extensions/). Prevents bloating sync with disposable caches.
 */
export const PROFILE_FILE_BLACKLIST: string[] = [
  '**/Cache/**',
  '**/Code Cache/**',
  '**/GPUCache/**',
  '**/Service Worker/**',
  '**/Service Worker',
  '**/CacheStorage/**',
  '**/blob_storage/**',
  '**/Storage/ext/**/cache/**',
  '**/*.tmp',
  '**/*-journal-tmp',
  '**/LOCK',
  '**/LOG',
  '**/LOG.old',
  '**/MANIFEST-*',          // leveldb manifests are regenerated
  '**/*.ldb',               // wait — we DO want .ldb (it IS the data).
                            // Override: remove this from blacklist.
];

// Remove the over-broad ldb skip we just added.
PROFILE_FILE_BLACKLIST.splice(PROFILE_FILE_BLACKLIST.indexOf('**/*.ldb'), 1);
PROFILE_FILE_BLACKLIST.splice(PROFILE_FILE_BLACKLIST.indexOf('**/MANIFEST-*'), 1);
// Also keep MANIFEST: leveldb won't open without it. Trim the false positives.

/**
 * Minimal glob matcher (no need to add a dependency). Supports:
 *   *      one segment, no slash
 *   **     any number of segments
 *   ?      single char
 * Match is case-insensitive (Windows-ish) but path separators are normalized
 * to forward slashes by the caller.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+()|^$\\[]{}'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

const WHITELIST_RE = PROFILE_FILE_WHITELIST.map(globToRegExp);
const BLACKLIST_RE = PROFILE_FILE_BLACKLIST.map(globToRegExp);

export function shouldSyncFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  if (BLACKLIST_RE.some((re) => re.test(p))) return false;
  return WHITELIST_RE.some((re) => re.test(p));
}
