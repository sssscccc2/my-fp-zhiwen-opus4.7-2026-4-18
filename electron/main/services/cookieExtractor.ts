/**
 * Decrypt Chromium's Cookies SQLite database into plaintext JSON cookies that
 * can be replayed via Playwright's `addCookies()` on a different machine /
 * different Windows user.
 *
 * Why this exists
 * ---------------
 * Chromium encrypts the `value` column of every cookie with OSCrypt. On
 * Windows, the AES-256 key lives in `Local State` (JSON, field
 * `os_crypt.encrypted_key`) wrapped with DPAPI — and DPAPI's master key is
 * bound to the *current Windows user's logon credentials*. Therefore copying
 * Cookies/Local State to another machine (or another Windows account on the
 * same machine) leaves the cookies un-decryptable, and the browser starts
 * with an empty cookie jar — i.e. all sessions appear logged out.
 *
 * Our cloud sync extracts cookies on the source machine *while we still own
 * the DPAPI key*, persists them as plaintext JSON on the server, and on the
 * target machine the existing v0.2 cookie injection (browserLauncher.ts ->
 * `context.addCookies()`) replays them into a fresh profile.
 *
 * Encryption format reference
 * ---------------------------
 *   Local State JSON:
 *     os_crypt.encrypted_key = base64( "DPAPI" + DPAPI_blob(AES_KEY_32) )
 *
 *   Each cookie row (`encrypted_value` BLOB), Chrome 80+:
 *     "v10" or "v11" prefix (3 bytes ascii) | 12-byte nonce | ciphertext | 16-byte GCM tag
 *     -> AES-256-GCM(key=AES_KEY_32, iv=nonce)
 *
 *   Chrome 127+ added `v20` (App-Bound Encryption) which wraps the key with
 *   COM elevation and is not decryptable with raw DPAPI. We detect and
 *   gracefully skip those (most fingerprint-browser kernels disable it).
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { app } from 'electron';
import type { BrowserCookie } from '@shared/cookieFormats';

// ---------------- DPAPI via PowerShell ----------------

/**
 * Decrypt a DPAPI blob using the current Windows user's master key.
 * We pipe the base64-encoded blob via stdin to avoid command-line length
 * limits, and the script writes the base64-encoded plaintext to stdout.
 *
 * Throws on failure (typically "the data is invalid" if the blob came from
 * a different Windows user).
 */
function dpapiUnprotect(blob: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Security',
      '$inB64 = [Console]::In.ReadToEnd().Trim()',
      '$enc = [Convert]::FromBase64String($inB64)',
      '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::Out.Write([Convert]::ToBase64String($plain))',
    ].join('; ');

    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { windowsHide: true });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ps.stdout.on('data', (c: Buffer) => out.push(c));
    ps.stderr.on('data', (c: Buffer) => err.push(c));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`DPAPI unprotect failed (code ${code}): ${Buffer.concat(err).toString('utf-8').slice(0, 200)}`));
      }
      try {
        resolve(Buffer.from(Buffer.concat(out).toString('utf-8').trim(), 'base64'));
      } catch (e) {
        reject(e as Error);
      }
    });

    ps.stdin.end(blob.toString('base64'));
  });
}

/** Read Local State JSON, decrypt and return the 32-byte AES master key. */
async function getMasterKey(profileDir: string): Promise<Buffer> {
  // Local State lives one level above the "Default" profile directory in
  // standard Chromium layout, but our launcher uses each profile dir as the
  // user-data-dir root, so it sits directly under profileDir.
  const localStatePath = path.join(profileDir, 'Local State');
  if (!existsSync(localStatePath)) {
    throw new Error('NO_LOCAL_STATE');
  }
  const txt = readFileSync(localStatePath, 'utf-8');
  let json: { os_crypt?: { encrypted_key?: string } };
  try { json = JSON.parse(txt); } catch (e) { throw new Error('Local State is not valid JSON: ' + (e as Error).message); }
  const enc = json.os_crypt?.encrypted_key;
  if (!enc) throw new Error('NO_ENCRYPTED_KEY');

  const wrapped = Buffer.from(enc, 'base64');
  // Strip the literal "DPAPI" 5-byte prefix.
  if (wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI') {
    throw new Error('UNKNOWN_KEY_PREFIX:' + wrapped.subarray(0, 5).toString('hex'));
  }
  const dpapiBlob = wrapped.subarray(5);
  const key = await dpapiUnprotect(dpapiBlob);
  if (key.length !== 32) {
    throw new Error(`Unexpected master key length: ${key.length}`);
  }
  return key;
}

// ---------------- Per-cookie AES-GCM ----------------

/**
 * Decrypt one `encrypted_value` blob. Returns plaintext UTF-8 string, or
 * `null` if the format is unsupported (e.g. v20 App-Bound Encryption) or
 * decryption fails (caller treats as "skip this cookie").
 *
 * IMPORTANT: Since Chromium 116 the plaintext is prefixed with
 *   SHA256(host_key)  (32 raw bytes)
 * as an integrity tag — see Chromium CL 4609637 "Bind cookie to its origin
 * via SHA256 prefix". Callers must pass the cookie's `host_key` so we can
 * strip (and optionally verify) that prefix; pass `null` for legacy data.
 */
function decryptCookieValue(blob: Buffer, key: Buffer, hostKey: string | null): string | null {
  if (!blob || blob.length === 0) return '';
  const prefix = blob.subarray(0, 3).toString('ascii');
  if (prefix === 'v10' || prefix === 'v11') {
    // GCM layout: [3 prefix][12 nonce][ciphertext][16 tag]
    if (blob.length < 3 + 12 + 16) return null;
    const nonce = blob.subarray(3, 3 + 12);
    const tag = blob.subarray(blob.length - 16);
    const ciphertext = blob.subarray(3 + 12, blob.length - 16);
    let plain: Buffer;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(tag);
      plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return null;
    }
    // Strip Chromium 116+ host-binding SHA256 prefix when present. We don't
    // *require* it (compat with cookies written by older Chromium versions),
    // but if it matches we drop those 32 bytes to recover the real value.
    if (hostKey && plain.length >= 32) {
      const hostHash = crypto.createHash('sha256').update(hostKey, 'utf-8').digest();
      if (plain.subarray(0, 32).equals(hostHash)) {
        plain = plain.subarray(32);
      }
    }
    return plain.toString('utf-8');
  }
  if (prefix === 'v20') {
    // App-Bound Encryption (Chrome 127+). Requires COM elevation service to
    // unwrap the key — we can't do it from a normal Node process.
    return null;
  }
  // Pre-v10 (no prefix) was a plain DPAPI blob over the value directly.
  // Most modern Chromium builds don't produce these any more.
  return null;
}

// ---------------- Cookies SQLite ----------------

let SQL: SqlJsStatic | null = null;

function findWasmPath(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

async function ensureSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  const wasmPath = findWasmPath();
  SQL = await initSqlJs({
    locateFile: (file: string) => wasmPath ?? file,
  });
  return SQL;
}

/**
 * The Cookies file is held open by Chromium when the browser is running. We
 * copy it to a temp file before opening to avoid SQLITE_BUSY and to leave the
 * live DB untouched.
 */
function snapshotFile(src: string): string | null {
  try {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fp-cookie-'));
    const dst = path.join(dir, 'Cookies');
    copyFileSync(src, dst);
    // also copy WAL/journal if present so SQLite sees the latest committed state
    for (const ext of ['-journal', '-wal', '-shm']) {
      const s = src + ext;
      if (existsSync(s)) {
        try { copyFileSync(s, dst + ext); } catch { /* non-fatal */ }
      }
    }
    return dst;
  } catch (err) {
    console.warn('[cookieExtractor] cannot snapshot Cookies file:', (err as Error).message);
    return null;
  }
}

interface CookieRow {
  host_key: string;
  name: string;
  encrypted_value: Uint8Array;
  value: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  has_expires: number;
  is_persistent: number;
  samesite: number;
}

/**
 * Convert Chromium's WebKit microseconds-since-1601 timestamp to Unix
 * epoch SECONDS. Returns undefined for `expires_utc <= 0` (session cookie).
 */
function chromeTimeToUnixSeconds(t: number): number | undefined {
  if (!t || t <= 0) return undefined;
  // Chromium epoch is 1601-01-01 UTC, in microseconds.
  // Difference between 1601-01-01 and 1970-01-01 in microseconds:
  const DELTA_MICROS = 11644473600000000;
  const unixMs = (t - DELTA_MICROS) / 1000;
  if (!Number.isFinite(unixMs) || unixMs <= 0) return undefined;
  return Math.floor(unixMs / 1000);
}

function chromeSameSiteToString(v: number): BrowserCookie['sameSite'] {
  // Chromium net::CookieSameSite enum:
  //   -1 UNSPECIFIED, 0 NO_RESTRICTION, 1 LAX_MODE, 2 STRICT_MODE
  if (v === 0) return 'None';
  if (v === 1) return 'Lax';
  if (v === 2) return 'Strict';
  return undefined;
}

export interface ExtractResult {
  cookies: BrowserCookie[];
  totalRows: number;
  decrypted: number;
  skipped: number;
  reason?: string;     // populated only when extraction failed entirely
}

/**
 * Locate the Cookies SQLite file inside a Chromium user-data-dir. Modern
 * Chromium puts it at `<udd>/Default/Network/Cookies`; older builds (and
 * some embedded Chromium) used `<udd>/Default/Cookies`. We check both.
 */
function findCookiesFile(profileDir: string): string | null {
  const candidates = [
    path.join(profileDir, 'Default', 'Network', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * Extract & decrypt all cookies from a profile's Cookies SQLite database.
 *
 * Returns plaintext cookies that can be JSON-stringified into the existing
 * `profile.cookies` field (which the launcher already injects on startup).
 *
 * On failure (no Cookies file, no master key, DPAPI unauthorised) returns
 * an empty cookies array with `reason` set so the caller can decide whether
 * to skip-without-error or to surface the problem.
 */
export async function extractCookies(profileDir: string): Promise<ExtractResult> {
  if (process.platform !== 'win32') {
    return { cookies: [], totalRows: 0, decrypted: 0, skipped: 0, reason: 'NOT_WINDOWS' };
  }

  const cookiesFile = findCookiesFile(profileDir);
  if (!cookiesFile) {
    return { cookies: [], totalRows: 0, decrypted: 0, skipped: 0, reason: 'NO_COOKIES_FILE' };
  }

  let key: Buffer;
  try {
    key = await getMasterKey(profileDir);
  } catch (err) {
    return {
      cookies: [], totalRows: 0, decrypted: 0, skipped: 0,
      reason: 'KEY_FAILED: ' + (err as Error).message,
    };
  }

  // Snapshot to avoid touching the live DB / racing with the running browser.
  const snap = snapshotFile(cookiesFile);
  if (!snap) {
    return { cookies: [], totalRows: 0, decrypted: 0, skipped: 0, reason: 'SNAPSHOT_FAILED' };
  }

  try {
    const sql = await ensureSql();
    const buf = readFileSync(snap);
    const db = new sql.Database(new Uint8Array(buf));
    try {
      const stmt = db.prepare(
        `SELECT host_key, name, encrypted_value, value, path, expires_utc,
                is_secure, is_httponly, has_expires, is_persistent, samesite
         FROM cookies`,
      );
      const out: BrowserCookie[] = [];
      let total = 0;
      let decrypted = 0;
      let skipped = 0;
      while (stmt.step()) {
        total++;
        const row = stmt.getAsObject() as unknown as CookieRow;

        // Prefer encrypted_value, fall back to legacy plaintext `value`.
        let plainValue: string | null = null;
        const enc = row.encrypted_value;
        const hostKey = String(row.host_key ?? '');
        if (enc && (enc as Uint8Array).length > 0) {
          plainValue = decryptCookieValue(Buffer.from(enc as Uint8Array), key, hostKey);
        } else if (typeof row.value === 'string' && row.value.length > 0) {
          plainValue = row.value;
        } else {
          plainValue = '';
        }

        if (plainValue === null) {
          skipped++;
          continue;
        }
        decrypted++;

        const c: BrowserCookie = {
          name: String(row.name ?? ''),
          value: plainValue,
          domain: String(row.host_key ?? ''),
          path: String(row.path ?? '/') || '/',
        };
        if (row.is_secure) c.secure = true;
        if (row.is_httponly) c.httpOnly = true;
        const ss = chromeSameSiteToString(Number(row.samesite));
        if (ss) c.sameSite = ss;
        if (row.has_expires && row.is_persistent) {
          const exp = chromeTimeToUnixSeconds(Number(row.expires_utc));
          if (typeof exp === 'number') c.expires = exp;
        }
        if (!c.name || !c.domain) continue;
        out.push(c);
      }
      stmt.free();
      db.close();

      return { cookies: out, totalRows: total, decrypted, skipped };
    } finally {
      try { db.close(); } catch { /* already closed */ }
    }
  } catch (err) {
    return {
      cookies: [], totalRows: 0, decrypted: 0, skipped: 0,
      reason: 'SQL_FAILED: ' + (err as Error).message,
    };
  } finally {
    // Clean up snapshot dir.
    try {
      const snapDir = path.dirname(snap);
      rmSync(snapDir, { recursive: true, force: true });
    } catch { /* non-fatal */ }
  }
}
