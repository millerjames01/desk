/**
 * Getting a page's HTML into the browser without a server of our own.
 *
 * 1. Direct fetch: works for the few sites that send CORS headers.
 * 2. Public CORS proxies from Settings, one at a time, politely.
 * 3. The bookmarklet: run on the article's own tab, it posts the page to
 *    Desk. No proxy, and it sees what the reader sees, JavaScript included.
 * 4. Paste, for anything else.
 */

export interface Fetched {
  html: string;
  via: 'direct' | 'proxy';
  proxy?: string;
}

function proxied(template: string, url: string): string {
  return template.replace('{url}', encodeURIComponent(url));
}

async function getText(url: string, ms = 20000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeHtml(s: string): boolean {
  return s.length > 500 && /<(html|body|article|p)[\s>]/i.test(s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchPage(url: string, proxies: string[], onTry?: (label: string) => void): Promise<Fetched> {
  const errors: string[] = [];
  try {
    onTry?.('direct');
    const html = await getText(url, 10000);
    if (looksLikeHtml(html)) return { html, via: 'direct' };
  } catch (e) {
    errors.push(`direct: ${(e as Error).message}`);
  }
  for (const p of proxies) {
    const host = p.replace(/^https?:\/\//, '').split(/[/?]/)[0];
    try {
      onTry?.(host);
      const html = await getText(proxied(p, url));
      if (looksLikeHtml(html)) return { html, via: 'proxy', proxy: host };
      errors.push(`${host}: not an HTML page`);
    } catch (e) {
      errors.push(`${host}: ${(e as Error).message}`);
    }
    await sleep(800);
  }
  throw new Error(`Couldn't fetch the page (${errors.join('; ')}). Use the bookmarklet on the article's tab, or paste it.`);
}

/** Fetches an image as a Blob, directly or through the same proxies. */
export async function fetchImage(src: string, proxies: string[]): Promise<Blob | null> {
  for (const url of [src, ...proxies.map((p) => proxied(p, src))]) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.type.startsWith('image/') || blob.size > 2000) return blob;
    } catch {
      // next route
    }
  }
  return null;
}

// ---------- Bookmarklet ----------

export interface Posted {
  url: string;
  html: string;
  title: string;
  /** Data URLs of images the article tab could read, keyed by absolute URL. */
  images: Record<string, string>;
}

/**
 * The bookmarklet opens Desk's receive page and hands it the article tab's
 * HTML. Desk then asks for the images it decided to keep; the article tab
 * fetches them with its own origin and sends them back as data URLs.
 */
export function bookmarkletSource(deskUrl: string): string {
  const js = `(()=>{const D=${JSON.stringify(deskUrl)};const w=window.open(D+'#/read/receive','desk-receive');if(!w){alert('Desk: allow pop-ups for this site, then try again.');return}const read=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=()=>r(null);f.readAsDataURL(b)});const img=async u=>{try{const r=await fetch(u,{credentials:'include'});if(!r.ok)return null;return await read(await r.blob())}catch(e){return null}};const on=async e=>{if(e.source!==w)return;const m=e.data||{};if(m.type==='desk:ready')w.postMessage({type:'desk:page',url:location.href,title:document.title,html:document.documentElement.outerHTML},'*');if(m.type==='desk:want-images'){const out={};for(const u of m.urls){const d=await img(u);if(d)out[u]=d}w.postMessage({type:'desk:images',images:out},'*')}if(m.type==='desk:done')removeEventListener('message',on)};addEventListener('message',on)})()`;
  return 'javascript:' + encodeURIComponent(js);
}

/**
 * On Desk's receive page: announces itself to the opener, waits for the
 * page, then asks for images. Resolves with what arrived.
 */
export function receiveFromOpener(chooseImages: (html: string, url: string) => string[], timeoutMs = 30000): Promise<Posted> {
  return new Promise((resolve, reject) => {
    const opener = window.opener as Window | null;
    if (!opener) {
      reject(new Error('Open this page from the Desk bookmarklet on an article’s tab.'));
      return;
    }
    let page: Omit<Posted, 'images'> | null = null;
    const timer = setTimeout(() => {
      removeEventListener('message', on);
      if (page) resolve({ ...page, images: {} });
      else reject(new Error('The article tab never answered. Is it still open?'));
    }, timeoutMs);
    const on = (e: MessageEvent) => {
      if (e.source !== opener) return;
      const m = e.data ?? {};
      if (m.type === 'desk:page' && typeof m.html === 'string') {
        page = { url: String(m.url), html: m.html, title: String(m.title ?? '') };
        const urls = chooseImages(m.html, page.url);
        if (!urls.length) finish({});
        else opener.postMessage({ type: 'desk:want-images', urls }, '*');
      }
      if (m.type === 'desk:images' && page) finish(m.images ?? {});
    };
    const finish = (images: Record<string, string>) => {
      clearTimeout(timer);
      removeEventListener('message', on);
      opener.postMessage({ type: 'desk:done' }, '*');
      resolve({ ...page!, images });
    };
    addEventListener('message', on);
    opener.postMessage({ type: 'desk:ready' }, '*');
  });
}

export async function dataUrlToBlob(d: string): Promise<Blob> {
  return (await fetch(d)).blob();
}
