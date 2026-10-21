/**
 * How Desk reaches other sites. The Desk extension is preferred: it fetches
 * as the browser, so no proxy is involved. Without it, the public CORS
 * proxies from Settings. Either way the same manners apply: robots.txt is
 * obeyed, a host gets one request every three seconds at most (more if it
 * asks), and nothing is fetched twice in a session.
 */

import { crawlDelay, isAllowed, MIN_GAP_MS, parseRobots } from '../../extension/robots.js';

export interface Transport {
  name: 'extension' | 'proxy';
  fetchText(url: string): Promise<string>;
  fetchImage(url: string): Promise<Blob | null>;
}

// ---------- Extension bridge ----------

let extensionVersion: string | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

if (typeof window !== 'undefined') {
  addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'desk-ext') return;
    const m = e.data;
    if (m.type === 'hello') extensionVersion = String(m.version ?? '?');
    if (m.type === 'res' && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error ?? 'Extension request failed'));
    }
  });
}

function ask<T>(op: string, payload: Record<string, unknown>, timeoutMs = 120000): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The Desk extension did not answer.'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    window.postMessage({ source: 'desk', type: 'req', id, op, ...payload }, location.origin);
  });
}

/** Resolves with the extension's version, or null if it isn't installed. */
export async function detectExtension(): Promise<string | null> {
  if (extensionVersion) return extensionVersion;
  try {
    const v = await ask<string>('ping', {}, 800);
    extensionVersion = v;
    return v;
  } catch {
    return null;
  }
}

export const extensionTransport: Transport = {
  name: 'extension',
  fetchText: (url) => ask<string>('fetch', { url }),
  async fetchImage(url) {
    try {
      const dataUrl = await ask<string>('image', { url });
      return dataUrl ? (await fetch(dataUrl)).blob() : null;
    } catch {
      return null;
    }
  },
};

// ---------- Proxy, with the same manners ----------

const robotsCache = new Map<string, Promise<{ groups: ReturnType<typeof parseRobots>; delay: number }>>();
const lastHit = new Map<string, number>();
const textCache = new Map<string, string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viaProxies(url: string, proxies: string[]): Promise<Response> {
  let last: unknown;
  for (const p of proxies) {
    try {
      const res = await fetch(p.replace('{url}', encodeURIComponent(url)), { credentials: 'omit' });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('No proxy answered');
}

async function robotsFor(origin: string, proxies: string[]) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const text = await (await viaProxies(`${origin}/robots.txt`, proxies)).text();
        // A proxy's error page is not a robots.txt.
        if (/<html/i.test(text)) return { groups: [], delay: 0 };
        return { groups: parseRobots(text), delay: crawlDelay(text) };
      } catch {
        return { groups: [], delay: 0 };
      }
    })());
  }
  return robotsCache.get(origin)!;
}

async function polite(url: string, proxies: string[]): Promise<void> {
  const u = new URL(url);
  const robots = await robotsFor(u.origin, proxies);
  if (!isAllowed(robots.groups, u.pathname + u.search)) throw new Error(`${u.hostname}’s robots.txt asks automated readers not to fetch ${u.pathname}. Open it yourself and capture it with the bookmarklet.`);
  const gap = Math.max(MIN_GAP_MS, robots.delay);
  const wait = (lastHit.get(u.host) ?? 0) + gap - Date.now();
  lastHit.set(u.host, Date.now() + Math.max(0, wait));
  if (wait > 0) await sleep(wait);
}

export function proxyTransport(proxies: string[]): Transport {
  return {
    name: 'proxy',
    async fetchText(url) {
      if (textCache.has(url)) return textCache.get(url)!;
      await polite(url, proxies);
      const text = await (await viaProxies(url, proxies)).text();
      textCache.set(url, text);
      return text;
    },
    async fetchImage(url) {
      try {
        await polite(url, proxies);
        const blob = await (await viaProxies(url, proxies)).blob();
        return blob.size ? blob : null;
      } catch {
        return null;
      }
    },
  };
}

export async function bestTransport(proxies: string[]): Promise<Transport> {
  return (await detectExtension()) ? extensionTransport : proxyTransport(proxies);
}
