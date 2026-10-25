import { describe, expect, it } from 'vitest';
import { editionNumber, editionsLabel, labels } from '../src/read/issue';
import { editionGroups } from '../src/read/render';
import { estimatePages } from '../src/read/walk';
import type { Article, Issue } from '../src/types';

const months = [
  { label: 'July 2026', url: 'u7', month: '2026-07' },
  { label: 'August 2026', url: 'u8', month: '2026-08' },
  { label: 'September 2026', url: 'u9', month: '2026-09' },
];

describe('several editions in one booklet', () => {
  it('names the run', () => {
    expect(editionsLabel(months)).toBe('July–September 2026');
    expect(editionsLabel([{ label: 'December 2025', url: '', month: '2025-12' }, { label: 'January 2026', url: '', month: '2026-01' }])).toBe('December 2025–January 2026');
    expect(editionsLabel([{ label: 'Issue Ninety-Two', url: '' }, { label: 'Issue Ninety-Three', url: '' }])).toBe('Issues 92–93');
    expect(editionsLabel([{ label: 'Spring', url: '' }, { label: 'Summer', url: '' }])).toBe('Spring & Summer');
    expect(editionsLabel([months[0]])).toBe('July 2026');
  });

  it('numbers the cover with a range', () => {
    const src = { domain: 'lostballoon.com', publication: 'Lost Balloon', edition: 'July–September 2026', url: '', editions: months };
    const ed = editionNumber(src, '2026-10-lost-balloon')!;
    expect(ed).toMatchObject({ number: 9, month: true, range: '07–09' });
    expect(labels('b-grid', 'Marginalia', 1, ed)).toMatchObject({ numberLabel: '07–09', mark: 'Lost Balloon · July–September 2026' });
    expect(labels('a-review', 'Marginalia', 1, ed).numberLabel).toBe('July–September 2026');
    expect(labels('c-pamphlet', 'Marginalia', 1, ed).numberLabel).toBe('July–September 2026');
    const issues = editionNumber({ domain: 's', publication: 'SmokeLong Quarterly', edition: 'Issues 92–93', url: '', editions: [{ label: 'Issue 92', url: '' }, { label: 'Issue 93', url: '' }] }, 'x')!;
    expect(issues.range).toBe('92–93');
    expect(labels('a-review', 'Marginalia', 1, issues).numberLabel).toBe('Nos. 92–93');
  });

  it('groups articles by edition, oldest first, long reads before Short Takes', () => {
    const art = (id: string, section: string, shortTake = false) => ({ id, section, shortTake }) as Article;
    const issue = { source: { editions: months } } as Issue;
    const groups = editionGroups(issue, [art('a', 'September 2026'), art('b', 'July 2026', true), art('c', 'July 2026'), art('d', 'Elsewhere')])!;
    expect(groups.map((g) => g.label)).toEqual(['July 2026', 'September 2026']);
    expect(groups[0].articles.map((a) => a.id)).toEqual(['c', 'b']);
    expect(groups[1].articles.map((a) => a.id)).toEqual(['a', 'd']);
    expect(editionGroups({ source: { editions: [months[0]] } } as Issue, [])).toBeUndefined();
  });

  it('estimates pages from words', () => {
    expect(estimatePages([])).toBe(4);
    expect(estimatePages([{ words: 2100, shortTake: false, excluded: false }, { words: 2100, shortTake: false, excluded: true }])).toBe(15);
    expect(estimatePages([{ words: 420, shortTake: true, excluded: false }], 3)).toBe(8);
  });
});
