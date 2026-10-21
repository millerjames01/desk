/**
 * Publication skins (brief §8). A skin changes a handful of tokens and nothing
 * structural. A new domain gets a skin derived from a hash of its name, saved
 * on first sight and never regenerated, so a publication looks the same in
 * every issue.
 */

import type { Publication, Skin } from '../types';

export const ORNAMENTS = ['■', '❧', '◆', '—', '※', ''] as const;
export const OPENERS = ['dropcap', 'smallcaps', 'boldlead', 'none'] as const;
export const RULES = ['hairline', 'thick', 'double', 'none'] as const;
export const TITLE_CASES = ['as-is', 'small-caps', 'uppercase-tracked'] as const;
const ACCENTS = ['#000000', '#222222', '#333333', '#444444', '#555555', '#666666'];
const KICKERS = ['{section} · {read_minutes} min read', '{publication}', '{section} · {publication}', '{publication} · {read_minutes} min'];

export const BUILT_IN: Record<string, Skin> = {
  // No ornament here: each house has its own end mark unless a skin sets one.
  default: { kicker: '{section} · {read_minutes} min read' },
  'theatlantic.com': { name: 'The Atlantic', accent: '#333333', ornament: '◆', opener_variant: 'smallcaps' },
  'aeon.co': { name: 'Aeon', rule: 'double', ornament: '❧' },
  // The flash journals Desk has site profiles for (design-reference/SOURCES.md).
  'smokelong.com': { name: 'SmokeLong Quarterly', ornament: '■', title_case: 'as-is' },
  'vestalreview.net': { name: 'Vestal Review', title_case: 'small-caps', rule: 'double' },
  'lost-balloon.com': { name: 'Lost Balloon', ornament: '◆' },
  'havehashad.com': { name: 'HAD', ornament: '※', title_case: 'as-is' },
  'xraylitmag.com': { name: 'X-R-A-Y', ornament: '—', title_case: 'as-is' },
};

/** FNV-1a: small, stable across browsers and versions. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], h: number, salt: number): T {
  return list[(h >>> (salt * 4)) % list.length];
}

export function autoSkin(domain: string, name: string): Skin {
  const h = hash(domain);
  return {
    name,
    accent: pick(ACCENTS, h, 0),
    kicker: pick(KICKERS, h, 1),
    ornament: pick(ORNAMENTS.slice(0, 5), h, 2),
    opener_variant: pick(OPENERS.slice(0, 3), h, 3),
    rule: pick(RULES, h, 4),
    title_case: pick(TITLE_CASES, h, 5),
  };
}

/** Subdomains match their parent: essays.example.org → example.org. */
export function findPublication(domain: string, pubs: Map<string, Publication>): Publication | undefined {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = pubs.get(parts.slice(i).join('.'));
    if (hit) return hit;
  }
  return undefined;
}

/** Greys only, no lighter than #777, so kickers and rules still read in print. */
export function safeAccent(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const full = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const y = Math.min(0x77, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
  const v = y.toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

export interface ResolvedSkin extends Required<Omit<Skin, 'accent'>> {
  accent?: string;
  key: string;
}

/** House ← built-in default ← saved default ← publication. Unset tokens fall to the house style. */
export function resolveSkin(domain: string, pubs: Map<string, Publication>, fallbackName: string, houseOrnament = '■'): ResolvedSkin {
  const pub = findPublication(domain, pubs) ?? (BUILT_IN[domain] ? { domain, ...BUILT_IN[domain], updatedAt: '' } : undefined);
  const def = { ...BUILT_IN.default, ...(pubs.get('default') ?? {}) };
  const s: Skin = { ...def, ...(pub ?? {}) };
  return {
    key: (pub?.domain ?? 'default').replace(/[^a-z0-9]+/gi, '-'),
    name: pub?.name || fallbackName || domain,
    accent: safeAccent(s.accent),
    kicker: s.kicker ?? '{section} · {read_minutes} min read',
    ornament: s.ornament ?? houseOrnament,
    opener_variant: s.opener_variant ?? ('' as never),
    rule: s.rule ?? ('' as never),
    title_case: s.title_case ?? ('' as never),
  };
}

/** Fills a kicker pattern, dropping separators left dangling by empty fields. */
export function kickerText(pattern: string, fields: Record<string, string | number>): string {
  const filled = pattern.replace(/\{(\w+)\}/g, (_, k) => String(fields[k] ?? '').trim());
  return filled
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !/^min( read)?$/.test(s))
    .join(' · ');
}

/**
 * Domains in `domains` with no saved or built-in skin get one now. Returns the
 * new records so the caller can save them and report them.
 */
export function newSkins(domains: { domain: string; name: string }[], pubs: Map<string, Publication>, at: string): Publication[] {
  const out: Publication[] = [];
  for (const { domain, name } of domains) {
    if (!domain || findPublication(domain, pubs) || BUILT_IN[domain] || out.some((p) => p.domain === domain)) continue;
    out.push({ domain, ...autoSkin(domain, name || domain), auto: true, updatedAt: at });
  }
  return out;
}
