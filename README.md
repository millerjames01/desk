# Desk

A one-person desk for a reading and writing practice. Three rooms:

| | |
|---|---|
| **Read** | Turn free articles from small literary sites into an A5 booklet, *Marginalia*, printed at home, folded and saddle-stapled. One template, three house styles, a fixed skin per publication, QA that proves no word was lost. |
| **Drafts** | Photograph handwritten pages, read them with OCR, then work the text in an editor that keeps every version you save, with word-level diffs. |
| **Publish** | Journals, submissions and answers: what's out, for how long, who takes simultaneous submissions, what to withdraw when something is accepted. |

The **Desk** page ties them together: what to do next, and sixteen weeks of reading, writing and sending days. Those days are derived from the record every time: a version saved, a page captured, an article ticked as read, a submission sent. Nothing is stored that could drift or be padded.

Everything runs in the browser and lives in IndexedDB on the device. There is no backend and no account. It is hosted on GitHub Pages and installs to a phone's home screen.

## Use it

**https://millerjames01.github.io/desk/**

- **Install it.** iPhone: Safari → Share → *Add to Home Screen*. Android: Chrome menu → *Install app*.
- **Keep it.** Settings → *Ask the browser to keep my data*, then *Download a backup* now and then. The data lives only in this browser.
- **Offline.** After the first visit the app works without a connection. Fetching articles, Claude, and Tesseract's first download need one.

## Read: the booklet

The brief for the booklet is in [`design-reference/MARGINALIA-BRIEF.md`](design-reference/MARGINALIA-BRIEF.md), with the nine mockups beside it. The brief describes a Node pipeline. Desk does the same work in the browser, with no server:

| Brief step | In Desk |
|---|---|
| Scrape (undici, Playwright) | **Fetch** through public CORS proxies; the **bookmarklet** on the article's own tab (sees what you see, JavaScript and all); or **paste**. |
| Extract (Readability, Turndown) | The same libraries, in the browser (`src/read/extract.ts`). |
| Images (sharp) | Canvas: greyscale, ≤ 1400 px on the long edge, nothing under 300 px wide, at most 3 per article, lead and captioned images first. |
| Sanity checks + Claude fallback | `src/read/quality.ts`. Flagged articles are **held out** of the booklet. With an API key, Claude extracts the body, and the result is kept only if every paragraph is found word for word in the page (`src/read/verify.ts`). Otherwise the article is listed as needing a manual paste. |
| Typeset (Nunjucks, pagedjs-cli) | Paged.js in `book.html`, rendered from the issue in IndexedDB. |
| QA (pdftotext, Paged.js warnings) | Run on the laid-out pages (`src/read/qa.ts`): text integrity, in order, for every paragraph and footnote (hard); unintended blank pages (hard); overflow and Paged.js layout loops (hard); widows, orphans, stranded subheads, low-dpi images (soft). A booklet with errors won't impose without `&force=1`. |
| Impose (pdfjam) | `src/read/impose.ts`. Pages move onto A4 landscape sheets in saddle-stitch order, with creep. |
| Outputs | **Reading copy** (A5, print → Save as PDF), **Booklet** (A4, duplex), **Fronts** and **Backs** (manual duplex, backs reversed), **Cover card** and **Interior** separately, **Contact sheet**, and **report.md**. |

### Printing

1. Open an issue → **Typeset and check**. Fix anything red.
2. **Booklet (A4, duplex)** → Print: A4 landscape, two-sided, **flip on short edge**, scale 100 %, margins none.
   - Sheet 1 is the cover card (160–185 g; check the printer's limit). Use **Cover card** and **Interior** to feed the card separately.
   - No auto-duplex? Print **Fronts**, put the stack back printed side down, then print **Backs**.
3. Fold, two staples through the fold, read.

On paper the cover prints in black only; the card supplies the colour (set per issue). The interior is greyscale.

### Design rules kept from the brief

- One base template (`src/read/house/base.css`): A5, margins 18/15/20/17 mm mirrored, orphans and widows 3, keep-with-next subheads, folios, running heads, contents via `target-counter`.
- Three house styles over it: **A · Review**, **B · Grid** (the default), **C · Pamphlet**. Switch in Settings; nothing else changes.
- Publication skins change only accent (greys #000–#777), kicker, end mark, opener, rule and title case. A new domain gets a skin derived from a hash of its name, saved and marked *auto*, so it looks the same in every issue (Read → Publications).
- No colour inside, nothing within 6 mm of the trim, no URLs in the body (they're in the colophon).

**Creep** moves the pages of inner sheets **toward the spine**, 0.2 mm per sheet by default. The brief says "outward", but in a folded stack the inner sheets' text already sits further out, so the correction runs inward. Set a negative value in Settings if your stack behaves otherwise.

### Paged.js pitfalls (found the hard way)

These are worked around in the code; keep them in mind when editing the house CSS:

- An element with a `style` attribute is treated as hidden (`data-undisplayed`). Per-article tokens go in a generated stylesheet instead.
- Rules with sibling combinators (`p + p`) are dropped. Follow-on paragraphs carry `.cont`.
- `break-before: avoid` on an element after a long one makes Paged.js back up over the whole article and loop ("Layout repeated").
- `initial-letter` is mismeasured; drop caps are floats.
- A margin-free page loses about 3 mm; the cover is 206 mm tall.
- Footnotes are moved out of `.book`, so their font is named in each house file, and the rule above them belongs to the first note.

### Fetching without a server

Browsers can't read other sites' pages directly. The public proxies in Settings work for most small sites but are rate-limited and unreliable. The **bookmarklet** (Read page) never needs one: drag it to the bookmarks bar, open an article, click it.

For a steadier proxy, a free Cloudflare Worker you own:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get('url');
    if (!url) return new Response('?url=', { status: 400 });
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Desk reader)' } });
    const out = new Response(res.body, res);
    out.headers.set('Access-Control-Allow-Origin', 'https://millerjames01.github.io');
    return out;
  },
};
```

Add `https://<worker>.workers.dev/?url={url}` at the top of the proxy list.

## Drafts

- **New from pages:** take or choose photos (several at once). Each page is read in turn and shown beside its photo for correction, then saved as version 1. Photos stay on the device with the piece.
- **OCR:** Tesseract.js runs locally (≈ 10 MB of English data on first use) and is weak on cursive. With an Anthropic key in Settings, choose Claude: far better on handwriting, about a cent a page, and the photo goes to Anthropic. Claude is told to transcribe only, never correct.
- **Editor:** autosaves the working copy as you type; **Save version** keeps a numbered snapshot with a note. Read any version, see what changed from the one before, compare it with the editor, or restore it.

## Publish

Journals carry whether they take simultaneous submissions and their usual response time. Logging a submission warns you if the piece is already there, was declined there before, is out somewhere exclusive, or is going somewhere exclusive while out elsewhere. Overdue submissions are flagged. When a piece is accepted, anything else still out for it is marked for withdrawal.

## Backups and devices

Settings → **Download a backup** writes every record as JSON: pieces, versions, transcriptions, submissions, journals, issues and article text. It leaves out photos, article images, raw page HTML and the API key. **Merge a backup** keeps whichever copy of each record is newer, so moving a file between phone and computer in either direction leaves both the same.

## Claude, optionally

Two calls only, both with the key you paste into Settings, from the browser straight to Anthropic (the `@anthropic-ai/sdk`, loaded only when used): transcribing a page photo, and extracting a flagged article. Default model `claude-opus-5-5`, changeable in Settings. Requests set the server-side refusal fallback, so a declined request is retried on another model rather than failing. The key never leaves the browser otherwise and is never in a backup.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # typecheck + build to dist/
```

- `src/read/`: the booklet (extract, quality, skins, render, house CSS, qa, impose, sample issue)
- `src/book/`: `book.html`, the typesetting page
- `src/drafts/`, `src/publish/`: logic for the other rooms
- `src/pages/`: the React views
- `src/db.ts`: IndexedDB; every write notifies this tab and other Desk tabs

Read → **Try the sample issue** renders two placeholder essays in the chosen house style, which is the quickest way to check a template change.

`.github/workflows/deploy.yml` tests, builds with the Pages base path and publishes on every push to `main`; `checks.yml` runs the same on pull requests.
