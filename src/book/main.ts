/**
 * book.html: typesets one issue with Paged.js and lays it out for print.
 *
 *   book.html?issue=2026-11&layout=reading|booklet|fronts|backs|cover|interior|sheet[&print=1]
 *
 * Reading order first, padded to a multiple of 4 on a second pass so the
 * folios stay right. QA runs on the reading-order pages, then the pages are
 * moved onto A4 sheets for the print layouts.
 */

import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-600.css';
import '@fontsource/source-serif-4/latin-400-italic.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-500.css';
import '@fontsource/literata/latin-400-italic.css';
import './book.css';
import baseCss from '../read/house/base.css?raw';
import aCss from '../read/house/a-review.css?raw';
import bCss from '../read/house/b-grid.css?raw';
import cCss from '../read/house/c-pamphlet.css?raw';
import { Previewer } from 'pagedjs';
import { all, get, kvSet, now } from '../db';
import { loadSettings } from '../settings';
import { COVER_DEFAULTS, issueNumber } from '../read/issue';
import { renderIssue } from '../read/render';
import { markId } from '../read/mark';
import { runQa, type QaReport } from '../read/qa';
import { creep, padCount, sidesFor, type Layout } from '../read/impose';
import type { Article, HouseStyle, Publication } from '../types';

const HOUSE_CSS: Record<HouseStyle, string> = { 'a-review': aCss, 'b-grid': bCss, 'c-pamphlet': cCss };
const HOUSE_SHORT: Record<HouseStyle, string> = { 'a-review': 'house-a', 'b-grid': 'house-b', 'c-pamphlet': 'house-c' };
const LAYOUTS: { id: Layout | 'reading' | 'sheet'; label: string }[] = [
  { id: 'reading', label: 'Reading copy (A5)' },
  { id: 'booklet', label: 'Booklet (A4, duplex)' },
  { id: 'fronts', label: 'Fronts' },
  { id: 'backs', label: 'Backs' },
  { id: 'cover', label: 'Cover card' },
  { id: 'interior', label: 'Interior' },
  { id: 'sheet', label: 'Contact sheet' },
];

const FONTS = [
  '400 11pt "EB Garamond"', '500 11pt "EB Garamond"', 'italic 400 11pt "EB Garamond"',
  '400 11pt "Source Serif 4"', '600 11pt "Source Serif 4"', 'italic 400 11pt "Source Serif 4"',
  '400 11pt "IBM Plex Sans"', '500 11pt "IBM Plex Sans"',
  '400 11pt "Literata"', '500 11pt "Literata"', 'italic 400 11pt "Literata"',
];

const params = new URLSearchParams(location.search);
const issueId = params.get('issue') ?? '';
const layout = (params.get('layout') ?? 'reading') as Layout | 'reading' | 'sheet';
const autoPrint = params.get('print') === '1';
const embedded = params.get('embed') === '1';

const status = document.getElementById('status')!;
const pagesEl = document.getElementById('pages')!;

function say(msg: string): void {
  status.textContent = msg;
}

async function load() {
  const [settings, issue, issues, articles, pubList] = await Promise.all([
    loadSettings(),
    get('issues', issueId),
    all('issues'),
    all('articles'),
    all('publications'),
  ]);
  if (!issue) throw new Error(`No issue “${issueId}” on this device.`);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const ordered = issue.order.map((id) => byId.get(id)).filter((a): a is Article => !!a && !a.excluded);
  const urls = new Map<string, string>();
  for (const a of ordered) {
    for (const id of a.images) {
      const rec = await get('blobs', id);
      if (rec?.blob) urls.set(id, URL.createObjectURL(rec.blob));
    }
  }
  const pubs = new Map<string, Publication>(pubList.map((p) => [p.domain, p]));
  const mark = issue.source ? await get('blobs', markId(issue.source.domain)) : undefined;
  const markUrl = mark?.blob ? URL.createObjectURL(mark.blob) : undefined;
  return { settings, issue, articles: ordered, number: issueNumber(issue.id, issues), pubs, urls, markUrl };
}

function clearPaged(): void {
  document.querySelectorAll('style[data-pagedjs-inserted-styles]').forEach((s) => s.remove());
  pagesEl.innerHTML = '';
}

/** Paged.js reports a layout it can't resolve only on the console. */
let layoutRepeated = 0;

async function typeset(html: string, css: string): Promise<HTMLElement[]> {
  const t = document.createElement('template');
  t.innerHTML = html;
  const previewer = new Previewer();
  const error = console.error;
  layoutRepeated = 0;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Layout repeated')) layoutRepeated++;
    error(...args);
  };
  try {
    await previewer.preview(t.content, [{ [location.href]: css }], pagesEl);
  } finally {
    console.error = error;
  }
  return [...pagesEl.querySelectorAll<HTMLElement>('.pagedjs_page')];
}

/** Steps smaller the contents and the sources may be set (see .tight-1, .tight-2). */
const MAX_TIGHT = 2;

/** How many pages hold part of an element. */
function spans(pages: HTMLElement[], selector: string): number {
  return pages.filter((p) => p.querySelector(selector)).length;
}

/** Short Takes whose heading lands with less than 40% of the page left below it. */
function lateShortTakes(pages: HTMLElement[]): Set<string> {
  const late = new Set<string>();
  for (const p of pages) {
    const area = p.querySelector('.pagedjs_page_content')?.getBoundingClientRect();
    if (!area) continue;
    p.querySelectorAll<HTMLElement>('.article.short.runs-on').forEach((a) => {
      const head = a.querySelector('.short-head');
      if (!head) return;
      const top = head.getBoundingClientRect().top - area.top;
      if (top / area.height > 0.6) late.add(a.dataset.id ?? a.id);
    });
  }
  return late;
}

function markPages(pages: HTMLElement[], house: HouseStyle, coverColour: string): void {
  for (const p of pages) {
    p.classList.add(HOUSE_SHORT[house]);
    // On screen the card's four pages (cover, its inside, the back) show its colour edge to edge.
    if (p.querySelector('.cover, .inside-cover, .back-cover')) p.style.setProperty('--card', coverColour);
    if (p.querySelector('.article:not(.short) .article-head, .short-takes-opener, .edition-opener')) p.classList.add('opener');
    if (p.querySelector('.pad')) p.classList.add('pad-page');
  }
}

/**
 * Folios are CSS counters, counted in document order. Pin each page's own
 * number before moving it, or imposition would renumber the booklet.
 */
function freezeFolios(pages: HTMLElement[]): void {
  for (const p of pages) {
    p.style.counterReset = `page ${p.dataset.pageNumber}`;
    p.style.counterIncrement = 'none';
  }
}

function impose(pages: HTMLElement[], which: Layout, creepMm: number): void {
  const byNumber = new Map(pages.map((p) => [Number(p.dataset.pageNumber), p]));
  freezeFolios(pages);
  const sheets = document.createElement('div');
  sheets.className = 'sheets';
  for (const side of sidesFor(pages.length, which)) {
    const sheet = document.createElement('div');
    sheet.className = `sheet ${side.face}`;
    sheet.dataset.label = `Sheet ${side.sheet + 1} · ${side.face} · pages ${side.left} and ${side.right}`;
    const shift = creep(side.sheet, creepMm);
    for (const [pos, n] of [['left', side.left], ['right', side.right]] as const) {
      const slot = document.createElement('div');
      slot.className = `slot ${pos}`;
      // Each page keeps a .pagedjs_pages parent: Paged.js's own CSS selects on it.
      const wrap = document.createElement('div');
      wrap.className = 'pagedjs_pages';
      wrap.style.transform = `translateX(${shift[pos]}mm)`;
      wrap.append(byNumber.get(n)!);
      slot.append(wrap);
      sheet.append(slot);
    }
    sheets.append(sheet);
  }
  pagesEl.replaceChildren(sheets);
  const style = document.createElement('style');
  style.textContent = '@page { size: A4 landscape; margin: 0; }';
  document.head.append(style);
}

function contactSheet(pages: HTMLElement[]): void {
  freezeFolios(pages);
  const grid = document.createElement('div');
  grid.className = 'contact';
  for (const p of pages) {
    const cell = document.createElement('figure');
    const wrap = document.createElement('div');
    wrap.className = 'pagedjs_pages';
    wrap.append(p);
    cell.append(wrap);
    const cap = document.createElement('figcaption');
    cap.textContent = p.dataset.pageNumber ?? '';
    cell.append(cap);
    grid.append(cell);
  }
  pagesEl.replaceChildren(grid);
  const style = document.createElement('style');
  style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.append(style);
}

function toolbar(total: number, report: QaReport): void {
  const bar = document.getElementById('bar')!;
  if (embedded) {
    bar.remove();
    return;
  }
  const sel = document.createElement('select');
  for (const l of LAYOUTS) sel.append(new Option(l.label, l.id, false, l.id === layout));
  sel.onchange = () => {
    params.set('layout', sel.value);
    params.delete('print');
    location.search = params.toString();
  };
  const print = document.createElement('button');
  print.textContent = 'Print';
  print.onclick = () => window.print();
  const errors = report.items.filter((i) => i.level === 'error').length;
  const warns = report.items.filter((i) => i.level === 'warn').length;
  const info = document.createElement('span');
  info.className = errors ? 'bad' : 'ok';
  info.textContent = `${total} pages · ${total / 4} sheets · ${errors ? `${errors} QA errors` : 'QA passed'}${warns ? ` · ${warns} warnings` : ''}`;
  const tip = document.createElement('span');
  tip.className = 'tip';
  tip.textContent = TIPS[layout];
  bar.replaceChildren(sel, print, info, tip);
  // Say what QA found, not just how much: a blocked booklet should say why.
  const found = report.items.filter((i) => i.level !== 'note');
  if (found.length) {
    const list = document.createElement('ul');
    list.className = 'qa-list';
    for (const i of found) {
      const li = document.createElement('li');
      li.className = i.level;
      li.textContent = `${i.level === 'error' ? 'Error' : 'Warning'}${i.page ? ` · p. ${i.page}` : ''}${i.article ? ` · ${i.article}` : ''}: ${i.message}`;
      list.append(li);
    }
    bar.append(list);
  }
}

const TIPS: Record<string, string> = {
  reading: 'Print → Save as PDF gives an A5 reading copy. Margins: none; background graphics on.',
  booklet: 'Print on A4 landscape, two-sided, flip on short edge. Margins: none, scale 100%. Sheet 1 is the cover card.',
  fronts: 'Manual duplex, step 1: print these, then put the stack back in the tray printed side down, top edge first.',
  backs: 'Manual duplex, step 2: these run in reverse so the stack goes straight back in.',
  cover: 'The cover card: the outside only, one side, landscape. The inside stays bare card.',
  interior: 'Every sheet inside the cover: plain A4, landscape, two-sided, flip on short edge, scale 100%, margins none.',
  sheet: 'Every page at a glance. Look for odd breaks, stranded heads and empty pages.',
};

async function main(): Promise<void> {
  say('Loading issue…');
  const data = await load();
  const { settings, issue, articles, number, pubs, urls, markUrl } = data;
  const config = settings.book;
  document.title = `${config.title} ${issue.id}`;
  document.documentElement.classList.toggle('print', layout !== 'reading' && layout !== 'sheet');
  document.body.classList.add(`body-${config.house_style}`);
  if (!articles.length) throw new Error('This issue has no articles ready to print yet.');

  say('Loading fonts…');
  await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => [])));

  const css = [baseCss, HOUSE_CSS[config.house_style]].join('\n');
  const input = { issue, number, articles, config, pubs, imageUrl: (id: string) => urls.get(id), pad: 0, markUrl };

  say('Typesetting…');
  let out = renderIssue(input);
  let pages = await typeset(out.html, css + '\n' + out.css);
  // The contents and the sources each read best on one page: set them a step
  // smaller, twice at most, until each fits.
  const tight = { contents: 0, sources: 0 };
  for (let round = 0; round < MAX_TIGHT; round++) {
    const more = { contents: spans(pages, '.contents') > 1, sources: spans(pages, '.colophon') > 1 };
    if (!more.contents && !more.sources) break;
    if (more.contents) tight.contents++;
    if (more.sources) tight.sources++;
    say('Typesetting again to fit the contents and the sources on a page each…');
    clearPaged();
    out = renderIssue({ ...input, tight });
    pages = await typeset(out.html, css + '\n' + out.css);
  }
  // A Short Take that would start in the bottom 40% of a page starts the next one instead.
  const late = lateShortTakes(pages);
  if (late.size) {
    say('Typesetting again to move short pieces that start low on a page…');
    clearPaged();
    out = renderIssue({ ...input, tight, breakBefore: late });
    pages = await typeset(out.html, css + '\n' + out.css);
  }
  const pad = padCount(pages.length);
  if (pad) {
    say(`Typesetting again with ${pad} padding page${pad > 1 ? 's' : ''}…`);
    clearPaged();
    out = renderIssue({ ...input, tight, breakBefore: late, pad });
    pages = await typeset(out.html, css + '\n' + out.css);
  }
  const html = out.html;
  markPages(pages, config.house_style, issue.coverColour || COVER_DEFAULTS[config.house_style]);

  say('Checking…');
  const source = document.createElement('template');
  source.innerHTML = html;
  const items = runQa({ pages, source: source.content.firstElementChild!, articles });
  if (layoutRepeated) items.push({ level: 'error', check: 'overflow', message: 'Paged.js could not lay out part of the issue and gave up there (“Layout repeated”). Something is too tall for a page or can never break.' });
  if (pages.length % 4) items.push({ level: 'error', check: 'length', message: `${pages.length} pages after padding; the booklet needs a multiple of 4.` });
  const report: QaReport = { at: now(), pages: pages.length, items, ok: !items.some((i) => i.level === 'error') };
  await kvSet(`qa:${issue.id}`, report);
  window.parent?.postMessage({ type: 'desk:qa', issue: issue.id, report }, location.origin);

  if (layout === 'sheet') contactSheet(pages);
  else if (layout !== 'reading') {
    if (!report.ok && !params.has('force')) {
      say('QA found errors. Fix them in Desk before printing, or add &force=1 to print anyway.');
      toolbar(pages.length, report);
      return;
    }
    impose(pages, layout, config.creep_mm_per_sheet);
  }
  toolbar(pages.length, report);
  say('');
  status.remove();
  fitToScreen();
  addEventListener('resize', fitToScreen);
  if (autoPrint) setTimeout(() => window.print(), 300);
}

/**
 * On a screen narrower than a page (a phone), shrink the preview to fit
 * rather than cut it off. Only after QA has measured the pages, and never
 * in print: book.css resets the zoom there.
 */
function fitToScreen(): void {
  pagesEl.style.zoom = '';
  const first = pagesEl.querySelector<HTMLElement>('.sheet, .contact, .pagedjs_page');
  if (!first) return;
  const natural = first.classList.contains('contact') ? first.scrollWidth : first.getBoundingClientRect().width;
  const room = document.documentElement.clientWidth - 16;
  if (natural > room) pagesEl.style.zoom = String(room / natural);
}

main().catch((e) => {
  say(String(e instanceof Error ? e.message : e));
  status.classList.add('bad');
  window.parent?.postMessage({ type: 'desk:qa-error', issue: issueId, message: String(e) }, location.origin);
});
