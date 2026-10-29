/**
 * An issue made from one edition of one journal: find the edition's stories,
 * then fetch them one at a time through the polite transport. The remaining
 * list is saved after every story, so a closed tab picks up where it stopped.
 */

import { all, get, kvGet, kvSet, now, put } from '../db';
import type { Article, EditionRef, Issue, Settings } from '../types';
import { editionsLabel } from './issue';
import { loadProfiles } from './profiles';
import { addFromHtml, DuplicateError } from './articles';
import { ensureMark } from './mark';
import { cleanTitle, meta, parseHtml } from './extract';
import { editionStories, issueEditions, monthEditions, profileFor, type Edition, type SiteProfile, type StoryLink } from './sites';
import { normalize, slugify } from './text';
import type { Transport } from './transport';

export async function listEditions(p: SiteProfile, t: Transport): Promise<Edition[]> {
  if (p.edition.kind === 'month') return monthEditions(p);
  const index = issueEditions(parseHtml(await t.fetchText(p.edition.index), p.edition.index), p);
  if (!p.edition.current) return index;
  // The newest issue is often on the home page before the archive lists it.
  const listed = new Set(index.map((e) => e.url));
  try {
    const newer = issueEditions(parseHtml(await t.fetchText(p.edition.current), p.edition.current), p).filter((e) => !listed.has(e.url));
    return [...newer.slice(0, 1), ...index];
  } catch {
    return index;
  }
}

/** The edition's stories, and the edition page's own title (for an address pasted in). */
export async function listStories(p: SiteProfile, edition: Edition, t: Transport): Promise<{ stories: StoryLink[]; title: string }> {
  let title = '';
  const stories = await editionStories(p, edition, async (url) => {
    const doc = parseHtml(await t.fetchText(url), url);
    title ||= cleanTitle(normalize(meta(doc, 'og:title') || doc.title), p.name);
    return doc;
  });
  return { stories, title };
}

export function editionIssueId(p: SiteProfile, edition: Edition, at = new Date()): string {
  const month = edition.month ?? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  // Whole words only: "smokelong", not "smokelong-quarte".
  const short = (s: string, max: number) => slugify(s).split('-').reduce((acc, w) => (!acc ? w : acc.length + w.length < max ? `${acc}-${w}` : acc), '');
  return `${month}-${short(p.name, 16)}-${short(edition.label, 28)}`;
}

export interface Fill {
  /** Pages to aim for. */
  target: number;
  /** Earlier editions to take from, nearest first. */
  candidates: Edition[];
}

/** Reading order is oldest first: months by date; issues by their place in the list, which runs newest first. */
function oldestFirst(editions: Edition[], listOrder: Edition[]): Edition[] {
  const pos = (e: Edition) => listOrder.findIndex((x) => x.url === e.url);
  return [...editions].sort((a, b) => (a.month && b.month ? a.month.localeCompare(b.month) : pos(b) - pos(a)));
}

const ref = (e: Edition): EditionRef => ({ label: e.label, url: e.url, ...(e.month ? { month: e.month } : {}) });

/**
 * An issue of one journal made from one or more of its editions. With `fill`,
 * the walk adds earlier editions until the booklet reaches about the target.
 */
export async function createEditionIssue(p: SiteProfile, editions: Edition[], stories: StoryLink[], opts: { listOrder?: Edition[]; fill?: Fill } = {}): Promise<Issue> {
  const ordered = oldestFirst(editions, opts.listOrder ?? editions);
  const label = editionsLabel(ordered.map(ref));
  const newest = ordered[ordered.length - 1];
  const id = editionIssueId(p, { ...newest, label });
  const existing = await get('issues', id);
  const issue: Issue = existing ?? {
    id,
    order: [],
    coverColour: '',
    subtitle: `${p.name} · ${label}`,
    source: { domain: p.domain, publication: p.name, edition: label, url: newest.url, editions: ordered.map(ref) },
    createdAt: now(),
    updatedAt: now(),
  };
  if (!existing) await put('issues', issue);
  const done = new Set((await kvGet<string[]>(`walked:${id}`)) ?? []);
  await kvSet(`walk:${id}`, stories.filter((s) => !done.has(s.url)));
  if (opts.fill) await kvSet(`fill:${id}`, opts.fill);
  return issue;
}

/** A rough page count from what has been fetched: prose at about 210 words a page, plus headings and front matter. */
export function estimatePages(articles: Pick<Article, 'words' | 'shortTake' | 'excluded'>[], editions = 1): number {
  const body = articles.filter((a) => !a.excluded).reduce((n, a) => n + a.words / 210 + (a.shortTake ? 0.35 : 0.8), 0);
  return Math.round(4 + body + (editions > 1 ? editions * 0.4 : 0));
}

export async function remaining(issueId: string): Promise<StoryLink[]> {
  return (await kvGet<StoryLink[]>(`walk:${issueId}`)) ?? [];
}

export interface WalkProgress {
  done: number;
  total: number;
  current?: string;
  failed: { url: string; error: string }[];
}

/**
 * Fetches each remaining story in order. Stops early when `signal` aborts;
 * what is left stays saved for next time.
 */
export async function walk(issueId: string, settings: Settings, t: Transport, onProgress: (p: WalkProgress) => void, signal?: AbortSignal): Promise<WalkProgress> {
  let issue = await get('issues', issueId);
  let left = await remaining(issueId);
  const progress: WalkProgress = { done: 0, total: left.length, failed: [] };
  const walked = new Set((await kvGet<string[]>(`walked:${issueId}`)) ?? []);
  const notes: string[] = [];
  const p = issue?.source ? profileFor(issue.source.url, await loadProfiles()) : undefined;
  if (p && !signal?.aborted) await ensureMark(p, t);
  while (!signal?.aborted) {
    if (!left.length) {
      const next = await nextEdition(issueId, t);
      if (!next) break;
      left = next;
      progress.total += next.length;
      await kvSet(`walk:${issueId}`, left);
      continue;
    }
    const story = left[0];
    onProgress({ ...progress, current: story.label });
    try {
      const html = await t.fetchText(story.url);
      const r = await addFromHtml({ issueId, url: story.url, html, via: t.name === 'extension' ? 'extension' : 'proxy', settings, transport: t, section: story.edition ?? issue?.source?.edition });
      notes.push(...r.notes);
      walked.add(story.url);
    } catch (e) {
      if (e instanceof DuplicateError) walked.add(story.url);
      else progress.failed.push({ url: story.url, error: (e as Error).message });
    }
    left = left.slice(1);
    progress.done++;
    await kvSet(`walk:${issueId}`, left);
    await kvSet(`walked:${issueId}`, [...walked]);
  }
  for (const f of progress.failed) notes.push(`Couldn’t fetch ${f.url}: ${f.error}`);
  if (notes.length) await kvSet(`notes:${issueId}`, [...((await kvGet<string[]>(`notes:${issueId}`)) ?? []), ...new Set(notes)]);
  onProgress({ ...progress, current: undefined });
  return progress;
}

/**
 * When the booklet is still short of its target, take the next earlier
 * edition: list its stories and add it to the issue. Undefined when full or
 * when there are no more candidates.
 */
async function nextEdition(issueId: string, t: Transport): Promise<StoryLink[] | undefined> {
  const fill = await kvGet<Fill>(`fill:${issueId}`);
  const issue = await get('issues', issueId);
  if (!fill || !issue?.source || !fill.candidates.length) return undefined;
  const articles = (await all('articles')).filter((a) => issue.order.includes(a.id));
  const editions = issue.source.editions ?? [{ label: issue.source.edition, url: issue.source.url }];
  if (estimatePages(articles, editions.length) >= fill.target * 0.85) return undefined;
  const p = profileFor(issue.source.url, await loadProfiles());
  if (!p) return undefined;
  const [edition, ...rest] = fill.candidates;
  await kvSet(`fill:${issueId}`, { ...fill, candidates: rest });
  const { stories } = await listStories(p, edition, t);
  // The earlier edition goes first in reading order.
  const all_ = [ref(edition), ...editions];
  const label = editionsLabel(all_);
  await put('issues', { ...issue, subtitle: `${issue.source.publication} · ${label}`, source: { ...issue.source, edition: label, editions: all_ }, updatedAt: now() });
  return stories.map((s) => ({ ...s, edition: edition.label }));
}

// ---------- One walk at a time, outliving page changes ----------

type Listener = (issueId: string, p: WalkProgress | null) => void;
const listeners = new Set<Listener>();
let running: { issueId: string; progress: WalkProgress; abort: AbortController } | null = null;

export function onWalk(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentWalk(): { issueId: string; progress: WalkProgress } | null {
  return running && { issueId: running.issueId, progress: running.progress };
}

export function stopWalk(): void {
  running?.abort.abort();
}

export async function startWalk(issueId: string, settings: Settings, t: Transport): Promise<WalkProgress | null> {
  if (running) return null;
  const abort = new AbortController();
  running = { issueId, progress: { done: 0, total: 0, failed: [] }, abort };
  try {
    return await walk(issueId, settings, t, (p) => {
      if (running) running.progress = p;
      for (const fn of listeners) fn(issueId, p);
    }, abort.signal);
  } finally {
    running = null;
    for (const fn of listeners) fn(issueId, null);
  }
}
