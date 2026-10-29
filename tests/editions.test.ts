import { describe, expect, it } from 'vitest';
import { editionNumber, editionsLabel, editionStrip, labels } from '../src/read/issue';
import { inkOf, sizedSvg } from '../src/read/mark';
import { runQa } from '../src/read/qa';
import { editionGroups, runsOn } from '../src/read/render';
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

  it('fills the gathered months or issues on the cover strip', () => {
    const lb = { domain: 'lost-balloon.com', publication: 'Lost Balloon', edition: 'July–September 2026', url: '', editions: months };
    const strip = editionStrip(lb, '2026-10-lb')!;
    expect(strip.map((c) => c.label).join('')).toBe('JFMAMJJASOND');
    expect(strip.filter((c) => c.on).map((_, i) => i)).toHaveLength(3);
    expect(strip.findIndex((c) => c.on)).toBe(6);
    const one = editionStrip({ ...lb, edition: 'October 2026', editions: undefined }, 'x')!;
    expect(one.findIndex((c) => c.on)).toBe(9);
    const winter = editionStrip({ ...lb, edition: 'December 2025–January 2026', editions: [{ label: 'December 2025', url: '', month: '2025-12' }, { label: 'January 2026', url: '', month: '2026-01' }] }, 'x')!;
    expect(winter.filter((c) => c.on).map((c) => c.label)).toEqual(['J', 'D']);
    const sl = editionStrip({ domain: 's', publication: 'SmokeLong Quarterly', edition: 'Issues 92–93', url: '', editions: [{ label: 'Issue 92', url: '' }, { label: 'Issue 93', url: '' }] }, 'x')!;
    expect(sl.map((c) => c.label)).toEqual(['87', '88', '89', '90', '91', '92', '93', '94']);
    expect(sl.filter((c) => c.on).map((c) => c.label)).toEqual(['92', '93']);
    expect(editionStrip({ domain: 's', publication: 'S', edition: 'Issue 3', url: '' }, 'x')!.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(editionStrip({ domain: 's', publication: 'S', edition: 'The Winter One', url: '' }, 'undated')).toBeUndefined();
  });

  it('turns a mark to black ink', () => {
    expect(inkOf(200, 40, 30, 255, 'shape')).toBe(255);
    expect(inkOf(255, 255, 255, 255, 'dark')).toBe(0);
    expect(inkOf(0, 0, 0, 255, 'dark')).toBe(255);
    expect(inkOf(255, 255, 255, 128, 'light')).toBe(128);
    expect(sizedSvg('<svg viewBox="0 0 156 133"><path/></svg>')).toBe('<svg width="600" height="512" viewBox="0 0 156 133"><path/></svg>');
    expect(sizedSvg('<svg width="10" viewBox="0 0 1 1"/>')).toBe('<svg width="10" viewBox="0 0 1 1"/>');
  });

  it('fails QA when the cover runs onto a second page', () => {
    const page = () => Object.assign(document.createElement('div'), { innerHTML: '<div class="pagedjs_page_content"><section class="cover">x</section></div>' });
    const pages = [page(), page()];
    pages.forEach((p, i) => (p.dataset.pageNumber = String(i + 1)));
    const items = runQa({ pages, source: document.createElement('div'), articles: [] } as unknown as Parameters<typeof runQa>[0]);
    expect(items).toContainEqual(expect.objectContaining({ level: 'error', page: 2, message: 'The cover runs onto a second page.' }));
  });

  it('starts every piece on a page, except a very short one after another', () => {
    const piece = (words: number) => ({ words, shortTake: words < 1000 }) as Article;
    expect(runsOn(piece(60), piece(40))).toBe(true);
    expect(runsOn(piece(60), piece(600))).toBe(false);
    expect(runsOn(piece(600), piece(60))).toBe(false);
    expect(runsOn(piece(60), undefined)).toBe(false);
  });
});
