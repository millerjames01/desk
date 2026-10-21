import { useEffect, useMemo, useRef, useState } from 'react';
import { kvGet, kvSet, now, put, remove } from '../db';
import { Badge, Empty, fmtDate, go, plural, useNotice, type Data } from '../lib';
import { addFromHtml, addFromText, addFromUrl, claudeFallback, createIssue } from '../read/articles';
import { extract } from '../read/extract';
import { bookmarkletSource, receiveFromOpener } from '../read/fetch';
import { COVER_DEFAULTS, issueDate, issueNumber, labels, nextIssueId } from '../read/issue';
import type { QaReport } from '../read/qa';
import { flagLabel, reportMarkdown } from '../read/report';
import { installSample, SAMPLE_ISSUE } from '../read/sample';
import { BUILT_IN, OPENERS, ORNAMENTS, RULES, safeAccent, TITLE_CASES } from '../read/skins';
import { countWords, markdownBlocks, readMinutes } from '../read/text';
import { download } from '../backup';
import type { Article, Issue, Publication } from '../types';

const BASE = import.meta.env.BASE_URL;
const deskUrl = () => new URL(BASE, location.href).href;

export function bookUrl(issueId: string, layout: string, extra = ''): string {
  return `${BASE}book.html?issue=${encodeURIComponent(issueId)}&layout=${layout}${extra}`;
}

function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  // React warns on javascript: hrefs, so the link is set directly.
  useEffect(() => ref.current?.setAttribute('href', bookmarkletSource(deskUrl())), []);
  return (
    <div className="card">
      <h3>The bookmarklet</h3>
      <p>
        Drag this to your bookmarks bar: <a ref={ref} className="bookmarklet" onClick={(e) => e.preventDefault()}>＋ Desk</a>
      </p>
      <p className="muted">
        On an article’s page, click it. Desk opens and takes the page as you see it, images included. It needs no proxy and works on pages
        that build themselves with JavaScript. On a phone, add any bookmark, then edit its address and paste the bookmarklet in (long-press the link to copy it).
      </p>
    </div>
  );
}

function useQa(issueId: string): [QaReport | undefined, (r: QaReport) => void] {
  const [qa, setQa] = useState<QaReport>();
  useEffect(() => {
    kvGet<QaReport>(`qa:${issueId}`).then(setQa);
    const on = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === 'desk:qa' && e.data.issue === issueId) setQa(e.data.report);
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [issueId]);
  return [qa, setQa];
}

export function ReadIndex({ data }: { data: Data }) {
  const issues = [...data.issues].sort((a, b) => (a.id === SAMPLE_ISSUE ? 1 : b.id === SAMPLE_ISSUE ? -1 : b.id.localeCompare(a.id)));
  const [notice, show] = useNotice();
  const newIssue = async () => {
    const id = nextIssueId(data.issues);
    await createIssue(id);
    go(`read/${id}`);
  };
  const sample = async () => {
    try {
      go(`read/${await installSample()}`);
    } catch (e) {
      show(String(e), 'bad');
    }
  };
  return (
    <>
      <div className="head">
        <h1>Read</h1>
        <p className="lede">A booklet of things worth reading, printed at home, folded and stapled.</p>
        <div className="actions">
          <button className="primary" onClick={newIssue}>New issue</button>
          <button onClick={sample}>Try the sample issue</button>
          <a className="button" href="#/read/publications">Publications</a>
        </div>
        {notice}
      </div>
      {issues.length ? (
        <div className="list">
          {issues.map((i) => {
            const arts = i.order.map((id) => data.articles.find((a) => a.id === id)).filter(Boolean) as Article[];
            const read = arts.filter((a) => a.readAt).length;
            const held = arts.filter((a) => a.excluded).length;
            return (
              <a key={i.id} className="row" href={`#/read/${i.id}`}>
                <span className="swatch" style={{ background: i.coverColour || COVER_DEFAULTS[data.settings.book.house_style] }} />
                <span className="grow">
                  <strong>{i.id === SAMPLE_ISSUE ? 'Sample issue' : `${labels(data.settings.book.house_style, data.settings.book.title, issueNumber(i.id, data.issues)).numberLabel} · ${issueDate(i.id).month}`}</strong>
                  <span className="muted">
                    {plural(arts.length, 'article')}
                    {held ? ` · ${held} held out` : ''}
                    {arts.length ? ` · ${read} read` : ''}
                    {i.printedAt ? ` · printed ${fmtDate(i.printedAt)}` : ''}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <Empty>No issues yet. Start one, or open the sample to see the house style.</Empty>
      )}
      <Bookmarklet />
    </>
  );
}

function AddArticle({ issue, data }: { issue: Issue; data: Data }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [paste, setPaste] = useState(false);
  const [form, setForm] = useState({ url: '', title: '', author: '', publication: '', published: '', text: '' });
  const [notice, show] = useNotice();

  const record = async (notes: string[]) => {
    if (!notes.length) return;
    const prev = (await kvGet<string[]>(`notes:${issue.id}`)) ?? [];
    await kvSet(`notes:${issue.id}`, [...prev, ...notes]);
  };

  const fetchIt = async () => {
    const list = url.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u) && !u.startsWith('#'));
    if (!list.length) return;
    const failed: string[] = [];
    for (const [n, u] of list.entries()) {
      try {
        setBusy(`${n + 1}/${list.length}: fetching…`);
        const r = await addFromUrl(issue.id, u, data.settings, (via) => setBusy(`${n + 1}/${list.length}: trying ${via}…`));
        await record(r.notes);
        show(`Added “${r.article.title}”${r.article.flags.length ? ' — flagged, held out' : ''}.`, r.article.flags.length ? 'bad' : 'good');
      } catch (e) {
        failed.push(u);
        show((e as Error).message, 'bad');
      }
    }
    setBusy('');
    setUrl(failed.join('\n'));
  };

  const pasteIt = async () => {
    try {
      const looksHtml = /^\s*</.test(form.text);
      const r = looksHtml
        ? await addFromHtml({ issueId: issue.id, url: form.url || 'https://example.org/', html: form.text, via: 'paste', settings: data.settings })
        : await addFromText(issue.id, form);
      await record(r.notes);
      show(`Added “${r.article.title}”.`);
      setForm({ url: '', title: '', author: '', publication: '', published: '', text: '' });
      setPaste(false);
    } catch (e) {
      show((e as Error).message, 'bad');
    }
  };

  return (
    <div className="card">
      <h3>Add articles</h3>
      <div className="field-row">
        <textarea rows={2} placeholder="Paste one or more article URLs, one per line" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="primary" disabled={!!busy || !url.trim()} onClick={fetchIt}>{busy ? 'Working…' : 'Fetch'}</button>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {notice}
      <p className="muted small">
        Fetching goes through a public CORS proxy, since a browser can’t read other sites directly. If it fails, use the bookmarklet on the article’s tab, or{' '}
        <button className="link" onClick={() => setPaste(!paste)}>paste the text</button>.
      </p>
      {paste && (
        <div className="stack">
          <div className="grid2">
            <input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input placeholder="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            <input placeholder="Publication" value={form.publication} onChange={(e) => setForm({ ...form, publication: e.target.value })} />
            <input type="date" value={form.published} onChange={(e) => setForm({ ...form, published: e.target.value })} />
          </div>
          <textarea rows={10} placeholder="The article text, paragraphs separated by a blank line. Or the page’s HTML source." value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          <div><button className="primary" disabled={!form.text.trim() || (!form.title && !/^\s*</.test(form.text))} onClick={pasteIt}>Add pasted article</button></div>
        </div>
      )}
    </div>
  );
}

function ArticleRow({ a, index, count, issue, data }: { a: Article; index: number; count: number; issue: Issue; data: Data }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(a);
  const [busy, setBusy] = useState(false);
  const [notice, show] = useNotice();
  useEffect(() => setEdit(a), [a]);

  const move = async (by: number) => {
    const order = [...issue.order];
    const i = order.indexOf(a.id);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await put('issues', { ...issue, order, updatedAt: now() });
  };
  const save = async () => {
    const words = countWords(markdownBlocks(edit.markdown).body.join(' '));
    await put('articles', { ...edit, words, read_minutes: readMinutes(words), updatedAt: now() });
    show('Saved.');
  };
  const drop = async () => {
    if (!confirm(`Remove “${a.title}” from this issue?`)) return;
    await put('issues', { ...issue, order: issue.order.filter((id) => id !== a.id), updatedAt: now() });
    for (const id of a.images) await remove('blobs', id);
    await remove('blobs', `raw-${a.id}`);
    await remove('articles', a.id);
  };
  const tryClaude = async () => {
    setBusy(true);
    try {
      const r = await claudeFallback(a, data.settings);
      show(r.message, r.ok ? 'good' : 'bad');
      const prev = (await kvGet<string[]>(`notes:${issue.id}`)) ?? [];
      await kvSet(`notes:${issue.id}`, [...prev, `${a.title}: ${r.message}`]);
    } catch (e) {
      show((e as Error).message, 'bad');
    }
    setBusy(false);
  };

  return (
    <div className={`article-row${a.excluded ? ' held' : ''}`}>
      <div className="article-line">
        <span className="num">{index + 1}</span>
        <button className="grow plain left" onClick={() => setOpen(!open)}>
          <strong>{a.title}</strong>
          <span className="muted">
            {[a.publication || a.domain, a.author, `${a.words.toLocaleString()} words`, `${a.read_minutes} min`].filter(Boolean).join(' · ')}
          </span>
          <span className="tags">
            {a.excluded && <Badge tone="bad">held out</Badge>}
            {a.flags.map((f) => <Badge key={f.code} tone="warn">{flagLabel(f.code)}</Badge>)}
            {a.via === 'claude' && <Badge>via Claude, verified</Badge>}
            {a.readAt && <Badge tone="good">read</Badge>}
          </span>
        </button>
        <span className="row-actions">
          <label className="check" title="Mark as read">
            <input type="checkbox" checked={!!a.readAt} onChange={(e) => put('articles', { ...a, readAt: e.target.checked ? now() : undefined, updatedAt: now() })} /> read
          </label>
          <button className="icon" disabled={index === 0} onClick={() => move(-1)} aria-label="Move up">↑</button>
          <button className="icon" disabled={index === count - 1} onClick={() => move(1)} aria-label="Move down">↓</button>
        </span>
      </div>
      {open && (
        <div className="article-detail stack">
          {a.flags.length > 0 && (
            <ul className="flags">
              {a.flags.map((f) => <li key={f.code}><strong>{flagLabel(f.code)}.</strong> {f.detail}</li>)}
            </ul>
          )}
          <div className="actions">
            {a.excluded ? (
              <button onClick={() => put('articles', { ...a, excluded: false, updatedAt: now() })}>Include anyway</button>
            ) : (
              <button onClick={() => put('articles', { ...a, excluded: true, updatedAt: now() })}>Hold out of the booklet</button>
            )}
            {a.flags.length > 0 && (
              <button disabled={busy || !data.settings.anthropicKey} onClick={tryClaude} title={data.settings.anthropicKey ? '' : 'Needs an API key in Settings'}>
                {busy ? 'Asking Claude…' : 'Try Claude extraction'}
              </button>
            )}
            {a.url && <a className="button" href={a.url} target="_blank" rel="noreferrer">Original</a>}
            <button className="danger" onClick={drop}>Remove</button>
          </div>
          {notice}
          <div className="grid2">
            <label>Title<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
            <label>Author<input value={edit.author} onChange={(e) => setEdit({ ...edit, author: e.target.value })} /></label>
            <label>Section (kicker)<input value={edit.section} onChange={(e) => setEdit({ ...edit, section: e.target.value })} /></label>
            <label>Published<input type="date" value={edit.published} onChange={(e) => setEdit({ ...edit, published: e.target.value })} /></label>
          </div>
          <label>Standfirst<textarea rows={2} value={edit.dek} onChange={(e) => setEdit({ ...edit, dek: e.target.value })} /></label>
          <label>
            Body (Markdown)
            <textarea className="mono" rows={12} value={edit.markdown} onChange={(e) => setEdit({ ...edit, markdown: e.target.value })} />
          </label>
          <p className="muted small">Edit only to repair the extraction (stray junk, a lost paragraph pasted back in). The booklet is the text as published.</p>
          <div><button className="primary" onClick={save}>Save article</button></div>
        </div>
      )}
    </div>
  );
}

const LAYOUTS = [
  ['reading', 'Reading copy (A5)'],
  ['booklet', 'Booklet (A4, duplex)'],
  ['fronts', 'Fronts'],
  ['backs', 'Backs'],
  ['cover', 'Cover card'],
  ['interior', 'Interior'],
  ['sheet', 'Contact sheet'],
] as const;

export function IssuePage({ data, issueId }: { data: Data; issueId: string }) {
  const issue = data.issues.find((i) => i.id === issueId);
  const [qa] = useQa(issueId);
  const [preview, setPreview] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    kvGet<string[]>(`notes:${issueId}`).then((n) => setNotes(n ?? []));
  }, [issueId, data]);
  if (!issue) return <Empty>No issue {issueId}. <a href="#/read">Back to Read</a></Empty>;

  const book = data.settings.book;
  const arts = issue.order.map((id) => data.articles.find((a) => a.id === id)).filter(Boolean) as Article[];
  const ready = arts.filter((a) => !a.excluded);
  const words = ready.reduce((n, a) => n + a.words, 0);
  const lab = labels(book.house_style, book.title, issueNumber(issue.id, data.issues));
  const errors = qa?.items.filter((i) => i.level === 'error') ?? [];
  const warns = qa?.items.filter((i) => i.level === 'warn') ?? [];
  const infos = qa?.items.filter((i) => i.level === 'note') ?? [];
  const stale = qa && issue.updatedAt > qa.at;

  const setIssue = (patch: Partial<Issue>) => put('issues', { ...issue, ...patch, updatedAt: now() });
  const deleteIssue = async () => {
    if (!confirm(`Delete issue ${issue.id} and its ${arts.length} articles from this device?`)) return;
    for (const a of arts) {
      for (const id of a.images) await remove('blobs', id);
      await remove('blobs', `raw-${a.id}`);
      await remove('articles', a.id);
    }
    await remove('issues', issue.id);
    go('read');
  };

  return (
    <>
      <div className="head">
        <p className="crumb"><a href="#/read">Read</a></p>
        <h1>{issue.id === SAMPLE_ISSUE ? 'Sample issue' : `${lab.numberLabel} · ${issueDate(issue.id).month}`}</h1>
        <p className="lede">
          {plural(ready.length, 'article')} for the booklet · {words.toLocaleString()} words · about {Math.round(words / 230)} minutes
          {arts.length > ready.length ? ` · ${arts.length - ready.length} held out` : ''}
        </p>
      </div>

      <AddArticle issue={issue} data={data} />

      <div className="card">
        <h3>In this issue</h3>
        {arts.length ? arts.map((a, i) => <ArticleRow key={a.id} a={a} index={i} count={arts.length} issue={issue} data={data} />) : <Empty>Add a URL above to begin.</Empty>}
      </div>

      <div className="card">
        <h3>The booklet</h3>
        <div className="grid2">
          <label>
            Cover card colour
            <span className="field-row">
              <input type="color" value={issue.coverColour || COVER_DEFAULTS[book.house_style]} onChange={(e) => setIssue({ coverColour: e.target.value })} />
              {issue.coverColour && <button className="link" onClick={() => setIssue({ coverColour: '' })}>house default</button>}
            </span>
          </label>
          <label>Cover line<input placeholder={book.tagline} value={issue.subtitle} onChange={(e) => setIssue({ subtitle: e.target.value })} /></label>
        </div>
        <p className="muted small">House style: {book.house_style.replace('-', ' · ')} (change in Settings). The cover colour is the card you print on; on paper the cover prints in black.</p>
        <div className="actions">
          <button className="primary" disabled={!ready.length} onClick={() => setPreview((n) => n + 1)}>{preview ? 'Typeset again' : 'Typeset and check'}</button>
          {LAYOUTS.map(([id, label]) => (
            <a key={id} className="button" href={bookUrl(issue.id, id)} target="_blank" rel="noreferrer">{label}</a>
          ))}
        </div>
        {qa ? (
          <div className="qa">
            <p>
              <Badge tone={qa.ok ? 'good' : 'bad'}>{qa.ok ? 'QA passed' : `${errors.length} error${errors.length === 1 ? '' : 's'}`}</Badge>{' '}
              {qa.pages} pages · {qa.pages / 4} sheets · checked {fmtDate(qa.at)}
              {stale && <span className="muted"> · the issue changed since; typeset again</span>}
            </p>
            {[...errors, ...warns, ...infos].length > 0 && (
              <ul className="qa-items">
                {[...errors, ...warns, ...infos].map((i, n) => (
                  <li key={n} className={i.level}>
                    <strong>{i.level === 'error' ? 'Error' : i.level === 'warn' ? 'Warning' : 'Note'}</strong>
                    {i.page ? ` · p. ${i.page}` : ''}
                    {i.article ? ` · ${i.article}` : ''}: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="muted">Not typeset yet.</p>
        )}
        {preview > 0 && <iframe key={preview} className="book-frame" title="Booklet preview" src={bookUrl(issue.id, 'reading', '&embed=1')} />}
        <div className="actions">
          <button onClick={() => download(`${issue.id}-report.md`, reportMarkdown(issue, data.articles, qa, notes, book.printer), 'text/markdown')}>Download report.md</button>
          {issue.printedAt ? (
            <button onClick={() => setIssue({ printedAt: undefined })}>Printed {fmtDate(issue.printedAt)} · undo</button>
          ) : (
            <button disabled={!qa?.ok} onClick={() => setIssue({ printedAt: now() })}>Mark printed</button>
          )}
          {notes.length > 0 && <button onClick={() => kvSet(`notes:${issue.id}`, []).then(() => setNotes([]))}>Clear {plural(notes.length, 'note')}</button>}
          <button className="danger" onClick={deleteIssue}>Delete issue</button>
        </div>
        {notes.length > 0 && (
          <ul className="notes">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </div>
    </>
  );
}

export function Receive({ data }: { data: Data }) {
  const [state, setState] = useState<{ phase: 'waiting' | 'saving' | 'done' | 'error'; message: string; issueId?: string }>({ phase: 'waiting', message: 'Waiting for the article tab…' });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const max = data.settings.book.max_images_per_article;
        const posted = await receiveFromOpener((html, url) => extract(html, url, { maxImages: max }).images.map((i) => i.src));
        setState({ phase: 'saving', message: `Got “${posted.title || posted.url}”. Saving…` });
        const dated = data.issues.filter((i) => i.id !== SAMPLE_ISSUE && !i.printedAt).sort((a, b) => b.id.localeCompare(a.id));
        const issue = dated[0] ?? (await createIssue(nextIssueId(data.issues)));
        const r = await addFromHtml({ issueId: issue.id, url: posted.url, html: posted.html, via: 'bookmarklet', settings: data.settings, postedImages: posted.images });
        if (r.notes.length) await kvSet(`notes:${issue.id}`, [...((await kvGet<string[]>(`notes:${issue.id}`)) ?? []), ...r.notes]);
        setState({
          phase: 'done',
          issueId: issue.id,
          message: `Added “${r.article.title}” to ${issue.id}${r.article.flags.length ? '. It was flagged and is held out; check it there.' : '.'}`,
        });
      } catch (e) {
        setState({ phase: 'error', message: (e as Error).message });
      }
    })();
  }, [data]);
  return (
    <div className="card center">
      <h2>From the bookmarklet</h2>
      <p className={state.phase === 'error' ? 'notice bad' : ''}>{state.message}</p>
      {state.issueId && <p><a className="button primary" href={`#/read/${state.issueId}`}>Open {state.issueId}</a> <button onClick={() => window.close()}>Close this tab</button></p>}
    </div>
  );
}

function SkinEditor({ pub }: { pub: Publication }) {
  const [p, setP] = useState(pub);
  const [notice, show] = useNotice();
  useEffect(() => setP(pub), [pub]);
  const sel = <K extends keyof Publication>(k: K, options: readonly string[]) => (
    <select value={(p[k] as string) ?? ''} onChange={(e) => setP({ ...p, [k]: e.target.value || undefined })}>
      <option value="">house default</option>
      {options.map((o) => <option key={o} value={o}>{o || 'none'}</option>)}
    </select>
  );
  const save = async () => {
    const accent = p.accent ? safeAccent(p.accent) : undefined;
    await put('publications', { ...p, accent, auto: false, updatedAt: now() });
    show(accent && accent !== p.accent ? `Saved. Accent made grey: ${accent}.` : 'Saved.');
  };
  return (
    <div className="skin">
      <div className="skin-head">
        <strong>{p.name || p.domain}</strong> <span className="muted">{p.domain}</span> {pub.auto && <Badge tone="warn">auto</Badge>}
      </div>
      <div className="grid3">
        <label>Name<input value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label>Accent (grey, #000–#777)<input value={p.accent ?? ''} placeholder="#333333" onChange={(e) => setP({ ...p, accent: e.target.value })} /></label>
        <label>Kicker<input value={p.kicker ?? ''} placeholder="{section} · {read_minutes} min read" onChange={(e) => setP({ ...p, kicker: e.target.value })} /></label>
        <label>End mark{sel('ornament', ORNAMENTS)}</label>
        <label>Opener{sel('opener_variant', OPENERS)}</label>
        <label>Rule{sel('rule', RULES)}</label>
        <label>Title case{sel('title_case', TITLE_CASES)}</label>
      </div>
      <div className="actions">
        <button onClick={save}>Save</button>
        {p.domain !== 'default' && <button className="danger" onClick={() => remove('publications', p.domain)}>Delete</button>}
      </div>
      {notice}
    </div>
  );
}

export function Publications({ data }: { data: Data }) {
  const pubs = useMemo(() => {
    const saved = new Map(data.publications.map((p) => [p.domain, p]));
    for (const [domain, skin] of Object.entries(BUILT_IN)) if (!saved.has(domain)) saved.set(domain, { domain, ...skin, updatedAt: '' });
    return [...saved.values()].sort((a, b) => (a.domain === 'default' ? -1 : b.domain === 'default' ? 1 : (a.name ?? a.domain).localeCompare(b.name ?? b.domain)));
  }, [data.publications]);
  return (
    <>
      <div className="head">
        <p className="crumb"><a href="#/read">Read</a></p>
        <h1>Publications</h1>
        <p className="lede">
          Each source keeps the same small touches in every issue: accent, kicker, end mark, opener, rule, title case. Nothing else; the layout is the house’s.
          New domains get a skin made from their name, marked <em>auto</em>, until you change it.
        </p>
      </div>
      <div className="card">{pubs.map((p) => <SkinEditor key={p.domain} pub={p} />)}</div>
    </>
  );
}
