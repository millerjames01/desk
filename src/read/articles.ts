/**
 * Adding articles to an issue: page HTML (or pasted text) → stored article,
 * its images greyed and saved on this device, a skin for any new publication,
 * and the Claude fallback for flagged pages when a key is set.
 */

import { all, get, now, put, putMany, today, uid } from '../db';
import type { Article, Issue, Publication, Settings } from '../types';
import { domainOf, extract, fromPlainText, parseHtml } from './extract';
import { dataUrlToBlob, fetchImage, fetchPage } from './fetch';
import { prepareImage } from './images';
import { checkArticle, visibleWords } from './quality';
import { newSkins } from './skins';
import { countWords, markdownBlocks, readMinutes, slugify } from './text';
import { sourceText, verifyAgainstSource } from './verify';

export interface AddResult {
  article: Article;
  /** Things the report should mention: new skins, dropped images, the Claude step. */
  notes: string[];
}

async function ensureSkin(domain: string, name: string, notes: string[]): Promise<void> {
  const pubs = new Map((await all('publications')).map((p) => [p.domain, p]));
  const fresh = newSkins([{ domain, name }], pubs, now());
  if (fresh.length) {
    await putMany('publications', fresh);
    notes.push(`New publication ${fresh[0].name} (${domain}) got an automatic skin. Adjust it under Read → Publications.`);
  }
}

async function storeImages(markdown: string, images: { src: string }[], settings: Settings, posted: Record<string, string>, notes: string[]): Promise<{ markdown: string; ids: string[] }> {
  const ids: string[] = [];
  let md = markdown;
  for (const { src } of images) {
    const raw = posted[src] ? await dataUrlToBlob(posted[src]) : await fetchImage(src, settings.proxies);
    const prepared = raw ? await prepareImage(raw) : null;
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!prepared) {
      if (raw) {
        // Too small to print: drop it, caption and all.
        md = md.replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(${escaped}(?:\\s+"[^"]*")?\\)\\n*`), '\n\n');
        notes.push('Dropped an image under 300 px wide.');
      } else {
        notes.push('An image could not be downloaded; it will load from the web when printing.');
      }
      continue;
    }
    const id = uid('img');
    await put('blobs', { id, kind: 'image', blob: prepared.blob, width: prepared.width, height: prepared.height, createdAt: now() });
    md = md.replace(new RegExp(`\\(${escaped}`), `(desk-image:${id}`);
    ids.push(id);
  }
  return { markdown: md.replace(/\n{3,}/g, '\n\n').trim(), ids };
}

/** The page cut down to what Claude needs to see: no scripts, styles or attributes but links and images. */
export function htmlForClaude(doc: Document): string {
  const body = (doc.body ?? doc.documentElement).cloneNode(true) as HTMLElement;
  body.querySelectorAll('script,style,noscript,template,svg,iframe,link,meta,form,button,input').forEach((el) => el.remove());
  body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (!['href', 'src', 'alt'].includes(a.name)) el.removeAttribute(a.name);
  });
  return body.innerHTML.replace(/\s{2,}/g, ' ');
}

/**
 * The Claude step for a flagged article. Accepted only if every paragraph
 * it returns is found in the page text.
 */
export async function claudeFallback(article: Article, settings: Settings): Promise<{ ok: boolean; message: string; article: Article }> {
  const raw = await get('blobs', `raw-${article.id}`);
  if (!raw?.text) return { ok: false, message: 'The page source was not kept for this article.', article };
  const doc = parseHtml(raw.text, article.url);
  // The SDK loads only when there is a key to use it with.
  const { extractBody } = await import('../claude');
  const md = await extractBody(settings, htmlForClaude(doc));
  const verdict = verifyAgainstSource(md, sourceText(doc));
  if (!verdict.ok) {
    return { ok: false, message: `Claude's extraction was rejected: ${verdict.missing.length} passage(s) not found in the page, e.g. “${verdict.missing[0].slice(0, 80)}”. Needs a manual paste.`, article };
  }
  const flags = checkArticle(md, visibleWords(doc)).filter((f) => f.code !== 'low-ratio');
  const words = countWords(markdownBlocks(md).body.join(' '));
  const next: Article = { ...article, markdown: md, images: [], via: 'claude', flags, excluded: flags.length > 0, words, read_minutes: readMinutes(words), updatedAt: now() };
  await put('articles', next);
  return { ok: true, message: `Claude extracted ${words} words; every paragraph was found in the page.`, article: next };
}

export async function addToIssue(issueId: string, articleId: string): Promise<void> {
  const issue = await get('issues', issueId);
  if (!issue) throw new Error(`No issue ${issueId}`);
  if (!issue.order.includes(articleId)) await put('issues', { ...issue, order: [...issue.order, articleId], updatedAt: now() });
}

export async function addFromHtml(opts: {
  issueId: string;
  url: string;
  html: string;
  via: Article['via'];
  settings: Settings;
  postedImages?: Record<string, string>;
}): Promise<AddResult> {
  const { issueId, url, html, via, settings } = opts;
  const notes: string[] = [];
  const ex = extract(html, url, { maxImages: settings.book.max_images_per_article });
  await ensureSkin(ex.domain, ex.siteName, notes);
  const { markdown, ids } = await storeImages(ex.markdown, ex.images, settings, opts.postedImages ?? {}, notes);
  const id = `${slugify(ex.title)}-${Date.now().toString(36)}`;
  await put('blobs', { id: `raw-${id}`, kind: 'raw-html', text: html, createdAt: now() });
  let article: Article = {
    id,
    issueId,
    title: ex.title,
    dek: ex.dek,
    author: ex.author,
    publication: ex.siteName,
    domain: ex.domain,
    url,
    published: ex.published,
    fetched: today(),
    words: ex.words,
    read_minutes: ex.read_minutes,
    section: ex.section,
    markdown,
    images: ids,
    flags: ex.flags,
    via,
    excluded: ex.flags.length > 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await put('articles', article);
  await addToIssue(issueId, id);
  if (article.flags.length && settings.anthropicKey && settings.autoClaudeExtract) {
    try {
      const r = await claudeFallback(article, settings);
      notes.push(r.message);
      article = r.article;
    } catch (e) {
      notes.push(`Claude fallback failed: ${(e as Error).message}`);
    }
  }
  return { article, notes };
}

export async function addFromUrl(issueId: string, url: string, settings: Settings, onTry?: (s: string) => void): Promise<AddResult> {
  const page = await fetchPage(url, settings.proxies, onTry);
  const r = await addFromHtml({ issueId, url, html: page.html, via: 'proxy', settings });
  if (page.proxy) r.notes.unshift(`Fetched through ${page.proxy}.`);
  return r;
}

export async function addFromText(issueId: string, fields: { url: string; title: string; author: string; publication: string; published: string; text: string }): Promise<AddResult> {
  const notes: string[] = [];
  const markdown = fromPlainText(fields.text);
  const domain = domainOf(fields.url);
  if (domain) await ensureSkin(domain, fields.publication, notes);
  const words = countWords(markdownBlocks(markdown).body.join(' '));
  const id = `${slugify(fields.title)}-${Date.now().toString(36)}`;
  const flags = checkArticle(markdown, 0).filter((f) => f.code !== 'thin' || words < 100);
  const article: Article = {
    id, issueId, title: fields.title || 'Untitled', dek: '', author: fields.author, publication: fields.publication, domain,
    url: fields.url, published: fields.published, fetched: today(), words, read_minutes: readMinutes(words), section: '',
    markdown, images: [], flags, via: 'paste', excluded: false, createdAt: now(), updatedAt: now(),
  };
  await put('articles', article);
  await addToIssue(issueId, id);
  return { article, notes };
}

export async function createIssue(id: string): Promise<Issue> {
  const issue: Issue = { id, order: [], coverColour: '', subtitle: '', createdAt: now(), updatedAt: now() };
  await put('issues', issue);
  return issue;
}

export function publicationsMap(list: Publication[]): Map<string, Publication> {
  return new Map(list.map((p) => [p.domain, p]));
}
