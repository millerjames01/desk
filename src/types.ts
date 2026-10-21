/** Everything Desk stores. One IndexedDB store per record type (see db.ts). */

export type HouseStyle = 'a-review' | 'b-grid' | 'c-pamphlet';

export interface BookConfig {
  title: string;
  tagline: string;
  house_style: HouseStyle;
  max_images_per_article: number;
  recto_starts: boolean;
  /** Per sheet, toward the spine. Negative pushes outward. */
  creep_mm_per_sheet: number;
  pad_with: 'blank' | 'notes';
  printer: string;
  /** Place line for house C's cover foot, e.g. "Catalunya". */
  place: string;
}

export interface Settings {
  book: BookConfig;
  /** CORS proxy templates, tried in order. `{url}` is the encoded target. */
  proxies: string[];
  anthropicKey: string;
  claudeModel: string;
  /** Use Claude vision for OCR when a key is set. Tesseract otherwise. */
  ocrEngine: 'tesseract' | 'claude';
  /** Run the Claude extraction fallback on flagged articles automatically. */
  autoClaudeExtract: boolean;
}

// ---------- Read ----------

export interface Skin {
  name?: string;
  accent?: string;
  kicker?: string;
  ornament?: string;
  opener_variant?: 'dropcap' | 'smallcaps' | 'boldlead' | 'none';
  rule?: 'hairline' | 'thick' | 'double' | 'none';
  title_case?: 'as-is' | 'small-caps' | 'uppercase-tracked';
}

export interface Publication extends Skin {
  /** Domain key, e.g. "aeon.co", or "default". */
  domain: string;
  auto?: boolean;
  updatedAt: string;
}

export interface Issue {
  /** Folder-style id, YYYY-MM. Sorting by id gives the issue number. */
  id: string;
  /** Article ids in reading order. */
  order: string[];
  /** Hex override, or empty for the house default. */
  coverColour: string;
  /** Cover subtitle override (house C uses it). */
  subtitle: string;
  printedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type FlagCode = 'thin' | 'low-ratio' | 'paywall' | 'mid-sentence' | 'link-heavy' | 'duplicates' | 'no-body';

export interface Flag {
  code: FlagCode;
  detail: string;
}

export interface Article {
  id: string;
  issueId: string;
  title: string;
  dek: string;
  author: string;
  publication: string;
  domain: string;
  url: string;
  published: string;
  fetched: string;
  words: number;
  read_minutes: number;
  section: string;
  markdown: string;
  /** Image ids referenced from the markdown as `desk-image:<id>`. */
  images: string[];
  flags: Flag[];
  /** How the body was obtained. */
  via: 'proxy' | 'bookmarklet' | 'paste' | 'claude';
  /** Held back from the booklet until fixed. Flagged articles start excluded. */
  excluded: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Binary or bulky things that never leave the device (not in backups). */
export interface BlobRecord {
  id: string;
  kind: 'image' | 'page-photo' | 'raw-html';
  blob?: Blob;
  text?: string;
  width?: number;
  height?: number;
  caption?: string;
  createdAt: string;
}

// ---------- Drafts ----------

export type PieceStatus = 'drafting' | 'resting' | 'ready' | 'retired';

export interface Piece {
  id: string;
  title: string;
  status: PieceStatus;
  /** The editor's live text. Versions are snapshots of it. */
  working: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: string;
  pieceId: string;
  n: number;
  text: string;
  note: string;
  source: 'ocr' | 'edit' | 'paste';
  words: number;
  createdAt: string;
  updatedAt: string;
}

export interface PagePhoto {
  id: string;
  pieceId: string;
  /** BlobRecord id of the photo. Photos stay on the device. */
  blobId: string;
  order: number;
  ocr: string;
  engine: 'tesseract' | 'claude' | 'none';
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------- Publish ----------

export interface Journal {
  id: string;
  name: string;
  url: string;
  /** Accepts simultaneous submissions. */
  simultaneous: boolean;
  /** Typical response time in days, if published. */
  responseDays?: number;
  fee: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type SubmissionStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface Submission {
  id: string;
  pieceId: string;
  versionId?: string;
  journalId: string;
  submittedAt: string;
  status: SubmissionStatus;
  /** A rejection with a personal note. */
  personal: boolean;
  respondedAt?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreMap {
  kv: { key: string; value: unknown };
  publications: Publication;
  issues: Issue;
  articles: Article;
  blobs: BlobRecord;
  pieces: Piece;
  versions: Version;
  pages: PagePhoto;
  journals: Journal;
  submissions: Submission;
}

export type StoreName = keyof StoreMap;
