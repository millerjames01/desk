# Marginalia — Personal Reading Booklet Builder

Handover brief for Claude Code. Read the whole brief before scaffolding.

## 1. What we're building

A local tool that turns a list of free, publicly readable web articles into a print-ready A5 booklet. It's a small "literary review" for one reader (me), printed on a home Brother printer, folded and saddle-stapled.

One command should do everything:

```
npm run issue 2026-11
```

That runs scrape → clean → typeset → QA → impose, and outputs:
- `out/2026-11/reading.pdf`: A5 pages in reading order, for screen review
- `out/2026-11/print-a4.pdf`: imposed booklet, A4 landscape, 2-up
- `out/2026-11/contact-sheet.png`: thumbnails of every page for a quick visual check
- `out/2026-11/report.md`: QA results and anything that needs manual attention

This is for personal reading only. No distribution, so no licensing concerns beyond normal fetching etiquette.

## 2. Core design principle: one template, per-publication skins

- **One base template** controls everything structural: page size, margins, grid, type scale, pagination rules, running heads, folios, contents, source notes. It must be identical across every issue, which is what makes the booklet feel like a single journal.
- **Publication skins** are small, consistent styling touches per source publication (e.g. every article from *The Atlantic* always gets the same accent and kicker treatment). A skin may only change the tokens listed in §6. It must never change layout, margins or body type size.
- **House style:** the base template ships with three selectable "house styles" (A, B and C below), chosen once in `config.yml`. I haven't picked one yet, so build all three as token sets over the same structure. That keeps switching to a one-line change.

## 3. Repository structure

```
marginalia/
  BRIEF.md
  config.yml                 # house style, booklet title, defaults
  publications.yml           # per-publication skins, keyed by domain
  issues/
    2026-11/
      urls.txt               # input: one URL per line, # for comments
      issue.yml              # generated, then hand-editable: order, cover colour, overrides
      articles/01-slug.md    # generated: front matter + Markdown body
      images/
  template/
    issue.njk                # cover, contents, article wrapper, colophon
    base.css                 # structure: @page, grid, pagination rules
    house/a-review.css       # house style tokens + flourishes
    house/b-grid.css
    house/c-pamphlet.css
    fonts/                   # self-hosted woff2 (no network at render time)
  src/
    scrape.js
    clean.js
    build.js
    qa.js
    impose.js
    cli.js
  design-reference/          # the nine mockup artboards (HTML) from the design canvas
  out/
```

## 4. Pipeline

### 4.1 Scrape (`scrape.js`), fully automated
1. Read `urls.txt`.
2. Fetch with `undici` using a normal browser UA, with polite one-by-one requests and a short delay.
3. If the extracted text is thin or the page is JS-rendered, retry with Playwright (headless Chromium) and wait for network idle.
4. Extract with `@mozilla/readability` on `jsdom`, keeping title, byline, published date, site name, lead/dek (from `og:description` or the first standfirst) and content HTML.
5. Convert to Markdown with `turndown`, keeping headings, emphasis, blockquotes, lists, figures and captions. Drop share buttons, newsletter boxes, related links and inline ads.
6. **Images:** download them locally, then convert to greyscale with `sharp`, resized to a max of 1400 px on the long edge. Drop images under 300 px wide, icons, author headshots and tracking pixels. Keep at most 3 per article by default (configurable). Prefer the lead image plus images that have captions.
7. Write `articles/NN-slug.md` with front matter:
   ```yaml
   title: ...
   dek: ...
   author: ...
   publication: The Atlantic     # human name, from publications.yml or og:site_name
   domain: theatlantic.com
   url: https://...
   published: 2026-10-12
   fetched: 2026-10-21
   words: 3120
   read_minutes: 14
   section: Nature               # optional kicker; from article:section meta if present
   ```

### 4.2 Sanity checks and Claude fallback (`clean.js`)
Flag an article when:
- it has under 300 words, or under 50% of the visible text estimate from the raw HTML
- it contains truncation or paywall phrases ("subscribe to continue", "sign in to read", "already a subscriber")
- the body ends mid-sentence, is more than 30% links, or has duplicated paragraphs

For flagged articles only, call the Claude API (`ANTHROPIC_API_KEY` in `.env`) with the raw HTML. The prompt asks it to extract the article body verbatim as Markdown, with **no rewriting, summarising or reordering**, and to return `UNEXTRACTABLE` if that isn't possible.

**Verify the result:** every output paragraph must appear in the source HTML text after normalising whitespace and quotes. Reject on any miss. If it still fails, list the article in `report.md` as "needs manual paste" and skip it. Never silently include a bad article.

### 4.3 Build (`build.js`)
- Render `issue.njk` with markdown-it (plus footnote and smartypants-style typographic quotes) and Nunjucks into a single `issue.html`.
- Order: cover → contents → articles → colophon (issue info and a sources list).
- Apply the house style CSS, then the publication skin as CSS custom properties on each `<article data-pub="theatlantic">`.
- Render to PDF with `pagedjs-cli` (Paged.js + Chromium).

### 4.4 QA (`qa.js`); the build fails on hard errors
- **Text integrity (hard):** extract the PDF text with `pdftotext`, normalise it, and confirm every source paragraph appears in order. Report any missing or duplicated paragraph with the article and page.
- **Blank pages (hard, unless intentional):** fail on unintended blank pages. Intentional blanks for recto starts or 4-page padding are allowed and noted.
- **Overflow (hard):** fail on overflow or clipping by checking Paged.js overflow warnings plus a rendered check that no element exceeds the page box.
- **Widows and orphans (soft):** warn on any widow/orphan line or a heading stranded at the bottom of a page.
- **Images (soft):** warn when an image is below 200 dpi at its printed size.
- **Contact sheet:** produce `contact-sheet.png` via `pdftoppm` plus an `sharp` montage, 8 columns.

### 4.5 Impose (`impose.js`)
- Pad the page count to a multiple of 4 with blank pages before the colophon (or a "Notes" ruled page if configured).
- Impose with `pdfjam --booklet true --landscape --a4paper --suffix print`, or `pdfbook2`. Output `print-a4.pdf`.
- Also output `print-a4-fronts.pdf` and `print-a4-backs.pdf` (backs reversed) for manual duplex in case the printer lacks auto-duplex.
- Acrobat Reader's Booklet print remains a manual alternative, but the scripted path is the default.

## 5. Physical and print spec

| Element | Spec |
|---|---|
| Trim | A5 (148 × 210 mm), from A4 folded |
| Length | 24–40 pages typical (6–10 sheets); warn above 48 (staples struggle) |
| Interior paper | Smooth uncoated 90 g, warm or natural white (e.g. Clairefontaine DCP 90 g) |
| Cover | Separate coloured card, about 160–185 g, printed with black only. Check the printer's max weight. Can also be left unprinted |
| Binding | Two staples through the fold with a long-reach stapler |
| Colour | Interior entirely black and greyscale. No colour in the interior, ever |
| Bleed | None. Nothing prints within 6 mm of the trim (home printer margins) |
| Creep | Shift inner-sheet content outward by `creep_mm` (default 0.2 mm per sheet, configurable) in `impose.js` |

The printer model is TBD and goes in `config.yml`; the cover weight limit depends on it.

## 6. Base template spec (shared by all house styles)

**Page:**
```css
@page { size: A5; margin: 18mm 15mm 20mm 17mm; }   /* top, outside, bottom, inside */
@page :left  { margin-left: 15mm; margin-right: 17mm; }
@page :right { margin-left: 17mm; margin-right: 15mm; }
@page cover  { margin: 0; }
@page opener { /* no running head on article openers */ }
```

**Type scale** (pt, at print size):
- Body: 10.5–11 pt, leading 1.45–1.6 (set per house style), single column, measure about 60–68 characters
- Dek/standfirst: 13–14 pt italic or regular
- Article title: 22–30 pt
- Subheads: 9.5–10 pt, caps or small caps with tracking, or semibold sans (house-dependent)
- Captions: 8.5–9 pt
- Running heads and folios: 8–9 pt
- Source note: 8.5 pt

**Pagination rules:**
- `orphans: 3; widows: 3`
- `h2, h3 { break-after: avoid; }`, with figures kept with their captions
- Each article starts on a new page. `break-before: right` is a config option (default: off, to save paper)
- Running head (string-set): the article title on verso and the booklet title + issue on recto, or as specified per house style
- Folios: `counter(page)`, except none on the cover or contents
- Contents page numbers via `target-counter(attr(href), page)`
- Hyphenation on (`hyphens: auto`, `lang` set per article), with justification as specified per house style
- Footnotes: Paged.js `float: footnote` where the source has them

**Article structure:** kicker (section · read time) → title → dek → byline → body → end mark → source note (publication, date, "fetched DD Month YYYY"). Long URLs go in the colophon sources list, never in the body.

**Images:** full-width figures between paragraphs only (no floats or text wrap). Max height 45% of the text block, with the caption below. Tables become full width at a smaller size; if a table won't fit, flag it in the report.

## 7. House styles

These match the nine mockup artboards in `design-reference/` (cover, opener and body page for each). Treat them as visual targets, not code to copy. The mockups are drawn at 560 × 794 px (A5 at 96 dpi), so 14.5 px body ≈ 11 pt.

### A · Review (literary quarterly)
- **Font:** EB Garamond (400, 500, italic)
- **Cover:** ochre `#D6B15E`, black ink `#1A1712`. Contains the issue number and date in tracked caps between hairline rules, a large title (about 63 pt) with an italic tagline beneath, and an "In this issue" list at the bottom.
- **Interior:** warm paper `#FBF8F1`, accent `#6B5A33` for kickers and folios, hairline rules `#D8CDB4`
- **Opener:** tracked-caps kicker, 38 px title, italic dek, caps byline, and a 3-line drop cap. Body justified with first-line indent 1.4em (no indent after headings).
- **Body pages:** italic running head with a hairline under it, folio on the outside edge. Subheads in tracked caps at 500 weight. Source note above the bottom rule.

### B · Grid (modern Swiss)
- **Fonts:** Source Serif 4 for body and titles; IBM Plex Sans for labels, kickers, captions and folios
- **Cover:** dusty blue `#A3B4C2`, ink `#111418`. Uses a 6-column grid with a huge issue number ("01", about 225 pt, weight 500, tight tracking), and contents in 2 columns with page numbers above titles.
- **Interior:** white paper, grey-blue labels `#4A5866`, image placeholder tint `#E3E8EC`
- **Opener:** sans running label row, a large gap, a semibold 36 px title with a full rule beneath, dek over 4 cols and author plus read time over 2 cols. Ragged-right body (no justification), with the first words in semibold instead of a drop cap.
- **Body pages:** sans running head. Figures span 4 of 6 columns with the caption in the remaining 2, bottom-aligned. Paragraph spacing instead of indents.

### C · Pamphlet (classical, centred)
- **Font:** Literata (400, 500, italic), with real small caps where available
- **Cover:** warm grey `#BFBAB0`, ink `#1C1B19`. Everything is centred: "Number One" in wide-tracked caps, the title in spaced caps between short rules, an italic subtitle, and place and year in roman numerals at the foot.
- **Interior:** paper `#FAF8F4`, secondary text `#5C5850`
- **Opener:** roman-numeral article number, the title in centred spaced caps, a short rule, the author in italic, and the first line in small caps. Body justified with indents.
- **Body pages:** centred tracked-caps running head. Section breaks as `* * *` and a fleuron end mark (❧). Centred italic source line ("First published in …") and a centred folio `· 6 ·`.

## 8. Publication skins (`publications.yml`)

Each skin is keyed by domain, with subdomains matching their parent. The same publication must always look identical across issues, and any domain without an entry uses `default`.

**A skin may set only these tokens:**

| Token | Purpose |
|---|---|
| `name` | Display name used in kickers and source notes |
| `accent` | Greyscale value only (interior is black/grey), for kicker, rules, drop cap and end mark. Range `#000`–`#777`, checked for contrast |
| `kicker` | Text pattern, e.g. `"{section} · {publication}"` or `"{publication}"` |
| `ornament` | End mark glyph: `■`, `❧`, `◆`, `—`, `※`, or none |
| `opener_variant` | `dropcap` / `smallcaps` / `boldlead` / `none` (the house default if unset) |
| `rule` | Opener rule style: `hairline` / `thick` / `double` / `none` |
| `title_case` | `as-is` / `small-caps` / `uppercase-tracked` |

Example:
```yaml
default:
  kicker: "{section} · {read_minutes} min read"
  ornament: "■"
theatlantic.com:
  name: The Atlantic
  accent: "#333"
  ornament: "◆"
  opener_variant: smallcaps
aeon.co:
  name: Aeon
  rule: double
  ornament: "❧"
```

When a new domain appears in an issue, `build.js` should auto-generate a skin deterministically from a hash of the domain (picking from the allowed values), append it to `publications.yml` with a `# auto` comment, and note this in `report.md` so I can tweak it. After that, it never changes unless edited.

Skins must never change: body size, leading, margins, measure, fonts, page structure or cover design.

## 9. Config (`config.yml`)

```yaml
title: Marginalia
tagline: A private review of things worth reading
house_style: a-review          # a-review | b-grid | c-pamphlet
issue_numbering: sequential    # derives "No. 3" from issue folder order
cover_colour: auto             # or a hex override per issue in issue.yml
max_images_per_article: 3
recto_starts: false
creep_mm_per_sheet: 0.2
pad_with: blank                # blank | notes
printer: TBD                   # model, for the cover weight note in the report
```

## 10. Tech stack

- Node 20+, ESM
- undici, playwright, jsdom, @mozilla/readability, turndown, markdown-it (+ footnote plugin), nunjucks, pagedjs-cli, sharp, js-yaml, @anthropic-ai/sdk
- System tools: poppler-utils (`pdftotext`, `pdftoppm`), texlive `pdfjam` (or `pdfbook2`). Document install steps for macOS and Linux in the README.
- Self-hosted fonts in `template/fonts/` (EB Garamond, Source Serif 4, IBM Plex Sans and Literata are all OFL-licensed)

## 11. Build order and milestones

1. **Template first:** hard-code one sample article in Markdown and get house style A to render a good PDF (cover, contents, opener, body pages). Compare against `design-reference/`.
2. Add house styles B and C as token and flourish layers over the same structure.
3. Add publication skins and the skin resolver.
4. Add the scraper and clean step, testing against 5–6 real URLs including one JS-heavy site.
5. Add QA (text-integrity diff first).
6. Add imposition and the duplex split, and verify the page order with an 8-page test.
7. Add the `npm run issue` CLI and README.

## 12. Acceptance criteria

- One command produces all four outputs from a `urls.txt`.
- No article text is altered, summarised or dropped, as proven by the QA diff.
- The same publication looks identical in two different issues.
- Switching `house_style` restyles the whole issue with no layout breakage.
- A printed, folded 8-page test reads in the correct order.
- Flagged and failed articles are clearly listed and never silently included.

## 13. Open decisions (ask me, don't guess)

- Which house style is the default (A, B or C)
- Printer model, which sets the cover card weight
- Whether the booklet keeps the name "Marginalia"
- Whether to include a ruled notes page as end padding
