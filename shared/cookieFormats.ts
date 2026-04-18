/**
 * Cookie format normalization.
 *
 * Users typically paste cookies copied from another fingerprint browser
 * (AdsPower / iSO / Bit / etc.) or from a browser extension
 * (EditThisCookie, Cookie-Editor). Each tool exports its own JSON dialect
 * with subtly different field names, casing, and value encodings. This
 * module converts any of those into a single canonical shape that we can
 * persist and feed into Playwright's `context.addCookies()`.
 *
 * Supported inputs (auto-detected):
 *   1. iSO / AdsPower / Bit-style: PascalCase keys
 *      {Name, Value, Domain, Path, Secure, HttpOnly, Persistent, Expires,
 *       Samesite, HasExpires, ...}
 *   2. EditThisCookie / Cookie-Editor / Playwright export: camelCase
 *      {name, value, domain, path, secure, httpOnly, sameSite, expirationDate}
 *   3. A single object (gets wrapped in an array).
 */

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix epoch SECONDS. `-1` or omitted = session cookie. */
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CookieParseResult {
  cookies: BrowserCookie[];
  errors: string[];
  /** What format we recognized in the input (for the UI to show a hint). */
  format: 'iso' | 'standard' | 'unknown' | 'mixed';
}

export interface CookieDomainGroup {
  domain: string;
  count: number;
}

/**
 * iSO/AdsPower/Bit "Samesite" is a Chromium net::CookieSameSite enum value
 * encoded as a stringified int:
 *   "-1" → UNSPECIFIED       → omit (Playwright default)
 *   "0"  → NO_RESTRICTION    → "None"
 *   "1"  → LAX_MODE          → "Lax"
 *   "2"  → STRICT_MODE       → "Strict"
 */
function decodeIsoSameSite(raw: unknown): BrowserCookie['sameSite'] | undefined {
  const v = String(raw ?? '').trim();
  if (v === '0') return 'None';
  if (v === '1') return 'Lax';
  if (v === '2') return 'Strict';
  return undefined;
}

function decodeStandardSameSite(raw: unknown): BrowserCookie['sameSite'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'no_restriction' || v === 'none') return 'None';
  if (v === 'lax') return 'Lax';
  if (v === 'strict') return 'Strict';
  if (v === 'unspecified' || v === '') return undefined;
  return undefined;
}

function parseExpiresIso(raw: unknown, hasExpires: unknown, persistent: unknown): number | undefined {
  // iSO: expires is meaningful only when both flags are "1" (truthy strings).
  const has = String(hasExpires ?? '').trim();
  const per = String(persistent ?? '').trim();
  if (has !== '1' && has !== 'true') return undefined;
  if (per === '0' || per === 'false') return undefined;
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  // Common iSO export uses "1601-01-01T08:00:00+08:00" as a sentinel meaning
  // "no expiry recorded" — treat as session.
  if (s.startsWith('1601-')) return undefined;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  const epochSec = Math.floor(t / 1000);
  if (epochSec <= 0) return undefined;
  return epochSec;
}

function parseExpiresStandard(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  // Accept: number (epoch seconds OR ms), Date string
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return undefined;
    // Heuristic: > 10^11 is almost certainly milliseconds.
    return raw > 1e11 ? Math.floor(raw / 1000) : Math.floor(raw);
  }
  const s = String(raw).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  return Math.floor(t / 1000);
}

function isIsoShape(obj: Record<string, unknown>): boolean {
  return 'Name' in obj && 'Value' in obj && 'Domain' in obj;
}

function isStandardShape(obj: Record<string, unknown>): boolean {
  return 'name' in obj && 'value' in obj && 'domain' in obj;
}

function normalizeDomain(d: unknown): string {
  return String(d ?? '').trim();
}

function isValidDomain(d: string): boolean {
  if (!d) return false;
  // Reject obvious garbage. Leading dot is allowed (legacy / iSO style).
  return /^[\w.-]+$/i.test(d) || /^\.[\w.-]+$/i.test(d);
}

function fromIso(raw: Record<string, unknown>, errors: string[]): BrowserCookie | null {
  const name = String(raw.Name ?? '').trim();
  if (!name) {
    errors.push('iSO cookie missing Name');
    return null;
  }
  const domain = normalizeDomain(raw.Domain);
  if (!isValidDomain(domain)) {
    errors.push(`Invalid domain "${domain}" for cookie ${name}`);
    return null;
  }
  const cookie: BrowserCookie = {
    name,
    value: String(raw.Value ?? ''),
    domain,
    path: String(raw.Path ?? '/') || '/',
  };
  if (raw.Secure === true || raw.Secure === 'true' || raw.Secure === 1 || raw.Secure === '1') {
    cookie.secure = true;
  }
  if (raw.HttpOnly === true || raw.HttpOnly === 'true' || raw.HttpOnly === 1 || raw.HttpOnly === '1') {
    cookie.httpOnly = true;
  }
  const ss = decodeIsoSameSite(raw.Samesite);
  if (ss) cookie.sameSite = ss;
  const exp = parseExpiresIso(raw.Expires, raw.HasExpires, raw.Persistent);
  if (typeof exp === 'number') cookie.expires = exp;
  return cookie;
}

function fromStandard(raw: Record<string, unknown>, errors: string[]): BrowserCookie | null {
  const name = String(raw.name ?? '').trim();
  if (!name) {
    errors.push('Cookie missing name');
    return null;
  }
  const domain = normalizeDomain(raw.domain);
  if (!isValidDomain(domain)) {
    errors.push(`Invalid domain "${domain}" for cookie ${name}`);
    return null;
  }
  const cookie: BrowserCookie = {
    name,
    value: String(raw.value ?? ''),
    domain,
    path: String(raw.path ?? '/') || '/',
  };
  if (raw.secure === true || raw.secure === 'true' || raw.secure === 1) {
    cookie.secure = true;
  }
  if (raw.httpOnly === true || raw.httpOnly === 'true' || raw.httpOnly === 1) {
    cookie.httpOnly = true;
  }
  // Accept either `sameSite` or `samesite`
  const ss = decodeStandardSameSite(raw.sameSite ?? raw.samesite);
  if (ss) cookie.sameSite = ss;
  // Accept either `expires`, `expirationDate` (EditThisCookie), or `expiry`
  const expRaw = raw.expires ?? raw.expirationDate ?? raw.expiry;
  if (raw.session === true) {
    // explicit session marker: leave expires undefined
  } else {
    const exp = parseExpiresStandard(expRaw);
    if (typeof exp === 'number') cookie.expires = exp;
  }
  return cookie;
}

/**
 * Parse a JSON string (or already-parsed object/array) into BrowserCookie[].
 * Recognises iSO, EditThisCookie, Cookie-Editor and Playwright JSON exports
 * automatically.
 */
export function parseCookieJson(input: string | unknown): CookieParseResult {
  const errors: string[] = [];
  let parsed: unknown;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return { cookies: [], errors: [], format: 'unknown' };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return {
        cookies: [],
        errors: ['JSON 解析失败：' + (err as Error).message],
        format: 'unknown',
      };
    }
  } else {
    parsed = input;
  }

  const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const cookies: BrowserCookie[] = [];
  const seen = new Set<string>(); // dedup key: name|domain|path
  let isoCount = 0;
  let stdCount = 0;

  for (const item of arr) {
    if (!item || typeof item !== 'object') {
      errors.push('Skipped non-object entry');
      continue;
    }
    const obj = item as Record<string, unknown>;
    let cookie: BrowserCookie | null = null;
    if (isIsoShape(obj)) {
      cookie = fromIso(obj, errors);
      isoCount++;
    } else if (isStandardShape(obj)) {
      cookie = fromStandard(obj, errors);
      stdCount++;
    } else {
      errors.push('Unrecognized cookie shape (need Name+Value+Domain or name+value+domain)');
      continue;
    }
    if (!cookie) continue;
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (seen.has(key)) continue; // last write wins is also fine; we keep first
    seen.add(key);
    cookies.push(cookie);
  }

  let format: CookieParseResult['format'] = 'unknown';
  if (isoCount && stdCount) format = 'mixed';
  else if (isoCount) format = 'iso';
  else if (stdCount) format = 'standard';

  return { cookies, errors, format };
}

/**
 * Group cookies by registrable-ish domain for display. We strip the leading
 * dot but otherwise keep the domain as-is (no PSL — that's overkill here).
 */
export function summarizeCookies(cookies: BrowserCookie[]): CookieDomainGroup[] {
  const map = new Map<string, number>();
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, '');
    map.set(d, (map.get(d) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Convert internal cookies to Playwright `addCookies` input. We always
 * provide `domain`+`path`; Playwright then synthesises the URL itself.
 * Cookies whose `domain` doesn't start with a dot still work fine — the
 * browser scopes them to that exact host.
 */
export function toPlaywrightCookies(cookies: BrowserCookie[]): Array<Record<string, unknown>> {
  return cookies.map((c) => {
    const out: Record<string, unknown> = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
    };
    if (typeof c.expires === 'number' && c.expires > 0) out.expires = c.expires;
    if (c.secure) out.secure = true;
    if (c.httpOnly) out.httpOnly = true;
    if (c.sameSite) out.sameSite = c.sameSite;
    return out;
  });
}
