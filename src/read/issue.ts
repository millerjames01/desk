import type { EditionRef, HouseStyle, Issue } from '../types';
import { numberWords, roman, wordsToNumber } from './text';

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

/**
 * A booklet of one journal's edition carries that edition's number, not
 * Marginalia's own count: "93" for SmokeLong's Issue Ninety-Three, the month
 * for a journal that publishes by month.
 */
export interface EditionNumber {
  publication: string;
  number: number;
  /** A month edition: `number` is the month, `label` its name. */
  month?: boolean;
  label: string;
  /** Several editions: "07–09", "92–93". */
  range?: string;
}

/**
 * Several editions under one name: "July–September 2026" for months,
 * "Issues 92–93" for numbered issues, else the labels joined.
 */
export function editionsLabel(editions: EditionRef[]): string {
  if (editions.length === 1) return editions[0].label;
  const first = editions[0], last = editions[editions.length - 1];
  if (first.month && last.month) {
    const [fy, fm] = first.month.split('-').map(Number), [ly, lm] = last.month.split('-').map(Number);
    return fy === ly ? `${MONTHS[fm - 1]}–${MONTHS[lm - 1]} ${ly}` : `${MONTHS[fm - 1]} ${fy}–${MONTHS[lm - 1]} ${ly}`;
  }
  const nums = editions.map((e) => editionNumberOf(e.label));
  if (nums.every((n) => n !== undefined)) return `Issues ${nums[0]}–${nums[nums.length - 1]}`;
  return editions.map((e) => e.label).join(' & ');
}

function editionNumberOf(label: string): number | undefined {
  const digits = label.match(/\d+/);
  return digits ? parseInt(digits[0], 10) : wordsToNumber(label.replace(/^(issue|no\.?|number|volume|vol\.?)\s+/i, ''));
}

export function editionNumber(source: NonNullable<Issue['source']>, issueId: string): EditionNumber | undefined {
  const many = source.editions && source.editions.length > 1 ? source.editions : undefined;
  if (many) {
    const first = many[0], last = many[many.length - 1];
    const two = (n: number) => String(n).padStart(2, '0');
    if (first.month && last.month) {
      const a = Number(first.month.slice(5)), b = Number(last.month.slice(5));
      return { publication: source.publication, number: b, month: true, label: source.edition, range: `${two(a)}–${two(b)}` };
    }
    const a = editionNumberOf(first.label), b = editionNumberOf(last.label);
    if (a !== undefined && b !== undefined) return { publication: source.publication, number: b, label: source.edition, range: `${a}–${b}` };
    return undefined;
  }
  const month = source.edition.match(/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/);
  if (month) return { publication: source.publication, number: MONTHS.indexOf(month[1]) + 1, month: true, label: source.edition };
  const digits = source.edition.match(/\d+/);
  const words = source.edition.replace(/^(issue|no\.?|number|volume|vol\.?)\s+/i, '');
  const n = digits ? parseInt(digits[0], 10) : wordsToNumber(words);
  if (n !== undefined) return { publication: source.publication, number: n, label: source.edition };
  if (/^\d{4}-\d{2}/.test(issueId)) return { publication: source.publication, number: parseInt(issueId.slice(5, 7), 10), month: true, label: source.edition };
  return undefined;
}

export function labels(house: HouseStyle, title: string, number: number, edition?: EditionNumber): IssueLabels {
  if (edition?.range) {
    const pub = edition.publication;
    const mark = `${pub} · ${edition.label}`;
    switch (house) {
      case 'a-review':
        return { number: edition.number, numberLabel: edition.month ? edition.label : `Nos. ${edition.range}`, mark };
      case 'b-grid':
        return { number: edition.number, numberLabel: edition.range, mark };
      case 'c-pamphlet':
        return { number: edition.number, numberLabel: edition.label, mark };
    }
  }
  if (edition) {
    const n = edition.number;
    const two = String(n).padStart(2, '0');
    const pub = edition.publication;
    switch (house) {
      case 'a-review':
        return { number: n, numberLabel: edition.month ? edition.label : `No. ${n}`, mark: edition.month ? `${pub} · ${edition.label}` : `${pub} · No. ${n}` };
      case 'b-grid':
        return { number: n, numberLabel: two, mark: edition.month ? `${pub} · ${edition.label}` : `${pub} ${two}` };
      case 'c-pamphlet':
        return { number: n, numberLabel: edition.month ? edition.label : `Number ${numberWords(n)}`, mark: edition.month ? `${pub} · ${edition.label}` : `${pub} · ${roman(n)}` };
    }
  }
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
