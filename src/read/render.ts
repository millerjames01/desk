/**
 * Issue → one HTML document for Paged.js (brief §4.3): cover, contents,
 * articles, padding, colophon, back cover. Structure is identical for every
 * house style; the house CSS and the per-article skin tokens do the rest.
 */

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type { Article, BookConfig, Issue, Publication } from '../types';
import { COVER_DEFAULTS, issueDate, labels } from './issue';
import { kickerText, resolveSkin } from './skins';

export interface RenderInput {
  issue: Issue;
  number: number;
  articles: Article[];
  config: BookConfig;
  pubs: Map<string, Publication>;
  /** Image id → URL the page can load (object URLs from IndexedDB). */
  imageUrl: (id: string) => string | undefined;
  /** Extra blank or notes pages before the colophon, to reach a multiple of 4. */
  pad: number;
  /** Short Takes that start a page because too little was left on the last one. */
  breakBefore?: Set<string>;
}

/** Long reads first, then Short Takes, each group in issue order. */
export function readingOrder(articles: Article[]): Article[] {
  return [...articles.filter((a) => !a.shortTake), ...articles.filter((a) => a.shortTake)];
}

/** Under this, a Short Take is never split across pages. */
export const KEEP_WHOLE_WORDS = 250;

const md = new MarkdownIt({ html: true, typographer: true, linkify: false }).use(footnote);
// Smart quotes only. The other replacements ((c) → ©, -- → –) would change
// characters the text-integrity check compares.
md.disable('replacements');

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fetchedLabel(iso: string, house: BookConfig['house_style']): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (house === 'b-grid') return iso.split('-').reverse().join('.');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function publishedLabel(iso: string): string {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Body Markdown → HTML, then the DOM fixes Markdown can't express: lone
 * images become figures, footnotes move inline for float: footnote, the
 * first paragraph is marked for the opener treatment, and anything
 * executable is dropped.
 */
export function bodyHtml(a: Article, imageUrl: RenderInput['imageUrl'], opener: string, ornament: string): string {
  const src = a.markdown.replace(/\(desk-image:([\w-]+)/g, (_m, id) => `(${imageUrl(id) ?? 'about:blank#missing-' + id}`);
  const box = document.createElement('div');
  box.innerHTML = md.render(src);

  box.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((el) => el.remove());
  box.querySelectorAll('*').forEach((el) => {
    // No style attributes either: Paged.js treats any element carrying one as hidden.
    for (const attr of [...el.attributes]) if (attr.name === 'style' || /^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
  });
  box.querySelectorAll('h1').forEach((h) => {
    const h2 = document.createElement('h2');
    h2.innerHTML = h.innerHTML;
    h.replaceWith(h2);
  });
  box.querySelectorAll('h4,h5,h6').forEach((h) => {
    const h3 = document.createElement('h3');
    h3.innerHTML = h.innerHTML;
    h.replaceWith(h3);
  });

  box.querySelectorAll('p').forEach((p) => {
    const kids = [...p.childNodes].filter((n) => n.nodeType !== 3 || n.textContent!.trim());
    if (kids.length !== 1 || (kids[0] as Element).tagName !== 'IMG') return;
    const img = kids[0] as HTMLImageElement;
    const fig = document.createElement('figure');
    fig.append(img);
    const caption = img.getAttribute('title');
    img.removeAttribute('title');
    if (!img.src.startsWith('blob:') && !img.src.startsWith('data:')) img.classList.add('remote');
    if (caption) {
      const fc = document.createElement('figcaption');
      fc.textContent = caption;
      fig.append(fc);
    }
    p.replaceWith(fig);
  });

  // markdown-it-footnote puts notes in a list at the end; Paged.js wants each
  // note's text where it is called.
  const notes = new Map<string, string>();
  box.querySelectorAll('section.footnotes li[id]').forEach((li) => {
    li.querySelectorAll('.footnote-backref').forEach((b) => b.remove());
    notes.set(li.id, li.innerHTML.replace(/^\s*<p>|<\/p>\s*$/g, '').trim());
  });
  // Numbers are written out, not CSS counters: imposition moves pages around
  // and a counter would renumber them.
  let n = 0;
  box.querySelectorAll('sup.footnote-ref').forEach((sup) => {
    const id = sup.querySelector('a')?.getAttribute('href')?.slice(1) ?? '';
    n += 1;
    const ref = document.createElement('sup');
    ref.className = 'fn-ref';
    ref.textContent = String(n);
    const span = document.createElement('span');
    span.className = 'fn';
    span.innerHTML = `<span class="fn-mark">${n}.</span> ${notes.get(id) ?? ''}`;
    sup.replaceWith(ref, span);
  });
  box.querySelectorAll('section.footnotes, hr.footnotes-sep').forEach((el) => el.remove());

  // Paged.js drops rules with sibling combinators (p + p), so a paragraph
  // that follows another paragraph carries a class instead.
  for (const el of box.querySelectorAll('p')) {
    if (el.previousElementSibling?.tagName === 'P') el.classList.add('cont');
  }

  const first = [...box.children].find((el) => el.tagName === 'P');
  if (first) {
    first.classList.add('first');
    if (opener === 'boldlead') boldLead(first);
  }
  const paras = box.querySelectorAll(':scope > p');
  const last = paras[paras.length - 1] ?? box;
  if (ornament) {
    const end = document.createElement('span');
    end.className = 'end-mark';
    end.setAttribute('aria-hidden', 'true');
    last.append(end);
  }
  return box.innerHTML;
}

/** Wraps the opening words (to the first comma, or the first three words) in a semibold span. */
function boldLead(p: Element): void {
  const t = p.firstChild;
  if (!t || t.nodeType !== 3) return;
  const text = t.textContent ?? '';
  const comma = text.indexOf(',');
  const words = text.split(/(\s+)/);
  const cut = comma > 0 && comma < 40 ? comma + 1 : words.slice(0, 5).join('').length;
  if (cut <= 0) return;
  const span = document.createElement('span');
  span.className = 'lead';
  span.textContent = text.slice(0, cut);
  t.textContent = text.slice(cut);
  p.insertBefore(span, t);
}

function cover(i: RenderInput, issueLabel: ReturnType<typeof labels>): string {
  const { config: c, issue, articles } = i;
  const date = issueDate(issue.id);
  const list = articles.map((a) => `<li><a class="toc-link" href="#${a.id}"><span class="toc-title">${esc(a.title)}</span></a></li>`).join('');
  switch (c.house_style) {
    case 'a-review':
      return `<section class="cover cover-a">
  <div class="cover-top"><span>${esc(issueLabel.numberLabel)}</span><span>${esc(date.month)}</span></div>
  <div class="cover-mid"><h1 class="cover-title">${esc(c.title)}</h1><p class="cover-tagline">${esc(issue.subtitle || c.tagline)}</p></div>
  <div class="cover-list"><div class="cover-label">In this issue</div><ul>${list}</ul></div>
</section>`;
    case 'b-grid':
      return `<section class="cover cover-b">
  <div class="cover-top"><span>${esc(c.title)}</span><span>${esc(date.short)}</span></div>
  <div class="cover-num">${esc(issueLabel.numberLabel)}</div>
  <ul class="cover-list">${list}</ul>
</section>`;
    case 'c-pamphlet':
      return `<section class="cover cover-c">
  <div class="cover-top">${esc(issueLabel.numberLabel)}</div>
  <div class="cover-mid"><div class="short-rule"></div><h1 class="cover-title">${esc(c.title)}</h1><p class="cover-tagline">${esc(issue.subtitle || c.tagline)}</p><div class="short-rule"></div></div>
  <div class="cover-foot">${esc([c.place, date.romanYear].filter(Boolean).join(' · '))}</div>
</section>`;
  }
}

function contents(i: RenderInput): string {
  const row = (a: Article, n: number) => {
    const skin = resolveSkin(a.domain, i.pubs, a.publication);
    const who = [a.author, skin.name].filter(Boolean).map(esc).join(' · ');
    return `<li><a class="toc-link" href="#${a.id}"><span class="toc-n">${n}</span><span class="toc-title">${esc(a.title)}</span><span class="toc-who">${who}</span></a></li>`;
  };
  const long = i.articles.filter((a) => !a.shortTake);
  const short = i.articles.filter((a) => a.shortTake);
  const rows = long.map((a, n) => row(a, n + 1)).join('');
  // Short Takes are one entry with their titles underneath (only a group when there are long reads too).
  const group = short.length && long.length
    ? `<li class="toc-group"><span class="toc-group-title">Short Takes</span><ol class="toc toc-short">${short.map((a, n) => row(a, long.length + n + 1)).join('')}</ol></li>`
    : short.map((a, n) => row(a, n + 1)).join('');
  return `<section class="contents"><h2 class="contents-title">Contents</h2><ol class="toc">${rows}${group}</ol></section>`;
}

function article(a: Article, n: number, i: RenderInput, vars: string[], firstShort = false): string {
  const house = i.config.house_style;
  const skin = resolveSkin(a.domain, i.pubs, a.publication, HOUSE_ORNAMENT[house]);
  const kicker = kickerText(skin.kicker, { section: a.section, read_minutes: a.read_minutes, publication: skin.name });
  // Paged.js treats any element with a style attribute as hidden, so the
  // skin's tokens go in a generated stylesheet keyed by class.
  vars.push(`.art-${n + 1} { ${skin.accent ? `--accent: ${skin.accent}; ` : ''}--ornament: ${JSON.stringify(skin.ornament)}; }`);
  const opener = skin.opener_variant || '';
  const attrs = [
    `id="${a.id}"`,
    `class="article art-${n + 1}${a.shortTake ? ` short${a.words < KEEP_WHOLE_WORDS ? ' keep' : ''}${firstShort ? ' first-short' : ''}${i.breakBefore?.has(a.id) ? ' new-page' : ''}` : ''}"`,
    `data-pub="${esc(skin.key)}"`,
    opener ? `data-opener="${opener}"` : '',
    skin.rule ? `data-rule="${skin.rule}"` : '',
    skin.title_case ? `data-title-case="${skin.title_case}"` : '',
    `lang="en"`,
  ].filter(Boolean).join(' ');
  const pub = publishedLabel(a.published);
  const fetched = fetchedLabel(a.fetched, house);
  const source =
    house === 'c-pamphlet'
      ? `First published in ${esc(skin.name)}${pub ? `, ${esc(pub)}` : ''}.`
      : house === 'b-grid'
        ? `Source: ${esc(skin.name)}${pub ? `, ${esc(pub)}` : ''} · fetched ${esc(fetched)}`
        : `<span class="src-label">Source</span> — ${esc(skin.name)}${pub ? `, ${esc(pub)}` : ''}. Fetched ${esc(fetched)}.`;
  const label = house === 'b-grid'
    ? `<div class="label-row"><span><a class="pg" href="#${a.id}"></a> — ${esc(a.section || skin.name)}</span><span>${esc(skin.name)}</span></div>`
    : house === 'c-pamphlet' ? `<div class="art-num">${romanOf(n + 1)}</div>` : '';
  const byline = house === 'b-grid'
    ? `<div class="dek-row"><p class="dek">${esc(a.dek)}</p><div class="byline">${esc(a.author)}${a.author ? '<br>' : ''}${a.read_minutes} min read</div></div>`
    : `${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ''}${a.author ? `<div class="byline">${esc(a.author)}</div>` : ''}`;
  // A Short Take opens compactly: journal, title, author, and the text follows on the same page.
  const head = a.shortTake
    ? `<header class="article-head short-head">
  <div class="kicker">${esc(skin.name)}</div>
  <h1 class="article-title">${esc(a.title)}</h1>
  ${a.author ? `<div class="byline">${esc(a.author)}</div>` : ''}
</header>`
    : '';
  if (head) {
    return `<article ${attrs}>
<span class="rh-title">${esc(a.title)}</span><span class="rh-section">Short Takes</span>
${head}
<div class="article-body" data-article="${a.id}">${bodyHtml(a, i.imageUrl, opener || defaultOpener(house), skin.ornament)}</div>
<p class="source-note">${source}</p>
</article>`;
  }
  return `<article ${attrs}>
<span class="rh-title">${esc(a.title)}</span><span class="rh-section">${esc(a.section || skin.name)}</span>
<header class="article-head">
  ${label}
  ${house !== 'c-pamphlet' && house !== 'b-grid' && kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
  <h1 class="article-title">${esc(a.title)}</h1>
  ${house === 'c-pamphlet' ? '<div class="short-rule"></div>' : ''}
  ${byline}
</header>
<div class="article-body" data-article="${a.id}">${bodyHtml(a, i.imageUrl, opener || defaultOpener(house), skin.ornament)}</div>
<p class="source-note">${source}</p>
</article>`;
}

function romanOf(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] ?? String(n);
}

const HOUSE_ORNAMENT: Record<BookConfig['house_style'], string> = { 'a-review': '■', 'b-grid': '■', 'c-pamphlet': '❧' };

export function defaultOpener(house: BookConfig['house_style']): string {
  return house === 'a-review' ? 'dropcap' : house === 'b-grid' ? 'boldlead' : 'smallcaps';
}

function colophon(i: RenderInput, issueLabel: ReturnType<typeof labels>): string {
  const sources = i.articles
    .map((a) => {
      const skin = resolveSkin(a.domain, i.pubs, a.publication);
      return `<li><span class="col-title">${esc(a.title)}</span>${a.author ? ` — ${esc(a.author)}` : ''}. ${esc(skin.name)}${a.published ? `, ${esc(publishedLabel(a.published))}` : ''}.<br><span class="col-url">${esc(a.url)}</span></li>`;
    })
    .join('');
  const d = issueDate(i.issue.id);
  return `<section class="colophon">
<h2 class="colophon-title">${esc(i.config.title)}</h2>
<p>${esc(issueLabel.numberLabel)} · ${esc(d.month)}. ${esc(i.config.tagline)}.</p>
<p>A private booklet for one reader, not for distribution. Every text is reproduced as published, unaltered.</p>
<h3>Sources</h3>
<ol class="sources">${sources}</ol>
</section>`;
}

export interface Rendered {
  html: string;
  /** Per-issue tokens: the cover colour and each article's skin. */
  css: string;
}

export function renderIssue(i: RenderInput): Rendered {
  const house = i.config.house_style;
  const issueLabel = labels(house, i.config.title, i.number);
  const coverColour = i.issue.coverColour || COVER_DEFAULTS[house];
  const vars: string[] = [`.book { --cover: ${/^#[0-9a-f]{3,8}$/i.test(coverColour) ? coverColour : COVER_DEFAULTS[house]}; }`];
  const pads = Array.from({ length: i.pad }, () =>
    i.config.pad_with === 'notes' ? '<section class="pad pad-notes"><h2>Notes</h2><div class="ruled"></div></section>' : '<section class="pad pad-blank"><p class="pad-fill">&nbsp;</p></section>',
  ).join('');
  const ordered = readingOrder(i.articles);
  const firstShort = ordered.findIndex((a) => a.shortTake);
  const hasLong = ordered.some((a) => !a.shortTake);
  const shortCount = ordered.length - (firstShort < 0 ? ordered.length : firstShort);
  const articles = ordered
    .map((a, n) => (n === firstShort && hasLong ? `<section class="short-takes-opener"><h2>Short Takes</h2><p>${shortCount} short piece${shortCount === 1 ? '' : 's'}</p></section>\n` : '') + article(a, n, i, vars, n === firstShort))
    .join('\n');
  const html = `<div class="book house-${house}${i.config.recto_starts ? ' recto-starts' : ''}">
${cover(i, issueLabel).replace('<div class="cover-top">', `<div class="cover-top"><span class="rh-issue">${esc(issueLabel.mark)}</span>`)}
${contents({ ...i, articles: ordered })}
${articles}
${pads}
${colophon({ ...i, articles: ordered }, issueLabel)}
<section class="back-cover"><div class="back-mark">${esc(issueLabel.mark)}</div></section>
</div>`;
  return { html, css: vars.join('\n') };
}
