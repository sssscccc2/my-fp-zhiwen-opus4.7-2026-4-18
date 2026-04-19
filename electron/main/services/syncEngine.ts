/**
 * Cloud sync engine — runs entirely in the main process.
 *
 * High-level flow:
 *   uploadAll():
 *     1. snapshot the local DB (profiles, groups, proxies)
 *     2. for each profile, walk userDataDir + filter via PROFILE_FILE_WHITELIST
 *        and produce a ProfileManifest with sha256 per file
 *     3. POST snapshot to server
 *     4. For each profile:
 *         a. POST manifest. Server returns `needsUpload` — only blobs we
 *            haven't already uploaded (cross-profile dedup).
 *         b. Stream-upload each blob.
 *
 *   downloadAll():
 *     1. GET snapshot from server
 *     2. Wipe local DB rows for profiles/groups/proxies and re-insert from
 *        snapshot (overwrite-with-server, "latest wins")
 *     3. For each profile, GET manifest, then for each file:
 *         - skip if local file already has matching sha256
 *         - else GET blob and write to profile dir, atomically.
 *
 * "Latest wins" policy: we compare timestamps in `getStatus()` and warn the
 * user if both ends moved since lastSync. Once they decide which side wins,
 * we just blindly overwrite — no merge.
 */

import { app } from 'electron';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { createReadStream, statSync, readdirSync, mkdirSync, existsSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { all, get, run } from '../db/client.js';
import { listProfiles, listGroups } from './profileService.js';
import { listProxies } from './proxyService.js';
import { extractCookies } from './cookieExtractor.js';
import { shouldSyncFile } from '@shared/profileWhitelist';
import {
  SYNC_QUOTA_BYTES, SYNC_MAX_FILE_BYTES,
} from '@shared/syncTypes';
import type {
  RemoteSnapshot, ProfileManifest, FileManifestEntry, RemoteProfile,
  SyncStatus, SyncDirection, SyncProgress, SyncResult, QuotaInfo,
} from '@shared/syncTypes';
import type { Profile, ProfileGroup, ProxyConfig } from '@shared/types';

type ProgressCb = (p: SyncProgress) => void;

const SYNC_STATE_FILE = 'sync-state.json';

interface LocalSyncState {
  lastPulledAt: number;
  lastUploadedAt: number;
  lastDirection?: 'upload' | 'download';
}

function syncStatePath(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, SYNC_STATE_FILE);
}

function loadLocalState(): LocalSyncState {
  try {
    const t = readFileSync(syncStatePath(), 'utf-8');
    return JSON.parse(t);
  } catch {
    return { lastPulledAt: 0, lastUploadedAt: 0 };
  }
}

function saveLocalState(s: LocalSyncState): void {
  try {
    writeFileSync(syncStatePath(), JSON.stringify(s));
  } catch (err) {
    console.warn('[sync] failed to save local state:', err);
  }
}

// ---------------- HTTP helpers ----------------

function pickClient(server: string): { lib: typeof http | typeof https; isHttps: boolean } {
  return server.startsWith('https://')
    ? { lib: https, isHttps: true }
    : { lib: http, isHttps: false };
}

function jsonRequest<T = unknown>(
  server: string,
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  pathAndQuery: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(server.replace(/\/+$/, '') + pathAndQuery);
    const { lib } = pickClient(server);
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let data: { error?: string; code?: string } | T;
        try { data = JSON.parse(buf.toString('utf-8')); }
        catch { return reject(new Error(`Bad JSON from server (${res.statusCode}): ${buf.toString('utf-8').slice(0, 200)}`)); }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data as T);
        } else {
          const err = (data as { error?: string }).error || `HTTP ${res.statusCode}`;
          const code = (data as { code?: string }).code;
          const e = new Error(err) as Error & { code?: string; status?: number };
          e.code = code;
          e.status = res.statusCode;
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadBlob(
  server: string,
  token: string,
  sha256: string,
  filePath: string,
  size: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(server.replace(/\/+$/, '') + `/api/sync/profile/file?sha256=${sha256}`);
    const { lib } = pickClient(server);
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': size,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve();
        let msg = `HTTP ${res.statusCode}`;
        try { msg = JSON.parse(Buffer.concat(chunks).toString('utf-8')).error || msg; } catch {}
        reject(new Error(msg));
      });
    });
    req.on('error', reject);
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.pipe(req);
  });
}

function downloadBlob(
  server: string,
  token: string,
  sha256: string,
  destPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(server.replace(/\/+$/, '') + `/api/sync/profile/file?sha256=${sha256}`);
    const { lib } = pickClient(server);
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let msg = `HTTP ${res.statusCode}`;
          try { msg = JSON.parse(Buffer.concat(chunks).toString('utf-8')).error || msg; } catch {}
          reject(new Error(msg));
        });
        return;
      }
      mkdirSync(path.dirname(destPath), { recursive: true });
      const tmp = destPath + '.dl-' + Math.random().toString(16).slice(2);
      const ws = require('node:fs').createWriteStream(tmp);
      const hasher = createHash('sha256');
      res.on('data', (c: Buffer) => hasher.update(c));
      res.pipe(ws);
      ws.on('error', reject);
      ws.on('finish', () => {
        const got = hasher.digest('hex');
        if (got !== sha256) {
          try { rmSync(tmp); } catch {}
          return reject(new Error(`sha256 mismatch (expected ${sha256}, got ${got})`));
        }
        try { renameSync(tmp, destPath); resolve(); }
        catch (err) { try { rmSync(tmp); } catch {} reject(err as Error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------- File walking ----------------

function* walkFiles(root: string, rel: string = ''): Generator<{ abs: string; rel: string; size: number; mtimeMs: number }> {
  const cur = path.join(root, rel);
  let entries: string[];
  try { entries = readdirSync(cur); } catch { return; }
  for (const name of entries) {
    const subRel = rel ? rel + '/' + name : name;
    const abs = path.join(cur, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      yield* walkFiles(root, subRel);
    } else if (st.isFile()) {
      yield { abs, rel: subRel, size: st.size, mtimeMs: st.mtimeMs };
    }
  }
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

async function buildProfileManifest(profile: Profile): Promise<ProfileManifest> {
  const root = profile.userDataDir;
  if (!existsSync(root)) {
    return { profileId: profile.id, clientModifiedAt: Date.now(), totalBytes: 0, files: [] };
  }
  const files: FileManifestEntry[] = [];
  let mostRecent = 0;
  let totalBytes = 0;
  for (const f of walkFiles(root)) {
    if (!shouldSyncFile(f.rel)) continue;
    if (f.size > SYNC_MAX_FILE_BYTES) {
      console.warn(`[sync] skip ${f.rel} (${(f.size / 1024 / 1024).toFixed(1)} MB > limit)`);
      continue;
    }
    const sha256 = await hashFile(f.abs);
    files.push({ path: f.rel, sha256, size: f.size, mtimeMs: f.mtimeMs });
    totalBytes += f.size;
    if (f.mtimeMs > mostRecent) mostRecent = f.mtimeMs;
  }
  return {
    profileId: profile.id,
    clientModifiedAt: mostRecent || Date.now(),
    totalBytes,
    files,
  };
}

// ---------------- DB application (download path) ----------------

function applyRemoteToDb(snap: RemoteSnapshot): void {
  // Collect IDs we want to keep.
  const profileIds = new Set(snap.profiles.map((p) => p.profile.id));
  const groupIds = new Set(snap.groups.map((g) => g.id));
  const proxyIds = new Set(snap.proxies.map((p) => p.id));

  // Remove rows that no longer exist in remote (latest wins).
  const localProfiles = all<{ id: string; user_data_dir: string }>('SELECT id, user_data_dir FROM profiles');
  for (const p of localProfiles) {
    if (!profileIds.has(p.id)) {
      run('DELETE FROM profiles WHERE id = @id', { id: p.id });
      // We do NOT auto-delete the on-disk profile dir here — it's safer to
      // let user remove it via UI. Orphaned dirs are harmless.
    }
  }
  const localGroups = all<{ id: string }>('SELECT id FROM groups');
  for (const g of localGroups) if (!groupIds.has(g.id)) run('DELETE FROM groups WHERE id = @id', { id: g.id });

  const localProxies = all<{ id: string }>('SELECT id FROM proxies');
  for (const p of localProxies) if (!proxyIds.has(p.id)) run('DELETE FROM proxies WHERE id = @id', { id: p.id });

  // Upsert groups.
  for (const g of snap.groups) {
    run(
      `INSERT INTO groups (id, name, color, created_at) VALUES (@id, @name, @color, @t)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color`,
      { id: g.id, name: g.name, color: g.color, t: Date.now() },
    );
  }

  // Upsert proxies.
  for (const p of snap.proxies) {
    run(
      `INSERT INTO proxies (id, name, type, host, port, username, password, notes, dns_config, created_at)
       VALUES (@id, @name, @type, @host, @port, @username, @password, @notes, @dns, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, type=excluded.type, host=excluded.host, port=excluded.port,
         username=excluded.username, password=excluded.password, notes=excluded.notes,
         dns_config=excluded.dns_config`,
      {
        id: p.id,
        name: p.name,
        type: p.type,
        host: p.host,
        port: p.port,
        username: p.username ?? null,
        password: p.password ?? null,
        notes: p.notes ?? null,
        dns: p.dns ? JSON.stringify(p.dns) : null,
        createdAt: Date.now(),
      },
    );
  }

  // Upsert profiles. We assign userDataDir on this device — it does NOT travel.
  for (const rp of snap.profiles) {
    const p = rp.profile;
    const localDir = path.join(app.getPath('userData'), 'profiles', p.id);
    mkdirSync(localDir, { recursive: true });
    run(
      `INSERT INTO profiles (id, name, group_id, tags, fingerprint_config, proxy_id,
                             user_data_dir, created_at, last_opened_at, notes, cookies)
       VALUES (@id, @name, @groupId, @tags, @fp, @proxyId, @udd, @ca, @lo, @notes, @cookies)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, group_id=excluded.group_id, tags=excluded.tags,
         fingerprint_config=excluded.fingerprint_config, proxy_id=excluded.proxy_id,
         last_opened_at=excluded.last_opened_at, notes=excluded.notes, cookies=excluded.cookies`,
      {
        id: p.id,
        name: p.name,
        groupId: p.groupId ?? null,
        tags: JSON.stringify(p.tags ?? []),
        fp: JSON.stringify(p.fingerprint),
        proxyId: p.proxyId ?? null,
        udd: localDir,
        ca: p.createdAt ?? Date.now(),
        lo: p.lastOpenedAt ?? null,
        notes: p.notes ?? null,
        cookies: p.cookies ?? null,
      },
    );
  }
}

function getLocalProfileDir(profileId: string): string | null {
  const row = get<{ user_data_dir: string }>('SELECT user_data_dir FROM profiles WHERE id = @id', { id: profileId });
  return row?.user_data_dir ?? null;
}

// ---------------- Public API ----------------

export async function getStatus(server: string, token: string): Promise<SyncStatus> {
  const local = loadLocalState();
  const localProfiles = listProfiles().length;
  let remote: RemoteSnapshot | { empty: true } | null = null;
  let quota: QuotaInfo | undefined;
  try {
    remote = await jsonRequest<RemoteSnapshot | { empty: true }>(server, token, 'GET', '/api/sync/snapshot');
    quota = await jsonRequest<QuotaInfo>(server, token, 'GET', '/api/sync/quota');
  } catch (err) {
    throw new Error('获取云端状态失败: ' + (err as Error).message);
  }

  const isEmpty = remote && 'empty' in remote && remote.empty;
  const remoteProfiles = isEmpty ? 0 : (remote as RemoteSnapshot).profiles.length;
  const remoteUploadedAt = isEmpty ? 0 : (remote as RemoteSnapshot).uploadedAt;

  let direction: SyncDirection;
  if (localProfiles === 0 && remoteProfiles === 0) direction = 'in-sync';
  else if (remoteProfiles === 0 && localProfiles > 0) direction = 'never-synced';
  else if (localProfiles === 0 && remoteProfiles > 0) direction = 'remote-only';
  else if (remoteUploadedAt > local.lastPulledAt && local.lastUploadedAt < remoteUploadedAt) {
    // Server has changes since our last pull AND our last upload happened
    // before that. Pure "remote newer".
    direction = 'remote-newer';
  } else if (local.lastUploadedAt < Date.now() - 1000 && hasLocalChangesSince(local.lastUploadedAt)) {
    direction = 'local-newer';
  } else if (remoteUploadedAt > 0 && local.lastPulledAt < remoteUploadedAt && hasLocalChangesSince(local.lastUploadedAt)) {
    direction = 'conflict';
  } else {
    direction = 'in-sync';
  }

  return {
    localProfiles,
    remoteProfiles,
    remoteUploadedAt,
    lastPulledAt: local.lastPulledAt,
    direction,
    quota,
  };
}

/**
 * Cheap heuristic: "has anything in the local DB changed since `since`?".
 * We compare against last_opened_at and created_at — true if any row was
 * created or opened after `since`. Imperfect (won't detect rename-only) but
 * good enough; the user can always manually choose to upload.
 */
function hasLocalChangesSince(since: number): boolean {
  if (!since) return true;
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM profiles WHERE created_at > @t OR (last_opened_at IS NOT NULL AND last_opened_at > @t)`,
    { t: since },
  );
  return (row?.n ?? 0) > 0;
}

function buildLocalSnapshot(deviceLabel: string): RemoteSnapshot {
  const profiles = listProfiles();
  const groups = listGroups();
  const proxies = listProxies();
  return {
    schemaVersion: 1,
    username: '',                 // server overrides
    uploadedAt: Date.now(),
    deviceLabel,
    profiles: profiles.map<RemoteProfile>((p) => ({
      profile: p,
      manifestSha256: '',         // filled after manifest upload (optional)
      filesBytes: 0,
      filesUploadedAt: 0,
    })),
    groups: groups as ProfileGroup[],
    proxies: proxies as ProxyConfig[],
  };
}

export async function uploadAll(
  server: string,
  token: string,
  onProgress?: ProgressCb,
): Promise<SyncResult> {
  const start = Date.now();
  const profiles = listProfiles();

  // 1a. Extract cookies (DPAPI-decrypted plaintext JSON) into profile.cookies
  // BEFORE we read profile data into the snapshot, so the snapshot carries
  // them. On the target machine the launcher's existing addCookies() flow
  // replays them — no need to ship the (un-portable) Cookies SQLite blob.
  onProgress?.({ phase: 'scan', current: 0, total: profiles.length, message: '提取窗口 cookies...' });
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    onProgress?.({ phase: 'scan', current: i, total: profiles.length, message: `提取 cookies: ${p.name}` });
    try {
      const ext = await extractCookies(p.userDataDir);
      if (ext.cookies.length > 0) {
        const json = JSON.stringify(ext.cookies);
        run('UPDATE profiles SET cookies = @c WHERE id = @id', { c: json, id: p.id });
        p.cookies = json;
        console.log(`[sync] dumped ${ext.decrypted}/${ext.totalRows} cookies for "${p.name}" (skipped ${ext.skipped})`);
      } else if (ext.reason && ext.reason !== 'NO_COOKIES_FILE') {
        console.warn(`[sync] cookie dump skipped for "${p.name}": ${ext.reason}`);
      }
    } catch (err) {
      console.warn(`[sync] cookie extract failed for "${p.name}":`, (err as Error).message);
    }
  }

  onProgress?.({ phase: 'scan', current: 0, total: profiles.length, message: '扫描本地窗口文件...' });

  // 1b. Build all manifests up front so the snapshot can carry filesBytes.
  const manifests: ProfileManifest[] = [];
  for (let i = 0; i < profiles.length; i++) {
    onProgress?.({ phase: 'scan', current: i, total: profiles.length, message: `扫描 ${profiles[i].name}` });
    manifests.push(await buildProfileManifest(profiles[i]));
  }

  // Quota pre-check (sum of unique file sizes — close enough, server has the
  // final word and will refuse if real over).
  const seenHashes = new Set<string>();
  let projected = 0;
  for (const m of manifests) for (const f of m.files) {
    if (!seenHashes.has(f.sha256)) { seenHashes.add(f.sha256); projected += f.size; }
  }
  if (projected > SYNC_QUOTA_BYTES) {
    return {
      ok: false,
      direction: 'upload',
      error: `本次上传约 ${(projected / 1024 / 1024).toFixed(1)} MB，超过 ${SYNC_QUOTA_BYTES / 1024 / 1024} MB 配额。请清理冗余 cookie/extension 数据后重试。`,
    };
  }

  // 2. Build snapshot, attach filesBytes per profile.
  const snap = buildLocalSnapshot(`${process.platform}-${process.arch}`);
  for (const rp of snap.profiles) {
    const m = manifests.find((x) => x.profileId === rp.profile.id);
    rp.filesBytes = m?.totalBytes ?? 0;
    rp.filesUploadedAt = Date.now();
  }

  // 3. Upload snapshot.
  onProgress?.({ phase: 'upload-meta', current: 0, total: 1, message: '上传元数据...' });
  await jsonRequest(server, token, 'POST', '/api/sync/snapshot', snap);

  // 4. For each profile, post manifest, get needsUpload list, upload blobs.
  let totalBytesUp = 0;
  let uploadedFileCount = 0;
  for (let i = 0; i < manifests.length; i++) {
    const m = manifests[i];
    const profile = profiles[i];
    onProgress?.({
      phase: 'upload-meta', current: i + 1, total: manifests.length,
      message: `提交清单 ${profile.name}`,
    });
    const resp = await jsonRequest<{ needsUpload: string[] }>(
      server, token, 'POST', '/api/sync/profile/manifest', m,
    );
    const need = new Set(resp.needsUpload || []);
    if (!need.size) continue;

    const filesToUpload = m.files.filter((f) => need.has(f.sha256));
    for (let j = 0; j < filesToUpload.length; j++) {
      const f = filesToUpload[j];
      onProgress?.({
        phase: 'upload-files',
        current: uploadedFileCount + 1,
        total: 0, // We don't know the global total upfront — rely on currentFile.
        currentFile: `${profile.name} / ${f.path}`,
        bytesTransferred: totalBytesUp,
        message: `上传 ${f.path}`,
      });
      const abs = path.join(profile.userDataDir, ...f.path.split('/'));
      try {
        await uploadBlob(server, token, f.sha256, abs, f.size);
        totalBytesUp += f.size;
        uploadedFileCount++;
      } catch (err) {
        return {
          ok: false,
          direction: 'upload',
          error: `上传失败 (${f.path}): ${(err as Error).message}`,
          uploadedFiles: uploadedFileCount,
          bytes: totalBytesUp,
        };
      }
    }
  }

  const local = loadLocalState();
  saveLocalState({ ...local, lastUploadedAt: Date.now(), lastDirection: 'upload' });
  onProgress?.({ phase: 'done', current: 1, total: 1, message: '同步完成' });

  return {
    ok: true,
    direction: 'upload',
    uploadedFiles: uploadedFileCount,
    bytes: totalBytesUp,
    durationMs: Date.now() - start,
  };
}

export async function downloadAll(
  server: string,
  token: string,
  onProgress?: ProgressCb,
): Promise<SyncResult> {
  const start = Date.now();
  onProgress?.({ phase: 'download-meta', current: 0, total: 1, message: '下载云端清单...' });
  const snap = await jsonRequest<RemoteSnapshot | { empty: true }>(server, token, 'GET', '/api/sync/snapshot');
  if ('empty' in snap && snap.empty) {
    return { ok: false, direction: 'download', error: '云端没有任何数据' };
  }
  const remote = snap as RemoteSnapshot;

  // Apply DB rows first so profile dirs exist for the file step.
  applyRemoteToDb(remote);

  let downloadedFiles = 0;
  let totalBytes = 0;
  for (let i = 0; i < remote.profiles.length; i++) {
    const rp = remote.profiles[i];
    onProgress?.({
      phase: 'download-meta', current: i + 1, total: remote.profiles.length,
      message: `下载清单 ${rp.profile.name}`,
    });
    const manifest = await jsonRequest<ProfileManifest | null>(
      server, token, 'GET', `/api/sync/profile/manifest?profileId=${encodeURIComponent(rp.profile.id)}`,
    );
    if (!manifest) continue;

    const localDir = getLocalProfileDir(rp.profile.id);
    if (!localDir) continue;

    // Build a quick lookup of existing local file hashes so we skip them.
    const localHashes = new Map<string, string>();
    if (existsSync(localDir)) {
      for (const f of walkFiles(localDir)) {
        if (manifest.files.some((mf) => mf.path === f.rel)) {
          try { localHashes.set(f.rel, await hashFile(f.abs)); } catch { /* ignore */ }
        }
      }
    }

    for (let j = 0; j < manifest.files.length; j++) {
      const f = manifest.files[j];
      if (localHashes.get(f.path) === f.sha256) continue;     // already correct
      const abs = path.join(localDir, ...f.path.split('/'));
      onProgress?.({
        phase: 'download-files',
        current: downloadedFiles + 1, total: 0,
        currentFile: `${rp.profile.name} / ${f.path}`,
        bytesTransferred: totalBytes,
        message: `下载 ${f.path}`,
      });
      try {
        await downloadBlob(server, token, f.sha256, abs);
        downloadedFiles++;
        totalBytes += f.size;
      } catch (err) {
        return {
          ok: false,
          direction: 'download',
          error: `下载失败 (${f.path}): ${(err as Error).message}`,
          downloadedFiles,
          bytes: totalBytes,
        };
      }
    }
  }

  const local = loadLocalState();
  saveLocalState({
    ...local,
    lastPulledAt: Date.now(),
    lastUploadedAt: remote.uploadedAt,    // we now reflect remote state
    lastDirection: 'download',
  });
  onProgress?.({ phase: 'done', current: 1, total: 1, message: '同步完成' });

  return {
    ok: true,
    direction: 'download',
    downloadedFiles,
    bytes: totalBytes,
    durationMs: Date.now() - start,
  };
}

/**
 * Tell the server we deleted a profile so it cleans up the manifest+blobs.
 * We don't tie this into deleteProfile() automatically because the user might
 * not be using sync at all — instead the renderer calls this proactively
 * after a delete *if* sync is enabled.
 */
export async function deleteRemoteProfile(server: string, token: string, profileId: string): Promise<void> {
  await jsonRequest(server, token, 'POST', '/api/sync/profile/delete', { profileId });
}
