/**
 * A journal's mark for the Grid cover: its logo or favicon, fetched once
 * through the polite transport and turned to black ink, because the cover
 * prints black on coloured card.
 */

import { get, now, put } from '../db';
import type { Mark, SiteProfile } from './sites';
import type { Transport } from './transport';

/** Long edge of the stored mark, enough for about 25 mm at print resolution. */
const MARK_EDGE = 600;

export const markId = (domain: string) => `mark-${domain}`;

/** How much ink a pixel gets, from its colour and opacity (0–255 each). */
export function inkOf(r: number, g: number, b: number, a: number, ink: Mark['ink'] = 'shape'): number {
  if (ink === 'shape') return a;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.round(((ink === 'dark' ? 255 - y : y) * a) / 255);
}

/** An SVG with only a viewBox has no size of its own as an image; give it one. */
export function sizedSvg(text: string): string {
  const root = text.match(/<svg\b[^>]*>/)?.[0];
  if (!root || /\swidth=/.test(root)) return text;
  const vb = root.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!vb) return text;
  const k = MARK_EDGE / Math.max(Number(vb[1]), Number(vb[2]));
  return text.replace(root, root.replace('<svg', `<svg width="${Math.round(Number(vb[1]) * k)}" height="${Math.round(Number(vb[2]) * k)}"`));
}

async function decode(blob: Blob): Promise<HTMLImageElement> {
  if (/svg/.test(blob.type)) blob = new Blob([sizedSvg(await blob.text())], { type: 'image/svg+xml' });
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(img.src);
  }
  return img;
}

/** Black on transparent, cropped and scaled, as a PNG. */
export async function inkMark(src: Blob, mark: Mark): Promise<Blob | null> {
  const img = await decode(src).catch(() => null);
  if (!img || !img.naturalWidth) return null;
  const [cx, cy, cw, ch] = mark.crop ?? [0, 0, 1, 1];
  const sw = img.naturalWidth * cw, sh = img.naturalHeight * ch;
  const scale = MARK_EDGE / Math.max(sw, sh);
  const width = Math.round(sw * scale), height = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, img.naturalWidth * cx, img.naturalHeight * cy, sw, sh, 0, 0, width, height);
  const px = g.getImageData(0, 0, width, height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = inkOf(d[i], d[i + 1], d[i + 2], d[i + 3], mark.ink);
    d[i] = d[i + 1] = d[i + 2] = 17;
    d[i + 3] = a;
  }
  g.putImageData(px, 0, 0);
  return new Promise((r) => canvas.toBlob(r, 'image/png'));
}

/**
 * Stores the profile's mark the first time a walk needs it. One request at
 * most, through the transport, so robots.txt and the gap between requests
 * apply. A mark that can't be had leaves the cover without one.
 */
export async function ensureMark(p: SiteProfile, t: Transport): Promise<void> {
  if (!p.mark || (await get('blobs', markId(p.domain)))) return;
  try {
    const raw = p.mark.svg ? new Blob([p.mark.svg], { type: 'image/svg+xml' }) : p.mark.url ? await t.fetchImage(p.mark.url) : null;
    const blob = raw ? await inkMark(raw, p.mark) : null;
    if (blob) await put('blobs', { id: markId(p.domain), kind: 'mark', blob, createdAt: now() });
  } catch {
    // The cover goes without.
  }
}
