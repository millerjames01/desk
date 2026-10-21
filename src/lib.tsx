import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { all, onChange } from './db';
import { loadSettings } from './settings';
import type { Article, Issue, Journal, PagePhoto, Piece, Publication, Settings, Submission, Version } from './types';

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string): void {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

export interface Data {
  settings: Settings;
  issues: Issue[];
  articles: Article[];
  publications: Publication[];
  pieces: Piece[];
  versions: Version[];
  pages: PagePhoto[];
  journals: Journal[];
  submissions: Submission[];
}

async function loadAll(): Promise<Data> {
  const [settings, issues, articles, publications, pieces, versions, pages, journals, submissions] = await Promise.all([
    loadSettings(), all('issues'), all('articles'), all('publications'), all('pieces'), all('versions'), all('pages'), all('journals'), all('submissions'),
  ]);
  return { settings, issues, articles, publications, pieces, versions, pages, journals, submissions };
}

/** Everything but the blobs, reloaded after every write. Small enough for one person's desk. */
export function useData(): Data | null {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    let queued = false;
    const reload = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        loadAll().then((d) => alive && setData(d));
      });
    };
    reload();
    const off = onChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return data;
}

export function useDebounced<T>(fn: (v: T) => void, ms: number): (v: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback((v: T) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(v), ms);
  }, [ms]);
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDay(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function ago(iso?: string): string {
  if (!iso) return '';
  const days = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(iso);
}

export function plural(n: number, word: string, many = word + 's'): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Badge({ tone = 'plain', children }: { tone?: 'plain' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/** A transient message line under an action. */
export function useNotice(): [ReactNode, (msg: string, tone?: 'good' | 'bad') => void] {
  const [msg, setMsg] = useState<{ text: string; tone: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    clearTimeout(timer.current);
    setMsg({ text, tone });
    timer.current = setTimeout(() => setMsg(null), tone === 'bad' ? 12000 : 5000);
  }, []);
  return [msg ? <p className={`notice ${msg.tone}`}>{msg.text}</p> : null, show];
}
