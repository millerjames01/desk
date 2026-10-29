import { describe, expect, it } from 'vitest';
import { crawlDelay, isAllowed, parseRobots } from '../extension/robots.js';
import { sameUrl } from '../src/read/articles';
import { parseHtml } from '../src/read/extract';
import { holds } from '../src/read/quality';
import { readingOrder } from '../src/read/render';
import { DEFAULT_PROFILES, editionStories, extractWithProfile, issueEditions, monthEditions, profileFor, storyLinks } from '../src/read/sites';
import { editionIssueId } from '../src/read/walk';
import type { Article } from '../src/types';

const profile = (d: string) => DEFAULT_PROFILES.find((p) => p.domain === d)!;
const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

describe('robots.txt', () => {
  const txt = `User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /stories/secret/\nAllow: /stories/secret/open\nDisallow: /*.pdf$\nCrawl-delay: 5\n\nUser-agent: AhrefsBot\nDisallow: /`;
  const g = parseRobots(txt);
  it('uses the * group for DeskReader', () => {
    expect(isAllowed(g, '/stories/horses/')).toBe(true);
    expect(isAllowed(g, '/stories/secret/x')).toBe(false);
    expect(isAllowed(g, '/stories/secret/open')).toBe(true);
    expect(isAllowed(g, '/a/file.pdf')).toBe(false);
    expect(isAllowed(g, '/a/file.pdf?x')).toBe(true);
  });
  it('a named group wins over *', () => {
    expect(isAllowed(g, '/stories/horses/', 'ClaudeBot')).toBe(false);
  });
  it('an empty Disallow allows everything; no file allows everything', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), '/x')).toBe(true);
    expect(isAllowed([], '/x')).toBe(true);
  });
  it('reads Crawl-delay for our group', () => {
    expect(crawlDelay(txt)).toBe(5000);
    expect(crawlDelay('User-agent: Other\nCrawl-delay: 9')).toBe(0);
  });
});

describe('site profiles', () => {
  it('match a host and its subdomains', () => {
    expect(profileFor('https://www.smokelong.com/stories/x/', DEFAULT_PROFILES)?.name).toBe('SmokeLong Quarterly');
    expect(profileFor('https://www.havehashad.com/hadposts/x', DEFAULT_PROFILES)?.name).toBe('HAD');
    expect(profileFor('https://example.org/', DEFAULT_PROFILES)).toBeUndefined();
  });

  it('SmokeLong-shaped page: byline, date, body, no audio or bio', () => {
    const html = `<html><head><meta property="og:title" content="Horses - SmokeLong Quarterly"></head><body><h1>SmokeLong Quarterly</h1><article>
      <h2>Horses</h2><p class="byline"><span>Story by Nicola Caroli <a href="/interviews/x">(Read author interview)</a></span> <span>September 21, 2026</span></p>
      <p class="audiointro">You can also listen to this story:</p><audio src="a.m4a"></audio><div class="fimage"><img src="art.jpg"><p>Art by SmokeLong</p></div>
      <div class="entry-content dropcap"><p>${words(120)}.</p><p>${words(80, 'more')}.</p></div></article>
      <div class="aboutauthor"><h3>About the Author</h3><p>Bio here.</p></div></body></html>`;
    const r = extractWithProfile(html, 'https://www.smokelong.com/stories/horses/', profile('smokelong.com'), { maxImages: 3 })!;
    expect(r).toMatchObject({ title: 'Horses', author: 'Nicola Caroli', published: '2026-09-21', siteName: 'SmokeLong Quarterly', words: 200 });
    expect(r.markdown).not.toMatch(/listen|Art by|Bio here/);
    expect(holds(r.flags, true)).toBe(false);
  });

  it('Lost Balloon-shaped page: title by author, date from the URL, bio after the last rule trimmed and noted', () => {
    const html = `<html><body><article><h1 class="entry-title">His Eye is on the Sparrow by Lindsey James</h1>
      <div class="entry-content"><p>${words(150)}.</p><hr><p>${words(100, 'two')}.</p><hr><p><img src="me.jpg"></p><p>A native of somewhere, she writes.</p></div>
      <a rel="category tag" href="/category/flash-fiction/">flash fiction</a></article></body></html>`;
    const r = extractWithProfile(html, 'https://lost-balloon.com/2026/09/23/his-eye-is-on-the-sparrow-lindsey-james/', profile('lost-balloon.com'), { maxImages: 3 })!;
    expect(r).toMatchObject({ title: 'His Eye is on the Sparrow', author: 'Lindsey James', published: '2026-09-23', category: 'flash fiction' });
    expect(r.markdown).toContain('* * *');
    expect(r.markdown).toContain('two99');
    expect(r.markdown).not.toContain('A native');
    expect(r.flags.map((f) => f.code)).toEqual(['trimmed']);
  });

  it('keeps a long last section after a rule: only a short tail counts as a bio', () => {
    const html = `<html><body><h1 class="entry-title">Two Parts by A Writer</h1><div class="entry-content"><p>${words(100)}.</p><hr><p>${words(400, 'second')}.</p></div></body></html>`;
    const r = extractWithProfile(html, 'https://lost-balloon.com/2026/09/01/two-parts-a-writer/', profile('lost-balloon.com'), { maxImages: 0 })!;
    expect(r.markdown).toContain('second399');
    expect(r.flags).toEqual([]);
  });

  it('HAD-shaped page: a prose poem with no full stop is not held out', () => {
    const html = `<html><body><div class="feature-story"><h3 class="date">October 16, 2026</h3><h1 class="title">excess culture</h1><h2 class="author"><a href="/a">nat raum</a></h2></div>
      <div class="story-content"><p>as in leather / as in lace / ${words(60)} / else</p></div><div class="story-author-bio"><p><strong>nat raum</strong> is a poet.</p></div></body></html>`;
    const r = extractWithProfile(html, 'https://www.havehashad.com/hadposts/excess-culture', profile('havehashad.com'), { maxImages: 0 })!;
    expect(r).toMatchObject({ title: 'excess culture', author: 'nat raum', published: '2026-10-16' });
    expect(r.markdown).not.toContain('is a poet');
    expect(holds(r.flags, true)).toBe(false);
    expect(holds(r.flags, false)).toBe(true);
  });

  it('drops a closing bio that opens with the author in bold', () => {
    const html = `<html><body><h1 class="entry-title">Keepsake by Mark Williams</h1><div class="entry-content"><p>${words(200)}.</p><p><strong>Mark Williams</strong>’s fiction has appeared widely.</p></div></body></html>`;
    const r = extractWithProfile(html, 'https://xraylitmag.com/keepsake-by-mark-williams/fiction/', profile('xraylitmag.com'), { maxImages: 0 })!;
    expect(r.markdown).not.toContain('appeared widely');
  });

  it('keeps spacing in pieces laid out with white-space: pre', () => {
    const html = `<html><body><h1 class="entry-title">Shape by A Poet</h1><div class="entry-content"><div style="white-space: pre-wrap">a    spaced\n      shape</div><p>${words(30)}.</p></div></body></html>`;
    const r = extractWithProfile(html, 'https://xraylitmag.com/shape-by-a-poet/fiction/', profile('xraylitmag.com'), { maxImages: 0 })!;
    expect(r.markdown).toContain('<pre class="verse">');
  });

  it('returns null when the body selector misses, so the generic extractor takes over', () => {
    expect(extractWithProfile('<html><body><p>nothing</p></body></html>', 'https://www.smokelong.com/stories/x/', profile('smokelong.com'), { maxImages: 0 })).toBeNull();
  });
});

describe('editions', () => {
  it('issue index → editions; issue page → stories without the editor’s letter or menus', () => {
    const p = profile('smokelong.com');
    const index = parseHtml('<html><body><main><a href="/issue-ninety-three/">Issue Ninety-Three</a><a href="/issue-ninety-two/">Issue Ninety-Two</a><a href="/about/">About</a></main></body></html>', p.edition.kind === 'issue' ? p.edition.index : '');
    expect(issueEditions(index, p).map((e) => e.label)).toEqual(['Issue Ninety-Three', 'Issue Ninety-Two']);
    // The archive's links say only "Open this Issue"; the name and date are in the entry.
    const archive = parseHtml(`<html><body><div id="covers">
      <div class="issh"><a href="https://www.smokelong.com/issue-ninety-two/">Open this Issue</a><div class="qic"><img alt="Cover for Issue Ninety-Two"><p><span> Issue Ninety-Two </span> June 15, 2026 </p></div></div>
      <div class="issh"><a href="https://www.smokelong.com/issue-ninety-one/">Open this Issue</a><div class="qic"><img alt="Cover for Issue Ninety-One"></div></div>
      <div class="issh"><a href="https://www.smokelong.com/issue-ninety/">Open this Issue</a></div></div></body></html>`, 'https://www.smokelong.com/archives/quarterly/');
    expect(issueEditions(archive, p).map((e) => [e.label, e.date])).toEqual([['Issue Ninety-Two', 'June 15, 2026'], ['Issue Ninety-One', undefined], ['Issue Ninety', undefined]]);
    const issue = parseHtml(`<html><body><nav><a href="/stories/in-the-menu/">Menu story</a></nav><main>
      <a href="https://www.smokelong.com/stories/horses/">Horses</a><a href="/stories/letter-from-the-editor-93/">Letter</a>
      <a href="/stories/horses/#comments">dup</a><a href="/stories/rendered/">Rendered</a><a href="https://elsewhere.com/stories/x/">x</a></main></body></html>`, 'https://www.smokelong.com/issue-ninety-three/');
    expect(storyLinks(issue, p).map((l) => l.label)).toEqual(['Horses', 'Rendered']);
  });

  it('month editions over a shared, paginated archive: only that month, oldest first, stops past it', async () => {
    const p = profile('havehashad.com');
    const pages: Record<string, string> = {
      'https://www.havehashad.com/hadposts/archives': `<div class="story"><span class="date">November 2, 2026</span><h1 class="title"><a href="/hadposts/nov">Nov</a></h1></div>
        <div class="story"><span class="date">October 21, 2026</span><h1 class="title"><a href="/hadposts/b">B</a></h1></div><a rel="next" href="/hadposts/archives?page=2">next</a>`,
      'https://www.havehashad.com/hadposts/archives?page=2': `<div class="story"><span class="date">October 3, 2026</span><h1 class="title"><a href="/hadposts/a">A</a></h1></div>
        <div class="story"><span class="date">September 30, 2026</span><h1 class="title"><a href="/hadposts/sep">Sep</a></h1></div><a rel="next" href="/hadposts/archives?page=3">next</a>`,
    };
    const fetched: string[] = [];
    const months = monthEditions(p, new Date(2026, 10, 5), 3);
    expect(months.map((m) => m.label)).toEqual(['November 2026', 'October 2026', 'September 2026']);
    const got = await editionStories(p, months[1], async (url) => {
      fetched.push(url);
      return parseHtml(`<html><body>${pages[url] ?? ''}</body></html>`, url);
    });
    expect(got.map((s) => s.label)).toEqual(['A', 'B']);
    expect(fetched).toHaveLength(2);
  });

  it('edition issues get a dated id, so they number in order', () => {
    expect(editionIssueId(profile('smokelong.com'), { label: 'Issue Ninety-Three', url: '' }, new Date(2026, 9, 21))).toBe('2026-10-smokelong-issue-ninety-three');
    expect(editionIssueId(profile('lost-balloon.com'), { label: 'September 2026', url: '', month: '2026-09' })).toBe('2026-09-lost-balloon-september-2026');
  });
});

describe('issue assembly', () => {
  it('long reads first, then Short Takes, each in issue order', () => {
    const a = (id: string, shortTake: boolean) => ({ id, shortTake }) as Article;
    expect(readingOrder([a('s1', true), a('l1', false), a('s2', true), a('l2', false)]).map((x) => x.id)).toEqual(['l1', 'l2', 's1', 's2']);
  });
  it('recognises the same story under another address', () => {
    expect(sameUrl('https://www.smokelong.com/stories/horses/', 'http://smokelong.com/stories/horses?utm_source=x#top')).toBe(true);
    expect(sameUrl('https://smokelong.com/stories/horses/', 'https://smokelong.com/stories/rendered/')).toBe(false);
  });
});
