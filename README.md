# Desk

A one-person desk for a reading and writing practice. Three rooms:

| | |
|---|---|
| **Read** | Turn free articles from small literary sites into an A5 booklet, *Marginalia*, printed at home, folded and saddle-stapled. One template, three house styles, a fixed skin per publication, QA that proves no word was lost. |
| **Drafts** | Photograph handwritten pages, read them with OCR, then work the text in an editor that keeps every version you save, with word-level diffs. |
| **Publish** | Journals, submissions and answers: what's out, for how long, who takes simultaneous submissions, what to withdraw when something is accepted. |

The **Desk** page shows one thing to do, not a list: write (always first, until you have today), read the next article in a printed issue, print the issue, send a ready piece, or query a journal that's overdue. *Something else* swaps it for the next one, for today only. Underneath, one quiet line: this week's days and how many in a row you've written. Those days come from the record (a version saved, pages captured, an article read, a submission sent); nothing is stored, so there's nothing to pad.

Everything runs in the browser and lives in IndexedDB on the device. There is no backend and no account. It is hosted on GitHub Pages and installs to a phone's home screen.

## Use it

**https://millerjames01.github.io/desk/**

- **Install it.** iPhone: Safari → Share → *Add to Home Screen*. Android: Chrome menu → *Install app*.
- **Keep it.** Settings → *Ask the browser to keep my data*, then *Download a backup* now and then. The data lives only in this browser.
- **Offline.** After the first visit the app works without a connection. Fetching articles, Claude, and Tesseract's first download need one.

## Read: booklets of editions

A booklet is one journal, never a mix: SmokeLong's Issue Ninety-Three, HAD's October, or Lost Balloon's July–September when a single month is too thin to make a book. On the Read page, **From an edition**:

1. Choose the journal, then one or more issues or months (or paste an edition's address), and **Find the stories**.
2. Desk lists every story in them, grouped by edition, from the issue page or the month's archive, following "older posts" pages as needed. Untick any you don't want.
3. Leave **Add earlier editions** on to fill a thin booklet. When the chosen editions are walked and the booklet is still short of about 85% of the target (Settings → *Fill a booklet to about*, 48 pages by default), the walk lists the next earlier edition and carries on, up to six more.
4. **Make the booklet.** Desk fetches the stories one at a time, a few seconds apart, into a new issue titled with the journal and edition (or the run of them: "July–September 2026", "Issues 92–93"). You can leave the page; a closed tab resumes with **Carry on**.
5. Typeset, check, print.

A booklet of several editions reads oldest first. Each edition opens with a half-title, the contents are grouped by edition, and Short Takes stay with their own edition.

In Grid, a journal's booklet has its own cover: a strip of the year's months (or a run of issue numbers) with the gathered ones filled in, the journal's mark on the left edge above its name, the editions and year, and the journal's address. The mark is the journal's logo or favicon, named in its profile (`mark` in `src/read/sites.ts`). The walk fetches it once, through the extension or proxies like any other request, and Desk turns it to black ink for the card. Lost Balloon has no logo, so its profile carries a balloon drawn as a stand-in. Review and Pamphlet keep their covers, with the range in the issue line.

| Journal | A booklet is usually |
|---|---|
| SmokeLong Quarterly | one issue (about 40 pages) |
| X-R-A-Y | one month, two in a quiet month |
| Lost Balloon | a season, three months (about 16 pages a month) |
| HAD | two months |
| Vestal Review | one or two issues |

The source survey is in [`design-reference/SOURCES.md`](design-reference/SOURCES.md). The site profiles are in `src/read/sites.ts` and editable at Read → **Sites**, with a tester for any story URL.

| Journal | Edition | Profile |
|---|---|---|
| SmokeLong Quarterly | an issue | checked against live pages |
| Vestal Review | an issue | from the survey; check on first use |
| Lost Balloon | a month | checked |
| HAD | a month | checked |
| X-R-A-Y | a month | checked |
| Flash Frog | — | no profile yet; capture pages one at a time |

A profile finds the story, not a guess at it: title, author, date, body, and what to strip (audio players, share bars, bios). When a profile's body selector finds nothing, the page goes through Readability instead and the article is held out with a note that the site may have changed.

### The Desk Reader extension

Browsers can't read other sites' pages, so walking an edition needs help. The **Desk Reader** extension (`extension/`, also served as `desk-reader.zip` beside the app) does the fetching, and nothing else:

- It obeys each site's `robots.txt`, read fresh, for the `DeskReader` agent or `*`. A disallowed page is refused; open it yourself and press the button.
- One request per site every 3 seconds at least, longer if `Crawl-delay` asks.
- It says who it is: `Mozilla/5.0 (compatible; DeskReader/0.1; personal reading…)`.
- Pages are cached for 30 days, so nothing is fetched twice.
- It fetches only the pages Desk asks for: an edition's list and its stories, plus their images. It never follows links on its own.
- Its toolbar button sends the page you're reading to Desk, into an unprinted issue of the same journal if there is one. A story already in the issue is skipped.

Install: download `desk-reader.zip` (link on the Read page), unzip, open `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, choose the folder, reload Desk. Without it, Desk falls back to public CORS proxies with the same rules applied in the page, which works when the proxies do.

The survey listed HAD, X-R-A-Y and Flash Frog as disallowed by `robots.txt`. Checked live on 21 October 2026, HAD and X-R-A-Y allow general agents; they block AI crawlers by name, which is likely what the survey saw. Vestal Review blocks `ClaudeBot` and `anthropic-ai` but allows general agents on story pages. Flash Frog didn't answer at the addresses tried. None of this is hard-coded: the extension asks each site every time.

### Short Takes

Pieces under 1,000 words are **Short Takes**. They follow the long reads in their own section (with an opener page when there are long reads too), and, like every piece, each starts a fresh page. The exception is a very short piece (under 250 words, a haiku or a prose poem) straight after another: it follows on the same page, is never split, and starts the next page instead if it would begin in the bottom 40%; a measuring pass finds those. The contents lists Short Takes as a group.

### Other ways in

- **Add articles** on an issue page: paste URLs, fetched the same way.
- The **bookmarklet** (Read page): on any article tab, click it to send that page. No extension needed.
- **Paste** the text, for anything else.

### The booklet

The brief for the booklet is in [`design-reference/MARGINALIA-BRIEF.md`](design-reference/MARGINALIA-BRIEF.md), with the nine mockups beside it. The brief describes a Node pipeline; Desk does the same work in the browser:

| Brief step | In Desk |
|---|---|
| Scrape (undici, Playwright) | The extension, or proxies, or the bookmarklet, or paste. |
| Extract (Readability, Turndown) | Site profiles first, Readability as the fallback, the same Turndown rules for both (`src/read/extract.ts`, `src/read/sites.ts`). |
| Images (sharp) | Canvas: greyscale, ≤ 1400 px on the long edge, nothing under 300 px wide, at most 3 per article, lead and captioned images first. |
| Sanity checks + Claude fallback | `src/read/quality.ts`. Flagged articles are **held out** of the booklet. For a profiled site a short piece, or a prose poem ending without a full stop, is normal and isn't held. With an API key, Claude extracts the body, kept only if every paragraph is found word for word in the page (`src/read/verify.ts`). |
| Typeset (Nunjucks, pagedjs-cli) | Paged.js in `book.html`, rendered from the issue in IndexedDB. |
| QA (pdftotext, Paged.js warnings) | Run on the laid-out pages (`src/read/qa.ts`): text integrity, in order, for every paragraph and footnote (hard); unintended blank pages (hard); overflow and Paged.js layout loops (hard); widows, orphans, stranded subheads, low-dpi images (soft). A booklet with errors won't impose without `&force=1`. |
| Impose (pdfjam) | `src/read/impose.ts`. Pages move onto A4 landscape sheets in saddle-stitch order, with creep. |
| Outputs | **Reading copy** (A5, print → Save as PDF), **Booklet** (A4, duplex), **Fronts** and **Backs** (manual duplex, backs reversed), **Cover card** and **Interior** separately, **Contact sheet**, and **report.md**. |

### Printing

1. Open an issue → **Typeset and check**. Fix anything red; the list says what and where, here and in the print window.
2. Under **Print the booklet**: **Pages** on plain A4 (two-sided, flip on the short edge), then **Cover** on one sheet of card, one side only.

3. Fold, two staples through the fold, read.

Under *Other ways to print*: **Everything at once** (A4 landscape, two-sided, flip on short edge, scale 100 %, margins none; sheet 1 is the cover card, so load it first), and **Fronts** then **Backs** for a printer without two-sided printing (put the stack back printed side down between them).

On paper the cover prints in black only; the card supplies the colour (set per issue). The inside of the card (pages 2 and the second to last) is left bare, so the contents and the sources sit whole on the paper and the card goes through the printer once. The interior is greyscale.

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

### A proxy of your own

Without the extension, Desk uses the public proxies in Settings, which are rate-limited and unreliable. A free Cloudflare Worker you own is steadier:

```js
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get('url');
    if (!url) return new Response('?url=', { status: 400 });
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DeskReader/0.1; personal reading)' } });
    const out = new Response(res.body, res);
    out.headers.set('Access-Control-Allow-Origin', 'https://millerjames01.github.io');
    return out;
  },
};
```

Add `https://<worker>.workers.dev/?url={url}` at the top of the proxy list. Desk still reads `robots.txt` and spaces requests through it.

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

- `src/read/`: the booklet (sites and editions, walk, transport, extract, quality, skins, render, house CSS, qa, impose, sample issue)
- `extension/`: Desk Reader (Manifest V3, no build step); `robots.js` is shared with the app
- `src/book/`: `book.html`, the typesetting page
- `src/drafts/`, `src/publish/`: logic for the other rooms
- `src/pages/`: the React views
- `src/db.ts`: IndexedDB; every write notifies this tab and other Desk tabs

Read → **Try the sample issue** renders two placeholder essays as a booklet of two editions (September and October) of an imaginary journal, Desk Sample, in the chosen house style. It shows the edition cover, the half-titles and the grouped contents, and is the quickest way to check a template change.

`.github/workflows/deploy.yml` tests, builds with the Pages base path and publishes on every push to `main`; `checks.yml` runs the same on pull requests.
