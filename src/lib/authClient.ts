/**
 * Client for the remote auth server (146.190.45.66:3000 by default).
 *
 * Token + server URL persist in localStorage so they survive Electron restarts.
 * Heartbeat is fired every HEARTBEAT_INTERVAL_MS to detect server-side disable
 * within at most that window.
 *
 * Errors:
 *   - Network failures throw with `code = 'NETWORK'` so callers can show a
 *     friendlier message (server down, no internet, etc.) instead of treating
 *     them like an "account disabled" event.
 *   - Server-issued auth failures throw with the server's `code` field
 *     (e.g. ACCOUNT_DISABLED, INVALID_TOKEN) so the UI can react accordingly.
 */

const STORAGE_TOKEN = 'fp.auth.token';
const STORAGE_USER = 'fp.auth.user';
const STORAGE_SERVER = 'fp.auth.server';

const DEFAULT_SERVER = 'http://146.190.45.66:3000';

export interface AuthUser {
  username: string;
  role: 'user' | 'admin';
}

export interface AuthResult extends AuthUser {
  token: string;
}

export class AuthError extends Error {
  /** Stable machine-readable code: ACCOUNT_DISABLED, INVALID_TOKEN, ACCOUNT_DELETED, NETWORK, HTTP_4XX, … */
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_SERVER) || DEFAULT_SERVER;
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) {
    localStorage.removeItem(STORAGE_SERVER);
  } else {
    localStorage.setItem(STORAGE_SERVER, trimmed);
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_TOKEN);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeSession(result: AuthResult): void {
  localStorage.setItem(STORAGE_TOKEN, result.token);
  localStorage.setItem(STORAGE_USER, JSON.stringify({ username: result.username, role: result.role }));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_USER);
}

async function call<T>(
  path: string,
  body: Record<string, unknown>,
  opts: { token?: string; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${getServerUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new AuthError(
      `无法连接服务器 (${getServerUrl()})：${(err as Error).message}`,
      'NETWORK',
    );
  } finally {
    clearTimeout(timer);
  }
  let data: { error?: string; code?: string; [k: string]: unknown };
  try {
    data = await resp.json();
  } catch {
    throw new AuthError(`服务器返回异常 (${resp.status})`, 'BAD_RESPONSE', resp.status);
  }
  if (!resp.ok) {
    throw new AuthError(
      (data.error as string) || `请求失败 (${resp.status})`,
      (data.code as string) || `HTTP_${resp.status}`,
      resp.status,
    );
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const r = await call<AuthResult>('/api/login', { username, password });
  storeSession(r);
  return r;
}

export async function register(
  username: string,
  password: string,
): Promise<{ message: string; pending?: boolean }> {
  return call('/api/register', { username, password });
}

export async function verify(token: string): Promise<AuthUser> {
  return call<AuthUser>('/api/verify', { token });
}

export async function ping(): Promise<{ status: string; time: number }> {
  return call('/api/ping', {});
}

/**
 * Verify the stored token. Returns the user if valid, or throws AuthError.
 * On NETWORK errors we keep the local session — server may be temporarily
 * unreachable, no point logging the user out.
 */
export async function verifyStoredSession(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const u = await verify(token);
    return u;
  } catch (err) {
    if (err instanceof AuthError && err.code === 'NETWORK') {
      // keep local session, surface error to caller
      throw err;
    }
    // Hard auth failure → drop session
    clearSession();
    throw err;
  }
}

/** ms */
export const HEARTBEAT_INTERVAL_MS = 60_000;
