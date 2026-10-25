import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../db';
import { Badge, go, plural, useNotice, type Data } from '../lib';
import { addFromHtml, createIssue } from '../read/articles';
import { nextIssueId } from '../read/issue';
import { loadProfiles, saveProfiles } from '../read/profiles';
import { SAMPLE_ISSUE } from '../read/sample';
import { DEFAULT_PROFILES, extractWithProfile, monthEditions, profileFor, profileReport, type Edition, type SiteProfile, type StoryLink } from '../read/sites';
import { bestTransport, detectExtension, extensionTransport } from '../read/transport';
import { createEditionIssue, currentWalk, listEditions, listStories, onWalk, remaining, startWalk, stopWalk, type WalkProgress } from '../read/walk';

const BASE = import.meta.env.BASE_URL;

export function useExtension(): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    detectExtension().then(setV);
  }, []);
  return v;
}

export function ExtensionStatus({ version }: { version: string | null | undefined }) {
  if (version === undefined) return null;
  return version ? (
    <p className="muted small"><Badge tone="good">Desk Reader {version}</Badge> fetches from your browser: robots.txt obeyed, one request every 3 seconds per site.</p>
  ) : (
    <p className="muted small">
      <Badge tone="warn">no extension</Badge> Using public proxies, which often fail. <a href={`${BASE}desk-reader.zip`}>Get the Desk Reader extension</a>: unzip it, open <code>chrome://extensions</code>, turn on Developer mode, Load unpacked, pick the folder. Then reload Desk.
    </p>
  );
}

/**
 * The main way to start an issue: one journal, one or more of its editions,
 * all their stories. With "fill", Desk adds earlier editions until the
 * booklet reaches about the page target.
 */
export function EditionBuilder({ data }: { data: Data }) {
  const ext = useExtension();
  const target = data.settings.book.target_pages;
  const [profiles, setProfiles] = useState<SiteProfile[]>(DEFAULT_PROFILES);
  const [domain, setDomain] = useState(DEFAULT_PROFILES[0].domain);
  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [selected, setSelected] = useState<Edition[]>([]);
  const [pasted, setPasted] = useState('');
  const [stories, setStories] = useState<(StoryLink & { on: boolean })[] | null>(null);
  const [fill, setFill] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, show] = useNotice();
  useEffect(() => {
    loadProfiles().then(setProfiles);
  }, [data]);
  const p = profiles.find((x) => x.domain === domain);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      show((e as Error).message, 'bad');
    } finally {
      setBusy('');
    }
  };
  const reset = () => { setEditions(null); setStories(null); setSelected([]); };

  const findEditions = () => p && run('Reading the list of editions…', async () => {
    setEditions(await listEditions(p, await bestTransport(data.settings.proxies)));
    setSelected([]);
    setStories(null);
  });

  const toggle = (e: Edition) => setSelected((cur) => (cur.some((x) => x.url === e.url) ? cur.filter((x) => x.url !== e.url) : [...cur, e]));

  const findStories = (chosen: Edition[], labelFromPage = false) => p && run(`Finding the stories in ${chosen.map((e) => e.label).join(', ')}… (a few seconds per page)`, async () => {
    const t = await bestTransport(data.settings.proxies);
    const found: (StoryLink & { on: boolean })[] = [];
    const named: Edition[] = [];
    for (const e of chosen) {
      const { stories: list, title } = await listStories(p, e, t);
      const ed = labelFromPage && title ? { ...e, label: title } : e;
      named.push(ed);
      found.push(...list.map((x) => ({ ...x, edition: ed.label, on: true })));
    }
    setSelected(named);
    if (!found.length) show('No stories found. Check the edition, or the site profile under Sites.', 'bad');
    setStories(found);
  });

  /** Editions older than the oldest one chosen, nearest first: what "fill" draws on. */
  const candidates = (): Edition[] => {
    if (!p) return [];
    const list = editions ?? (selected[0]?.month ? monthEditions(p, new Date(`${selected[0].month}-15T12:00:00`), 13) : []);
    const idx = Math.max(...selected.map((s) => list.findIndex((x) => x.url === s.url)));
    return idx < 0 ? [] : list.slice(idx + 1, idx + 7);
  };

  const make = async () => {
    if (!p || !selected.length || !stories) return;
    const chosen = stories.filter((s) => s.on);
    const more = fill ? candidates() : [];
    const issue = await createEditionIssue(p, selected, chosen, { listOrder: editions ?? selected, fill: more.length ? { target, candidates: more } : undefined });
    go(`read/${issue.id}`);
    startWalk(issue.id, data.settings, await bestTransport(data.settings.proxies));
  };

  const chosen = stories?.filter((s) => s.on).length ?? 0;
  const groups = selected.map((e) => ({ e, items: (stories ?? []).map((s, i) => ({ s, i })).filter(({ s }) => s.edition === e.label) }));
  return (
    <div className="card stack">
      <h3>From an edition</h3>
      <p className="muted small">Choose a journal and one or more of its issues or months. Desk finds every story and fetches them, slowly, into a booklet of that journal.</p>
      <ExtensionStatus version={ext} />
      <div className="field-row">
        <select value={domain} onChange={(e) => { setDomain(e.target.value); reset(); }}>
          {profiles.map((x) => <option key={x.domain} value={x.domain}>{x.name}{x.status === 'unverified' ? ' (check on first use)' : ''}</option>)}
        </select>
        <button className="primary" disabled={!!busy} onClick={findEditions}>{p?.edition.kind === 'month' ? 'Months' : 'Issues'}</button>
      </div>
      {p?.notes && <p className="muted small">{p.notes}</p>}
      <div className="field-row">
        <input placeholder="…or paste an edition’s address (an issue page or archive)" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <button disabled={!!busy || !/^https?:\/\//.test(pasted)} onClick={() => {
          const prof = profileFor(pasted, profiles);
          if (!prof) return show('No site profile for that address. Add one under Sites, or capture its stories one by one.', 'bad');
          setDomain(prof.domain);
          setEditions(null);
          const m = pasted.match(/\/(\d{4})\/(\d{2})\/?$/);
          const e: Edition = m
            ? { label: monthEditions(prof, new Date(`${m[1]}-${m[2]}-15T12:00:00`), 1)[0].label, url: pasted, month: `${m[1]}-${m[2]}` }
            : { label: decodeURIComponent(new URL(pasted).pathname.replace(/\/$/, '').split('/').pop() ?? pasted).replace(/-/g, ' '), url: pasted };
          findStories([e], !m);
        }}>Use it</button>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {notice}
      {editions && !stories && (
        <>
          <div className="editions">
            {editions.slice(0, 24).map((e) => (
              <button key={e.url} className={selected.some((x) => x.url === e.url) ? 'on' : ''} disabled={!!busy} aria-pressed={selected.some((x) => x.url === e.url)} onClick={() => toggle(e)}>{e.label}</button>
            ))}
            {!editions.length && <p className="muted">No editions found on the index page.</p>}
          </div>
          <div className="actions">
            <button className="primary" disabled={!!busy || !selected.length} onClick={() => findStories(selected)}>Find the stories</button>
            <span className="muted small">{selected.length ? `${plural(selected.length, 'edition')} chosen.` : 'Choose one edition, or several to bind together.'}</span>
          </div>
        </>
      )}
      {stories && selected.length > 0 && (
        <div className="stack">
          <p>
            <strong>{p?.name} · {selected.map((e) => e.label).join(', ')}</strong> <span className="muted">· {plural(stories.length, 'story', 'stories')} found</span>{' '}
            <button className="link" onClick={() => setStories(null)}>other editions</button>
          </p>
          {groups.map(({ e, items }) => (
            <div key={e.url}>
              {groups.length > 1 && <p className="eyebrow-small">{e.label}</p>}
              <ul className="checklist">
                {items.map(({ s, i }) => (
                  <li key={s.url}>
                    <label className="check">
                      <input type="checkbox" checked={s.on} onChange={(ev) => setStories(stories.map((x, j) => (j === i ? { ...x, on: ev.target.checked } : x)))} />
                      {s.label}{s.date ? <span className="muted small"> · {s.date}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <label className="check">
            <input type="checkbox" checked={fill} disabled={!candidates().length} onChange={(e) => setFill(e.target.checked)} />
            Add earlier editions until the booklet reaches about {target} pages
          </label>
          <div className="actions">
            <button className="primary" disabled={!chosen} onClick={make}>Make the booklet</button>
            <span className="muted small">{chosen} stories to start, a few seconds each. You can leave this page.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function useWalk(issueId: string): WalkProgress | null {
  const [p, setP] = useState<WalkProgress | null>(() => (currentWalk()?.issueId === issueId ? currentWalk()!.progress : null));
  useEffect(() => onWalk((id, prog) => id === issueId && setP(prog)), [issueId]);
  return p;
}

/** On an issue made from an edition: the walk's progress, or a resume button. */
export function WalkPanel({ issueId, data }: { issueId: string; data: Data }) {
  const progress = useWalk(issueId);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    remaining(issueId).then((r) => setLeft(r.length));
  }, [issueId, progress, data]);
  if (progress) {
    return (
      <div className="card walk">
        <p>
          <strong>Fetching the edition</strong> · {progress.done} of {progress.total}
          {progress.current ? <> · <span className="muted">{progress.current}</span></> : null}
        </p>
        <progress value={progress.done} max={progress.total || 1} />
        <p className="muted small">One story every few seconds, so the site isn’t troubled. You can use the rest of Desk meanwhile. {progress.failed.length ? `${progress.failed.length} failed so far.` : ''}</p>
        <button onClick={stopWalk}>Pause</button>
      </div>
    );
  }
  if (!left) return null;
  return (
    <div className="card walk">
      <p><strong>{plural(left, 'story', 'stories')} still to fetch</strong> from this edition.</p>
      <button className="primary" onClick={async () => startWalk(issueId, data.settings, await bestTransport(data.settings.proxies))}>Carry on</button>
    </div>
  );
}

/** Captures sent by the Desk Reader button, from any tab. */
export function CaptureListener({ data, onNotice }: { data: Data; onNotice: (msg: string, tone?: 'good' | 'bad') => void }) {
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'desk-ext' || e.data.type !== 'capture') return;
      const c = e.data.capture as { url: string; title: string; html: string };
      try {
        const host = new URL(c.url).hostname;
        const open = data.issues.filter((i) => i.id !== SAMPLE_ISSUE && !i.printedAt).sort((a, b) => b.id.localeCompare(a.id));
        // An unprinted issue of the same journal first, then the newest open issue, then a new one.
        const issue = open.find((i) => i.source && host.endsWith(i.source.domain)) ?? open.find((i) => !i.source) ?? (await createIssue(nextIssueId(data.issues)));
        const r = await addFromHtml({ issueId: issue.id, url: c.url, html: c.html, via: 'extension', settings: data.settings, transport: extensionTransport });
        if (r.notes.length) await kvSet(`notes:${issue.id}`, [...((await kvGet<string[]>(`notes:${issue.id}`)) ?? []), ...r.notes]);
        onNotice(`Added “${r.article.title}” to ${issue.id}${r.article.excluded ? ', held out to check' : ''}.`, r.article.excluded ? 'bad' : 'good');
      } catch (err) {
        onNotice(`Capture failed: ${(err as Error).message}`, 'bad');
      }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [data]);
  return null;
}

/** Read → Sites: the profiles, editable as JSON, with a tester. */
export function Sites({ data }: { data: Data }) {
  const [profiles, setProfiles] = useState<SiteProfile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [testUrl, setTestUrl] = useState('');
  const [result, setResult] = useState('');
  const [notice, show] = useNotice();
  useEffect(() => {
    loadProfiles().then(setProfiles);
  }, []);
  if (!profiles) return null;

  const edit = (p: SiteProfile) => {
    setOpen(p.domain);
    setDraft(JSON.stringify(p, null, 2));
    setResult('');
  };
  const save = async () => {
    try {
      const p = JSON.parse(draft) as SiteProfile;
      if (!p.domain || !p.name || !p.storyPath || !p.story?.body) throw new Error('A profile needs domain, name, storyPath and story.body.');
      const next = [...profiles.filter((x) => x.domain !== open && x.domain !== p.domain), p];
      await saveProfiles(next);
      setProfiles(next);
      setOpen(p.domain);
      show('Saved.');
    } catch (e) {
      show((e as Error).message, 'bad');
    }
  };
  const reset = async (domain: string) => {
    const def = DEFAULT_PROFILES.find((d) => d.domain === domain);
    const next = def ? profiles.map((x) => (x.domain === domain ? def : x)) : profiles.filter((x) => x.domain !== domain);
    await saveProfiles(next);
    setProfiles(next);
    setOpen(null);
  };
  const test = async () => {
    try {
      const p = JSON.parse(draft) as SiteProfile;
      const html = await (await bestTransport(data.settings.proxies)).fetchText(testUrl);
      const misses = profileReport(html, testUrl, p);
      const r = extractWithProfile(html, testUrl, p, { maxImages: 3 });
      setResult(
        [
          misses.length ? `Selectors that matched nothing: ${misses.join(', ')}` : 'Every selector matched.',
          r ? `Title: ${r.title}\nAuthor: ${r.author}\nDate: ${r.published}\nWords: ${r.words}\nFlags: ${r.flags.map((f) => f.detail).join(' ') || 'none'}\n\nStarts: ${r.markdown.slice(0, 200)}…\n\nEnds: …${r.markdown.slice(-200)}` : 'No body found.',
        ].join('\n\n'),
      );
    } catch (e) {
      setResult((e as Error).message);
    }
  };
  const blank: SiteProfile = { domain: 'example.org', name: 'Example Review', status: 'unverified', edition: { kind: 'issue', index: 'https://example.org/issues/', editionPath: '^/issue-\\d+/?$' }, storyPath: '^/stories/[^/]+/?$', story: { title: 'h1', body: { select: '.entry-content' } } };

  return (
    <>
      <div className="head">
        <p className="crumb"><a href="#/read">Read</a></p>
        <h1>Sites</h1>
        <p className="lede">How Desk finds a journal’s editions and reads its story pages. When a site redesigns, fix the selectors here; test them on a story first.</p>
        <div className="actions"><button onClick={() => edit(blank)}>Add a site</button></div>
      </div>
      <div className="card">
        {profiles.map((p) => (
          <div key={p.domain} className="skin">
            <div className="row-line">
              <span className="grow"><strong>{p.name}</strong> <span className="muted small">{p.domain} · editions by {p.edition.kind}</span></span>
              <Badge tone={p.status === 'checked' ? 'good' : 'warn'}>{p.status}</Badge>
              <button onClick={() => (open === p.domain ? setOpen(null) : edit(p))}>{open === p.domain ? 'Close' : 'Edit'}</button>
            </div>
            {open === p.domain && <ProfileEditor {...{ draft, setDraft, save, test, testUrl, setTestUrl, result, notice }} onReset={() => reset(p.domain)} />}
          </div>
        ))}
        {open && !profiles.some((p) => p.domain === open) && <ProfileEditor {...{ draft, setDraft, save, test, testUrl, setTestUrl, result, notice }} onReset={() => setOpen(null)} />}
      </div>
    </>
  );
}

function ProfileEditor(props: { draft: string; setDraft: (s: string) => void; save: () => void; test: () => void; testUrl: string; setTestUrl: (s: string) => void; result: string; notice: React.ReactNode; onReset: () => void }) {
  return (
    <div className="stack">
      <textarea className="mono" rows={18} value={props.draft} onChange={(e) => props.setDraft(e.target.value)} />
      <div className="actions">
        <button className="primary" onClick={props.save}>Save</button>
        <button onClick={props.onReset}>Reset</button>
      </div>
      {props.notice}
      <div className="field-row">
        <input placeholder="A story URL to test these rules on" value={props.testUrl} onChange={(e) => props.setTestUrl(e.target.value)} />
        <button disabled={!/^https?:/.test(props.testUrl)} onClick={props.test}>Test</button>
      </div>
      {props.result && <pre className="test-result">{props.result}</pre>}
    </div>
  );
}
