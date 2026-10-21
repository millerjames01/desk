/**
 * Handwritten page → text. Tesseract runs in the browser and needs nothing
 * but a first download of its English data; it is weak on cursive. With a key
 * in Settings, Claude reads the page instead and the photo goes to Anthropic.
 */

import type { Settings } from '../types';

export interface OcrResult {
  text: string;
  engine: 'tesseract' | 'claude';
  confidence?: number;
}

type Progress = (label: string, fraction: number) => void;

export function ocrEngine(s: Settings): 'tesseract' | 'claude' {
  return s.ocrEngine === 'claude' && s.anthropicKey ? 'claude' : 'tesseract';
}

export async function ocr(image: Blob, s: Settings, onProgress?: Progress, engine = ocrEngine(s)): Promise<OcrResult> {
  if (engine === 'claude') {
    onProgress?.('Claude is reading the page', 0.3);
    const { transcribe } = await import('../claude');
    const text = await transcribe(s, image);
    onProgress?.('Done', 1);
    return { text: tidy(text), engine: 'claude' };
  }
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: tidy(data.text), engine: 'tesseract', confidence: Math.round(data.confidence) };
  } finally {
    await worker.terminate();
  }
}

/**
 * OCR output keeps the page's line breaks. Lines inside a paragraph are
 * joined (mending words hyphenated across a line); blank lines stay as
 * paragraph breaks.
 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .reduce((acc, line) => (acc.endsWith('-') && /^[a-z]/.test(line) ? acc.slice(0, -1) + line : acc ? `${acc} ${line}` : line), ''),
    )
    .filter(Boolean)
    .join('\n\n');
}
