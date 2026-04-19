/**
 * Cloud sync data shapes.
 *
 * Server endpoints (mirrored in auth-server/server.js):
 *   GET  /api/sync/snapshot           -> RemoteSnapshot | { empty: true }
 *   POST /api/sync/snapshot           body: RemoteSnapshot
 *   GET  /api/sync/profile/manifest?profileId=xxx
 *                                     -> ProfileManifest | null
 *   POST /api/sync/profile/manifest   body: ProfileManifest
 *   GET  /api/sync/profile/file?sha256=xxx -> raw bytes (Content-Type: application/octet-stream)
 *   POST /api/sync/profile/file?sha256=xxx body: raw bytes
 *   GET  /api/sync/quota              -> QuotaInfo
 *   POST /api/sync/profile/delete     body: { profileId }
 *
 * Admin endpoints:
 *   POST /api/admin/sync/list-windows -> AdminWindowSummary[]
 *   POST /api/admin/sync/transfer     body: { fromUser, toUser, profileId }
 *
 * All sync endpoints require Authorization: Bearer <token>.
 */

import type { Profile, ProfileGroup, ProxyConfig } from './types';

/** Single Chromium file inside a profile, keyed by its path relative to userDataDir. */
export interface FileManifestEntry {
  /** Relative path with forward slashes, e.g. "Default/Cookies". */
  path: string;
  /** SHA-256 hex (lowercase). Used as the blob key for dedup. */
  sha256: string;
  /** Byte size — server uses this to enforce quota & per-file limit. */
  size: number;
  /** mtime in ms (informational only, not used for diff). */
  mtimeMs: number;
}

export interface ProfileManifest {
  profileId: string;
  /** ms since epoch — "latest wins" by this value during conflict. */
  clientModifiedAt: number;
  /** Total bytes in this manifest (after dedup, sum of distinct file sizes). */
  totalBytes: number;
  files: FileManifestEntry[];
}

/**
 * The DB-row level metadata for one profile. We sync the *logical* profile
 * (name, group, fingerprint, proxy, cookies) separately from the *files*
 * (Cookies SQLite, Local Storage, etc). This struct is what lives inside
 * `RemoteSnapshot.profiles[]`.
 */
export interface RemoteProfile {
  /** Mirror of local Profile, but serialized so we don't accidentally leak
   *  internals. We keep it as a record to stay forward-compatible. */
  profile: Profile;
  /** Hash of the profile's file manifest. Empty string means "no files
   *  uploaded yet" (admin-transferred shells, freshly created, etc.). */
  manifestSha256: string;
  /** Sum of file sizes for this profile (post-dedup). For UI display. */
  filesBytes: number;
  /** ms since epoch when this profile's files were last uploaded. */
  filesUploadedAt: number;
}

export interface RemoteProxy extends ProxyConfig {
  /** Marker so server can keep proxies even if they're orphaned. */
  _kind?: 'proxy';
}

/**
 * The full snapshot of one user's account state. Single JSON file on the
 * server, atomically replaced on each upload.
 */
export interface RemoteSnapshot {
  /** Schema version — bump if we add breaking changes. */
  schemaVersion: 1;
  /** Account that owns this snapshot. */
  username: string;
  /** ms since epoch when this snapshot was uploaded. */
  uploadedAt: number;
  /** Original device that uploaded — purely informational. */
  deviceLabel?: string;
  /** Top-level data. Cookies field is left in profile as-is. */
  profiles: RemoteProfile[];
  groups: ProfileGroup[];
  proxies: RemoteProxy[];
}

export interface QuotaInfo {
  used: number;
  /** Hard limit in bytes (500 MB by default). */
  limit: number;
  /** Number of distinct blobs stored. */
  blobs: number;
}

/** Local computed status for the sync button. */
export type SyncDirection =
  | 'in-sync'              // local hash == remote hash
  | 'local-newer'          // need to upload
  | 'remote-newer'         // need to download
  | 'conflict'             // both diverged (latest-wins still applies but we
                           //   warn the user before overwriting)
  | 'never-synced'         // server has nothing, local has stuff
  | 'remote-only';         // local is empty, server has stuff (first run on
                           //   a new device)

export interface SyncStatus {
  /** Local DB profile count. */
  localProfiles: number;
  /** Remote snapshot profile count (0 if empty). */
  remoteProfiles: number;
  /** Last successful upload time (ms), or 0 if never. */
  remoteUploadedAt: number;
  /** Last successful pull time (ms) — stored locally. */
  lastPulledAt: number;
  direction: SyncDirection;
  /** Bytes / quota — populated only when fresh status was fetched. */
  quota?: QuotaInfo;
}

export interface SyncProgress {
  phase: 'scan' | 'upload-meta' | 'upload-files' | 'download-meta' | 'download-files' | 'apply' | 'done';
  current: number;
  total: number;
  message?: string;
  /** When phase === 'upload-files' / 'download-files', the file we're on. */
  currentFile?: string;
  bytesTransferred?: number;
}

export interface SyncResult {
  ok: boolean;
  direction: 'upload' | 'download' | 'noop';
  uploadedFiles?: number;
  downloadedFiles?: number;
  bytes?: number;
  durationMs?: number;
  error?: string;
}

/** Admin endpoint responses. */
export interface AdminWindowSummary {
  username: string;
  profileId: string;
  profileName: string;
  groupName?: string;
  filesBytes: number;
  filesUploadedAt: number;
}

/** Server enforces these — keep in sync with auth-server/server.js. */
export const SYNC_QUOTA_BYTES = 500 * 1024 * 1024;        // 500 MB / user
export const SYNC_MAX_FILE_BYTES = 50 * 1024 * 1024;      // 50 MB / file
