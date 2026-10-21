/** Submission rules and figures. Pure functions over the records. */

import type { Journal, Piece, Submission } from '../types';

export const DAY = 86400000;

export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY));
}

export function daysOut(s: Submission, today: string): number {
  return daysBetween(s.submittedAt, s.respondedAt ?? today);
}

/** Pending past the journal's stated response time. */
export function overdue(s: Submission, j: Journal | undefined, today: string): boolean {
  return s.status === 'pending' && !!j?.responseDays && daysOut(s, today) > j.responseDays;
}

export interface Warning {
  level: 'block' | 'warn';
  message: string;
}

/** What to know before sending `pieceId` to `journalId`. */
export function checkSubmission(pieceId: string, journalId: string, subs: Submission[], journals: Map<string, Journal>): Warning[] {
  const out: Warning[] = [];
  const j = journals.get(journalId);
  const mine = subs.filter((s) => s.pieceId === pieceId);
  const here = mine.filter((s) => s.journalId === journalId);
  if (mine.some((s) => s.status === 'accepted')) out.push({ level: 'block', message: 'This piece has already been accepted elsewhere.' });
  if (here.some((s) => s.status === 'pending')) out.push({ level: 'block', message: `Already out at ${j?.name ?? 'this journal'}.` });
  if (here.some((s) => s.status === 'rejected')) out.push({ level: 'warn', message: `${j?.name ?? 'This journal'} has declined this piece before.` });
  const pendingElsewhere = mine.filter((s) => s.status === 'pending' && s.journalId !== journalId);
  if (pendingElsewhere.length && j && !j.simultaneous) {
    out.push({ level: 'warn', message: `${j.name} does not take simultaneous submissions, and this piece is out at ${pendingElsewhere.length} other place${pendingElsewhere.length > 1 ? 's' : ''}.` });
  }
  for (const s of pendingElsewhere) {
    const other = journals.get(s.journalId);
    if (other && !other.simultaneous) out.push({ level: 'warn', message: `${other.name} asked for an exclusive submission and still has this piece.` });
  }
  return out;
}

/** After an acceptance: everything else still out for that piece, to withdraw. */
export function toWithdraw(accepted: Submission, subs: Submission[]): Submission[] {
  return subs.filter((s) => s.pieceId === accepted.pieceId && s.id !== accepted.id && s.status === 'pending');
}

export interface JournalStats {
  sent: number;
  pending: number;
  accepted: number;
  rejected: number;
  personal: number;
  /** Median days to a response, from answered submissions. */
  medianDays?: number;
}

export function journalStats(journalId: string, subs: Submission[]): JournalStats {
  const mine = subs.filter((s) => s.journalId === journalId);
  const answered = mine.filter((s) => s.respondedAt && (s.status === 'accepted' || s.status === 'rejected'));
  const days = answered.map((s) => daysBetween(s.submittedAt, s.respondedAt!)).sort((a, b) => a - b);
  return {
    sent: mine.length,
    pending: mine.filter((s) => s.status === 'pending').length,
    accepted: mine.filter((s) => s.status === 'accepted').length,
    rejected: mine.filter((s) => s.status === 'rejected').length,
    personal: mine.filter((s) => s.status === 'rejected' && s.personal).length,
    medianDays: days.length ? days[Math.floor((days.length - 1) / 2)] : undefined,
  };
}

export interface Totals {
  out: number;
  sentThisYear: number;
  accepted: number;
  rejected: number;
  /** Pieces marked ready with nothing out. */
  idle: Piece[];
}

export function totals(subs: Submission[], pieces: Piece[], today: string): Totals {
  const year = today.slice(0, 4);
  const busy = new Set(subs.filter((s) => s.status === 'pending' || s.status === 'accepted').map((s) => s.pieceId));
  return {
    out: subs.filter((s) => s.status === 'pending').length,
    sentThisYear: subs.filter((s) => s.submittedAt.startsWith(year)).length,
    accepted: subs.filter((s) => s.status === 'accepted').length,
    rejected: subs.filter((s) => s.status === 'rejected').length,
    idle: pieces.filter((p) => p.status === 'ready' && !busy.has(p.id)),
  };
}
