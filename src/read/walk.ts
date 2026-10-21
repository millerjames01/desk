/**
 * An issue made from one edition of one journal: find the edition's stories,
 * then fetch them one at a time through the polite transport. The remaining
 * list is saved after every story, so a closed tab picks up where it stopped.
 */

import { get, kvGet, kvSet, now, put } from '../db';
import type { Issue, Settings } from '../types';
import { addFromHtml, DuplicateError } from './articles';
import { parseHtml } from './extract';
import { editionStories, issueEditions, monthEditions, type Edition, type SiteProfile, type StoryLink } from './sites';
import { slugify } from './text';
import type { Transport } from './transport';

export async function listEditions(p: SiteProfile, t: Transport): Promise<Edition[]> {
  if (p.edition.kind === 'month') return monthEditions(p);
  const html = await t.fetchText(p.edition.index);
  return issueEditions(parseHtml(html, p.edition.index), p);
}

export async function listStories(p: SiteProfile, edition: Edition, t: Transport): Promise<StoryLink[]> {
  return editionStories(p, edition, async (url) => parseHtml(await t.fetchText(url), url));
}

export function editionIssueId(p: SiteProfile, edition: Edition, at = new Date()): string {
  const month = edition.month ?? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  // Whole words only: "smokelong", not "smokelong-quarte".
  const short = (s: string, max: number) => slugify(s).split('-').reduce((acc, w) => (!acc ? w : acc.length + w.length < max ? `${acc}-${w}` : acc), '');
  return `${month}-${short(p.name, 16)}-${short(edition.label, 28)}`;
}

export async function createEditionIssue(p: SiteProfile, edition: Edition, stories: StoryLink[]): Promise<Issue> {
  const id = editionIssueId(p, edition);
  const existing = await get('issues', id);
  const issue: Issue = existing ?? {
    id,
    order: [],
    coverColour: '',
    subtitle: `${p.name} · ${edition.label}`,
    source: { domain: p.domain, publication: p.name, edition: edition.label, url: edition.url },
    createdAt: now(),
    updatedAt: now(),
  };
  if (!existing) await put('issues', issue);
  const done = new Set((await kvGet<string[]>(`walked:${id}`)) ?? []);
  await kvSet(`walk:${id}`, stories.filter((s) => !done.has(s.url)));
  return issue;
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
  const issue = await get('issues', issueId);
  let left = await remaining(issueId);
  const progress: WalkProgress = { done: 0, total: left.length, failed: [] };
  const walked = new Set((await kvGet<string[]>(`walked:${issueId}`)) ?? []);
  const notes: string[] = [];
  while (left.length && !signal?.aborted) {
    const story = left[0];
    onProgress({ ...progress, current: story.label });
    try {
      const html = await t.fetchText(story.url);
      const r = await addFromHtml({ issueId, url: story.url, html, via: t.name === 'extension' ? 'extension' : 'proxy', settings, transport: t, section: issue?.source?.edition });
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
