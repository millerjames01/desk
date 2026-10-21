/**
 * Raw page HTML → article record (brief §4.1, steps 4–7), in the browser.
 * Readability finds the body; Turndown writes it as Markdown. Images are only
 * chosen here; images.ts downloads and greys them.
 */

import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { checkArticle, visibleWords } from './quality';
import { countWords, markdownBlocks, normalize, readMinutes } from './text';
import type { Flag } from '../types';

export interface Extracted {
  title: string;
  dek: string;
  author: string;
  siteName: string;
  domain: string;
  url: string;
  published: string;
  section: string;
  markdown: string;
  /** Absolute image URLs kept, in order, with captions. */
  images: { src: string; caption: string }[];
  words: number;
  read_minutes: number;
  flags: Flag[];
}

export function parseHtml(html: string, url: string, parser?: (html: string) => Document): Document {
  const doc = parser ? parser(html) : new DOMParser().parseFromString(html, 'text/html');
  // Relative links and images resolve against the article, not against Desk.
  let base = doc.querySelector('base');
  if (!base) {
    base = doc.createElement('base');
    doc.head?.prepend(base);
  }
  base.setAttribute('href', new URL(base.getAttribute('href') ?? '', url).href);
  return doc;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function meta(doc: Document, ...names: string[]): string {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return '';
}

function isoDate(s: string): string {
  if (!s) return '';
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const JUNK_IMG = /(icon|avatar|headshot|author|logo|sprite|pixel|tracking|gravatar|badge|emoji|spinner|placeholder|1x1|blank\.gif)/i;
const JUNK_TEXT = /^(share|tweet|email|print|subscribe|sign up|newsletter|related|read more|more from|advertisement|sponsored|follow us|support our)/i;

function bestSrc(img: Element, base: string): string {
  const candidates: [string, number][] = [];
  for (const attr of ['srcset', 'data-srcset']) {
    const set = img.getAttribute(attr);
    if (!set) continue;
    for (const part of set.split(',')) {
      const [u, w] = part.trim().split(/\s+/);
      if (u) candidates.push([u, parseFloat(w) || 1]);
    }
  }
  candidates.sort((a, b) => b[1] - a[1]);
  const src = candidates[0]?.[0] || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
  if (!src || src.startsWith('data:')) return '';
  try {
    return new URL(src, base).href;
  } catch {
    return '';
  }
}

/** Picks at most `max` images: the lead image first, then captioned ones, then the rest. */
function chooseImages(root: HTMLElement, base: string, leadSrc: string, max: number): void {
  const scored: { el: Element; score: number; order: number }[] = [];
  root.querySelectorAll('img').forEach((img, order) => {
    const src = bestSrc(img, base);
    const w = parseInt(img.getAttribute('width') ?? '', 10);
    const junk = !src || JUNK_IMG.test(src) || JUNK_IMG.test(img.className) || JUNK_IMG.test(img.getAttribute('alt') ?? '') || (w > 0 && w < 300);
    const target = img.closest('figure') ?? img.closest('picture') ?? img;
    if (junk) {
      target.remove();
      return;
    }
    img.setAttribute('src', src);
    img.removeAttribute('srcset');
    const captioned = !!img.closest('figure')?.querySelector('figcaption');
    const lead = leadSrc && src.split('?')[0] === leadSrc.split('?')[0];
    scored.push({ el: target, score: (lead ? 4 : 0) + (captioned ? 2 : 0) + (order === 0 ? 1 : 0), order });
  });
  const keep = new Set(
    [...scored].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, Math.max(0, max)).map((s) => s.el),
  );
  for (const s of scored) if (!keep.has(s.el)) s.el.remove();
}

function stripJunk(root: HTMLElement): void {
  root.querySelectorAll('script,style,noscript,iframe,form,button,input,select,svg,video,audio,nav,aside').forEach((el) => el.remove());
  root.querySelectorAll('p,div,section,ul').forEach((el) => {
    const t = (el.textContent ?? '').trim();
    if (t.length < 160 && JUNK_TEXT.test(t) && !el.querySelector('img')) el.remove();
  });
}

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', emDelimiter: '*', bulletListMarker: '-', hr: '* * *' });
  td.addRule('figure', {
    filter: 'figure',
    replacement(_content, node) {
      const el = node as HTMLElement;
      const img = el.querySelector('img');
      if (!img) return '\n\n' + (el.textContent ?? '').trim() + '\n\n';
      const caption = normalize(el.querySelector('figcaption')?.textContent ?? '').replace(/"/g, '”');
      const alt = (img.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
      return `\n\n![${alt}](${img.getAttribute('src')}${caption ? ` "${caption}"` : ''})\n\n`;
    },
  });
  td.addRule('picture', { filter: ['picture'], replacement: (c) => c });
  td.addRule('loneImage', {
    filter: (node) => node.nodeName === 'IMG' && !node.closest('figure'),
    replacement(_c, node) {
      const img = node as HTMLElement;
      return `\n\n![${(img.getAttribute('alt') ?? '').replace(/[[\]]/g, '')}](${img.getAttribute('src')})\n\n`;
    },
  });
  // Footnote references and definitions come through as plain text and
  // superscripts; markdown-it-footnote can't recover them reliably, so keep them visible.
  td.keep(['sup', 'sub']);
  return td;
}

/** "Essay | Little Review" → "Essay" when the tail is the site's name. */
export function cleanTitle(title: string, site: string): string {
  if (!site) return title;
  const m = title.match(/^(.*\S)\s+[|\-–—·:]\s+(.+)$/);
  return m && normalize(m[2]).toLowerCase() === site.toLowerCase() ? m[1] : title;
}

export function extract(
  html: string,
  url: string,
  opts: { maxImages: number; parser?: (html: string) => Document },
): Extracted {
  const doc = parseHtml(html, url, opts.parser);
  const base = doc.baseURI || url;
  const rawWords = visibleWords(doc);
  const lead = meta(doc, 'og:image', 'twitter:image');
  const article = new Readability(doc.cloneNode(true) as Document, { keepClasses: false, charThreshold: 300 }).parse();

  const container = doc.createElement('div');
  container.innerHTML = article?.content ?? '';
  stripJunk(container);
  chooseImages(container, base, lead ? new URL(lead, base).href : '', opts.maxImages);
  // Readability repeats the title as the first heading more often than not.
  const title = cleanTitle(normalize(article?.title || meta(doc, 'og:title') || doc.title || 'Untitled'), normalize(article?.siteName || meta(doc, 'og:site_name')));
  const first = container.querySelector('h1, h2');
  if (first && normalize(first.textContent ?? '') === title) first.remove();
  // Readability leaves the byline in the body when the page's metadata named the author.
  const author = normalize(article?.byline || meta(doc, 'author', 'article:author', 'parsely-author') || '').replace(/^by\s+/i, '');
  // Only an exact "By <author>" goes: a first sentence starting "By the time…" stays.
  const firstPara = container.querySelector('p');
  const firstText = normalize(firstPara?.textContent ?? '').replace(/^by\s+/i, '').toLowerCase();
  if (firstPara && author && firstText === author.toLowerCase()) firstPara.remove();

  const markdown = turndown()
    .turndown(container)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const images = [...markdown.matchAll(/!\[[^\]]*\]\((\S+?)(?:\s+"([^"]*)")?\)/g)].map((m) => ({ src: m[1], caption: m[2] ?? '' }));
  const words = countWords(markdownBlocks(markdown).body.join(' '));

  return {
    title,
    dek: normalize(meta(doc, 'og:description', 'description', 'twitter:description') || article?.excerpt || ''),
    author,
    siteName: normalize(article?.siteName || meta(doc, 'og:site_name') || ''),
    domain: domainOf(url),
    url,
    published: isoDate(article?.publishedTime || meta(doc, 'article:published_time', 'datePublished', 'date', 'pubdate')),
    section: normalize(meta(doc, 'article:section', 'parsely-section')),
    markdown,
    images,
    words,
    read_minutes: readMinutes(words),
    flags: checkArticle(markdown, rawWords),
  };
}

/** Plain pasted text → Markdown paragraphs. Used for the "needs manual paste" path. */
export function fromPlainText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}
