/**
 * Sanity checks on an extracted article (brief §4.2). A flagged article is
 * held out of the booklet until it is fixed or explicitly let through; it is
 * never silently included.
 */

import type { Flag } from '../types';
import { countWords, markdownBlocks, normalize } from './text';

const PAYWALL = [
  'subscribe to continue',
  'subscribe to read',
  'sign in to read',
  'sign in to continue',
  'log in to continue',
  'already a subscriber',
  'become a member to',
  'this article is for subscribers',
  'to continue reading',
  'you have reached your limit',
  'free articles remaining',
];

/** A rough count of the words a reader would see on the raw page. */
export function visibleWords(doc: Document): number {
  const root = (doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body)?.cloneNode(true) as HTMLElement | null;
  if (!root) return 0;
  root.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form,svg,iframe,button').forEach((el) => el.remove());
  return countWords(root.textContent ?? '');
}

export function checkArticle(markdown: string, rawVisibleWords: number): Flag[] {
  const flags: Flag[] = [];
  const { body } = markdownBlocks(markdown);
  const text = body.join('\n');
  const words = countWords(text);

  if (!body.length) return [{ code: 'no-body', detail: 'No article body was found.' }];
  if (words < 300) flags.push({ code: 'thin', detail: `${words} words, under the 300-word floor.` });
  if (rawVisibleWords > 0 && words < rawVisibleWords * 0.5) {
    flags.push({
      code: 'low-ratio',
      detail: `${words} words extracted of about ${rawVisibleWords} visible on the page (${Math.round((words / rawVisibleWords) * 100)}%).`,
    });
  }

  const lower = normalize(text).toLowerCase();
  const hit = PAYWALL.find((p) => lower.includes(p));
  if (hit) flags.push({ code: 'paywall', detail: `Contains “${hit}”.` });

  const last = body[body.length - 1];
  if (!/[.!?…"'”’)\]—–:;*§❧■◆]$/.test(last)) {
    flags.push({ code: 'mid-sentence', detail: `Ends mid-sentence: “…${last.slice(-60)}”.` });
  }

  const linkChars = [...markdown.matchAll(/(?<!!)\[([^\]]*)\]\([^)]*\)/g)].reduce((n, m) => n + m[1].length, 0);
  const allChars = text.length || 1;
  if (linkChars / allChars > 0.3) {
    flags.push({ code: 'link-heavy', detail: `${Math.round((linkChars / allChars) * 100)}% of the text is links.` });
  }

  const seen = new Map<string, number>();
  for (const p of body) if (p.length > 40) seen.set(p, (seen.get(p) ?? 0) + 1);
  const dupes = [...seen.values()].filter((n) => n > 1).length;
  if (dupes) flags.push({ code: 'duplicates', detail: `${dupes} paragraph${dupes > 1 ? 's' : ''} repeated.` });

  return flags;
}
