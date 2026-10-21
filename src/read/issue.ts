import type { HouseStyle, Issue } from '../types';
import { numberWords, roman } from './text';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const COVER_DEFAULTS: Record<HouseStyle, string> = {
  'a-review': '#D6B15E',
  'b-grid': '#A3B4C2',
  'c-pamphlet': '#BFBAB0',
};

/** Issues are numbered by the order of their ids (YYYY-MM sorts by date). */
const DATED = /^\d{4}-\d{2}/;

export function issueNumber(id: string, issues: Pick<Issue, 'id'>[]): number {
  if (!DATED.test(id)) return 1;
  const ids = [...new Set([...issues.map((i) => i.id), id])].filter((i) => DATED.test(i)).sort();
  return ids.indexOf(id) + 1;
}

/** The issue's month from its id; an undated issue (the sample) takes this month. */
export function issueDate(id: string): { month: string; short: string; year: number; romanYear: string } {
  const dated = DATED.test(id) ? id : new Date().toISOString().slice(0, 7);
  const [y, m] = dated.split('-').map((n) => parseInt(n, 10));
  const month = MONTHS[(m || 1) - 1] ?? '';
  return { month: `${month} ${y}`, short: `${month.slice(0, 3)} ${y}`, year: y, romanYear: roman(y) };
}

export interface IssueLabels {
  number: number;
  /** "No. 3" (A), "03" (B), "Number Three" (C). */
  numberLabel: string;
  /** Running mark: "Marginalia · No. 3", "Marginalia 03", "Marginalia · III". */
  mark: string;
}

export function labels(house: HouseStyle, title: string, number: number): IssueLabels {
  const two = String(number).padStart(2, '0');
  switch (house) {
    case 'a-review':
      return { number, numberLabel: `No. ${number}`, mark: `${title} · No. ${number}` };
    case 'b-grid':
      return { number, numberLabel: two, mark: `${title} ${two}` };
    case 'c-pamphlet':
      return { number, numberLabel: `Number ${numberWords(number)}`, mark: `${title} · ${roman(number)}` };
  }
}

export function nextIssueId(issues: Pick<Issue, 'id'>[], from = new Date()): string {
  const base = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  const taken = new Set(issues.map((i) => i.id));
  if (!taken.has(base)) return base;
  // Two issues in a month: 2026-11b, 2026-11c…
  for (const suffix of 'bcdefghij') if (!taken.has(base + suffix)) return base + suffix;
  return `${base}-${Date.now()}`;
}
