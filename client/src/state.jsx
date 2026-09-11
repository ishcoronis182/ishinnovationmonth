// App-wide state: the bootstrap payload, the live pulse, and toasts.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api.js';
import { useRoute } from './router.js';

const AppContext = createContext(null);

const MAX_TOASTS = 3;

export function AppProvider({ children }) {
  const route = useRoute();
  const [boot, setBoot] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | unauthorised | error
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const routeKey = `${route.name}:${route.params.id || route.params.token || ''}`;
  const lastRoute = useRef(routeKey);

  const pushToast = useCallback((tone, message) => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((current) => [...current, { id, tone, message }].slice(-MAX_TOASTS));
    const life = tone === 'error' ? 8000 : 4500;
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, life);
    return id;
  }, []);

  const toast = useMemo(() => ({
    ok: (message) => pushToast('ok', message),
    error: (message) => pushToast('error', message instanceof Error ? message.message : message),
    warn: (message) => pushToast('warn', message),
    info: (message) => pushToast('info', message),
    dismiss: (id) => setToasts((current) => current.filter((t) => t.id !== id)),
    clear: () => setToasts([]),
  }), [pushToast]);

  // Toasts clear on navigation so they never pile up across pages.
  useEffect(() => {
    if (lastRoute.current !== routeKey) {
      lastRoute.current = routeKey;
      setToasts([]);
    }
  }, [routeKey]);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
    try {
      const payload = await api.bootstrap();
      setBoot(payload);
      setError(null);
      setStatus('ready');
      return payload;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus('unauthorised');
        setError(null);
        return null;
      }
      setError(err);
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    const isPublic = route.name === 'portal' || route.name === 'refer';
    if (isPublic) {
      setStatus('public');
      return;
    }
    if (!boot) load();
  }, [route.name, boot, load]);

  const refreshPulse = useCallback(async () => {
    try {
      const payload = await api.bootstrap();
      setBoot(payload);
    } catch {
      // a failed refresh is not worth interrupting the page for
    }
  }, []);

  const value = useMemo(() => ({
    boot,
    status,
    error,
    route,
    toasts,
    toast,
    reload: load,
    refreshPulse,
    setStatus,
    firm: boot?.firm || { name: 'PARTNER PULSE', broker: '', office: '' },
    today: boot?.today || '',
    ai: boot?.ai || { enabled: false },
    pulse: boot?.pulse || { inFlight: 0, redRecords: 0, commsDue: 0, updatesThisWeek: 0 },
  }), [boot, status, error, route, toasts, toast, load, refreshPulse]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/** Load data for a page, with loading and error state. */
export function useAsync(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loader();
      if (alive.current) {
        setData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      if (alive.current) setError(err);
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (immediate) run();
  }, [run, immediate]);

  return { data, setData, loading, error, reload: run };
}

export function Toasts() {
  const { toasts, toast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          <button type="button" className="toast__close" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
