
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const DATA_DIR = '/opt/fp-browser-auth';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SINGBOX_BIN = '/usr/local/bin/sing-box';
const RELAY_DIR = path.join(DATA_DIR, 'relays');
const SYNC_DIR = path.join(DATA_DIR, 'sync-data');
const PORT = 3000;

// 2026-04-19: cloud sync limits — keep these in lockstep with shared/syncTypes.ts
const SYNC_QUOTA_BYTES = 500 * 1024 * 1024;        // 500 MB / user hard cap
const SYNC_MAX_FILE_BYTES = 50 * 1024 * 1024;      // 50 MB / single file
const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;        // 5 MB cap on the metadata JSON itself
const MANIFEST_MAX_BYTES = 5 * 1024 * 1024;

const activeRelays = new Map();

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([
      { username: 'sunchao', password: hashPwd('sunchao250'), role: 'admin', enabled: true, createdAt: Date.now() }
    ], null, 2));
  }
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]');
}

function loadUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function loadSessions() { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')); } catch { return []; } }
function saveSessions(s) { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2)); }
function hashPwd(p) { return crypto.createHash('sha256').update(p).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function parseBody(req, maxBytes = 8 * 1024 * 1024) {
  // 2026-04-19: bumped from 1 MB → 8 MB so cloud-sync snapshots / manifests
  // (capped at 5 MB each on the route layer) fit comfortably.
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > maxBytes) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

function cleanExpired() {
  const s = loadSessions();
  const now = Date.now();
  const valid = s.filter(x => x.expiresAt > now);
  if (valid.length !== s.length) saveSessions(valid);
  return valid;
}

function getSessionUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const sessions = cleanExpired();
  return sessions.find(s => s.token === token) || null;
}

ensureFiles();

// Ensure admin exists
const users = loadUsers();
const hasAdmin = users.find(u => u.username === 'sunchao');
if (!hasAdmin) {
  users.push({ username: 'sunchao', password: hashPwd('sunchao250'), role: 'admin', enabled: true, createdAt: Date.now() });
  saveUsers(users);
}

// --- Relay Management (lightweight built-in SOCKS5 chain) ---
fs.mkdirSync(RELAY_DIR, { recursive: true });

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '0.0.0.0', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function connectUpstreamSocks5(targetHost, targetPort, upHost, upPort, upUser, upPass) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(upPort, upHost, () => {
      const methods = upUser ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      sock.write(methods);
    });
    sock.setTimeout(15000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('upstream timeout')); });
    sock.on('error', reject);
    let phase = 'greeting';
    sock.on('data', function handler(data) {
      if (phase === 'greeting') {
        if (data[0] !== 0x05) { sock.destroy(); return reject(new Error('bad socks version')); }
        if (data[1] === 0x02 && upUser) {
          phase = 'auth';
          const uBuf = Buffer.from(upUser, 'utf8');
          const pBuf = Buffer.from(upPass || '', 'utf8');
          const auth = Buffer.alloc(3 + uBuf.length + pBuf.length);
          auth[0] = 0x01; auth[1] = uBuf.length; uBuf.copy(auth, 2);
          auth[2 + uBuf.length] = pBuf.length; pBuf.copy(auth, 3 + uBuf.length);
          sock.write(auth);
        } else if (data[1] === 0x00) {
          phase = 'connect';
          sendConnect();
        } else { sock.destroy(); return reject(new Error('auth method rejected')); }
      } else if (phase === 'auth') {
        if (data[1] !== 0x00) { sock.destroy(); return reject(new Error('auth failed')); }
        phase = 'connect';
        sendConnect();
      } else if (phase === 'connect') {
        if (data[1] !== 0x00) { sock.destroy(); return reject(new Error('connect failed: ' + data[1])); }
        sock.removeListener('data', handler);
        sock.setTimeout(0);
        resolve(sock);
      }
    });
    function sendConnect() {
      const hostBuf = Buffer.from(targetHost, 'utf8');
      const req = Buffer.alloc(7 + hostBuf.length);
      req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
      req[4] = hostBuf.length; hostBuf.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + hostBuf.length);
      sock.write(req);
    }
  });
}

function createSocks5ChainServer(node) {
  const upHost = node.server;
  const upPort = node.server_port;
  const upUser = node.username || '';
  const upPass = node.password || '';

  const server = net.createServer(client => {
    client.once('data', greeting => {
      if (greeting[0] !== 0x05) { client.destroy(); return; }
      client.write(Buffer.from([0x05, 0x00]));
      client.once('data', request => {
        if (request[1] !== 0x01) {
          client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]));
          client.destroy(); return;
        }
        let targetHost, targetPort, addrEnd;
        if (request[3] === 0x01) {
          targetHost = request[4]+'.'+request[5]+'.'+request[6]+'.'+request[7];
          addrEnd = 8;
        } else if (request[3] === 0x03) {
          const len = request[4];
          targetHost = request.slice(5, 5+len).toString('utf8');
          addrEnd = 5 + len;
        } else if (request[3] === 0x04) {
          const parts = [];
          for (let i = 0; i < 16; i += 2) parts.push(request.readUInt16BE(4+i).toString(16));
          targetHost = parts.join(':');
          addrEnd = 20;
        } else { client.destroy(); return; }
        targetPort = request.readUInt16BE(addrEnd);

        connectUpstreamSocks5(targetHost, targetPort, upHost, upPort, upUser, upPass)
          .then(upstream => {
            const reply = Buffer.from([0x05,0x00,0x00,0x01, 0,0,0,0, 0,0]);
            client.write(reply);
            client.pipe(upstream);
            upstream.pipe(client);
            client.on('error', () => upstream.destroy());
            upstream.on('error', () => client.destroy());
            client.on('close', () => upstream.destroy());
            upstream.on('close', () => client.destroy());
          })
          .catch(() => {
            client.write(Buffer.from([0x05,0x05,0x00,0x01, 0,0,0,0, 0,0]));
            client.destroy();
          });
      });
    });
    client.on('error', () => {});
  });
  return server;
}

function buildSingboxRelayConfig(node, localPort) {
  const outbound = { tag: 'proxy', type: node.type, server: node.server, server_port: node.server_port };
  if (node.type === 'vmess') {
    outbound.uuid = node.uuid; outbound.alter_id = node.alter_id || 0; outbound.security = node.security || 'auto';
  } else if (node.type === 'vless') {
    outbound.uuid = node.uuid; outbound.flow = node.flow || '';
  } else if (node.type === 'shadowsocks') {
    outbound.method = node.method; outbound.password = node.password;
  } else if (node.type === 'trojan') {
    outbound.password = node.password;
  }
  if (node.tls && node.tls.enabled) {
    outbound.tls = { enabled: true, server_name: node.tls.server_name || node.server, insecure: false };
    if (node.tls.reality && node.tls.reality.enabled) {
      outbound.tls.reality = { enabled: true, public_key: node.tls.reality.public_key, short_id: node.tls.reality.short_id };
    }
  }
  if (node.transport) outbound.transport = { ...node.transport };
  return {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'socks', tag: 'socks-in', listen: '0.0.0.0', listen_port: localPort }],
    outbounds: [outbound, { type: 'direct', tag: 'direct' }]
  };
}

async function startRelay(relayId, node) {
  await stopRelay(relayId);
  const port = await findFreePort();

  if (node.type === 'socks' || node.type === 'http') {
    const tcpServer = createSocks5ChainServer(node);
    await new Promise((resolve, reject) => {
      tcpServer.on('error', reject);
      tcpServer.listen(port, '0.0.0.0', () => resolve());
    });
    activeRelays.set(relayId, { type: 'builtin', server: tcpServer, port });
    console.log('[Relay] Built-in SOCKS5 chain on port ' + port + ' for ' + relayId);
    return port;
  }

  const config = buildSingboxRelayConfig(node, port);
  const configPath = path.join(RELAY_DIR, relayId + '.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  const child = spawn(SINGBOX_BIN, ['run', '-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let started = false;
  return new Promise((resolve, reject) => {
    const onData = d => { const t = d.toString(); if (!started && (t.includes('started') || t.includes('socks-in'))) { started = true; activeRelays.set(relayId, { type: 'singbox', process: child, port, configPath }); resolve(port); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', e => { if (!started) reject(e); });
    child.on('exit', code => { activeRelays.delete(relayId); if (!started) reject(new Error('sing-box exited: ' + code)); });
    setTimeout(() => { if (!started && child.exitCode === null) { started = true; activeRelays.set(relayId, { type: 'singbox', process: child, port, configPath }); resolve(port); } }, 3000);
  });
}

async function stopRelay(relayId) {
  const entry = activeRelays.get(relayId);
  if (!entry) return;
  if (entry.type === 'builtin') {
    try { entry.server.close(); } catch {}
  } else {
    try { entry.process.kill(); } catch {}
    try { if (fs.existsSync(entry.configPath)) fs.unlinkSync(entry.configPath); } catch {}
  }
  activeRelays.delete(relayId);
}

// ---- Cloud sync storage helpers ----
fs.mkdirSync(SYNC_DIR, { recursive: true });

function safeUserDir(username) {
  // Defense-in-depth: prevent path traversal even though the auth layer
  // already validates usernames as [a-zA-Z0-9_-]+.
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error('invalid username');
  return path.join(SYNC_DIR, username);
}
function ensureUserSyncDir(username) {
  const dir = safeUserDir(username);
  fs.mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
  return dir;
}
function snapshotPath(username) { return path.join(safeUserDir(username), 'snapshot.json'); }
function manifestPath(username, profileId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('invalid profileId');
  return path.join(safeUserDir(username), 'manifests', profileId + '.json');
}
function blobPathFor(username, sha) {
  const sub = sha.slice(0, 2);
  return path.join(safeUserDir(username), 'blobs', sub, sha);
}
function blobExists(username, sha) {
  try { return fs.statSync(blobPathFor(username, sha)).isFile(); } catch { return false; }
}
function readSnapshot(username) {
  try {
    const t = fs.readFileSync(snapshotPath(username), 'utf-8');
    return JSON.parse(t);
  } catch { return null; }
}
function readManifest(username, profileId) {
  try {
    const t = fs.readFileSync(manifestPath(username, profileId), 'utf-8');
    return JSON.parse(t);
  } catch { return null; }
}
function writeFileAtomic(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, p);
}
function listManifests(username) {
  const dir = path.join(safeUserDir(username), 'manifests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
}
function computeQuota(username) {
  const dir = path.join(safeUserDir(username), 'blobs');
  let used = 0, blobs = 0;
  if (fs.existsSync(dir)) {
    for (const sub of fs.readdirSync(dir)) {
      const subDir = path.join(dir, sub);
      if (!fs.statSync(subDir).isDirectory()) continue;
      for (const f of fs.readdirSync(subDir)) {
        try {
          const st = fs.statSync(path.join(subDir, f));
          if (st.isFile()) { used += st.size; blobs++; }
        } catch {}
      }
    }
  }
  return { used, limit: SYNC_QUOTA_BYTES, blobs };
}
function gcOrphans(username) {
  // Delete any blob no longer referenced by any manifest, and any manifest
  // not listed in the snapshot.
  const snap = readSnapshot(username);
  const liveProfileIds = new Set((snap?.profiles || []).map(p => p.profile?.id).filter(Boolean));
  const dir = safeUserDir(username);
  const manifestsDir = path.join(dir, 'manifests');
  if (fs.existsSync(manifestsDir)) {
    for (const f of fs.readdirSync(manifestsDir)) {
      if (!f.endsWith('.json')) continue;
      const pid = f.slice(0, -5);
      if (!liveProfileIds.has(pid)) {
        try { fs.unlinkSync(path.join(manifestsDir, f)); } catch {}
      }
    }
  }
  // Now collect every sha referenced by any *surviving* manifest.
  const live = new Set();
  for (const m of listManifests(username)) {
    for (const f of m.files || []) if (f && f.sha256) live.add(f.sha256);
  }
  const blobsDir = path.join(dir, 'blobs');
  if (!fs.existsSync(blobsDir)) return;
  let removed = 0;
  for (const sub of fs.readdirSync(blobsDir)) {
    const subDir = path.join(blobsDir, sub);
    if (!fs.statSync(subDir).isDirectory()) continue;
    for (const f of fs.readdirSync(subDir)) {
      if (!live.has(f)) {
        try { fs.unlinkSync(path.join(subDir, f)); removed++; } catch {}
      }
    }
  }
  if (removed > 0) console.log(`[sync] gc removed ${removed} orphan blobs for ${username}`);
}
function transferProfile(fromUser, toUser, profileId) {
  // Move the manifest + the snapshot entry from fromUser to toUser.
  // Blobs are *copied* (we don't mess with the source user's references).
  const srcSnap = readSnapshot(fromUser);
  if (!srcSnap) throw new Error('源用户没有同步记录');
  const idx = (srcSnap.profiles || []).findIndex(p => p.profile?.id === profileId);
  if (idx < 0) throw new Error('源用户中找不到该窗口');
  const entry = srcSnap.profiles.splice(idx, 1)[0];

  // Source-side proxy: copy if referenced and not already in dest.
  const dstSnap = readSnapshot(toUser) || { schemaVersion: 1, username: toUser, uploadedAt: 0, profiles: [], groups: [], proxies: [] };
  if (entry.profile?.proxyId) {
    const px = (srcSnap.proxies || []).find(p => p.id === entry.profile.proxyId);
    if (px && !(dstSnap.proxies || []).find(p => p.id === px.id)) {
      dstSnap.proxies = [...(dstSnap.proxies || []), px];
    }
  }
  // Group: copy if referenced and not already in dest.
  if (entry.profile?.groupId) {
    const gp = (srcSnap.groups || []).find(g => g.id === entry.profile.groupId);
    if (gp && !(dstSnap.groups || []).find(g => g.id === gp.id)) {
      dstSnap.groups = [...(dstSnap.groups || []), gp];
    }
  }

  ensureUserSyncDir(toUser);

  // Move manifest file.
  const srcManifest = manifestPath(fromUser, profileId);
  const dstManifest = manifestPath(toUser, profileId);
  let copiedFiles = 0;
  if (fs.existsSync(srcManifest)) {
    const m = JSON.parse(fs.readFileSync(srcManifest, 'utf-8'));
    // Copy referenced blobs to destination (dedup by hash within destination).
    for (const f of m.files || []) {
      if (!f || !f.sha256) continue;
      const src = blobPathFor(fromUser, f.sha256);
      const dst = blobPathFor(toUser, f.sha256);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copiedFiles++;
      }
    }
    fs.copyFileSync(srcManifest, dstManifest);
    fs.unlinkSync(srcManifest);
  }

  // Add to destination snapshot, write both back.
  dstSnap.profiles.push(entry);
  dstSnap.uploadedAt = Date.now();
  writeFileAtomic(snapshotPath(toUser), JSON.stringify(dstSnap));

  srcSnap.uploadedAt = Date.now();
  writeFileAtomic(snapshotPath(fromUser), JSON.stringify(srcSnap));

  // GC source user's now-orphaned blobs.
  gcOrphans(fromUser);

  return {
    transferred: profileId,
    fromUser, toUser,
    copiedBlobs: copiedFiles,
    fromQuota: computeQuota(fromUser),
    toQuota: computeQuota(toUser),
  };
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理后台 - 天道酬勤麻将机</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#0f0f11;color:#e8e8ed;min-height:100vh}
.container{max-width:900px;margin:0 auto;padding:24px}
.header{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid #333340;margin-bottom:24px}
.header h1{font-size:20px;font-weight:600}
.header-right{display:flex;gap:8px;align-items:center}
.user-badge{font-size:13px;color:#9898a8;padding:6px 12px;background:#22222a;border-radius:8px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.btn-primary{background:#6366f1;color:#fff}.btn-primary:hover{background:#818cf8}
.btn-danger{background:transparent;color:#ef4444;border:1px solid #ef4444}.btn-danger:hover{background:#ef4444;color:#fff}
.btn-success{background:transparent;color:#22c55e;border:1px solid #22c55e}.btn-success:hover{background:#22c55e;color:#fff}
.btn-sm{padding:5px 10px;font-size:12px}
.btn-ghost{background:transparent;color:#9898a8;border:1px solid #333340}.btn-ghost:hover{background:#22222a;color:#e8e8ed}

.login-panel{max-width:400px;margin:80px auto;background:#1a1a1f;border:1px solid #333340;border-radius:16px;padding:40px 32px}
.login-panel h2{text-align:center;margin-bottom:24px;font-size:18px}
.form-group{margin-bottom:16px}
.form-label{display:block;font-size:13px;color:#9898a8;margin-bottom:6px}
.form-input{width:100%;padding:10px 14px;background:#22222a;border:1px solid #333340;border-radius:8px;color:#e8e8ed;font-size:14px;font-family:inherit;outline:none;transition:border-color .15s}
.form-input:focus{border-color:#6366f1}
.error{color:#ef4444;font-size:13px;margin-top:8px;display:none}
.error.show{display:block}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}
.stat-card{background:#1a1a1f;border:1px solid #333340;border-radius:12px;padding:20px;text-align:center}
.stat-num{font-size:28px;font-weight:700;color:#6366f1}
.stat-label{font-size:12px;color:#9898a8;margin-top:4px}

.table{width:100%;border-collapse:collapse;background:#1a1a1f;border-radius:12px;overflow:hidden;border:1px solid #333340}
.table th,.table td{padding:12px 16px;text-align:left;border-bottom:1px solid #333340}
.table th{background:#22222a;font-size:12px;color:#9898a8;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.table td{font-size:13px}
.table tr:last-child td{border-bottom:none}
.table tr:hover td{background:#22222a}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500}
.tag-admin{background:#1e3a5f;color:#60a5fa}
.tag-user{background:#1a3a2a;color:#6ee7b7}
.tag-enabled{background:#1a3a2a;color:#6ee7b7}
.tag-disabled{background:#3a1a1a;color:#f87171}
.tag-online{background:#1a3a2a;color:#6ee7b7}
.tag-offline{background:#22222a;color:#666}
.actions{display:flex;gap:4px}

.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center}
.modal-overlay.active{display:flex}
.modal{background:#1a1a1f;border:1px solid #333340;border-radius:14px;width:400px;padding:24px}
.modal h3{margin-bottom:16px;font-size:16px}
.modal .form-group:last-of-type{margin-bottom:20px}
.modal-actions{display:flex;gap:8px;justify-content:flex-end}

.tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #333340}
.tab-btn{padding:10px 18px;background:transparent;border:none;color:#9898a8;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;transition:all .15s}
.tab-btn:hover{color:#e8e8ed}
.tab-btn.active{color:#6366f1;border-bottom-color:#6366f1;font-weight:600}
.tab-pane{display:none}
.tab-pane.active{display:block}
.size-bar{display:inline-block;width:80px;height:6px;background:#333340;border-radius:3px;margin-right:8px;vertical-align:middle;overflow:hidden}
.size-bar-fill{display:block;height:100%;background:#6366f1}
.toast-box{position:fixed;bottom:24px;right:24px;z-index:2000}
.toast{padding:12px 20px;border-radius:8px;font-size:13px;margin-top:8px;animation:slideUp .2s}
.toast-ok{background:#065f46;color:#d1fae5}
.toast-err{background:#7f1d1d;color:#fecaca}
@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>

<div id="app-login" class="login-panel" style="display:none">
  <h2>&#128274; 管理员登录</h2>
  <div class="form-group">
    <label class="form-label">用户名</label>
    <input class="form-input" id="login-user" placeholder="管理员用户名" autofocus>
  </div>
  <div class="form-group">
    <label class="form-label">密码</label>
    <input class="form-input" id="login-pass" type="password" placeholder="密码">
  </div>
  <button class="btn btn-primary" style="width:100%" id="btn-login">登 录</button>
  <div class="error" id="login-error"></div>
</div>

<div id="app-main" style="display:none">
  <div class="container">
    <div class="header">
      <h1>&#128736; 用户管理后台</h1>
      <div class="header-right">
        <span class="user-badge" id="admin-name"></span>
        <button class="btn btn-ghost btn-sm" id="btn-logout">退出</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card"><div class="stat-num" id="stat-total">0</div><div class="stat-label">总用户数</div></div>
      <div class="stat-card"><div class="stat-num" id="stat-active">0</div><div class="stat-label">已启用</div></div>
      <div class="stat-card"><div class="stat-num" id="stat-online">0</div><div class="stat-label">在线</div></div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="users">用户管理</button>
      <button class="tab-btn" data-tab="windows">窗口管理</button>
    </div>

    <div class="tab-pane active" id="tab-users">
      <table class="table">
        <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>在线</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody id="user-tbody"></tbody>
      </table>
    </div>

    <div class="tab-pane" id="tab-windows">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;color:#9898a8">所有用户已同步到云端的窗口（按用户分组，可转移到其他用户）</div>
        <button class="btn btn-ghost btn-sm" id="btn-refresh-windows">刷新</button>
      </div>
      <table class="table">
        <thead><tr><th>用户</th><th>窗口名称</th><th>分组</th><th>大小</th><th>最后同步</th><th>操作</th></tr></thead>
        <tbody id="window-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-reset">
  <div class="modal">
    <h3>重置密码</h3>
    <div class="form-group">
      <label class="form-label">用户: <strong id="reset-username"></strong></label>
    </div>
    <div class="form-group">
      <label class="form-label">新密码</label>
      <input class="form-input" id="reset-pass" type="password" placeholder="输入新密码">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="$('#modal-reset').classList.remove('active')">取消</button>
      <button class="btn btn-primary btn-sm" id="btn-do-reset">确认重置</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="modal-transfer">
  <div class="modal">
    <h3>转移窗口到其他用户</h3>
    <div class="form-group">
      <label class="form-label">窗口: <strong id="transfer-name"></strong></label>
    </div>
    <div class="form-group">
      <label class="form-label">来源用户: <strong id="transfer-from"></strong></label>
    </div>
    <div class="form-group">
      <label class="form-label">目标用户</label>
      <select class="form-input" id="transfer-to"></select>
    </div>
    <div style="font-size:12px;color:#f59e0b;margin-bottom:16px">
      转移后该窗口会从来源用户的列表中移除，下次目标用户同步时会拉取到。
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="$('#modal-transfer').classList.remove('active')">取消</button>
      <button class="btn btn-primary btn-sm" id="btn-do-transfer">确认转移</button>
    </div>
  </div>
</div>

<div class="toast-box" id="toast-box"></div>

<script>
const $=s=>document.querySelector(s);
let TOKEN='';
let USERS=[];

function toast(msg,ok=true){
  const t=document.createElement('div');
  t.className='toast '+(ok?'toast-ok':'toast-err');
  t.textContent=msg;
  $('#toast-box').appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

async function api(url,body={},method='POST'){
  const h={'Content-Type':'application/json'};
  if(TOKEN)h['Authorization']='Bearer '+TOKEN;
  const r=await fetch(url,{method,headers:h,body:method==='GET'?undefined:JSON.stringify(body)});
  const d=await r.json();
  if(!r.ok)throw new Error(d.error||'请求失败');
  return d;
}

async function login(){
  const u=$('#login-user').value.trim();
  const p=$('#login-pass').value;
  if(!u||!p){$('#login-error').textContent='请填写用户名和密码';$('#login-error').classList.add('show');return}
  try{
    const d=await api('/api/login',{username:u,password:p});
    if(d.role!=='admin'){$('#login-error').textContent='此账号不是管理员';$('#login-error').classList.add('show');return}
    TOKEN=d.token;
    localStorage.setItem('admin_token',TOKEN);
    localStorage.setItem('admin_name',d.username);
    showMain(d.username);
  }catch(e){$('#login-error').textContent=e.message;$('#login-error').classList.add('show')}
}

function showMain(name){
  $('#app-login').style.display='none';
  $('#app-main').style.display='block';
  $('#admin-name').textContent='管理员: '+name;
  loadUsers();
}

async function loadUsers(){
  try{
    USERS=await api('/api/admin/users',{},'POST');
    renderUsers();
  }catch(e){toast(e.message,false)}
}

function renderUsers(){
  const total=USERS.length;
  const active=USERS.filter(u=>u.enabled).length;
  const online=USERS.filter(u=>u.online).length;
  $('#stat-total').textContent=total;
  $('#stat-active').textContent=active;
  $('#stat-online').textContent=online;

  $('#user-tbody').innerHTML=USERS.map(u=>{
    const date=u.createdAt?new Date(u.createdAt).toLocaleDateString('zh-CN'):'—';
    const isAdmin=u.role==='admin';
    return '<tr>'+
      '<td><strong>'+esc(u.username)+'</strong></td>'+
      '<td><span class="tag tag-'+(isAdmin?'admin':'user')+'">'+(isAdmin?'管理员':'用户')+'</span></td>'+
      '<td><span class="tag tag-'+(u.enabled?'enabled':'disabled')+'">'+(u.enabled?'已启用':'已禁用')+'</span></td>'+
      '<td><span class="tag tag-'+(u.online?'online':'offline')+'">'+(u.online?'在线':'离线')+'</span></td>'+
      '<td>'+date+'</td>'+
      '<td class="actions">'+
        (isAdmin?'':
          '<button class="btn btn-sm '+(u.enabled?'btn-danger':'btn-success')+'" onclick="toggleUser(\\''+esc(u.username)+'\\')">'+(u.enabled?'禁用':'启用')+'</button>'+
          '<button class="btn btn-ghost btn-sm" onclick="openReset(\\''+esc(u.username)+'\\')">重置密码</button>'+
          '<button class="btn btn-danger btn-sm" onclick="deleteUser(\\''+esc(u.username)+'\\')">删除</button>'
        )+
      '</td></tr>';
  }).join('');
}

async function toggleUser(username){
  try{await api('/api/admin/toggle',{username});toast(username+' 状态已切换');loadUsers()}catch(e){toast(e.message,false)}
}

async function deleteUser(username){
  if(!confirm('确定删除用户 '+username+'？'))return;
  try{await api('/api/admin/delete',{username});toast(username+' 已删除');loadUsers()}catch(e){toast(e.message,false)}
}

function openReset(username){
  $('#reset-username').textContent=username;
  $('#reset-pass').value='';
  $('#modal-reset').classList.add('active');
  $('#btn-do-reset').onclick=async()=>{
    const np=$('#reset-pass').value;
    if(!np||np.length<4){toast('密码至少4位',false);return}
    try{await api('/api/admin/reset-password',{username,newPassword:np});toast(username+' 密码已重置');$('#modal-reset').classList.remove('active')}catch(e){toast(e.message,false)}
  };
}

function esc(s){return s?s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"}[c])):''}

$('#btn-login').addEventListener('click',login);
$('#login-pass').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('#login-user').addEventListener('keydown',e=>{if(e.key==='Enter')$('#login-pass').focus()});
$('#btn-logout').addEventListener('click',()=>{TOKEN='';localStorage.clear();location.reload()});

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='windows') loadWindows();
  });
});
$('#btn-refresh-windows')?.addEventListener('click',loadWindows);

let WINDOWS=[];
function fmtBytes(n){
  if(n<1024) return n+' B';
  if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
  if(n<1024*1024*1024) return (n/1024/1024).toFixed(1)+' MB';
  return (n/1024/1024/1024).toFixed(2)+' GB';
}
function fmtTime(t){
  if(!t) return '—';
  const d=new Date(t),now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toTimeString().slice(0,5);
  return d.toLocaleDateString('zh-CN')+' '+d.toTimeString().slice(0,5);
}
async function loadWindows(){
  try{
    WINDOWS=await api('/api/sync/admin/list-windows',{},'POST');
    renderWindows();
  }catch(e){toast(e.message,false)}
}
function renderWindows(){
  const tb=$('#window-tbody');
  if(!WINDOWS.length){
    tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:#666;padding:40px">暂无任何用户上传过窗口</td></tr>';
    return;
  }
  // Group by user for visual block separation
  const sorted=[...WINDOWS].sort((a,b)=>{
    if(a.username!==b.username) return a.username.localeCompare(b.username);
    return (b.filesUploadedAt||0)-(a.filesUploadedAt||0);
  });
  tb.innerHTML=sorted.map(w=>{
    return '<tr>'+
      '<td><strong>'+esc(w.username)+'</strong></td>'+
      '<td>'+esc(w.profileName||'(未命名)')+'</td>'+
      '<td>'+esc(w.groupName||'未分组')+'</td>'+
      '<td>'+fmtBytes(w.filesBytes||0)+'</td>'+
      '<td>'+fmtTime(w.filesUploadedAt)+'</td>'+
      '<td class="actions">'+
        '<button class="btn btn-primary btn-sm" onclick="openTransfer(\\''+esc(w.username)+'\\',\\''+esc(w.profileId)+'\\',\\''+esc(w.profileName||'').replace(/'/g,"\\\\'")+'\\')">转移</button>'+
      '</td></tr>';
  }).join('');
}
function openTransfer(fromUser,profileId,name){
  $('#transfer-name').textContent=name||'(未命名)';
  $('#transfer-from').textContent=fromUser;
  const sel=$('#transfer-to');
  sel.innerHTML='<option value="">请选择目标用户...</option>'+
    USERS.filter(u=>u.username!==fromUser&&u.enabled).map(u=>'<option value="'+esc(u.username)+'">'+esc(u.username)+'</option>').join('');
  $('#modal-transfer').classList.add('active');
  $('#btn-do-transfer').onclick=async()=>{
    const to=sel.value;
    if(!to){toast('请选择目标用户',false);return}
    try{
      const r=await api('/api/sync/admin/transfer',{fromUser,toUser:to,profileId});
      toast('已转移到 '+to+'（复制了 '+r.copiedBlobs+' 个文件块）');
      $('#modal-transfer').classList.remove('active');
      loadWindows();
    }catch(e){toast(e.message,false)}
  };
}
window.openTransfer=openTransfer;

(async()=>{
  const t=localStorage.getItem('admin_token');
  if(t){
    TOKEN=t;
    try{
      const d=await api('/api/verify',{token:t});
      if(d.role==='admin'){showMain(d.username||localStorage.getItem('admin_name'));return}
    }catch{}
  }
  $('#app-login').style.display='block';
})();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 200, {}); return; }

  const url = req.url.split('?')[0];

  // --- Public API ---
  if (url === '/api/ping') return json(res, 200, { status: 'ok', time: Date.now() });

  if (url === '/api/login' && req.method === 'POST') {
    const { username, password } = await parseBody(req);
    if (!username || !password) return json(res, 400, { error: '请填写用户名和密码' });
    const users = loadUsers();
    // 2026-04-18: split "wrong credentials" from "account disabled" so the
    // user knows whether to retry or contact admin.
    const user = users.find(u => u.username === username);
    if (!user || user.password !== hashPwd(password))
      return json(res, 401, { error: '用户名或密码错误' });
    if (user.enabled === false)
      return json(res, 403, { error: '账号未激活或已被管理员禁用，请联系管理员', code: 'ACCOUNT_DISABLED' });
    const sessions = cleanExpired();
    const idx = sessions.findIndex(s => s.username === username);
    if (idx >= 0) sessions.splice(idx, 1);
    const token = genToken();
    sessions.push({ token, username, role: user.role || 'user', createdAt: Date.now(), expiresAt: Date.now() + 7*24*3600*1000 });
    saveSessions(sessions);
    return json(res, 200, { token, username, role: user.role || 'user' });
  }

  if (url === '/api/register' && req.method === 'POST') {
    const { username, password } = await parseBody(req);
    if (!username || !password) return json(res, 400, { error: '请填写用户名和密码' });
    if (username.length < 2 || username.length > 30) return json(res, 400, { error: '用户名长度 2-30 位' });
    if (password.length < 4) return json(res, 400, { error: '密码至少 4 位' });
    if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return json(res, 400, { error: '用户名只能包含字母数字下划线' });
    const users = loadUsers();
    if (users.find(u => u.username === username)) return json(res, 409, { error: '用户名已存在' });
    // 2026-04-18: new accounts default to disabled — admin must approve via /admin
    users.push({ username, password: hashPwd(password), role: 'user', enabled: false, createdAt: Date.now() });
    saveUsers(users);
    return json(res, 200, { message: '注册成功，请等待管理员审核激活', pending: true });
  }

  if (url === '/api/verify' && req.method === 'POST') {
    const { token } = await parseBody(req);
    if (!token) return json(res, 400, { error: 'Missing token' });
    const sessions = cleanExpired();
    const session = sessions.find(s => s.token === token);
    if (!session) return json(res, 401, { error: 'Invalid token', code: 'INVALID_TOKEN' });
    // 2026-04-18: also re-check user.enabled so admin can kick out a logged-in
    // user immediately without waiting for the 7-day token to expire.
    const users = loadUsers();
    const user = users.find(u => u.username === session.username);
    if (!user) {
      // Account deleted while logged in → invalidate session
      const next = sessions.filter(s => s.token !== token);
      saveSessions(next);
      return json(res, 401, { error: '账号已被删除', code: 'ACCOUNT_DELETED' });
    }
    if (user.enabled === false) {
      return json(res, 403, { error: '账号已被管理员禁用', code: 'ACCOUNT_DISABLED' });
    }
    return json(res, 200, { username: session.username, role: session.role });
  }

  // --- Admin API (requires admin token) ---
  if (url === '/admin') return html(res, ADMIN_HTML);

  if (url.startsWith('/api/admin/')) {
    const sess = getSessionUser(req);
    if (!sess || sess.role !== 'admin') return json(res, 403, { error: '需要管理员权限' });

    if (url === '/api/admin/users') {
      const users = loadUsers();
      const sessions = loadSessions();
      const list = users.map(u => ({
        username: u.username,
        role: u.role || 'user',
        enabled: u.enabled !== false,
        createdAt: u.createdAt || 0,
        online: sessions.some(s => s.username === u.username && s.expiresAt > Date.now()),
      }));
      return json(res, 200, list);
    }

    if (url === '/api/admin/toggle' && req.method === 'POST') {
      const { username } = await parseBody(req);
      if (!username) return json(res, 400, { error: 'Missing username' });
      const users = loadUsers();
      const u = users.find(x => x.username === username);
      if (!u) return json(res, 404, { error: 'User not found' });
      if (u.role === 'admin') return json(res, 400, { error: '不能禁用管理员' });
      u.enabled = !u.enabled;
      saveUsers(users);
      if (!u.enabled) {
        const sessions = loadSessions().filter(s => s.username !== username);
        saveSessions(sessions);
      }
      return json(res, 200, { username, enabled: u.enabled });
    }

    if (url === '/api/admin/delete' && req.method === 'POST') {
      const { username } = await parseBody(req);
      if (!username) return json(res, 400, { error: 'Missing username' });
      let users = loadUsers();
      const u = users.find(x => x.username === username);
      if (!u) return json(res, 404, { error: 'User not found' });
      if (u.role === 'admin') return json(res, 400, { error: '不能删除管理员' });
      users = users.filter(x => x.username !== username);
      saveUsers(users);
      const sessions = loadSessions().filter(s => s.username !== username);
      saveSessions(sessions);
      return json(res, 200, { deleted: username });
    }

    if (url === '/api/admin/reset-password' && req.method === 'POST') {
      const { username, newPassword } = await parseBody(req);
      if (!username || !newPassword) return json(res, 400, { error: 'Missing fields' });
      if (newPassword.length < 4) return json(res, 400, { error: '密码至少 4 位' });
      const users = loadUsers();
      const u = users.find(x => x.username === username);
      if (!u) return json(res, 404, { error: 'User not found' });
      u.password = hashPwd(newPassword);
      saveUsers(users);
      return json(res, 200, { message: '密码已重置' });
    }

    return json(res, 404, { error: 'Not found' });
  }

  // ========== Cloud Sync API (requires valid token) ==========
  // Layout on disk:
  //   /opt/fp-browser-auth/sync-data/<username>/snapshot.json
  //   /opt/fp-browser-auth/sync-data/<username>/manifests/<profileId>.json
  //   /opt/fp-browser-auth/sync-data/<username>/blobs/<sha256[:2]>/<sha256>
  //
  // Content-addressed blobs let us dedup identical files (e.g. same `Local
  // State` across many profiles) without bookkeeping. Garbage collection
  // happens lazily on profile delete: any blob no longer referenced by any
  // manifest is unlinked.
  if (url.startsWith('/api/sync/')) {
    const sess = getSessionUser(req);
    if (!sess) return json(res, 401, { error: '需要登录' });

    // Admin endpoints first — they live under /api/sync/admin/* so the
    // wildcard above catches them with the same auth wrapper.
    if (url.startsWith('/api/sync/admin/')) {
      if (sess.role !== 'admin') return json(res, 403, { error: '需要管理员权限' });

      if (url === '/api/sync/admin/list-windows' && req.method === 'POST') {
        // Walk every user's snapshot and emit one row per profile.
        const out = [];
        try {
          for (const username of fs.existsSync(SYNC_DIR) ? fs.readdirSync(SYNC_DIR) : []) {
            const snap = readSnapshot(username);
            if (!snap) continue;
            for (const rp of snap.profiles || []) {
              out.push({
                username,
                profileId: rp.profile?.id,
                profileName: rp.profile?.name || '(未命名)',
                groupName: (snap.groups || []).find(g => g.id === rp.profile?.groupId)?.name,
                filesBytes: rp.filesBytes || 0,
                filesUploadedAt: rp.filesUploadedAt || 0,
              });
            }
          }
        } catch (err) {
          return json(res, 500, { error: 'admin list failed: ' + err.message });
        }
        return json(res, 200, out);
      }

      if (url === '/api/sync/admin/transfer' && req.method === 'POST') {
        const { fromUser, toUser, profileId } = await parseBody(req);
        if (!fromUser || !toUser || !profileId) return json(res, 400, { error: '参数不完整' });
        if (fromUser === toUser) return json(res, 400, { error: '来源和目标用户相同' });
        const users = loadUsers();
        if (!users.find(u => u.username === toUser)) return json(res, 404, { error: '目标用户不存在' });
        try {
          const result = transferProfile(fromUser, toUser, profileId);
          return json(res, 200, result);
        } catch (err) {
          return json(res, 400, { error: err.message });
        }
      }

      return json(res, 404, { error: 'Not found' });
    }

    const username = sess.username;
    ensureUserSyncDir(username);

    if (url === '/api/sync/quota' && req.method === 'GET') {
      return json(res, 200, computeQuota(username));
    }

    if (url === '/api/sync/snapshot' && req.method === 'GET') {
      const snap = readSnapshot(username);
      if (!snap) return json(res, 200, { empty: true });
      return json(res, 200, snap);
    }

    if (url === '/api/sync/snapshot' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { error: '无效的 snapshot' });
      // Force the username to the session — never trust the client field.
      body.username = username;
      body.uploadedAt = Date.now();
      const text = JSON.stringify(body);
      if (text.length > SNAPSHOT_MAX_BYTES) {
        return json(res, 413, { error: `元数据过大 (${(text.length/1024).toFixed(1)} KB > ${SNAPSHOT_MAX_BYTES/1024} KB)` });
      }
      writeFileAtomic(snapshotPath(username), text);
      // Snapshot may shrink the profile list — GC orphan blobs/manifests.
      gcOrphans(username);
      return json(res, 200, { ok: true, uploadedAt: body.uploadedAt, quota: computeQuota(username) });
    }

    if (url === '/api/sync/profile/manifest' && req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const profileId = u.searchParams.get('profileId');
      if (!profileId) return json(res, 400, { error: '缺少 profileId' });
      const m = readManifest(username, profileId);
      if (!m) return json(res, 200, null);
      return json(res, 200, m);
    }

    if (url === '/api/sync/profile/manifest' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body || !body.profileId || !Array.isArray(body.files)) {
        return json(res, 400, { error: '无效的 manifest' });
      }
      const text = JSON.stringify(body);
      if (text.length > MANIFEST_MAX_BYTES) {
        return json(res, 413, { error: 'manifest 过大' });
      }
      writeFileAtomic(manifestPath(username, body.profileId), text);
      // Determine which blob hashes are actually needed by this manifest so
      // the client can ask "which ones do I still need to upload?"
      const need = body.files
        .filter(f => f && f.sha256 && !blobExists(username, f.sha256))
        .map(f => f.sha256);
      return json(res, 200, { ok: true, needsUpload: need, quota: computeQuota(username) });
    }

    if (url === '/api/sync/profile/file' && req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const sha = (u.searchParams.get('sha256') || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha)) return json(res, 400, { error: '无效的 sha256' });
      const p = blobPathFor(username, sha);
      if (!fs.existsSync(p)) return json(res, 404, { error: '文件不存在于云端' });
      const stat = fs.statSync(p);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(p).pipe(res);
      return;
    }

    if (url === '/api/sync/profile/file' && req.method === 'POST') {
      const u = new URL(req.url, 'http://x');
      const sha = (u.searchParams.get('sha256') || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha)) return json(res, 400, { error: '无效的 sha256' });
      const declared = parseInt(req.headers['content-length'] || '0', 10);
      if (declared > SYNC_MAX_FILE_BYTES) {
        return json(res, 413, { error: `单文件超过 ${SYNC_MAX_FILE_BYTES/1024/1024} MB 上限` });
      }
      const quota = computeQuota(username);
      if (quota.used + declared > SYNC_QUOTA_BYTES) {
        return json(res, 413, { error: '云端存储空间已满，请清理后再试', code: 'QUOTA_EXCEEDED', quota });
      }
      const target = blobPathFor(username, sha);
      if (fs.existsSync(target)) {
        // Already there — drain the request and ack instantly.
        req.on('data', () => {});
        req.on('end', () => json(res, 200, { ok: true, deduped: true }));
        return;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = target + '.upload-' + crypto.randomBytes(4).toString('hex');
      const ws = fs.createWriteStream(tmp);
      const hasher = crypto.createHash('sha256');
      let received = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > SYNC_MAX_FILE_BYTES) {
          aborted = true;
          req.destroy();
          ws.destroy();
          try { fs.unlinkSync(tmp); } catch {}
          return;
        }
        hasher.update(chunk);
        ws.write(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        ws.end(() => {
          const got = hasher.digest('hex');
          if (got !== sha) {
            try { fs.unlinkSync(tmp); } catch {}
            return json(res, 400, { error: 'sha256 校验失败 (got=' + got + ')' });
          }
          // Atomic rename so partial files never become live.
          try { fs.renameSync(tmp, target); }
          catch (err) { try { fs.unlinkSync(tmp); } catch {} return json(res, 500, { error: 'rename failed: ' + err.message }); }
          json(res, 200, { ok: true, sha256: sha, size: received, quota: computeQuota(username) });
        });
      });
      req.on('error', () => { try { ws.destroy(); fs.unlinkSync(tmp); } catch {} });
      return;
    }

    if (url === '/api/sync/profile/delete' && req.method === 'POST') {
      const { profileId } = await parseBody(req);
      if (!profileId) return json(res, 400, { error: '缺少 profileId' });
      const mp = manifestPath(username, profileId);
      if (fs.existsSync(mp)) fs.unlinkSync(mp);
      gcOrphans(username);
      return json(res, 200, { ok: true, deleted: profileId, quota: computeQuota(username) });
    }

    return json(res, 404, { error: 'Not found' });
  }

  // --- Relay API (requires valid token) ---
  if (url.startsWith('/api/relay/')) {
    const sess = getSessionUser(req);
    if (!sess) return json(res, 401, { error: '需要登录' });

    if (url === '/api/relay/start' && req.method === 'POST') {
      const { relayId, node } = await parseBody(req);
      if (!relayId || !node || !node.server) return json(res, 400, { error: '参数不完整' });
      try {
        const port = await startRelay(relayId, node);
        return json(res, 200, { port, host: '0.0.0.0' });
      } catch (e) {
        return json(res, 500, { error: '中转启动失败: ' + (e.message || e) });
      }
    }

    if (url === '/api/relay/stop' && req.method === 'POST') {
      const { relayId } = await parseBody(req);
      if (!relayId) return json(res, 400, { error: 'Missing relayId' });
      await stopRelay(relayId);
      return json(res, 200, { stopped: relayId });
    }

    return json(res, 404, { error: 'Not found' });
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Auth server running on port ${PORT}`);
  console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
});
