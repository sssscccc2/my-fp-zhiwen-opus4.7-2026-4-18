/**
 * Reddit-specific login state probe.
 *
 * Reddit's *login* state lives in a small set of HttpOnly cookies under
 * .reddit.com / www.reddit.com:
 *   - reddit_session   (classic session id; legacy old.reddit.com)
 *   - token_v2         (JWT used by new reddit & app)
 *   - loid             (long-lived ID; doesn't by itself imply logged-in)
 *   - session_tracker
 *   - sec-gcl-au       (server-side login indicator)
 *
 * Cookies like `g_state`, `eu_cookie`, `csv`, `edgebucket` are anonymous
 * Google-One-Tap / consent / a/b-test markers and do NOT mean logged in.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const initSqlJs = require('sql.js');

const ROOTS = [
  process.env.APPDATA + '\\tianhu6jin\\profiles',
  path.join(__dirname, '..', 'data', 'profiles'),
];

// Cookies that, when present + non-empty, indicate an authenticated session.
const LOGIN_COOKIES = new Set([
  'reddit_session',
  'token_v2',
  'session_tracker',
  '_authentik_session',
  // Reddit also sometimes uses these for sustained login:
  'session',
  'logged_in',
]);
const SUPPORTING_COOKIES = new Set([
  'loid',           // long-lived account-id; alone doesn't = login
  'edgebucket',
  'csv',
  'eu_cookie',
  'g_state',
]);

function dpapiUnprotect(blob) {
  return new Promise((resolve, reject) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Security',
      '$inB64 = [Console]::In.ReadToEnd().Trim()',
      '$enc = [Convert]::FromBase64String($inB64)',
      '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::Out.Write([Convert]::ToBase64String($plain))',
    ].join('; ');
    const ps = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', script], { windowsHide: true });
    const out = []; const err = [];
    ps.stdout.on('data', c => out.push(c));
    ps.stderr.on('data', c => err.push(c));
    ps.on('close', code => {
      if (code !== 0) return reject(new Error(`DPAPI failed: ${Buffer.concat(err).toString().slice(0, 200)}`));
      resolve(Buffer.from(Buffer.concat(out).toString().trim(), 'base64'));
    });
    ps.on('error', reject);
    ps.stdin.end(blob.toString('base64'));
  });
}

async function getMasterKey(profileDir) {
  const json = JSON.parse(fs.readFileSync(path.join(profileDir, 'Local State'), 'utf-8'));
  const wrapped = Buffer.from(json.os_crypt.encrypted_key, 'base64');
  return await dpapiUnprotect(wrapped.subarray(5));
}

function decrypt(blob, key, hostKey) {
  if (!blob || blob.length === 0) return '';
  const prefix = blob.subarray(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v11') return null;
  if (blob.length < 3 + 12 + 16) return null;
  const nonce = blob.subarray(3, 15);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(15, blob.length - 16);
  let plain;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    plain = Buffer.concat([d.update(ciphertext), d.final()]);
  } catch { return null; }
  if (hostKey && plain.length >= 32) {
    const h = crypto.createHash('sha256').update(hostKey, 'utf-8').digest();
    if (plain.subarray(0, 32).equals(h)) plain = plain.subarray(32);
  }
  return plain.toString('utf-8');
}

function fmtExpiry(utc) {
  if (!utc) return 'session';
  // Chromium time -> Unix
  const ms = (utc - 11644473600000000) / 1000;
  if (ms <= 0) return 'session';
  const d = new Date(ms);
  return d.toISOString().split('.')[0];
}

(async () => {
  const sql = await initSqlJs({ locateFile: f => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });

  const profileDirs = [];
  for (const r of ROOTS) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const full = path.join(r, d);
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'Local State'))) profileDirs.push(full);
    }
  }

  // Try to also pick up a profile name if the SQLite DB has it
  const dbPath = path.join(process.env.APPDATA, 'tianhu6jin', 'data', 'fingerprint-browser.db');
  let nameById = new Map();
  if (fs.existsSync(dbPath)) {
    try {
      const db = new sql.Database(new Uint8Array(fs.readFileSync(dbPath)));
      const st = db.prepare('SELECT id, name FROM profiles');
      while (st.step()) {
        const r = st.getAsObject();
        nameById.set(r.id, r.name);
      }
      st.free(); db.close();
    } catch {}
  }

  for (const pdir of profileDirs) {
    const id = path.basename(pdir);
    const name = nameById.get(id) || '(unknown)';
    console.log(`\n=== Profile "${name}" (${id.slice(0, 8)}) ===`);

    let key;
    try { key = await getMasterKey(pdir); }
    catch (e) { console.log('  master key failed:', e.message); continue; }

    const cookiesFile = [
      path.join(pdir, 'Default', 'Network', 'Cookies'),
      path.join(pdir, 'Default', 'Cookies'),
    ].find(p => fs.existsSync(p));
    if (!cookiesFile) { console.log('  no Cookies file'); continue; }

    const tmp = path.join(os.tmpdir(), 'fp-test-' + Date.now());
    fs.mkdirSync(tmp);
    const dst = path.join(tmp, 'Cookies');
    fs.copyFileSync(cookiesFile, dst);

    const db = new sql.Database(new Uint8Array(fs.readFileSync(dst)));
    const stmt = db.prepare(`SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
                             FROM cookies WHERE host_key LIKE '%reddit%' ORDER BY name`);

    const all = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const plain = decrypt(Buffer.from(row.encrypted_value || []), key, String(row.host_key || ''));
      all.push({
        host: String(row.host_key),
        name: String(row.name),
        value: plain,
        path: String(row.path),
        expires: row.expires_utc,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
        samesite: row.samesite,
      });
    }
    stmt.free(); db.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    if (all.length === 0) {
      console.log('  (no reddit cookies at all — never visited reddit)');
      continue;
    }

    console.log(`  reddit cookies found: ${all.length}\n`);
    console.log('  ' + 'name'.padEnd(28) + 'host'.padEnd(18) + 'flags'.padEnd(15) + 'expires'.padEnd(22) + 'value (len)');
    console.log('  ' + '-'.repeat(110));
    let loginIndicators = 0;
    for (const c of all) {
      const flags = (c.secure ? 'S' : '-') + (c.httpOnly ? 'H' : '-');
      const isLogin = LOGIN_COOKIES.has(c.name);
      const isSupporting = SUPPORTING_COOKIES.has(c.name);
      const tag = isLogin ? '🔑' : isSupporting ? '  ' : '  ';
      const vlen = c.value === null ? 'DECRYPT_FAIL' : `${c.value.length}: ${(c.value || '').slice(0, 30).replace(/[\n\r\t]/g, '?')}`;
      console.log(`  ${tag} ${c.name.padEnd(26)}${c.host.padEnd(18)}${flags.padEnd(15)}${fmtExpiry(c.expires).padEnd(22)}${vlen}`);
      if (isLogin && c.value && c.value.length > 0) loginIndicators++;
    }

    console.log('');
    if (loginIndicators > 0) {
      console.log(`  ✅ LOGGED IN — found ${loginIndicators} authenticated-session cookie(s)`);
    } else {
      console.log(`  ❌ NOT LOGGED IN — no reddit_session / token_v2 / session_tracker cookie present`);
      console.log(`     (cookies like g_state / eu_cookie are anonymous Google-OneTap & consent markers)`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
