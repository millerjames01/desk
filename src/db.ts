/**
 * IndexedDB, wrapped just enough to use with await. Everything lives on this
 * device; backups (backup.ts) carry the text out, never the photos.
 */

import type { StoreMap, StoreName } from './types';

const DB_NAME = 'desk';
const DB_VERSION = 1;

const KEYS: Record<StoreName, string> = {
  kv: 'key',
  publications: 'domain',
  issues: 'id',
  articles: 'id',
  blobs: 'id',
  pieces: 'id',
  versions: 'id',
  pages: 'id',
  journals: 'id',
  submissions: 'id',
};

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(KEYS)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

const listeners = new Set<() => void>();
// Other Desk tabs (the bookmarklet's, the booklet's) write too.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('desk-db') : null;
channel?.addEventListener('message', () => {
  for (const fn of listeners) fn();
});

/** Re-render hook: every write, in this tab or another, notifies. */
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(): void {
  for (const fn of listeners) fn();
  channel?.postMessage('changed');
}

export async function all<S extends StoreName>(name: S): Promise<StoreMap[S][]> {
  return done((await store(name, 'readonly')).getAll()) as Promise<StoreMap[S][]>;
}

export async function get<S extends StoreName>(name: S, key: string): Promise<StoreMap[S] | undefined> {
  return done((await store(name, 'readonly')).get(key)) as Promise<StoreMap[S] | undefined>;
}

export async function put<S extends StoreName>(name: S, value: StoreMap[S]): Promise<void> {
  await done((await store(name, 'readwrite')).put(value));
  changed();
}

export async function putMany<S extends StoreName>(name: S, values: StoreMap[S][]): Promise<void> {
  if (!values.length) return;
  const tx = (await open()).transaction(name, 'readwrite');
  const os = tx.objectStore(name);
  for (const v of values) os.put(v);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  changed();
}

export async function remove(name: StoreName, key: string): Promise<void> {
  await done((await store(name, 'readwrite')).delete(key));
  changed();
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await get('kv', key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await put('kv', { key, value });
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return now().slice(0, 10);
}
