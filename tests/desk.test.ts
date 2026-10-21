import { describe, expect, it } from 'vitest';
import { activity, calendar, streak } from '../src/activity';
import { newer } from '../src/backup';
import { tidy } from '../src/drafts/ocr';
import { compare, diffStats } from '../src/drafts/drafts';
import { checkSubmission, daysOut, journalStats, overdue, toWithdraw, totals } from '../src/publish/publish';
import type { Journal, Piece, Submission } from '../src/types';

const journal = (id: string, simultaneous = true, responseDays?: number): Journal => ({ id, name: id.toUpperCase(), url: '', simultaneous, responseDays, fee: '', notes: '', createdAt: '', updatedAt: '' });
const sub = (id: string, pieceId: string, journalId: string, status: Submission['status'] = 'pending', submittedAt = '2026-06-01', respondedAt?: string): Submission => ({
  id, pieceId, journalId, status, submittedAt, respondedAt, personal: false, notes: '', createdAt: '', updatedAt: '',
});

describe('submissions', () => {
  const journals = new Map([journal('a'), journal('b', false, 60), journal('c')].map((j) => [j.id, j]));

  it('blocks a second submission of the same piece to the same journal, and anything after an acceptance', () => {
    expect(checkSubmission('p', 'a', [sub('1', 'p', 'a')], journals)[0].level).toBe('block');
    expect(checkSubmission('p', 'c', [sub('1', 'p', 'a', 'accepted')], journals).some((w) => w.level === 'block')).toBe(true);
  });

  it('warns about exclusivity both ways, and about a journal that declined before', () => {
    const toExclusive = checkSubmission('p', 'b', [sub('1', 'p', 'a')], journals);
    expect(toExclusive.map((w) => w.message).join()).toMatch(/does not take simultaneous/);
    const fromExclusive = checkSubmission('p', 'c', [sub('1', 'p', 'b')], journals);
    expect(fromExclusive.map((w) => w.message).join()).toMatch(/asked for an exclusive/);
    expect(checkSubmission('p', 'a', [sub('1', 'p', 'a', 'rejected')], journals)[0].level).toBe('warn');
    expect(checkSubmission('p', 'a', [], journals)).toEqual([]);
  });

  it('days out, overdue, and what to withdraw after an acceptance', () => {
    const s = sub('1', 'p', 'b');
    expect(daysOut(s, '2026-06-11')).toBe(10);
    expect(overdue(s, journals.get('b'), '2026-07-30')).toBe(false);
    expect(overdue(s, journals.get('b'), '2026-08-02')).toBe(true);
    const all = [sub('1', 'p', 'a', 'accepted'), sub('2', 'p', 'c'), sub('3', 'q', 'c')];
    expect(toWithdraw(all[0], all).map((x) => x.id)).toEqual(['2']);
  });

  it('journal stats and totals', () => {
    const subs = [sub('1', 'p', 'a', 'rejected', '2026-01-01', '2026-01-31'), sub('2', 'q', 'a', 'accepted', '2026-02-01', '2026-02-11'), sub('3', 'r', 'a')];
    expect(journalStats('a', subs)).toMatchObject({ sent: 3, pending: 1, accepted: 1, rejected: 1, medianDays: 10 });
    const pieces = [{ id: 'r', status: 'ready' }, { id: 's', status: 'ready' }] as Piece[];
    expect(totals(subs, pieces, '2026-10-21')).toMatchObject({ out: 1, sentThisYear: 3, accepted: 1, idle: [{ id: 's' }] });
  });
});

describe('activity is derived from the record', () => {
  const days = activity({
    versions: [{ createdAt: '2026-10-19T10:00:00' }, { createdAt: '2026-10-20T10:00:00' }, { createdAt: '2026-10-21T09:00:00' }] as never,
    pages: [],
    articles: [{ readAt: '2026-10-20T20:00:00' }] as never,
    submissions: [{ submittedAt: '2026-10-21' }] as never,
  });
  it('counts a streak back from today, or from yesterday while today is open', () => {
    expect(streak(days, 'write', '2026-10-21')).toBe(3);
    expect(streak(days, 'write', '2026-10-22')).toBe(3);
    expect(streak(days, 'write', '2026-10-24')).toBe(0);
    expect(streak(days, 'read', '2026-10-21')).toBe(1);
  });
  it('builds Monday-first weeks ending this week', () => {
    const cal = calendar(days, '2026-10-21', 2);
    expect(cal).toHaveLength(2);
    expect(cal[1][0].date).toBe('2026-10-19');
    expect(cal[1][2].kinds.has('send')).toBe(true);
  });
});

describe('drafts', () => {
  it('OCR text joins wrapped lines and mends hyphens, keeping paragraphs', () => {
    expect(tidy('The first line of a\nlong sen-\ntence.\n\nNext para.')).toBe('The first line of a long sentence.\n\nNext para.');
  });
  it('word diff counts', () => {
    expect(diffStats(compare('The door was open.', 'The door was left open.'))).toEqual({ added: 1, removed: 0 });
  });
});

describe('backup merge', () => {
  it('takes new records and newer copies only', () => {
    const local = [{ id: 'a', updatedAt: '2026-10-02' }, { id: 'b', updatedAt: '2026-10-05' }];
    const incoming = [{ id: 'a', updatedAt: '2026-10-03' }, { id: 'b', updatedAt: '2026-10-01' }, { id: 'c', updatedAt: '2026-10-01' }];
    expect(newer(local, incoming, (r) => r.id).map((r) => r.id)).toEqual(['a', 'c']);
  });
});
