import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { friendlyError, loadSnapshot, openDatabase, requestPersistentStorage, type DB, type Snapshot } from './db/db';
import { todayLocal } from './lib/dates';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface Ctx {
  db: DB;
  snap: Snapshot;
  refresh: () => Promise<Snapshot>;
  /** Run a DB mutation, refresh state, report errors. Returns undefined on failure. */
  run: <T>(fn: (db: DB) => Promise<T>, okText?: string | ((r: T) => string)) => Promise<T | undefined>;
  toast: (kind: Toast['kind'], text: string) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  today: string;
  persisted: boolean | null;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('no app context');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [today, setToday] = useState(todayLocal());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const tid = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const d = await openDatabase();
        setDb(d);
        setSnap(await loadSnapshot(d));
        setPersisted(await requestPersistentStorage());
      } catch (e) {
        setFatal(
          `Local database unavailable: ${(e as Error).message}. Private Browsing or restricted storage settings can block it.`,
        );
      }
    })();
    // keep "today" correct if the app stays open past midnight
    const t = setInterval(() => setToday(todayLocal()), 30_000);
    return () => clearInterval(t);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = ++tid.current;
      setToasts((t) => [...t.filter((x) => x.kind === 'error').slice(-1), { id, kind, text }]);
      if (kind !== 'error') setTimeout(() => dismiss(id), 2600);
    },
    [dismiss],
  );

  const refresh = useCallback(async () => {
    const s = await loadSnapshot(db as DB);
    setSnap(s);
    return s;
  }, [db]);

  const run = useCallback(
    async <T,>(fn: (db: DB) => Promise<T>, okText?: string | ((r: T) => string)) => {
      try {
        const r = await fn(db as DB);
        await refresh();
        if (okText) toast('ok', typeof okText === 'function' ? okText(r) : okText);
        return r;
      } catch (e) {
        toast('error', friendlyError(e));
        try {
          await refresh();
        } catch {
          /* ignore */
        }
        return undefined;
      }
    },
    [db, refresh, toast],
  );

  const value = useMemo(
    () => (db && snap ? { db, snap, refresh, run, toast, toasts, dismiss, today, persisted } : null),
    [db, snap, refresh, run, toast, toasts, dismiss, today, persisted],
  );

  if (fatal)
    return (
      <div className="fatal">
        <h1>Storage error</h1>
        <p>{fatal}</p>
      </div>
    );
  if (!value) return <div className="loading">Loading…</div>;
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/* ---------------- hash router ---------------- */

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  return { path: p ? p.split('/').map(decodeURIComponent) : [], query: new URLSearchParams(q ?? '') };
}

export function useRoute(): Route {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function go(path: string) {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}
