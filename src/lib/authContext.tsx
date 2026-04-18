import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AuthError,
  AuthUser,
  HEARTBEAT_INTERVAL_MS,
  clearSession,
  getStoredToken,
  getStoredUser,
  login as apiLogin,
  register as apiRegister,
  verifyStoredSession,
} from './authClient';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; reason?: string }
  | { status: 'authenticated'; user: AuthUser; offline: boolean };

interface AuthContextValue {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<{ message: string; pending?: boolean }>;
  logout: (reason?: string) => void;
  recheck: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const logout = useCallback((reason?: string) => {
    clearSession();
    stopHeartbeat();
    setState({ status: 'unauthenticated', reason });
  }, [stopHeartbeat]);

  const recheck = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setState({ status: 'unauthenticated' });
      return;
    }
    try {
      const user = await verifyStoredSession();
      if (user) {
        setState({ status: 'authenticated', user, offline: false });
      } else {
        setState({ status: 'unauthenticated' });
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === 'NETWORK') {
        // Server unreachable — fall back to cached user but mark offline.
        const cached = getStoredUser();
        if (cached) {
          setState({ status: 'authenticated', user: cached, offline: true });
        } else {
          setState({ status: 'unauthenticated', reason: '无法连接服务器' });
        }
        return;
      }
      const code = err instanceof AuthError ? err.code : 'UNKNOWN';
      const msg = err instanceof Error ? err.message : '会话校验失败';
      setState({ status: 'unauthenticated', reason: `${msg}（${code}）` });
    }
  }, []);

  // Initial session check on mount
  useEffect(() => {
    void recheck();
  }, [recheck]);

  // Heartbeat while authenticated
  useEffect(() => {
    if (state.status !== 'authenticated') {
      stopHeartbeat();
      return;
    }
    stopHeartbeat();
    heartbeatTimer.current = setInterval(async () => {
      const token = getStoredToken();
      if (!token) {
        logout();
        return;
      }
      try {
        const u = await verifyStoredSession();
        if (u) {
          // Recover from "offline" badge once server is reachable again.
          setState((prev) => prev.status === 'authenticated' && prev.offline
            ? { status: 'authenticated', user: u, offline: false }
            : prev);
        }
      } catch (err) {
        if (err instanceof AuthError) {
          if (err.code === 'NETWORK') {
            // Mark offline, do NOT log out
            setState((prev) => prev.status === 'authenticated'
              ? { status: 'authenticated', user: prev.user, offline: true }
              : prev);
            return;
          }
          // Hard failure → log out with reason
          logout(err.message);
          return;
        }
        logout('会话已失效');
      }
    }, HEARTBEAT_INTERVAL_MS);
    return stopHeartbeat;
  }, [state.status, logout, stopHeartbeat]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiLogin(username, password);
    setState({ status: 'authenticated', user: { username: r.username, role: r.role }, offline: false });
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    return apiRegister(username, password);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    login,
    register,
    logout,
    recheck,
  }), [state, login, register, logout, recheck]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
