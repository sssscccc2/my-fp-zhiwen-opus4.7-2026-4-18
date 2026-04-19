/**
 * Renderer-side wrapper for cloud sync. Pulls token + serverUrl from the
 * existing auth client (so it shares the user's logged-in session) and
 * delegates the heavy lifting to the main process via IPC.
 */
import { api } from '../api';
import { getServerUrl, getStoredToken } from './authClient';
import type { SyncStatus, SyncResult, SyncProgress } from '@shared/syncTypes';

class NotLoggedInError extends Error {
  constructor() { super('未登录，无法同步'); this.name = 'NotLoggedInError'; }
}

function ensureCreds(): { server: string; token: string } {
  const token = getStoredToken();
  if (!token) throw new NotLoggedInError();
  return { server: getServerUrl(), token };
}

export async function fetchStatus(): Promise<SyncStatus> {
  const { server, token } = ensureCreds();
  return api.sync.status(server, token);
}

export async function uploadAll(): Promise<SyncResult> {
  const { server, token } = ensureCreds();
  return api.sync.upload(server, token);
}

export async function downloadAll(): Promise<SyncResult> {
  const { server, token } = ensureCreds();
  return api.sync.download(server, token);
}

export async function deleteRemote(profileId: string): Promise<void> {
  const { server, token } = ensureCreds();
  await api.sync.deleteRemote(server, token, profileId);
}

export function onProgress(cb: (p: SyncProgress) => void): () => void {
  return api.sync.onProgress(cb);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function fmtTime(ms: number): string {
  if (!ms) return '从未';
  const d = new Date(ms);
  const now = new Date();
  const diff = now.getTime() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function describeDirection(d: SyncStatus['direction']): { label: string; color: string; hint: string } {
  switch (d) {
    case 'in-sync':       return { label: '已同步', color: '#22c55e', hint: '本地与云端一致' };
    case 'local-newer':   return { label: '需要上传', color: '#3b82f6', hint: '本地有未上传的更改' };
    case 'remote-newer':  return { label: '云端更新', color: '#f59e0b', hint: '云端有新数据，建议下载' };
    case 'conflict':      return { label: '存在冲突', color: '#ef4444', hint: '本地和云端都有改动，请选择保留哪一边' };
    case 'never-synced':  return { label: '尚未同步', color: '#6366f1', hint: '云端还没有任何备份' };
    case 'remote-only':   return { label: '仅云端', color: '#a855f7', hint: '本地为空，可下载云端数据' };
  }
}
