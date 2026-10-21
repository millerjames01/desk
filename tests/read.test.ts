import { describe, expect, it } from 'vitest';
import { cleanTitle, extract, fromPlainText } from '../src/read/extract';
import { checkArticle } from '../src/read/quality';
import { autoSkin, findPublication, kickerText, newSkins, resolveSkin, safeAccent } from '../src/read/skins';
import { markdownBlocks, normalize, roman, squash } from '../src/read/text';
import { verifyAgainstSource } from '../src/read/verify';
import { compareBlocks } from '../src/read/qa';
import { issueNumber, labels, nextIssueId } from '../src/read/issue';
import type { Publication } from '../src/types';

const para = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ') + '.';

function page(body: string, meta = ''): string {
  return `<!doctype html><html><head><title>An Essay | Little Review</title>
<meta property="og:site_name" content="Little Review"><meta property="og:description" content="The standfirst.">
<meta name="author" content="Jo Tester"><meta property="article:published_time" content="2026-09-01T10:00:00Z">
<meta property="article:section" content="Essays">${meta}</head>
<body><nav><a href="/">Home</a></nav><article><h1>An Essay</h1><p>By Jo Tester</p>${body}</article><footer>© Little Review</footer></body></html>`;
}

describe('extract', () => {
  const body = Array.from({ length: 8 }, (_, i) => `<p>${para(60, 'word' + i + 'x')}</p>`).join('') +
    '<figure><img src="/big.jpg" width="1200"><figcaption>A caption.</figcaption></figure>' +
    '<figure><img src="/avatar.png" width="1200"></figure><img src="/icon-16.png" width="16">';
  const ex = extract(page(body), 'https://www.littlereview.org/essays/an-essay', { maxImages: 3 });

  it('pulls the metadata', () => {
    expect(ex.title).toBe('An Essay');
    expect(ex.author).toBe('Jo Tester');
    expect(ex.siteName).toBe('Little Review');
    expect(ex.domain).toBe('littlereview.org');
    expect(ex.published).toBe('2026-09-01');
    expect(ex.section).toBe('Essays');
    expect(ex.dek).toBe('The standfirst.');
  });

  it('keeps the body, drops the byline, keeps captioned images and drops junk ones', () => {
    expect(ex.markdown).not.toMatch(/^By Jo Tester/);
    expect(markdownBlocks(ex.markdown).body.filter((b) => b.startsWith('word')).length).toBe(8);
    expect(ex.images.map((i) => i.src)).toEqual(['https://www.littlereview.org/big.jpg']);
    expect(ex.images[0].caption).toBe('A caption.');
    expect(ex.flags).toEqual([]);
  });

  it('respects the image limit', () => {
    expect(extract(page(body), 'https://x.org/a', { maxImages: 0 }).images).toEqual([]);
  });

  it('only strips a byline that is exactly the author', () => {
    const md = extract(page(`<p>By the time we arrived it was dark.</p>${body}`), 'https://x.org/a', { maxImages: 0 }).markdown;
    expect(md).toContain('By the time we arrived');
  });

  it('cleans a site suffix off a title only when it is the site', () => {
    expect(cleanTitle('Essay | Little Review', 'Little Review')).toBe('Essay');
    expect(cleanTitle('Love: A Field Guide', 'Little Review')).toBe('Love: A Field Guide');
  });
});

describe('quality flags', () => {
  const long = Array.from({ length: 6 }, (_, i) => para(70, 'w' + i)).join('\n\n');
  it('passes a whole article', () => expect(checkArticle(long, 0)).toEqual([]));
  it('flags thin, paywalled, truncated, duplicated and low-ratio text', () => {
    const codes = (md: string, raw = 0) => checkArticle(md, raw).map((f) => f.code);
    expect(codes('Short piece.')).toContain('thin');
    expect(codes(long + '\n\nSubscribe to continue reading.')).toContain('paywall');
    expect(codes(long + '\n\nAnd then the')).toContain('mid-sentence');
    const p = para(60, 'dup');
    expect(codes(`${long}\n\n${p}\n\n${p}`)).toContain('duplicates');
    expect(codes(long, 2000)).toContain('low-ratio');
    expect(codes('')).toEqual(['no-body']);
  });
});

describe('text', () => {
  it('normalises typography but not words', () => {
    expect(normalize('“Quote” – it’s…  here')).toBe('"Quote" - it\'s... here');
    expect(squash('a b\nc')).toBe('abc');
  });
  it('splits markdown into blocks, captions and notes', () => {
    const md = '## Head\n\nA *para* with [a link](http://x).[^1]\n\n![alt](desk-image:1 "Cap")\n\n- one\n- two\n\n[^1]: The note.';
    expect(markdownBlocks(md)).toEqual({ body: ['Head', 'A para with a link.', 'Cap', 'one', 'two'], notes: ['The note.'] });
  });
  it('pasted text becomes paragraphs', () => {
    expect(fromPlainText('one\nline\n\ntwo')).toBe('one line\n\ntwo');
  });
  it('roman numerals', () => {
    expect(roman(2026)).toBe('MMXXVI');
    expect(roman(4)).toBe('IV');
  });
});

describe('skins', () => {
  it('auto skins are stable and use only allowed values', () => {
    expect(autoSkin('aeon.co', 'Aeon')).toEqual(autoSkin('aeon.co', 'Aeon'));
    expect(autoSkin('a.org', 'A')).not.toEqual(autoSkin('b.org', 'B'));
    const s = autoSkin('littlereview.org', 'Little Review');
    expect(['■', '❧', '◆', '—', '※']).toContain(s.ornament);
    expect(s.accent).toMatch(/^#([0-6])\1\1\1\1\1$/);
  });
  it('subdomains match their parent', () => {
    const pubs = new Map<string, Publication>([['example.org', { domain: 'example.org', name: 'Example', updatedAt: '' }]]);
    expect(findPublication('essays.example.org', pubs)?.name).toBe('Example');
    expect(newSkins([{ domain: 'essays.example.org', name: 'X' }], pubs, 'now')).toEqual([]);
    expect(newSkins([{ domain: 'new.org', name: 'New' }], pubs, 'now')[0]).toMatchObject({ domain: 'new.org', auto: true });
  });
  it('built-ins and the house fallback', () => {
    const s = resolveSkin('www.theatlantic.com'.replace('www.', ''), new Map(), '', '❧');
    expect(s.name).toBe('The Atlantic');
    expect(s.ornament).toBe('◆');
    expect(resolveSkin('unknown.org', new Map(), 'Unknown', '❧').ornament).toBe('❧');
  });
  it('accents are forced to greys no lighter than #777', () => {
    expect(safeAccent('#333')).toBe('#333333');
    expect(safeAccent('#ffffff')).toBe('#777777');
    expect(safeAccent('#6B5A33')).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(safeAccent('red')).toBeUndefined();
  });
  it('kickers drop empty fields', () => {
    expect(kickerText('{section} · {read_minutes} min read', { section: '', read_minutes: 12 })).toBe('12 min read');
    expect(kickerText('{section} · {publication}', { section: 'Nature', publication: '' })).toBe('Nature');
  });
});

describe('Claude extraction is verified against the page', () => {
  const source = 'Header nav. The first paragraph is here. “The second,” she said. Footer.';
  it('accepts verbatim paragraphs, whatever the quote style', () => {
    expect(verifyAgainstSource('The first paragraph is here.\n\n"The second," she said.', source).ok).toBe(true);
  });
  it('rejects any rewritten paragraph', () => {
    const v = verifyAgainstSource('The first paragraph is here.\n\nThe second, she remarked.', source);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['The second, she remarked.']);
  });
  it('rejects UNEXTRACTABLE', () => expect(verifyAgainstSource('UNEXTRACTABLE', source).ok).toBe(false));
});

describe('QA text integrity', () => {
  const blocks = ['First paragraph of the piece.', 'Second paragraph that is long enough to count.', 'Third.'];
  const loc = (pages: string[]) => {
    let text = '';
    const starts = pages.map((p, i) => {
      const s = { offset: text.length, page: i + 1 };
      text += squash(p);
      return s;
    });
    return { text, starts };
  };
  it('passes when every block is there in order, across page breaks', () => {
    expect(compareBlocks(blocks, loc(['First paragraph of the piece. Second paragraph that', 'is long enough to count. Third.']), 'A')).toEqual([]);
  });
  it('fails on a missing block, naming the page where it should begin', () => {
    const items = compareBlocks(blocks, loc(['First paragraph of the piece.', 'Third.']), 'A');
    expect(items[0]).toMatchObject({ level: 'error', page: 2 });
  });
  it('fails on a repeated block', () => {
    const items = compareBlocks(blocks, loc(['First paragraph of the piece. Second paragraph that is long enough to count.', 'Second paragraph that is long enough to count. Third.']), 'A');
    expect(items.some((i) => i.message.startsWith('Repeated'))).toBe(true);
  });
  it('a refrain repeated on purpose is not a duplicate', () => {
    const refrain = ['I am writing because your name showed up.', 'Hello. I am writing because your name showed up.', 'Then the rest of the letter, long enough.'];
    expect(compareBlocks(refrain, loc([refrain.join(' ')]), 'A')).toEqual([]);
  });
  it('fails on blocks out of order', () => {
    const items = compareBlocks(blocks, loc(['Second paragraph that is long enough to count. First paragraph of the piece. Third.']), 'A');
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('issues', () => {
  it('number by date order and label per house', () => {
    const issues = [{ id: '2026-11' }, { id: '2026-10' }, { id: 'sample' }];
    expect(issueNumber('2026-11', issues)).toBe(2);
    expect(issueNumber('sample', issues)).toBe(1);
    expect(labels('b-grid', 'Marginalia', 3).numberLabel).toBe('03');
    expect(labels('c-pamphlet', 'Marginalia', 3).numberLabel).toBe('Number Three');
    expect(labels('a-review', 'Marginalia', 3).mark).toBe('Marginalia · No. 3');
  });
  it('next id is this month, then a suffix', () => {
    const d = new Date(2026, 10, 5);
    expect(nextIssueId([], d)).toBe('2026-11');
    expect(nextIssueId([{ id: '2026-11' }], d)).toBe('2026-11b');
  });
});
