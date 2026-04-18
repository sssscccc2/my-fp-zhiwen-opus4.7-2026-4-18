import { app } from 'electron';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { all, get, run } from '../db/client.js';
import type {
  Profile,
  CreateProfileInput,
  UpdateProfileInput,
  FingerprintConfig,
  ProfileGroup,
} from '@shared/types';
import { generateRandomFingerprint, generateRandomFingerprintForOS, getPresetById, presetToFingerprint } from './presets.js';

interface ProfileRow {
  id: string;
  name: string;
  group_id: string | null;
  tags: string;
  fingerprint_config: string;
  proxy_id: string | null;
  user_data_dir: string;
  created_at: number;
  last_opened_at: number | null;
  notes: string | null;
}

/**
 * Self-heal fingerprints with missing required sub-objects (legacy/older data
 * created before all fields were forced-rendered in the editor). Missing
 * pieces are filled from a fresh random preset. The seed/os/brand the user
 * already chose are preserved.
 */
function normalizeFingerprint(fp: Partial<FingerprintConfig>): FingerprintConfig {
  const required: (keyof FingerprintConfig)[] = [
    'navigator', 'screen', 'webgl', 'canvas', 'audio', 'webrtc',
    'fonts', 'geo', 'timezone', 'locale', 'storageQuotaMB',
  ];
  // Also detect cross-OS inconsistencies introduced by an earlier (buggy)
  // heal pass — e.g. os=windows but webgl.renderer="Apple M1". Treat such
  // sub-trees as missing so they get re-filled from a matching preset.
  const os = (fp as FingerprintConfig).os;
  const renderer = (fp.webgl?.renderer ?? '').toLowerCase();
  const ua = (fp.navigator?.userAgent ?? '').toLowerCase();
  const platform = (fp.navigator?.platform ?? '').toLowerCase();
  if (os === 'windows') {
    if (renderer.includes('apple') || renderer.includes('metal')) { fp.webgl = undefined; }
    if (!ua.includes('windows') || platform.includes('mac') || platform.includes('linux')) {
      fp.navigator = undefined;
    }
  } else if (os === 'mac') {
    if (renderer.includes('direct3d') || renderer.includes('d3d11') || renderer.includes('angle')) {
      fp.webgl = undefined;
    }
    if (ua.includes('windows') || ua.includes('linux x86_64')) { fp.navigator = undefined; }
  } else if (os === 'linux') {
    if (renderer.includes('direct3d') || renderer.includes('d3d11') || renderer.includes('apple') || renderer.includes('metal')) {
      fp.webgl = undefined;
    }
    if (ua.includes('windows') || ua.includes('mac os x')) { fp.navigator = undefined; }
  }

  const missing = required.filter((k) => fp[k] === undefined || fp[k] === null);
  if (missing.length === 0) return fp as FingerprintConfig;

  // CRITICAL: pick a fallback whose OS matches, so we don't end up filling a
  // Windows profile with Apple Metal WebGL etc. (which would later trip
  // the consistency validator).
  const fallback = (os === 'windows' || os === 'mac' || os === 'linux')
    ? generateRandomFingerprintForOS(os)
    : generateRandomFingerprint();
  // Preserve user's seed/os/brand so the visible identity stays the same.
  const merged: FingerprintConfig = {
    ...fallback,
    ...(fp as FingerprintConfig),
    seed: (fp as FingerprintConfig).seed ?? fallback.seed,
    os: (fp as FingerprintConfig).os ?? fallback.os,
    brand: (fp as FingerprintConfig).brand ?? fallback.brand,
    // Re-fill only the missing branches; keep what user already provided.
    navigator: fp.navigator ?? fallback.navigator,
    screen: fp.screen ?? fallback.screen,
    webgl: fp.webgl ?? fallback.webgl,
    canvas: fp.canvas ?? fallback.canvas,
    audio: fp.audio ?? fallback.audio,
    webrtc: fp.webrtc ?? fallback.webrtc,
    fonts: fp.fonts ?? fallback.fonts,
    geo: fp.geo ?? fallback.geo,
    timezone: fp.timezone ?? fallback.timezone,
    locale: fp.locale ?? fallback.locale,
    storageQuotaMB: fp.storageQuotaMB ?? fallback.storageQuotaMB,
  };
  console.warn(`[profileService] auto-healed fingerprint, filled missing fields: ${missing.join(', ')}`);
  return merged;
}

function rowToProfile(row: ProfileRow): Profile {
  let fpRaw: Partial<FingerprintConfig> = {};
  try { fpRaw = JSON.parse(row.fingerprint_config) as Partial<FingerprintConfig>; } catch { /* leave empty -> normalize fills */ }
  const fp = normalizeFingerprint(fpRaw);
  // Persist the heal so future reads are clean and the editor reflects truth.
  if (JSON.stringify(fp) !== row.fingerprint_config) {
    try {
      run('UPDATE profiles SET fingerprint_config = @fp WHERE id = @id',
        { fp: JSON.stringify(fp), id: row.id });
    } catch (err) {
      console.warn('[profileService] failed to persist fingerprint heal', err);
    }
  }
  return {
    id: row.id,
    name: row.name,
    groupId: row.group_id,
    tags: JSON.parse(row.tags || '[]'),
    fingerprint: fp,
    proxyId: row.proxy_id,
    userDataDir: row.user_data_dir,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    notes: row.notes ?? undefined,
  };
}

function profilesRoot(): string {
  const dir = path.join(app.getPath('userData'), 'profiles');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProfileDir(id: string): string {
  const dir = path.join(profilesRoot(), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function listProfiles(filter?: { groupId?: string; search?: string }): Profile[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter?.groupId) {
    where.push('group_id = @groupId');
    params.groupId = filter.groupId;
  }
  if (filter?.search) {
    where.push('(name LIKE @search OR notes LIKE @search OR tags LIKE @search)');
    params.search = `%${filter.search}%`;
  }
  const sql = `SELECT * FROM profiles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const rows = all<ProfileRow>(sql, params);
  return rows.map(rowToProfile);
}

export function getProfile(id: string): Profile | null {
  const row = get<ProfileRow>('SELECT * FROM profiles WHERE id = @id', { id });
  return row ? rowToProfile(row) : null;
}

export function createProfile(input: CreateProfileInput): Profile {
  const id = randomUUID();
  const userDataDir = makeProfileDir(id);

  let fp: FingerprintConfig;
  if (input.fingerprint) {
    fp = input.fingerprint;
  } else if (input.presetId) {
    const preset = getPresetById(input.presetId);
    if (!preset) throw new Error(`Preset ${input.presetId} not found`);
    fp = presetToFingerprint(preset);
  } else {
    fp = generateRandomFingerprint();
  }

  const now = Date.now();
  run(
    `INSERT INTO profiles (id, name, group_id, tags, fingerprint_config, proxy_id, user_data_dir, created_at, last_opened_at, notes)
     VALUES (@id, @name, @groupId, @tags, @fingerprintConfig, @proxyId, @userDataDir, @createdAt, NULL, @notes)`,
    {
      id,
      name: input.name,
      groupId: input.groupId ?? null,
      tags: JSON.stringify(input.tags ?? []),
      fingerprintConfig: JSON.stringify(fp),
      proxyId: input.proxyId ?? null,
      userDataDir,
      createdAt: now,
      notes: input.notes ?? null,
    },
  );

  return getProfile(id)!;
}

export function updateProfile(input: UpdateProfileInput): Profile {
  const existing = getProfile(input.id);
  if (!existing) throw new Error(`Profile ${input.id} not found`);

  const updates: string[] = [];
  const params: Record<string, unknown> = { id: input.id };
  if (input.name !== undefined) { updates.push('name = @name'); params.name = input.name; }
  if (input.groupId !== undefined) { updates.push('group_id = @groupId'); params.groupId = input.groupId; }
  if (input.tags !== undefined) { updates.push('tags = @tags'); params.tags = JSON.stringify(input.tags); }
  if (input.fingerprint !== undefined) {
    updates.push('fingerprint_config = @fp');
    params.fp = JSON.stringify(input.fingerprint);
  }
  if (input.proxyId !== undefined) { updates.push('proxy_id = @proxyId'); params.proxyId = input.proxyId; }
  if (input.notes !== undefined) { updates.push('notes = @notes'); params.notes = input.notes; }

  if (updates.length > 0) {
    run(`UPDATE profiles SET ${updates.join(', ')} WHERE id = @id`, params);
  }
  return getProfile(input.id)!;
}

export function deleteProfile(id: string, deleteData = true): void {
  const profile = getProfile(id);
  if (!profile) return;
  run('DELETE FROM profiles WHERE id = @id', { id });
  if (deleteData && profile.userDataDir && existsSync(profile.userDataDir)) {
    try {
      rmSync(profile.userDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to remove profile dir', err);
    }
  }
}

export function cloneProfile(id: string, newName?: string): Profile {
  const src = getProfile(id);
  if (!src) throw new Error('Source profile not found');
  return createProfile({
    name: newName ?? `${src.name} (副本)`,
    groupId: src.groupId,
    tags: src.tags,
    fingerprint: { ...src.fingerprint, seed: Math.floor(Math.random() * 2_147_483_647) },
    proxyId: src.proxyId,
    notes: src.notes,
  });
}

export function markProfileOpened(id: string): void {
  run('UPDATE profiles SET last_opened_at = @t WHERE id = @id', { t: Date.now(), id });
}

export function listGroups(): ProfileGroup[] {
  return all<ProfileGroup>('SELECT id, name, color FROM groups ORDER BY name');
}

export function createGroup(name: string, color = '#1677ff'): ProfileGroup {
  const id = randomUUID();
  run('INSERT INTO groups (id, name, color, created_at) VALUES (@id, @name, @color, @t)', {
    id, name, color, t: Date.now(),
  });
  return { id, name, color };
}

export function updateGroup(id: string, name: string, color: string): void {
  run('UPDATE groups SET name = @name, color = @color WHERE id = @id', { id, name, color });
}

export function deleteGroup(id: string): void {
  run('DELETE FROM groups WHERE id = @id', { id });
}
