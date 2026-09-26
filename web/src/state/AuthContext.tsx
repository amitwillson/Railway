import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, ApiError } from '../api/client';
import idb from '../lib/idb';
import type { Bootstrap, Counters, Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  masters: Bootstrap | null;
  counters: Counters | null;
  unread: number;
  signIn: (identifier: string, password: string) => Promise<void>;
  requestOtp: (identifier: string) => Promise<{ target?: string; dev_otp?: string; channel: string }>;
  signInWithOtp: (identifier: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCounters: () => Promise<void>;
  setUnread: (n: number) => void;
  can: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const MASTERS_CACHE_KEY = 'masters.bootstrap';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [masters, setMasters] = useState<Bootstrap | null>(null);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [unread, setUnread] = useState(0);

  /** Loads master data, preferring the network and falling back to the cache. */
  const loadMasters = useCallback(async () => {
    const cached = await idb.get<Bootstrap>(MASTERS_CACHE_KEY);
    if (cached) setMasters(cached);
    try {
      const fresh = await api.get<Bootstrap>('/masters/bootstrap');
      setMasters(fresh);
      await idb.set(MASTERS_CACHE_KEY, fresh);
    } catch {
      /* offline: the cached snapshot keeps the inspection screen working */
    }
  }, []);

  const refreshCounters = useCallback(async () => {
    try {
      setCounters(await api.get<Counters>('/observations/counters'));
    } catch {
      /* counters are decorative when offline */
    }
  }, []);

  const bootstrapSession = useCallback(async () => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    try {
      const me = await api.get<{ user: User; unread_notifications: number }>('/auth/me');
      setUser(me.user);
      setUnread(me.unread_notifications);
      await Promise.all([loadMasters(), refreshCounters()]);
    } catch (err) {
      if (err instanceof ApiError && err.isOffline) {
        // Keep the cached identity so offline capture still works.
        const cachedUser = await idb.get<User>('session.user');
        if (cachedUser) setUser(cachedUser);
        await loadMasters();
      } else {
        setToken(null);
        setUser(null);
      }
    } finally {
      setReady(true);
    }
  }, [loadMasters, refreshCounters]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setCounters(null);
    });
    void bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    if (user) void idb.set('session.user', user);
  }, [user]);

  const afterLogin = useCallback(
    async (payload: { token: string; user: User }) => {
      setToken(payload.token);
      setUser(payload.user);
      await Promise.all([loadMasters(), refreshCounters()]);
      try {
        const me = await api.get<{ unread_notifications: number }>('/auth/me');
        setUnread(me.unread_notifications);
      } catch {
        /* ignore */
      }
    },
    [loadMasters, refreshCounters]
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const payload = await api.post<{ token: string; user: User }>('/auth/login', { identifier, password });
      await afterLogin(payload);
    },
    [afterLogin]
  );

  const requestOtp = useCallback(
    (identifier: string) =>
      api.post<{ target?: string; dev_otp?: string; channel: string }>('/auth/otp/request', { identifier }),
    []
  );

  const signInWithOtp = useCallback(
    async (identifier: string, code: string) => {
      const payload = await api.post<{ token: string; user: User }>('/auth/otp/verify', { identifier, code });
      await afterLogin(payload);
    },
    [afterLogin]
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the local session is cleared regardless */
    }
    setToken(null);
    setUser(null);
    setCounters(null);
    setUnread(0);
    await idb.remove('session.user');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user, ready, masters, counters, unread,
      signIn, requestOtp, signInWithOtp, signOut, refreshCounters, setUnread,
      can: (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    }),
    [user, ready, masters, counters, unread, signIn, requestOtp, signInWithOtp, signOut, refreshCounters]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
