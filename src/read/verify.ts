/**
 * Checks Claude's extraction against the page (brief §4.2): every paragraph
 * it returns must appear in the source text. One miss rejects the whole
 * result; the article is then listed as needing a manual paste.
 */

import { markdownBlocks, squash } from './text';

export interface Verdict {
  ok: boolean;
  missing: string[];
}

/** Visible text of the raw page, scripts and styles removed. */
export function sourceText(doc: Document): string {
  const body = (doc.body ?? doc.documentElement).cloneNode(true) as HTMLElement;
  body.querySelectorAll('script,style,noscript,template,svg').forEach((el) => el.remove());
  return body.textContent ?? '';
}

export function verifyAgainstSource(markdown: string, source: string): Verdict {
  if (markdown.trim() === 'UNEXTRACTABLE') return { ok: false, missing: ['Claude reported the article could not be extracted.'] };
  const haystack = squash(source);
  const { body, notes } = markdownBlocks(markdown);
  if (!body.length) return { ok: false, missing: ['No paragraphs returned.'] };
  const missing = [...body, ...notes].filter((b) => {
    const s = squash(b);
    return s.length > 0 && !haystack.includes(s);
  });
  return { ok: missing.length === 0, missing };
}
