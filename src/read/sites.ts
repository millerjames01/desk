/**
 * Site profiles: how to find a journal's editions, the stories in one, and
 * the parts of a story page (brief: SOURCES guide §2–4). Selectors live in
 * data, not code, so a redesign is a profile edit (Read → Journals).
 *
 * Every rule is optional. When a profile's body selector finds nothing, the
 * page goes through Readability and the article is flagged.
 */

import type { Flag } from '../types';
import { cleanTitle, domainOf, isoDate, meta, parseHtml, toMarkdown, type Extracted } from './extract';
import { checkArticle, visibleWords } from './quality';
import { countWords, normalize, readMinutes } from './text';

export interface IssueEditions {
  kind: 'issue';
  /** Page that links to every issue. */
  index: string;
  /** A page that links the newest issue when the index doesn't yet (often the home page). */
  current?: string;
  /** Path pattern of an issue page. */
  editionPath: string;
  /** Each issue's entry on the index, and where in it the issue's name is, when the link itself says only "Open". */
  item?: string;
  itemLabel?: string;
}

export interface MonthEditions {
  kind: 'month';
  /** Archive page; `{yyyy}` and `{mm}` are filled in, or one archive for all months, filtered by item dates. */
  archive: string;
  /** Pagination: the link to the next (older) page. */
  next?: string;
  /** On a shared archive: each entry, its link, and its date. */
  item?: string;
  itemLink?: string;
  itemDate?: string;
}

export interface StoryRules {
  title?: string;
  /** "Title by Author" in one heading: split on the last occurrence. */
  titleAuthor?: { select: string; splitLast: string };
  author?: { select: string; stripPrefix?: string };
  /** A line such as "Story by Ann Lee · September 21, 2026". */
  byline?: { marker: string };
  date?: { select?: string; fromUrl?: string };
  body: {
    select?: string;
    /** Drop this element and everything after it. `h3@About the Author` matches by text. */
    until?: string;
    /** Drop what follows the last match when it is short (an author bio). */
    bioAfterLast?: string;
    /** Keep only what lies between the first two matches. */
    between?: [string, string];
  };
  strip?: string[];
  category?: string;
}

export interface SiteProfile {
  domain: string;
  name: string;
  /** checked: tried against live pages; unverified: written from a survey, check on first use. */
  status: 'checked' | 'unverified';
  edition: IssueEditions | MonthEditions;
  /** Path pattern of a story page. */
  storyPath: string;
  skipPath?: string[];
  story: StoryRules;
  /** The journal's own mark, printed in black on the Grid cover. */
  mark?: Mark;
  notes?: string;
}

/**
 * A logo or favicon, fetched once through the transport and turned to black
 * ink. `ink` says what becomes ink: every opaque pixel (shape), the dark parts
 * of a mark on white (dark), or the bright parts of a mark on black (light).
 * `crop` keeps a part of it, as fractions [x, y, width, height].
 */
export interface Mark {
  url?: string;
  /** Inline SVG instead of a URL. */
  svg?: string;
  ink?: 'shape' | 'dark' | 'light';
  crop?: [number, number, number, number];
}

/** Lost Balloon has no logo of its own; this balloon is Desk's stand-in. */
const BALLOON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 80" width="200" height="400" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C10.5 4 4.5 11.5 4.5 20.5 4.5 31 13 40 19 43.5h2C27 40 35.5 31 35.5 20.5 35.5 11.5 29.5 4 20 4Z"/><path d="M11 14.5c1.6-3.8 4.8-5.8 8-6.2"/><path d="M18 43.5 16.8 47h6.4L22 43.5"/><path d="M20 47c-3 5 3 9 0 14s3 9 0 15"/></svg>';

export const DEFAULT_PROFILES: SiteProfile[] = [
  {
    domain: 'smokelong.com',
    name: 'SmokeLong Quarterly',
    status: 'checked',
    edition: { kind: 'issue', index: 'https://www.smokelong.com/archives/quarterly/', current: 'https://www.smokelong.com/', editionPath: '^/issue-[a-z-]+/?$', item: '.issh', itemLabel: '.qic span' },
    storyPath: '^/stories/[^/]+/?$',
    skipPath: ['^/stories/letter-from-the-editor'],
    story: {
      title: 'h2',
      byline: { marker: 'Story by' },
      body: { select: '.entry-content', until: 'h3@About the Author' },
      strip: ['audio', '.audiointro', '.fimage', '.sharedaddy', '.addtoany_share_save_container'],
    },
    mark: { url: 'https://www.smokelong.com/wp-content/uploads/2021/02/logofoot-1.svg', ink: 'shape', crop: [0, 0, 1, 0.69] },
    notes: 'Issue pages list about twelve stories and the editor’s letter, which is skipped.',
  },
  {
    domain: 'vestalreview.net',
    name: 'Vestal Review',
    status: 'unverified',
    edition: { kind: 'issue', index: 'https://www.vestalreview.net/past-issues', editionPath: '^/issue-\\d+/?$' },
    storyPath: '^/[a-z0-9][a-z0-9-]*/?$',
    skipPath: ['^/(past-issues|issue-\\d+|about.*|submit.*|submissions?|masthead|staff|contact|cart|search|shop.*|blog.*|news.*|contests?.*|donate|support|events?|resources?|newsletter|privacy.*|terms.*|home)/?$'],
    story: {
      title: 'h2',
      author: { select: 'h4', stripPrefix: 'By ' },
      body: { select: 'main, article, #page', between: ['hr', 'hr'] },
    },
    mark: { url: 'https://images.squarespace-cdn.com/content/v1/65a7291110083f33f632f3bf/e005d7cf-8b66-4c2d-bbb8-57cfd7765a34/LOGO_vector.png?format=500w', ink: 'shape' },
    notes: 'Squarespace: story URLs look like any page, so the list comes from the issue page. Dates come from the issue.',
  },
  {
    domain: 'lost-balloon.com',
    name: 'Lost Balloon',
    status: 'checked',
    edition: { kind: 'month', archive: 'https://lost-balloon.com/{yyyy}/{mm}/', next: '.nav-previous a, a.next' },
    storyPath: '^/\\d{4}/\\d{2}/\\d{2}/[^/]+/?$',
    story: {
      titleAuthor: { select: 'h1.entry-title', splitLast: ' by ' },
      date: { fromUrl: '/(\\d{4})/(\\d{2})/(\\d{2})/' },
      body: { select: '.entry-content', bioAfterLast: 'hr' },
      strip: ['.sharedaddy', '.jp-relatedposts', '#jp-post-flair', '.wpcnt', '.wp-block-jetpack-subscriptions'],
      category: 'a[rel~="category"]',
    },
    mark: { svg: BALLOON, ink: 'shape' },
    notes: 'Weekly posts, so an edition is a month. No logo of its own: the balloon mark is a stand-in.',
  },
  {
    domain: 'havehashad.com',
    name: 'HAD',
    status: 'checked',
    edition: { kind: 'month', archive: 'https://www.havehashad.com/hadposts/archives', next: 'a[rel="next"]', item: '.story', itemLink: 'h1.title a', itemDate: '.date' },
    storyPath: '^/hadposts/(?!archives|random|author)[^/]+$',
    story: { title: 'h1.title', author: { select: 'h2.author' }, date: { select: 'h3.date' }, body: { select: '.story-content' } },
    mark: { url: 'https://havehashad.com/apple-touch-icon.png', ink: 'dark' },
    notes: 'A piece a day; an edition is a month, read from the archive’s dates.',
  },
  {
    domain: 'xraylitmag.com',
    name: 'X-R-A-Y',
    status: 'checked',
    edition: { kind: 'month', archive: 'https://xraylitmag.com/{yyyy}/{mm}/', next: '.nav-previous a, a.next' },
    storyPath: '^/[^/]+-by-[^/]+/[^/]+/?$',
    story: { titleAuthor: { select: 'h1.entry-title', splitLast: ' by ' }, body: { select: '.entry-content', bioAfterLast: '.wp-block-spacer' } },
    mark: { url: 'https://xraylitmag.com/wp-content/uploads/2021/03/xray-header-transparent-3.png', ink: 'light' },
    notes: 'A few long pieces a month. Experimental forms: spacing is kept.',
  },
];

export function profileFor(url: string, profiles: SiteProfile[]): SiteProfile | undefined {
  const host = domainOf(url);
  return profiles.find((p) => host === p.domain || host.endsWith('.' + p.domain));
}

// ---------- Selectors ----------

/** querySelector plus `tag@text`: the first `tag` whose text contains `text`. */
export function pick(root: ParentNode, sel: string): Element | null {
  const at = sel.indexOf('@');
  if (at < 0) return root.querySelector(sel);
  const [tag, text] = [sel.slice(0, at), sel.slice(at + 1).toLowerCase()];
  return [...root.querySelectorAll(tag)].find((el) => (el.textContent ?? '').toLowerCase().includes(text)) ?? null;
}

/** Removes `el` and everything after it inside `root`, at every level. */
function cutFrom(el: Element, root: Element): void {
  let node: Element | null = el;
  while (node && node !== root) {
    while (node.nextSibling) node.nextSibling.remove();
    const parent: Element | null = node.parentElement;
    if (node === el) node.remove();
    node = parent;
  }
}

function text(el: Element | null | undefined): string {
  return normalize(el?.textContent ?? '');
}

// ---------- Editions ----------

export interface Edition {
  label: string;
  url: string;
  /** For month editions: yyyy-mm. */
  month?: string;
  /** When the index gives one: the issue's date, as printed. */
  date?: string;
}

export interface StoryLink {
  url: string;
  label: string;
  date?: string;
  /** The edition it belongs to, when a booklet holds several. */
  edition?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthEditions(p: SiteProfile, from = new Date(), count = 12): Edition[] {
  const e = p.edition as MonthEditions;
  const out: Edition[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    out.push({ label: `${MONTHS[d.getMonth()]} ${yyyy}`, url: e.archive.replace('{yyyy}', yyyy).replace('{mm}', mm), month: `${yyyy}-${mm}` });
  }
  return out;
}

function prettySlug(path: string): string {
  const slug = path.replace(/\/$/, '').split('/').pop() ?? path;
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function sameSite(href: string, p: SiteProfile): boolean {
  const host = domainOf(href);
  return host === p.domain || host.endsWith('.' + p.domain);
}

/** Issue links on the profile's index page, in page order. */
/** Link text that names nothing: "Open this Issue", "Read more", "View". */
const GENERIC_LINK = /^(open|read|view|see|go to|click|continue|more)\b|^this issue$/i;
const PRINTED_DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/;

/**
 * Issues linked from an index page, in its order (newest first, as journals
 * list them). An issue's name is its link text, or, when that says only
 * "Open this Issue", the profile's label inside its entry, the cover's alt
 * text, or its address.
 */
export function issueEditions(doc: Document, p: SiteProfile): Edition[] {
  const e = p.edition as IssueEditions;
  const re = new RegExp(e.editionPath);
  const byUrl = new Map<string, Edition>();
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = new URL(a.getAttribute('href')!, doc.baseURI).href.split('#')[0];
    if (!sameSite(url, p) || !re.test(new URL(url).pathname)) continue;
    const entry = e.item ? a.closest(e.item) : null;
    const own = text(a);
    const named = own && !GENERIC_LINK.test(own) ? own : '';
    const label = named
      || (entry && e.itemLabel ? text(entry.querySelector(e.itemLabel)) : '')
      || (a.querySelector('img') ?? entry?.querySelector('img'))?.getAttribute('alt')?.replace(/^cover (for|of)\s+/i, '').trim()
      || '';
    const date = text(entry ?? a).match(PRINTED_DATE)?.[0];
    const known = byUrl.get(url);
    if (known) {
      if (label && known.label === prettySlug(new URL(url).pathname)) known.label = label;
      known.date ??= date;
      continue;
    }
    byUrl.set(url, { label: label || prettySlug(new URL(url).pathname), url, ...(date ? { date } : {}) });
  }
  return [...byUrl.values()];
}

function isStory(url: string, p: SiteProfile): boolean {
  if (!sameSite(url, p)) return false;
  const path = new URL(url).pathname;
  if (!new RegExp(p.storyPath).test(path)) return false;
  return !(p.skipPath ?? []).some((s) => new RegExp(s).test(path));
}

/** Story links on one page of an edition. With item rules, each link carries its listed date. */
export function storyLinks(doc: Document, p: SiteProfile): StoryLink[] {
  const e = p.edition;
  const seen = new Map<string, StoryLink>();
  const out: StoryLink[] = [];
  // Archives often link a story several times (its date, its category, its title): keep the title, the longest.
  const dateLike = (t: string) => !t || /^\s*(\w+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/.test(t) || /^(read more|continue|more)/i.test(t);
  const add = (a: Element, date?: string) => {
    const url = new URL(a.getAttribute('href')!, doc.baseURI).href.split('#')[0];
    if (!isStory(url, p)) return;
    const label = text(a);
    const known = seen.get(url);
    if (known) {
      if (!dateLike(label) && (dateLike(known.label) || label.length > known.label.length)) known.label = label;
      return;
    }
    const link = { url, label: label || prettySlug(new URL(url).pathname), date };
    seen.set(url, link);
    out.push(link);
  };
  if (e.kind === 'month' && e.item && e.itemLink) {
    for (const item of doc.querySelectorAll(e.item)) {
      const a = item.querySelector(e.itemLink);
      if (a?.getAttribute('href')) add(a, isoDate(text(item.querySelector(e.itemDate ?? '.date'))));
    }
  } else {
    // Prefer links inside the main content, so menus and sidebars don't count.
    const scope = doc.querySelector('main, article, #content, .content, #main') ?? doc.body;
    scope.querySelectorAll('a[href]').forEach((a) => add(a));
    if (!out.length) doc.querySelectorAll('a[href]').forEach((a) => add(a));
  }
  for (const l of out) if (dateLike(l.label)) l.label = prettySlug(new URL(l.url).pathname);
  return out;
}

export function nextPage(doc: Document, p: SiteProfile): string | undefined {
  const e = p.edition;
  if (e.kind !== 'month' || !e.next) return undefined;
  const a = doc.querySelector(e.next);
  const href = a?.getAttribute('href');
  return href ? new URL(href, doc.baseURI).href : undefined;
}

/**
 * The stories in one edition. `fetchDoc` is the polite fetcher (extension or
 * proxy); this only decides which pages to ask for, at most `maxPages`.
 */
export async function editionStories(p: SiteProfile, edition: Edition, fetchDoc: (url: string) => Promise<Document>, maxPages = 12): Promise<StoryLink[]> {
  const out: StoryLink[] = [];
  const seen = new Set<string>();
  let url: string | undefined = edition.url;
  for (let page = 0; url && page < maxPages; page++) {
    const doc = await fetchDoc(url);
    let links = storyLinks(doc, p);
    if (edition.month) {
      const dated = links.filter((l) => l.date || dateFromUrl(l.url));
      if (dated.length) {
        const inMonth = links.filter((l) => (l.date || dateFromUrl(l.url) || '').startsWith(edition.month!));
        const older = dated.some((l) => (l.date || dateFromUrl(l.url)!) < edition.month!);
        links = inMonth;
        for (const l of links) if (!seen.has(l.url)) { seen.add(l.url); out.push(l); }
        if (older) break;
        url = nextPage(doc, p);
        continue;
      }
    }
    for (const l of links) if (!seen.has(l.url)) { seen.add(l.url); out.push(l); }
    url = nextPage(doc, p);
  }
  // Archives list newest first; a booklet reads oldest first.
  return edition.month ? out.reverse() : out;
}

function dateFromUrl(url: string): string | undefined {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

// ---------- Stories ----------

export interface ProfiledExtract extends Extracted {
  category: string;
}

export function extractWithProfile(html: string, url: string, p: SiteProfile, opts: { maxImages: number; parser?: (html: string) => Document }): ProfiledExtract | null {
  const doc = parseHtml(html, url, opts.parser);
  const r = p.story;
  const base = doc.baseURI || url;
  const flags: Flag[] = [];

  let title = r.title ? text(pick(doc, r.title)) : '';
  let author = '';
  if (r.titleAuthor) {
    const both = text(pick(doc, r.titleAuthor.select));
    const i = both.toLowerCase().lastIndexOf(r.titleAuthor.splitLast.toLowerCase());
    if (i > 0) {
      title = both.slice(0, i).trim();
      author = both.slice(i + r.titleAuthor.splitLast.length).trim();
    } else title = both;
  }
  if (!title) title = cleanTitle(normalize(meta(doc, 'og:title') || doc.title), p.name);
  if (r.author) {
    const a = text(pick(doc, r.author.select));
    author = r.author.stripPrefix && a.toLowerCase().startsWith(r.author.stripPrefix.toLowerCase()) ? a.slice(r.author.stripPrefix.length).trim() : a;
  }
  let published = '';
  if (r.byline) {
    const line = [...doc.querySelectorAll('p, div, span')].find((el) => el.children.length < 6 && text(el).startsWith(r.byline!.marker));
    if (line) {
      const t = text(line).slice(r.byline.marker.length).trim();
      author ||= t.split(/\s*[(|·•]\s*|\s{2,}/)[0].replace(/\s+[A-Z][a-z]+ \d{1,2}, \d{4}.*$/, '').trim();
      const d = t.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/);
      if (d) published = isoDate(d[1]);
    }
  }
  if (r.date?.select) published = isoDate(text(pick(doc, r.date.select)));
  if (r.date?.fromUrl) {
    const m = url.match(new RegExp(r.date.fromUrl));
    if (m) published = `${m[1]}-${m[2]}-${m[3]}`;
  }
  published ||= isoDate(meta(doc, 'article:published_time'));

  const found = r.body.select ? pick(doc, r.body.select) : null;
  if (!found) return null;
  const container = found.cloneNode(true) as HTMLElement;
  for (const s of r.strip ?? []) container.querySelectorAll(s).forEach((el) => el.remove());
  if (r.body.until) {
    const stop = pick(container, r.body.until);
    if (stop) cutFrom(stop, container);
  }
  if (r.body.between) {
    const [a, b] = r.body.between;
    const first = container.querySelector(a);
    const second = first ? [...container.querySelectorAll(b)].find((el) => first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    if (first) {
      const keep = document.createElement('div');
      let n = first.nextSibling;
      while (n && n !== second) {
        const next = n.nextSibling;
        keep.append(n);
        n = next;
      }
      container.replaceChildren(...keep.childNodes);
    }
  }
  if (r.body.bioAfterLast) {
    const all = container.querySelectorAll(r.body.bioAfterLast);
    const last = all[all.length - 1];
    if (last) {
      const tail = document.createElement('div');
      for (let n = last.nextSibling; n; n = n.nextSibling) tail.append(n.cloneNode(true));
      const words = countWords(tail.textContent ?? '');
      // A short tail after the last rule is the author's bio; a long one is the story.
      if (words > 0 && words <= 150) {
        cutFrom(last, container);
        flags.push({ code: 'trimmed', detail: `Left out ${words} words after the last rule as the author’s bio: “${normalize(tail.textContent ?? '').slice(0, 60)}…”` });
      }
    }
  }
  // A closing paragraph that opens with the author's name in bold is their bio.
  if (author) {
    const paras = [...container.querySelectorAll('p')].filter((el) => text(el));
    const last = paras[paras.length - 1];
    const lead = last?.querySelector('strong, b');
    if (last && lead && last.firstElementChild === lead && text(lead).toLowerCase().startsWith(author.toLowerCase()) && countWords(text(last)) <= 150) {
      flags.push({ code: 'trimmed', detail: `Left out the closing bio: “${text(last).slice(0, 60)}…”` });
      cutFrom(last, container);
    }
  }
  const category = r.category ? text(pick(doc, r.category)) : '';
  const lead = meta(doc, 'og:image');
  const { markdown, images, words } = toMarkdown(container, base, lead ? new URL(lead, base).href : '', opts.maxImages);
  // Very short pieces are the point here: the 300-word floor doesn't apply.
  const checks = checkArticle(markdown, 0).filter((f) => f.code !== 'thin' || words < 25);
  return {
    title,
    dek: '',
    author,
    siteName: p.name,
    domain: domainOf(url),
    url,
    published,
    section: category,
    category,
    markdown,
    images,
    words,
    read_minutes: readMinutes(words),
    flags: [...checks, ...flags],
  };
}

/** For the report: which selectors of a profile matched on this page. */
export function profileReport(html: string, url: string, p: SiteProfile, parser?: (html: string) => Document): string[] {
  const doc = parseHtml(html, url, parser);
  const r = p.story;
  const misses: string[] = [];
  for (const [k, sel] of [['title', r.title], ['title and author', r.titleAuthor?.select], ['author', r.author?.select], ['date', r.date?.select], ['body', r.body.select]] as const) {
    if (sel && !pick(doc, sel)) misses.push(`${k} (${sel})`);
  }
  if (visibleWords(doc) === 0) misses.push('the page has no visible text');
  return misses;
}
