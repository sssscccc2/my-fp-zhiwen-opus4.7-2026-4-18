
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
const PORT = 3000;

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

function parseBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
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

    <table class="table">
      <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>在线</th><th>注册时间</th><th>操作</th></tr></thead>
      <tbody id="user-tbody"></tbody>
    </table>
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
