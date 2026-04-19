/**
 * Standalone cookie extraction sanity check. Loads the SAME logic that
 * sync uses (DPAPI master key + AES-GCM + SHA256 host_key prefix strip),
 * runs it on every local profile dir, and prints per-domain stats so you
 * can see whether cookies decoded into legit plaintext.
 *
 * Run from project root:  node scripts/test-cookie-extract.cjs
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
      if (code !== 0) return reject(new Error(`DPAPI failed (${code}): ${Buffer.concat(err).toString().slice(0, 200)}`));
      resolve(Buffer.from(Buffer.concat(out).toString().trim(), 'base64'));
    });
    ps.on('error', reject);
    ps.stdin.end(blob.toString('base64'));
  });
}

async function getMasterKey(profileDir) {
  const lsPath = path.join(profileDir, 'Local State');
  if (!fs.existsSync(lsPath)) throw new Error('NO_LOCAL_STATE');
  const json = JSON.parse(fs.readFileSync(lsPath, 'utf-8'));
  const enc = json.os_crypt && json.os_crypt.encrypted_key;
  if (!enc) throw new Error('NO_ENCRYPTED_KEY');
  const wrapped = Buffer.from(enc, 'base64');
  if (wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI') throw new Error('UNKNOWN_KEY_PREFIX');
  return await dpapiUnprotect(wrapped.subarray(5));
}

function decrypt(blob, key, hostKey) {
  if (!blob || blob.length === 0) return '';
  const prefix = blob.subarray(0, 3).toString('ascii');
  if (prefix !== 'v10' && prefix !== 'v11') {
    if (prefix === 'v20') return null;
    return null;
  }
  if (blob.length < 3 + 12 + 16) return null;
  const nonce = blob.subarray(3, 15);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(15, blob.length - 16);
  let plain;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    plain = Buffer.concat([d.update(ciphertext), d.final()]);
  } catch (e) {
    return null;
  }
  if (hostKey && plain.length >= 32) {
    const h = crypto.createHash('sha256').update(hostKey, 'utf-8').digest();
    if (plain.subarray(0, 32).equals(h)) plain = plain.subarray(32);
  }
  return plain.toString('utf-8');
}

function isPrintable(s) {
  if (!s) return true;
  let bad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) bad++;
    else if (c === 0xfffd) bad++;
  }
  return bad / s.length < 0.05;
}

(async () => {
  const sql = await initSqlJs({ locateFile: f => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });

  let profileDirs = [];
  for (const r of ROOTS) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const full = path.join(r, d);
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'Local State'))) {
        profileDirs.push(full);
      }
    }
  }

  console.log(`Found ${profileDirs.length} profile dir(s)\n`);

  for (const pdir of profileDirs) {
    console.log(`\n========== ${pdir} ==========`);
    let key;
    try { key = await getMasterKey(pdir); }
    catch (e) { console.log(`  master key FAILED: ${e.message}`); continue; }
    console.log(`  master key: ${key.length} bytes ✓`);

    const cookiesFile = [
      path.join(pdir, 'Default', 'Network', 'Cookies'),
      path.join(pdir, 'Default', 'Cookies'),
    ].find(p => fs.existsSync(p));
    if (!cookiesFile) { console.log('  no Cookies file'); continue; }

    const tmp = path.join(os.tmpdir(), 'fp-test-' + Date.now());
    fs.mkdirSync(tmp);
    const dst = path.join(tmp, 'Cookies');
    fs.copyFileSync(cookiesFile, dst);

    const buf = fs.readFileSync(dst);
    const db = new sql.Database(new Uint8Array(buf));
    const stmt = db.prepare('SELECT host_key, name, encrypted_value FROM cookies');

    const byDomain = new Map(); // domain -> { ok, fail, samples: [{name, val}] }
    let total = 0, ok = 0, fail = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      total++;
      const hk = String(row.host_key || '');
      const ev = row.encrypted_value;
      const plain = (ev && ev.length > 0) ? decrypt(Buffer.from(ev), key, hk) : '';
      const dom = hk.replace(/^\./, '') || '(blank)';
      let entry = byDomain.get(dom);
      if (!entry) { entry = { ok: 0, fail: 0, garbled: 0, samples: [] }; byDomain.set(dom, entry); }
      if (plain === null) { entry.fail++; fail++; }
      else {
        ok++;
        const printable = isPrintable(plain);
        if (!printable) entry.garbled++;
        else entry.ok++;
        if (entry.samples.length < 2) entry.samples.push({ name: String(row.name || ''), val: plain.slice(0, 60), printable });
      }
    }
    stmt.free();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`  total: ${total}, decrypted ok: ${ok}, decrypt fail: ${fail}\n`);
    const sortedDomains = [...byDomain.entries()].sort((a,b) => (b[1].ok+b[1].garbled)-(a[1].ok+a[1].garbled));
    for (const [dom, st] of sortedDomains.slice(0, 30)) {
      const flag = st.garbled > 0 ? '❌' : st.fail > 0 ? '⚠️' : '✓';
      console.log(`  ${flag} ${dom.padEnd(35)} ok=${st.ok} garbled=${st.garbled} fail=${st.fail}`);
      for (const s of st.samples) {
        const tag = s.printable ? '   plain' : '   GARBLED';
        console.log(`         ${tag}: ${s.name.padEnd(24)} = ${JSON.stringify(s.val)}`);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
