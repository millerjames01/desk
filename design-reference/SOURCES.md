# Marginalia: source profiles and browser capture

A pre-scrape survey of six candidate flash journals (21 Oct 2026), and the browser-capture approach. It complements `MARGINALIA-BRIEF.md` §4.1.

> **As built in Desk** (notes added when implementing):
> - Desk has no Node scraper. A browser extension, Desk Reader, does all fetching. It reads each site's robots.txt live, for the `DeskReader` agent or `*`, and never relies on a hard-coded list. The bookmarklet and the extension's toolbar button capture the page in front of you.
> - Live robots.txt checks on 21 Oct 2026 disagree with §1. HAD (havehashad.com) and X-R-A-Y (xraylitmag.com) allow general agents and block only named AI crawlers. Vestal Review blocks `ClaudeBot` and `anthropic-ai` but allows general agents on story pages. Flash Frog did not answer at the addresses tried.
> - Captures go straight into Desk (IndexedDB), not to a local inbox server or `~/Downloads`.
> - Short Takes (§5) are implemented as described, including the 40% rule.
> - The profiles in `src/read/sites.ts` follow §2 and §4, tightened against live pages where robots.txt allowed it. SmokeLong, Lost Balloon and HAD are checked; X-R-A-Y's story pages are checked; Vestal is unverified.

## 1. Two classes of site

| Journal | Automated fetch | Platform | Capture method |
|---|---|---|---|
| SmokeLong Quarterly | Allowed | WordPress | Scraper or bookmarklet |
| Vestal Review | Allowed | Squarespace | Scraper or bookmarklet |
| Lost Balloon | Allowed | WordPress.com (Ixion theme) | Scraper (RSS likely) or bookmarklet |
| HAD | Disallowed by robots.txt | Not inspected | Bookmarklet only |
| X-R-A-Y | Disallowed by robots.txt | Not inspected | Bookmarklet only |
| Flash Frog | Disallowed by robots.txt | Not inspected | Bookmarklet only |

Rule: the scraper must check robots.txt and must not crawl disallowed sites. For those, the browser capture script reads only the page you're already viewing, like reader mode or "save page", and never navigates or crawls.

## 2. Per-site profiles

### SmokeLong Quarterly (smokelong.com)
- Story URLs: `/stories/{slug}/`. Exclude `/stories/letter-from-the-editor-*`.
- Discovery: the current issue at `/issue-{number-in-words}/` (e.g. `/issue-ninety-three/`, Sept 2026) lists about 12 stories. Archive at `/archives/quarterly/`.
- Title: the page `h2`. Fallback: `og:title` minus " - SmokeLong Quarterly".
- Byline and date: one line, "Story by {Author}" plus a date ("September 21, 2026"). Don't trust `article:modified_time`.
- Issue: from "This story appeared in Issue …" near the end.
- Body: prose after the byline and art image, up to "About the Author".
- Strip: audio player and `.m4a` link, "Art by SmokeLong" hero image, share buttons, "Translate this page", related stories, donation and PayPal pixels, mailing-list promo, footer.
- Bonus: each story links an interview at `/interviews/smoke-signals-with-{author}/`; optionally its first Q&A as an "Afterword" (off by default).
- Skin idea: kicker "SmokeLong · Issue 93", ornament ■.

### Vestal Review (vestalreview.net)
- Story URLs: `/{title-slug}` at the root (Squarespace), so discover them from issue pages.
- Discovery: current issue `/issue-68`, older issues `/issue-NN`, index at `/past-issues`.
- Title: the `h2`. Fallback: `<title>` minus " — Vestal Review".
- Author: the italic `h4` "By {Author}".
- Date and issue: not on the story page; inherit from the issue page.
- Body: between the two `<hr>` rules after the author line, usually one paragraph.
- Strip: the nav (repeated three times), cart, the bio starting with the bold author name and portrait, CTA links, "No results found".
- Skin idea: small-caps title, double rule.

### Lost Balloon (lost-balloon.com)
- Story URLs: `/YYYY/MM/DD/{title-slug}-{author-slug}/`.
- Discovery: `/feed/`; categories `/category/flash-fiction/`, `/category/flash-nonfiction/`, `/category/prose-poetry/`; monthly archives from 2017.
- Title and author: the heading reads "Title by Author Name"; split on the last " by ". Ignore the WordPress author (the editor).
- Date: from the URL path.
- Body: paragraphs after the heading; `<hr>` separates sections, kept as `* * *`. Preserve lists and menu-style layouts.
- Strip: the author photo and bio after the final `<hr>`, and the comments widget.
- Keep the category, so prose poetry can be labelled.

### HAD, X-R-A-Y and Flash Frog
Not inspected in the survey. Expectations: HAD has many very short pieces with quirky formatting; X-R-A-Y has experimental forms where whitespace matters; Flash Frog has one piece per post with an image.

## 3. The browser capture script

A bookmarklet (or userscript) that, on click: matches a site profile or falls back to Readability; extracts title, author, publication, date, issue, category, canonical URL and body; cleans the body (profile strips, empty paragraphs, share and subscription blocks, tracking images; `<hr>` to section breaks; keeps emphasis, lists, blockquotes and `white-space: pre-wrap` blocks); converts with the same Turndown rules as the pipeline; shows a preview with warnings (under 100 words, ends mid-sentence, paywall phrases, a profile selector that matched nothing, a duplicate URL); and saves the capture.

## 4. Site profiles

Selectors live in config, not code, so a redesign is a config fix. On first build, open one story per site in devtools and tighten each profile, preferring stable anchors (headings, `<hr>`, text markers) over theme class names.

## 5. Short Takes

- Captures under 1,000 words (or marked short) are grouped into a Short Takes section after the long reads, with one section opener page.
- Compact opener with no page break per piece: kicker (journal), title, author, body, ornament. The next piece follows on the same page if more than 40% of the page remains.
- Never split a piece under 250 words; move it whole.
- Each piece keeps its publication skin.
- The contents lists Short Takes as a group, titles indented beneath.

## 6. Etiquette

- Personal reading only; no redistribution.
- Respect robots.txt, wait 3 seconds or more between requests to a host, send an honest User-Agent, and cache so nothing is fetched twice.
- The capture tools read only the page you're on, plus its own images.
- Consider supporting the journals you read most. Several take small donations, and SmokeLong runs on them.
