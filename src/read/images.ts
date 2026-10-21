/**
 * Images for print (brief §4.1 step 6): greyscale, at most 1400 px on the
 * long edge, and none under 300 px wide.
 */

export interface Prepared {
  blob: Blob;
  width: number;
  height: number;
}

export const MIN_WIDTH = 300;
export const MAX_EDGE = 1400;

export async function prepareImage(src: Blob): Promise<Prepared | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(src);
  } catch {
    return null;
  }
  if (bitmap.width < MIN_WIDTH) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  g.drawImage(bitmap, 0, 0, width, height);
  const px = g.getImageData(0, 0, width, height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  g.putImageData(px, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  return blob ? { blob, width, height } : null;
}

/** Downscales a photo of a page for storage and OCR; keeps colour. */
export async function preparePhoto(src: Blob, maxEdge = 2200): Promise<Prepared> {
  const bitmap = await createImageBitmap(src);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  return { blob: blob ?? src, width, height };
}
