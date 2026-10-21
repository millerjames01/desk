/**
 * Backups are text only: every record, no photos, no article images, no raw
 * page HTML and no API key. Import merges by id and the newer record wins,
 * so moving a file between devices in both directions leaves both the same.
 */

import { all, putMany } from './db';
import { loadSettings, saveSettings } from './settings';
import type { StoreMap } from './types';

const STORES = ['publications', 'issues', 'articles', 'pieces', 'versions', 'pages', 'journals', 'submissions'] as const;
type Store = (typeof STORES)[number];

export interface Backup {
  app: 'desk';
  version: 1;
  exportedAt: string;
  settings: { book: unknown; proxies: string[]; claudeModel: string; ocrEngine: string };
  data: { [K in Store]: StoreMap[K][] };
}

export async function exportAll(): Promise<Backup> {
  const s = await loadSettings();
  const data = {} as Backup['data'];
  for (const name of STORES) (data as Record<string, unknown[]>)[name] = await all(name);
  return {
    app: 'desk',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { book: s.book, proxies: s.proxies, claudeModel: s.claudeModel, ocrEngine: s.ocrEngine },
    data,
  };
}

type Stamped = { updatedAt?: string };

/** Records from `incoming` that are new or newer than what `local` holds. */
export function newer<T extends Stamped>(local: T[], incoming: T[], key: (r: T) => string): T[] {
  const have = new Map(local.map((r) => [key(r), r]));
  return incoming.filter((r) => {
    const mine = have.get(key(r));
    return !mine || (r.updatedAt ?? '') > (mine.updatedAt ?? '');
  });
}

export async function importAll(b: Backup): Promise<Record<string, number>> {
  if (b?.app !== 'desk' || !b.data) throw new Error('Not a Desk backup file.');
  const counts: Record<string, number> = {};
  for (const name of STORES) {
    const incoming = (b.data[name] ?? []) as (StoreMap[Store] & Stamped)[];
    const key = (r: StoreMap[Store]) => ('domain' in r && name === 'publications' ? (r as { domain: string }).domain : (r as { id: string }).id);
    const take = newer(await all(name), incoming, key);
    await putMany(name, take as never[]);
    counts[name] = take.length;
  }
  const s = await loadSettings();
  await saveSettings({ ...s, book: { ...s.book, ...(b.settings?.book as object) }, proxies: b.settings?.proxies ?? s.proxies });
  return counts;
}

export function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
