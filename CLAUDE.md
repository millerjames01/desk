# Desk: working in this repo

Read `README.md` for the whole picture. These are the rules that keep it honest.

## Browser only

No backend, no server, no build pipeline beyond Vite. Data lives in IndexedDB on the device (`src/db.ts`). Anything that needs another site goes through the CORS proxies in Settings or the bookmarklet. Don't add a service that has to run somewhere.

## The text is the text

- A booklet reproduces articles as published. Never rewrite, summarise, shorten or reorder them, in code or in a prompt.
- Claude's extraction is accepted only when every paragraph is found in the page (`src/read/verify.ts`). Don't loosen that check.
- A flagged article is held out of the booklet until fixed or explicitly included. Never include one silently.
- QA text integrity is a hard error. If a template change makes it fail, fix the template, not the check.
- Transcription is transcription: Claude must not correct the writer's words.

## Derived, never stored

Streaks and reading/writing days come from dated records (versions, pages, articles read, submissions) on every render (`src/activity.ts`). Don't store counts. Don't backdate records or invent entries to fill a streak.

## Booklet templates

- Structure lives in `src/read/house/base.css` and must stay identical across house styles. House files set tokens and flourishes; skins set only the tokens in `src/read/skins.ts`.
- The interior is black and grey only. Accents go through `safeAccent`.
- Paged.js quirks (README → *Paged.js pitfalls*): no `style` attributes in content, no sibling combinators, no `break-before: avoid` after long elements, no `initial-letter`.
- After any template change, render the sample issue in all three houses and check QA passes.

## Privacy

The API key stays in the browser and goes only to Anthropic; never into backups, logs or the repo. Backups carry text only.

## Before committing

```sh
npm test
npm run build
```

`checks.yml` runs both on every PR.
