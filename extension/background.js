/**
 * Desk Reader's background worker: a slow, honest fetcher.
 *
 * - Obeys each site's robots.txt for the DeskReader agent (or `*`).
 * - One request per host every 3 s at least, longer if Crawl-delay asks.
 * - Identifies itself in the User-Agent.
 * - Caches pages for 30 days, so nothing is fetched twice.
 * - Fetches only what Desk asks for; it never follows links on its own.
 */

import { AGENT, MIN_GAP_MS, crawlDelay, isAllowed, parseRobots } from './robots.js';

const DESK_URLS = ['https://millerjames01.github.io/desk/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const DESK_HOME = 'https://millerjames01.github.io/desk/#/read';
const UA = `Mozilla/5.0 (compatible; ${AGENT}/${chrome.runtime.getManifest().version}; personal reading, one request per few seconds; +https://github.com/millerjames01/desk)`;
const CACHE = 'desk-pages-v1';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

// The worker's own requests (no tab) carry the honest User-Agent.
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: UA }] },
    condition: { tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'other', 'image'] },
  }],
});

const robots = new Map();
const lastHit = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function robotsFor(origin) {
  const hit = robots.get(origin);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit;
  let entry = { groups: [], delay: 0, at: Date.now() };
  try {
    const res = await fetch(`${origin}/robots.txt`, { credentials: 'omit' });
    if (res.ok) {
      const text = await res.text();
      entry = { groups: parseRobots(text), delay: crawlDelay(text), at: Date.now() };
    }
  } catch {
    // No robots.txt reachable: the default is allow.
  }
  robots.set(origin, entry);
  return entry;
}

/** Waits for this host's turn. Turns are reserved in order, so parallel asks queue. */
async function turn(url) {
  const u = new URL(url);
  const r = await robotsFor(u.origin);
  if (!isAllowed(r.groups, u.pathname + u.search)) {
    throw new Error(`${u.hostname}'s robots.txt asks automated readers not to fetch ${u.pathname}. Open it yourself and press the Desk button to capture it.`);
  }
  const gap = Math.max(MIN_GAP_MS, r.delay);
  const at = Math.max(Date.now(), (lastHit.get(u.host) ?? 0) + gap);
  lastHit.set(u.host, at);
  await sleep(at - Date.now());
}

async function cached(url) {
  const cache = await caches.open(CACHE);
  const res = await cache.match(url);
  if (res && Date.now() - Number(res.headers.get('x-desk-at') ?? 0) < MAX_AGE_MS) return res;
  return null;
}

async function store(url, body, type) {
  const cache = await caches.open(CACHE);
  await cache.put(url, new Response(body, { headers: { 'content-type': type, 'x-desk-at': String(Date.now()) } }));
}

async function fetchText(url) {
  const hit = await cached(url);
  if (hit) return hit.text();
  await turn(url);
  const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}`);
  const text = await res.text();
  await store(url, text, 'text/html');
  return text;
}

async function fetchImage(url) {
  const hit = await cached(url);
  const blob = hit ? await hit.blob() : await (async () => {
    await turn(url);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const b = await res.blob();
    await store(url, b, b.type || 'image/jpeg');
    return b;
  })();
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.op === 'fetch') return fetchText(msg.url);
    if (msg.op === 'image') return fetchImage(msg.url);
    if (msg.op === 'take-pending') {
      const { pending = [] } = await chrome.storage.session.get('pending');
      await chrome.storage.session.set({ pending: [] });
      return pending;
    }
    throw new Error(`Unknown request ${msg.op}`);
  })().then(
    (value) => reply({ ok: true, value }),
    (e) => reply({ ok: false, error: String(e?.message ?? e) }),
  );
  return true;
});

// ---------- The toolbar button: capture the page you're reading ----------

async function captureTab(tab) {
  if (!tab.id || !/^https?:/.test(tab.url ?? '')) return;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ url: location.href, title: document.title, html: document.documentElement.outerHTML }),
  });
  const desks = await chrome.tabs.query({ url: DESK_URLS });
  const desk = desks.find((t) => !t.url?.includes('book.html'));
  if (desk?.id) {
    await chrome.tabs.sendMessage(desk.id, { type: 'capture', capture: result });
    chrome.action.setBadgeText({ tabId: tab.id, text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2500);
    return;
  }
  const { pending = [] } = await chrome.storage.session.get('pending');
  await chrome.storage.session.set({ pending: [...pending, result] });
  chrome.tabs.create({ url: DESK_HOME });
}

chrome.action.onClicked.addListener(captureTab);
// Reachable from the worker's console (and tests): deskCapture(tab).
self.deskCapture = captureTab;
