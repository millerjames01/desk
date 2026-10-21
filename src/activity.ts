/**
 * Reading and writing days, derived from the record every time: a version
 * saved, a page captured, an article marked read, a submission sent. Nothing
 * is stored, so there is no count to drift or to pad.
 */

import type { Article, PagePhoto, Submission, Version } from './types';

export type Kind = 'write' | 'read' | 'send';

export interface Day {
  date: string;
  kinds: Set<Kind>;
}

export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function activity(input: { versions: Version[]; pages: PagePhoto[]; articles: Article[]; submissions: Submission[] }): Map<string, Set<Kind>> {
  const days = new Map<string, Set<Kind>>();
  const mark = (iso: string | undefined, k: Kind) => {
    if (!iso) return;
    const d = iso.length === 10 ? iso : localDate(iso);
    if (!days.has(d)) days.set(d, new Set());
    days.get(d)!.add(k);
  };
  for (const v of input.versions) mark(v.createdAt, 'write');
  for (const p of input.pages) mark(p.createdAt, 'write');
  for (const a of input.articles) mark(a.readAt, 'read');
  for (const s of input.submissions) mark(s.submittedAt, 'send');
  return days;
}

function shift(date: string, by: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + by);
  return localDate(d.toISOString());
}

/** Consecutive days with `kind`, ending today (or yesterday, if today is still open). */
export function streak(days: Map<string, Set<Kind>>, kind: Kind, today: string): number {
  let d = days.get(today)?.has(kind) ? today : shift(today, -1);
  let n = 0;
  while (days.get(d)?.has(kind)) {
    n++;
    d = shift(d, -1);
  }
  return n;
}

/** The last `weeks` weeks, Monday first, for the calendar strip. */
export function calendar(days: Map<string, Set<Kind>>, today: string, weeks = 12): Day[][] {
  const t = new Date(today + 'T12:00:00');
  const back = (t.getDay() + 6) % 7;
  let start = shift(today, -back - (weeks - 1) * 7);
  const out: Day[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: Day[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: start, kinds: days.get(start) ?? new Set() });
      start = shift(start, 1);
    }
    out.push(week);
  }
  return out;
}
