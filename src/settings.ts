import { kvGet, kvSet } from './db';
import type { BookConfig, Settings } from './types';

export const DEFAULT_BOOK: BookConfig = {
  title: 'Marginalia',
  tagline: 'A private review of things worth reading',
  house_style: 'b-grid',
  max_images_per_article: 3,
  recto_starts: false,
  creep_mm_per_sheet: 0.2,
  pad_with: 'blank',
  printer: 'TBD',
  place: '',
  target_pages: 48,
};

/**
 * Public CORS proxies, tried in order after a direct fetch. They come and go
 * and rate-limit freely; the bookmarklet is the dependable path. Add your own
 * (e.g. a Cloudflare Worker) at the top in Settings.
 */
export const DEFAULT_PROXIES = [
  'https://api.allorigins.win/raw?url={url}',
  'https://api.codetabs.com/v1/proxy?quest={url}',
  'https://corsproxy.io/?url={url}',
];

export const DEFAULT_SETTINGS: Settings = {
  book: DEFAULT_BOOK,
  proxies: DEFAULT_PROXIES,
  anthropicKey: '',
  claudeModel: 'claude-opus-5-5',
  ocrEngine: 'tesseract',
  autoClaudeExtract: true,
};

export async function loadSettings(): Promise<Settings> {
  const saved = (await kvGet<Partial<Settings>>('settings')) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, book: { ...DEFAULT_BOOK, ...(saved.book ?? {}) } };
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvSet('settings', s);
}
