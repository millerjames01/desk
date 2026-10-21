/** Pieces, their versions, and the page photos they came from. */

import { diffWordsWithSpace } from 'diff';
import { all, get, now, put, putMany, remove, uid } from '../db';
import { countWords } from '../read/text';
import type { PagePhoto, Piece, Version } from '../types';

export async function createPiece(title: string, text = '', source: Version['source'] = 'paste'): Promise<Piece> {
  const piece: Piece = { id: uid('piece'), title: title || 'Untitled', status: 'drafting', working: text, notes: '', createdAt: now(), updatedAt: now() };
  await put('pieces', piece);
  if (text.trim()) await saveVersion(piece, text, source === 'ocr' ? 'Transcribed from the handwritten pages' : 'First draft', source);
  return piece;
}

export async function versionsOf(pieceId: string): Promise<Version[]> {
  return (await all('versions')).filter((v) => v.pieceId === pieceId).sort((a, b) => a.n - b.n);
}

export async function pagesOf(pieceId: string): Promise<PagePhoto[]> {
  return (await all('pages')).filter((p) => p.pieceId === pieceId).sort((a, b) => a.order - b.order);
}

export async function saveVersion(piece: Piece, text: string, note: string, source: Version['source'] = 'edit'): Promise<Version> {
  const prior = await versionsOf(piece.id);
  const v: Version = { id: uid('ver'), pieceId: piece.id, n: (prior[prior.length - 1]?.n ?? 0) + 1, text, note, source, words: countWords(text), createdAt: now(), updatedAt: now() };
  await put('versions', v);
  await put('pieces', { ...piece, working: text, updatedAt: now() });
  return v;
}

export async function saveWorking(piece: Piece, working: string): Promise<Piece> {
  const next = { ...piece, working, updatedAt: now() };
  await put('pieces', next);
  return next;
}

export async function addPages(pieceId: string, photos: { blob: Blob; ocr: string; engine: PagePhoto['engine']; confidence?: number }[]): Promise<PagePhoto[]> {
  const start = (await pagesOf(pieceId)).length;
  const pages: PagePhoto[] = [];
  for (const [i, p] of photos.entries()) {
    const blobId = uid('photo');
    await put('blobs', { id: blobId, kind: 'page-photo', blob: p.blob, createdAt: now() });
    pages.push({ id: uid('page'), pieceId, blobId, order: start + i, ocr: p.ocr, engine: p.engine, confidence: p.confidence, createdAt: now(), updatedAt: now() });
  }
  await putMany('pages', pages);
  return pages;
}

export async function deletePiece(pieceId: string): Promise<void> {
  for (const v of await versionsOf(pieceId)) await remove('versions', v.id);
  for (const p of await pagesOf(pieceId)) {
    await remove('blobs', p.blobId);
    await remove('pages', p.id);
  }
  await remove('pieces', pieceId);
}

export async function photoUrl(page: PagePhoto): Promise<string | undefined> {
  const rec = await get('blobs', page.blobId);
  return rec?.blob ? URL.createObjectURL(rec.blob) : undefined;
}

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function compare(a: string, b: string): DiffPart[] {
  return diffWordsWithSpace(a, b);
}

export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (p.added) added += countWords(p.value);
    if (p.removed) removed += countWords(p.value);
  }
  return { added, removed };
}
