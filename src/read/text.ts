/** Text helpers shared by extraction, the Claude check and booklet QA. */

/**
 * Normalises text for comparison: compatibility forms, curly quotes and
 * dashes, soft hyphens and zero-width characters, and runs of whitespace.
 * Typography may change between source and page; words may not.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised with every space removed, so a line or page break can't hide a match. */
export function squash(text: string): string {
  return normalize(text).replace(/ /g, '');
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

export function readMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}

/** Markdown inline syntax down to the words a reader sees. */
export function stripInline(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
}

/**
 * The prose blocks of a Markdown body, in order, as plain text: paragraphs,
 * headings, list items, quotes and captions. Footnote definitions are
 * returned separately because a page sets them apart from the body.
 */
export function markdownBlocks(md: string): { body: string[]; notes: string[] } {
  const body: string[] = [];
  const notes: string[] = [];
  for (const raw of md.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block || /^(-{3,}|\*{3,}|_{3,}|(\* ){2,}\*)$/.test(block)) continue;
    const note = block.match(/^\[\^[^\]]+\]:\s*([\s\S]*)$/);
    if (note) {
      notes.push(clean(note[1]));
      continue;
    }
    const caption = block.match(/^!\[[^\]]*\]\([^)\s]*\s+"([^"]*)"\)$/);
    if (caption) {
      if (caption[1].trim()) body.push(clean(caption[1]));
      continue;
    }
    const lines = block.split('\n');
    const listy = lines.every((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s{2,}\S/.test(l));
    if (listy && lines.length > 1) {
      for (const l of lines) {
        const t = clean(l.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        if (t) body.push(t);
      }
      continue;
    }
    const t = clean(
      lines
        .map((l) => l.replace(/^\s*>\s?/, '').replace(/^#{1,6}\s+/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        .join(' '),
    );
    if (t) body.push(t);
  }
  return { body, notes };
}

function clean(s: string): string {
  return normalize(stripInline(s));
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'untitled'
  );
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** "Number One" style, for house C's cover. Up to 99, then digits. */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10].toLowerCase() : '');
  return String(n);
}
