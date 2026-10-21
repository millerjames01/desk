import { useEffect, useMemo, useRef, useState } from 'react';
import { now, put } from '../db';
import { addPages, compare, createPiece, deletePiece, diffStats, photoUrl, saveVersion, saveWorking } from '../drafts/drafts';
import { ocr, ocrEngine } from '../drafts/ocr';
import { preparePhoto } from '../read/images';
import { countWords } from '../read/text';
import { ago, Badge, Empty, fmtDate, go, plural, useDebounced, useNotice, type Data } from '../lib';
import { download } from '../backup';
import type { PagePhoto, Piece, PieceStatus, Version } from '../types';

const STATUSES: PieceStatus[] = ['drafting', 'resting', 'ready', 'retired'];
const STATUS_TONE: Record<PieceStatus, 'plain' | 'good' | 'warn' | 'bad'> = { drafting: 'plain', resting: 'warn', ready: 'good', retired: 'bad' };

export function DraftsIndex({ data }: { data: Data }) {
  const [filter, setFilter] = useState<PieceStatus | 'all'>('all');
  const pieces = [...data.pieces].filter((p) => filter === 'all' || p.status === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const blank = async () => go(`drafts/${(await createPiece('Untitled')).id}`);
  return (
    <>
      <div className="head">
        <h1>Drafts</h1>
        <p className="lede">Write by hand, photograph the pages, work the text here. Every saved version is kept.</p>
        <div className="actions">
          <a className="button primary" href="#/drafts/capture">New from pages</a>
          <button onClick={blank}>New blank draft</button>
        </div>
      </div>
      <div className="tabs">
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>
      {pieces.length ? (
        <div className="list">
          {pieces.map((p) => {
            const vs = data.versions.filter((v) => v.pieceId === p.id);
            const pages = data.pages.filter((pg) => pg.pieceId === p.id).length;
            const out = data.submissions.filter((s) => s.pieceId === p.id && s.status === 'pending').length;
            return (
              <a key={p.id} className="row" href={`#/drafts/${p.id}`}>
                <span className="grow">
                  <strong>{p.title}</strong>
                  <span className="muted">
                    {countWords(p.working).toLocaleString()} words · {plural(vs.length, 'version')}
                    {pages ? ` · ${plural(pages, 'page')} captured` : ''} · edited {ago(p.updatedAt)}
                  </span>
                </span>
                {out > 0 && <Badge tone="warn">{out} out</Badge>}
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
              </a>
            );
          })}
        </div>
      ) : (
        <Empty>{filter === 'all' ? 'Nothing yet. Photograph a page or start a blank draft.' : `No ${filter} pieces.`}</Empty>
      )}
    </>
  );
}

interface Shot {
  key: string;
  blob: Blob;
  url: string;
  text: string;
  engine: PagePhoto['engine'];
  confidence?: number;
  status: 'waiting' | 'reading' | 'done' | 'failed';
  progress: string;
}

export function Capture({ data, pieceId }: { data: Data; pieceId?: string }) {
  const piece = pieceId ? data.pieces.find((p) => p.id === pieceId) : undefined;
  const [shots, setShots] = useState<Shot[]>([]);
  const [title, setTitle] = useState('');
  const [engine, setEngine] = useState(ocrEngine(data.settings));
  const [notice, show] = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);

  const patch = (key: string, p: Partial<Shot>) => setShots((list) => list.map((s) => (s.key === key ? { ...s, ...p } : s)));

  // Pages are read one at a time, in the order they were added.
  useEffect(() => {
    if (running.current) return;
    const next = shots.find((s) => s.status === 'waiting');
    if (!next) return;
    running.current = true;
    patch(next.key, { status: 'reading', progress: 'starting' });
    ocr(next.blob, data.settings, (label, f) => patch(next.key, { progress: `${label} ${Math.round(f * 100)}%` }), engine)
      .then((r) => patch(next.key, { status: 'done', text: r.text, engine: r.engine, confidence: r.confidence, progress: '' }))
      .catch((e) => {
        patch(next.key, { status: 'failed', progress: (e as Error).message, engine: 'none' });
      })
      .finally(() => {
        running.current = false;
        setShots((s) => [...s]);
      });
  }, [shots, data.settings, engine]);

  const add = async (files: FileList | null) => {
    if (!files) return;
    const added: Shot[] = [];
    for (const f of [...files]) {
      const p = await preparePhoto(f);
      added.push({ key: `${Date.now()}-${Math.random()}`, blob: p.blob, url: URL.createObjectURL(p.blob), text: '', engine: 'none', status: 'waiting', progress: '' });
    }
    setShots((s) => [...s, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const move = (i: number, by: number) => setShots((s) => {
    const n = [...s];
    const j = i + by;
    if (j < 0 || j >= n.length) return s;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const busy = shots.some((s) => s.status === 'waiting' || s.status === 'reading');
  const text = shots.map((s) => s.text.trim()).filter(Boolean).join('\n\n');

  const finish = async () => {
    const photos = shots.map((s) => ({ blob: s.blob, ocr: s.text, engine: s.engine, confidence: s.confidence }));
    if (piece) {
      await addPages(piece.id, photos);
      const working = [piece.working.trim(), text].filter(Boolean).join('\n\n');
      await saveVersion(piece, working, `Added ${plural(shots.length, 'handwritten page')}`, 'ocr');
      go(`drafts/${piece.id}`);
    } else {
      const p = await createPiece(title || firstLine(text) || 'Untitled', text, 'ocr');
      await addPages(p.id, photos);
      go(`drafts/${p.id}`);
    }
    show('Saved.');
  };

  return (
    <>
      <div className="head">
        <p className="crumb"><a href="#/drafts">Drafts</a>{piece && <> · <a href={`#/drafts/${piece.id}`}>{piece.title}</a></>}</p>
        <h1>{piece ? 'Add pages' : 'New from pages'}</h1>
        <p className="lede">Photograph each page flat, in good light, square to the camera. Correct the reading beside each photo, then save it as a draft.</p>
      </div>
      <div className="card">
        <div className="actions">
          <button className="primary" onClick={() => fileRef.current?.click()}>Take or choose photos</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => add(e.target.files)} />
          <label className="inline">
            Read with
            <select value={engine} onChange={(e) => setEngine(e.target.value as 'tesseract' | 'claude')}>
              <option value="tesseract">Tesseract (on this device)</option>
              <option value="claude" disabled={!data.settings.anthropicKey}>Claude (sends the photo to Anthropic){data.settings.anthropicKey ? '' : ' — add a key in Settings'}</option>
            </select>
          </label>
        </div>
        <p className="muted small">
          Tesseract downloads its English data once (about 10 MB) and then works offline. It struggles with cursive; Claude reads handwriting far better for about a cent a page.
        </p>
      </div>
      {shots.map((s, i) => (
        <div key={s.key} className="card capture">
          <div className="capture-photo">
            <img src={s.url} alt={`Page ${i + 1}`} />
            <div className="actions">
              <span className="muted">Page {i + 1}</span>
              <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Earlier">↑</button>
              <button className="icon" onClick={() => move(i, 1)} disabled={i === shots.length - 1} aria-label="Later">↓</button>
              <button className="icon" onClick={() => patch(s.key, { status: 'waiting', text: '' })} disabled={s.status === 'reading'} title="Read again">↻</button>
              <button className="icon danger" onClick={() => setShots((list) => list.filter((x) => x.key !== s.key))} aria-label="Remove">×</button>
            </div>
          </div>
          <div className="capture-text">
            {s.status === 'done' || s.status === 'failed' ? (
              <>
                <textarea className="prose" rows={14} value={s.text} onChange={(e) => patch(s.key, { text: e.target.value })} />
                <p className="muted small">
                  {s.status === 'failed' ? `Couldn’t read it: ${s.progress}. Type it in, or read again.` : `${s.engine === 'claude' ? 'Read by Claude' : `Tesseract, ${s.confidence ?? '?'}% confident`} · ${countWords(s.text)} words`}
                </p>
              </>
            ) : (
              <p className="muted">{s.status === 'reading' ? `Reading… ${s.progress}` : 'Waiting its turn.'}</p>
            )}
          </div>
        </div>
      ))}
      {shots.length > 0 && (
        <div className="card">
          {!piece && <label>Title<input value={title} placeholder={firstLine(text) || 'Untitled'} onChange={(e) => setTitle(e.target.value)} /></label>}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={finish}>{piece ? `Add to “${piece.title}”` : 'Save as a new draft'}</button>
            <span className="muted">{countWords(text)} words from {plural(shots.length, 'page')}</span>
          </div>
          {notice}
        </div>
      )}
    </>
  );
}

function firstLine(t: string): string {
  return t.split('\n')[0].split(/[.!?]/)[0].slice(0, 60).trim();
}

function Diff({ a, b }: { a: string; b: string }) {
  const parts = useMemo(() => compare(a, b), [a, b]);
  const st = diffStats(parts);
  return (
    <div>
      <p className="muted small">+{st.added} words, −{st.removed} words</p>
      <div className="diff prose-view">
        {parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
      </div>
    </div>
  );
}

function Photos({ pages }: { pages: PagePhoto[] }) {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    let made: (string | undefined)[] = [];
    Promise.all(pages.map(photoUrl)).then((u) => {
      made = u;
      setUrls(u);
    });
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [pages.map((p) => p.id).join()]);
  if (!pages.length) return <p className="muted">No pages captured for this piece.</p>;
  return (
    <div className="photos">
      {pages.map((p, i) => (
        <figure key={p.id}>
          {urls[i] ? <a href={urls[i]} target="_blank" rel="noreferrer"><img src={urls[i]} alt={`Page ${i + 1}`} /></a> : <div className="missing">Photo not on this device</div>}
          <figcaption>Page {i + 1} · {fmtDate(p.createdAt)}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function PiecePage({ data, pieceId }: { data: Data; pieceId: string }) {
  const stored = data.pieces.find((p) => p.id === pieceId);
  const [text, setText] = useState(stored?.working ?? '');
  const [title, setTitle] = useState(stored?.title ?? '');
  const [note, setNote] = useState('');
  const [side, setSide] = useState<'versions' | 'pages' | 'notes' | 'out'>('versions');
  const [view, setView] = useState<{ v: Version; mode: 'read' | 'prev' | 'editor' } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving'>('saved');
  const [notice, show] = useNotice();
  const pieceRef = useRef<Piece | undefined>(stored);
  pieceRef.current = stored;

  useEffect(() => {
    setText(stored?.working ?? '');
    setTitle(stored?.title ?? '');
    // Only when opening a different piece; live edits stay local.
  }, [pieceId]);

  const autosave = useDebounced(async (t: string) => {
    if (pieceRef.current) await saveWorking(pieceRef.current, t);
    setSaved('saved');
  }, 700);

  if (!stored) return <Empty>No such draft. <a href="#/drafts">Back to Drafts</a></Empty>;
  const piece = stored;
  const versions = data.versions.filter((v) => v.pieceId === piece.id).sort((a, b) => b.n - a.n);
  const pages = data.pages.filter((p) => p.pieceId === piece.id).sort((a, b) => a.order - b.order);
  const subs = data.submissions.filter((s) => s.pieceId === piece.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const latest = versions[0];
  const prevOf = (v: Version) => versions.find((x) => x.n < v.n);
  const changed = !latest || latest.text !== text;
  const words = countWords(text);

  const onText = (t: string) => {
    setText(t);
    setSaved('saving');
    autosave(t);
  };
  const snapshot = async () => {
    await saveVersion({ ...piece, working: text }, text, note || `Version ${(latest?.n ?? 0) + 1}`, 'edit');
    setNote('');
    show('Version saved.');
  };
  const restore = async (v: Version) => {
    if (changed && !confirm('Replace the editor text with this version? Unsaved changes stay in the working copy only until you save a version.')) return;
    setText(v.text);
    await saveWorking(piece, v.text);
    setView(null);
    show(`Restored version ${v.n} to the editor.`);
  };

  return (
    <>
      <div className="head">
        <p className="crumb"><a href="#/drafts">Drafts</a></p>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== piece.title && put('pieces', { ...piece, title: title || 'Untitled', updatedAt: now() })} />
        <div className="actions">
          <select value={piece.status} onChange={(e) => put('pieces', { ...piece, status: e.target.value as PieceStatus, updatedAt: now() })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <a className="button" href={`#/drafts/${piece.id}/capture`}>Add handwritten pages</a>
          <a className="button" href={`#/publish/new?piece=${piece.id}`}>Submit…</a>
          <button onClick={() => download(`${piece.title.replace(/[^\w-]+/g, '-')}.md`, `# ${piece.title}\n\n${text}\n`, 'text/markdown')}>Download</button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="editor card">
          <textarea className="prose" value={text} onChange={(e) => onText(e.target.value)} placeholder="Write." spellCheck />
          <div className="editor-foot">
            <span className="muted">{words.toLocaleString()} words · {saved === 'saving' ? 'saving…' : 'saved on this device'}{latest && changed ? ` · changed since version ${latest.n}` : ''}</span>
            <span className="field-row">
              <input placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="primary" disabled={!changed || !text.trim()} onClick={snapshot}>Save version</button>
            </span>
          </div>
          {notice}
          {view && (
            <div className="card inset">
              <div className="actions">
                <strong>Version {view.v.n}</strong>
                <span className="muted">{fmtDate(view.v.createdAt)} · {view.v.note}</span>
                {view.mode !== 'read' && <button onClick={() => setView({ ...view, mode: 'read' })}>Read it</button>}
                {view.mode !== 'prev' && prevOf(view.v) && <button onClick={() => setView({ ...view, mode: 'prev' })}>Changes from v{prevOf(view.v)!.n}</button>}
                {view.mode !== 'editor' && <button onClick={() => setView({ ...view, mode: 'editor' })}>Compare with the editor</button>}
                <button onClick={() => restore(view.v)}>Restore to editor</button>
                <button onClick={() => setView(null)}>Close</button>
              </div>
              {view.mode === 'editor' ? <Diff a={view.v.text} b={text} /> : view.mode === 'prev' ? <Diff a={prevOf(view.v)!.text} b={view.v.text} /> : <div className="prose-view">{view.v.text}</div>}
            </div>
          )}
        </div>
        <aside className="card side">
          <div className="tabs">
            {(['versions', 'pages', 'notes', 'out'] as const).map((t) => (
              <button key={t} className={side === t ? 'on' : ''} onClick={() => setSide(t)}>
                {t === 'versions' ? `Versions ${versions.length}` : t === 'pages' ? `Pages ${pages.length}` : t === 'out' ? `Sent ${subs.length}` : 'Notes'}
              </button>
            ))}
          </div>
          {side === 'versions' && (versions.length ? (
            <ol className="versions">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <button className="plain left" onClick={() => setView({ v, mode: 'read' })}>
                    <strong>v{v.n}</strong> {v.note}
                    <span className="muted">{fmtDate(v.createdAt)} · {v.words} words{v.source === 'ocr' ? ' · from pages' : ''}</span>
                  </button>
                  {versions[i + 1] && <button className="link small" onClick={() => setView({ v, mode: 'prev' })}>changes</button>}
                </li>
              ))}
            </ol>
          ) : <p className="muted">No versions yet. Save one when the draft reaches a point worth keeping.</p>)}
          {side === 'pages' && <Photos pages={pages} />}
          {side === 'notes' && (
            <textarea rows={12} placeholder="Notes to self: what this piece is, where it might go." defaultValue={piece.notes} onBlur={(e) => put('pieces', { ...piece, notes: e.target.value, updatedAt: now() })} />
          )}
          {side === 'out' && (subs.length ? (
            <ul className="plain-list">
              {subs.map((s) => (
                <li key={s.id}>
                  {data.journals.find((j) => j.id === s.journalId)?.name ?? 'Unknown'} · {fmtDate(s.submittedAt)} · <Badge tone={s.status === 'accepted' ? 'good' : s.status === 'pending' ? 'warn' : 'plain'}>{s.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Not sent anywhere yet.</p>)}
          <p className="small"><button className="link danger" onClick={async () => { if (confirm(`Delete “${piece.title}”, its versions and photos?`)) { await deletePiece(piece.id); go('drafts'); } }}>Delete this piece</button></p>
        </aside>
      </div>
    </>
  );
}
