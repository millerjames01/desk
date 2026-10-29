/**
 * Booklet QA (brief §4.4), run on the pages Paged.js laid out. Hard errors
 * block printing; warnings and notes go in the report.
 *
 * Text integrity compares each article's body before pagination with what
 * landed on the pages, in order, with all whitespace removed. A dropped or
 * repeated paragraph fails the issue.
 */

import { markdownBlocks, normalize, squash } from './text';

export type Level = 'error' | 'warn' | 'note';

export interface QaItem {
  level: Level;
  check: 'integrity' | 'source' | 'blank' | 'overflow' | 'widow' | 'orphan' | 'heading' | 'image' | 'length' | 'skin' | 'flag';
  message: string;
  article?: string;
  page?: number;
}

export interface QaReport {
  at: string;
  pages: number;
  items: QaItem[];
  ok: boolean;
}

const LEAF = 'p, h2, h3, li, figcaption, pre, td, th, blockquote';
const SKIP = '.fn, .fn-ref, .end-mark, .fn-mark';

function textOf(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(SKIP).forEach((x) => x.remove());
  // When a page breaks inside a hyphenated word, Paged.js ends the first
  // half with its own hyphen (U+2011) and marks the element: that glyph is
  // the layout's, not the writer's.
  for (const h of [c, ...c.querySelectorAll('*')].filter((x) => x.classList.contains('pagedjs_hyphen'))) {
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (last?.data.endsWith('\u2011')) last.data = last.data.slice(0, -1);
  }
  return c.textContent ?? '';
}

/** The leaf text blocks of an element, in document order. */
export function leafBlocks(root: Element): string[] {
  const out: string[] = [];
  root.querySelectorAll(LEAF).forEach((el) => {
    if (el.closest(SKIP) || el.querySelector(LEAF)) return;
    const t = normalize(textOf(el));
    if (t) out.push(t);
  });
  return out;
}

export interface Located {
  /** Squashed text of every fragment, in page order. */
  text: string;
  /** Offset at which each page's text starts, with its page number. */
  starts: { offset: number; page: number }[];
}

export function pageAt(loc: Located, offset: number): number {
  let page = loc.starts[0]?.page ?? 0;
  for (const s of loc.starts) if (s.offset <= offset) page = s.page;
  return page;
}

/**
 * Finds every block, in order, in the paginated text. Missing blocks and
 * blocks that occur more often than in the source are errors.
 */
export function compareBlocks(blocks: string[], loc: Located, article: string): QaItem[] {
  const items: QaItem[] = [];
  let pos = 0;
  for (const b of blocks) {
    const s = squash(b);
    if (!s) continue;
    const at = loc.text.indexOf(s, pos);
    if (at < 0) {
      items.push({ level: 'error', check: 'integrity', article, page: pageAt(loc, pos), message: `Missing or out of order: “${b.slice(0, 80)}${b.length > 80 ? '…' : ''}”` });
      continue;
    }
    pos = at + s.length;
  }
  // Count each block the same way on both sides: a short paragraph that also
  // sits inside a longer one (a refrain) is found several times in each.
  const occurrences = (hay: string, s: string) => {
    let n = 0;
    for (let i = hay.indexOf(s); i >= 0; i = hay.indexOf(s, i + 1)) n++;
    return n;
  };
  const source = blocks.map(squash).join('');
  for (const s of new Set(blocks.map(squash).filter((x) => x.length >= 24))) {
    const n = occurrences(source, s);
    const count = occurrences(loc.text, s);
    if (count > n) {
      const first = loc.text.indexOf(s);
      const second = loc.text.indexOf(s, first + 1);
      items.push({ level: 'error', check: 'integrity', article, page: pageAt(loc, second), message: `Repeated on the page (${count}× for ${n} in the source): “${s.slice(0, 60)}…”` });
    }
  }
  const total = blocks.reduce((n, b) => n + squash(b).length, 0);
  if (!items.length && loc.text.length > total * 1.02 + 40) {
    items.push({ level: 'error', check: 'integrity', article, message: `${loc.text.length - total} more characters on the page than in the source.` });
  }
  return items;
}

/** Lines in a rendered element, counted from its distinct line boxes. */
function lineCount(el: Element): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = new Set<number>();
  for (const r of range.getClientRects()) if (r.height > 3 && r.width > 1) tops.add(Math.round(r.top / 2));
  return tops.size;
}

export interface QaInput {
  pages: HTMLElement[];
  /** The issue as rendered before pagination. */
  source: Element;
  articles: { id: string; title: string; markdown: string }[];
}

export function runQa({ pages, source, articles }: QaInput): QaItem[] {
  const items: QaItem[] = [];
  const titles = new Map(articles.map((a) => [a.id, a.title]));

  // ---------- Text integrity (hard) ----------
  for (const a of articles) {
    const body = source.querySelector(`.article-body[data-article="${a.id}"]`);
    if (!body) {
      items.push({ level: 'error', check: 'integrity', article: a.title, message: 'Article missing from the rendered issue.' });
      continue;
    }
    const blocks = leafBlocks(body);
    const loc: Located = { text: '', starts: [] };
    for (const page of pages) {
      const num = Number(page.dataset.pageNumber);
      const frags = page.querySelectorAll(`.article-body[data-article="${a.id}"]`);
      if (!frags.length) continue;
      loc.starts.push({ offset: loc.text.length, page: num });
      frags.forEach((f) => (loc.text += squash(textOf(f))));
    }
    items.push(...compareBlocks(blocks, loc, a.title));

    // Markdown → HTML should keep every block too. A mismatch here is a
    // conversion quirk to look at, not proof of loss, so it only warns.
    const html = squash(blocks.join(' '));
    for (const b of markdownBlocks(a.markdown).body) {
      const s = squash(b);
      if (s && !html.includes(s)) {
        items.push({ level: 'warn', check: 'source', article: a.title, message: `Markdown block not matched in the typeset text: “${b.slice(0, 70)}…”` });
        break;
      }
    }
  }

  // Footnotes land in the footnote area; check each one is somewhere.
  const notesOnPages = squash(pages.map((p) => [...p.querySelectorAll('.fn')].map((f) => textOf(f)).join(' ')).join(' '));
  source.querySelectorAll('.fn').forEach((fn) => {
    const s = squash(textOf(fn));
    if (s && !notesOnPages.includes(s)) {
      const art = fn.closest('.article-body')?.getAttribute('data-article') ?? '';
      items.push({ level: 'error', check: 'integrity', article: titles.get(art), message: `Footnote missing: “${normalize(textOf(fn)).slice(0, 60)}…”` });
    }
  });

  // ---------- The cover is one page (hard) ----------
  const coverPages = pages.filter((p) => p.querySelector('.cover'));
  if (coverPages.length > 1) items.push({ level: 'error', check: 'overflow', page: Number(coverPages[1].dataset.pageNumber), message: 'The cover runs onto a second page.' });

  for (const page of pages) {
    const num = Number(page.dataset.pageNumber);
    const area = page.querySelector('.pagedjs_page_content') as HTMLElement | null;
    if (!area) continue;
    const articleId = page.querySelector('.article-body[data-article]')?.getAttribute('data-article') ?? '';
    const article = titles.get(articleId);

    // ---------- Blank pages (hard unless intentional) ----------
    const hasText = (area.textContent ?? '').trim().length > 0;
    const hasArt = !!area.querySelector('img, .ruled, hr');
    if (!hasText && !hasArt) {
      const intentional = page.classList.contains('pagedjs_blank_page') || !!area.querySelector('.pad');
      items.push(
        intentional
          ? { level: 'note', check: 'blank', page: num, message: page.classList.contains('pagedjs_blank_page') ? 'Blank so the next article starts on a right-hand page.' : area.querySelector('.inside-cover') ? 'Inside of the cover card, left bare.' : 'Blank padding to a multiple of 4 pages.' }
          : { level: 'error', check: 'blank', page: num, message: 'Unintended blank page.' },
      );
    }

    // ---------- Overflow (hard) ----------
    const box = area.getBoundingClientRect();
    area.querySelectorAll('p, h1, h2, h3, li, figure, img, table, pre, blockquote, .article-head, .cover > *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const over = Math.max(r.right - box.right, box.left - r.left, r.bottom - box.bottom, box.top - r.top);
      if (over > 2) {
        items.push({ level: 'error', check: 'overflow', page: num, article, message: `${el.tagName.toLowerCase()} runs ${Math.round(over * 0.2646 * 10) / 10} mm past the text block.` });
      }
    });

    // Footnotes clipped by their own area.
    const notes = page.querySelector('.pagedjs_footnote_area') as HTMLElement | null;
    if (notes && notes.querySelector('.fn')) {
      const inner = notes.querySelector('.pagedjs_footnote_content') as HTMLElement | null;
      const clip = (inner?.scrollHeight ?? 0) - (inner?.clientHeight ?? 0);
      if (clip > 2) items.push({ level: 'error', check: 'overflow', page: num, article, message: `Footnote cut off by ${Math.round(clip * 0.2646 * 10) / 10} mm.` });
    }

    // ---------- Widows and orphans (soft) ----------
    area.querySelectorAll('p[data-split-to]').forEach((p) => {
      if (lineCount(p) < 2) items.push({ level: 'warn', check: 'orphan', page: num, article, message: 'One line of a paragraph alone at the foot of the page.' });
    });
    area.querySelectorAll('p[data-split-from]').forEach((p) => {
      if (lineCount(p) < 2) items.push({ level: 'warn', check: 'widow', page: num, article, message: 'Last line of a paragraph alone at the top of the page.' });
    });
    const blocks = [...area.querySelectorAll('.article-body > *')].filter((el) => !el.matches('.fn'));
    const last = blocks[blocks.length - 1];
    if (last && /^H[23]$/.test(last.tagName) && !page.querySelector('.source-note')) {
      items.push({ level: 'warn', check: 'heading', page: num, article, message: `Subhead “${normalize(last.textContent ?? '').slice(0, 40)}” stranded at the foot of the page.` });
    }

    // ---------- Images (soft) ----------
    area.querySelectorAll('img').forEach((img) => {
      const w = (img as HTMLImageElement).offsetWidth;
      const nat = (img as HTMLImageElement).naturalWidth;
      if (!w || !nat) {
        items.push({ level: 'warn', check: 'image', page: num, article, message: 'Image did not load.' });
        return;
      }
      const dpi = Math.round(nat / (w / 96));
      if (dpi < 200) items.push({ level: 'warn', check: 'image', page: num, article, message: `Image prints at ${dpi} dpi, under 200.` });
      if (img.classList.contains('remote')) items.push({ level: 'note', check: 'image', page: num, article, message: 'Image loads from the web; it was not saved to this device.' });
    });
  }

  if (pages.length > 64) items.push({ level: 'warn', check: 'length', message: `${pages.length} pages. Above 64 (16 folded sheets) a home long-reach stapler struggles; consider two booklets.` });
  return items;
}
