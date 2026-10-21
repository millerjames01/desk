import { useMemo, useState } from 'react';
import { now, put, remove, today, uid } from '../db';
import { Badge, Empty, fmtDate, go, plural, useNotice, type Data } from '../lib';
import { checkSubmission, daysOut, journalStats, overdue, totals } from '../publish/publish';
import type { Journal, Submission, SubmissionStatus } from '../types';

const TABS = [
  ['', 'Out now'],
  ['log', 'Log'],
  ['journals', 'Journals'],
  ['new', 'New submission'],
] as const;

const TONE: Record<SubmissionStatus, 'plain' | 'good' | 'warn' | 'bad'> = { pending: 'warn', accepted: 'good', rejected: 'plain', withdrawn: 'plain' };

export default function Publish({ data, tab = '' }: { data: Data; tab?: string }) {
  const [base, query] = tab.split('?');
  const params = new URLSearchParams(query ?? '');
  const t = today();
  const tot = totals(data.submissions, data.pieces, t);
  return (
    <>
      <div className="head">
        <h1>Publish</h1>
        <p className="lede">
          {plural(tot.out, 'submission')} out · {tot.sentThisYear} sent this year · {plural(tot.accepted, 'acceptance')}
          {tot.idle.length ? ` · ${plural(tot.idle.length, 'ready piece')} with nowhere to be` : ''}
        </p>
      </div>
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <a key={id} className={base === id ? 'on' : ''} href={`#/publish${id ? '/' + id : ''}`}>{label}</a>
        ))}
      </div>
      {base === '' && <OutNow data={data} />}
      {base === 'log' && <Log data={data} />}
      {base === 'journals' && <Journals data={data} />}
      {base === 'new' && <NewSubmission data={data} pieceId={params.get('piece') ?? ''} />}
    </>
  );
}

function useMaps(data: Data) {
  return useMemo(() => ({
    journals: new Map(data.journals.map((j) => [j.id, j])),
    pieces: new Map(data.pieces.map((p) => [p.id, p])),
  }), [data.journals, data.pieces]);
}

function Respond({ s }: { s: Submission }) {
  const [date, setDate] = useState(today());
  const [personal, setPersonal] = useState(false);
  const answer = (status: SubmissionStatus) =>
    put('submissions', { ...s, status, personal: status === 'rejected' && personal, respondedAt: date, updatedAt: now() });
  return (
    <span className="respond">
      <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      <button onClick={() => answer('accepted')}>Accepted</button>
      <button onClick={() => answer('rejected')}>Declined</button>
      <label className="check"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> personal note</label>
      <button onClick={() => answer('withdrawn')}>Withdrawn</button>
    </span>
  );
}

const withdraw = (s: Submission) =>
  put('submissions', { ...s, status: 'withdrawn', respondedAt: today(), notes: `${s.notes} Withdrawn: accepted elsewhere.`.trim(), updatedAt: now() });

function OutNow({ data }: { data: Data }) {
  const { journals, pieces } = useMaps(data);
  const t = today();
  const out = data.submissions.filter((s) => s.status === 'pending').sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const [open, setOpen] = useState<string | null>(null);
  const tot = totals(data.submissions, data.pieces, t);
  // Pieces already accepted somewhere: anything else still out for them should be withdrawn.
  const taken = new Set(data.submissions.filter((s) => s.status === 'accepted').map((s) => s.pieceId));
  return (
    <>
      <div className="card">
        {out.length ? (
          <div className="list">
            {out.map((s) => {
              const j = journals.get(s.journalId);
              const late = overdue(s, j, t);
              return (
                <div key={s.id} className="row column">
                  <div className="row-line">
                    <span className="grow">
                      <strong>{pieces.get(s.pieceId)?.title ?? 'Unknown piece'}</strong>
                      <span className="muted"> at {j?.name ?? 'unknown'} · sent {fmtDate(s.submittedAt)} · {daysOut(s, t)} days{j?.responseDays ? ` of a usual ${j.responseDays}` : ''}</span>
                    </span>
                    {taken.has(s.pieceId) && (
                      <>
                        <Badge tone="good">accepted elsewhere</Badge>
                        <button onClick={() => withdraw(s)}>Withdrawn</button>
                      </>
                    )}
                    {late && !taken.has(s.pieceId) && <Badge tone="bad">overdue — a polite query is fair</Badge>}
                    <button onClick={() => setOpen(open === s.id ? null : s.id)}>Heard back</button>
                  </div>
                  {taken.has(s.pieceId) && <p className="muted small">Write to {j?.name ?? 'them'} to withdraw it, then mark it withdrawn.</p>}
                  {open === s.id && <Respond s={s} />}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>Nothing out. <a href="#/publish/new">Send something.</a></Empty>
        )}
      </div>
      {tot.idle.length > 0 && (
        <div className="card">
          <h3>Ready, and not out anywhere</h3>
          <ul className="plain-list">
            {tot.idle.map((p) => <li key={p.id}><a href={`#/drafts/${p.id}`}>{p.title}</a> · <a href={`#/publish/new?piece=${p.id}`}>submit</a></li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function Log({ data }: { data: Data }) {
  const { journals, pieces } = useMaps(data);
  const [status, setStatus] = useState<SubmissionStatus | 'all'>('all');
  const rows = data.submissions.filter((s) => status === 'all' || s.status === status).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return (
    <div className="card">
      <div className="tabs small">
        {(['all', 'pending', 'accepted', 'rejected', 'withdrawn'] as const).map((s) => (
          <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {rows.length ? (
        <table className="table">
          <thead><tr><th>Sent</th><th>Piece</th><th>Journal</th><th>Status</th><th>Answered</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.submittedAt)}</td>
                <td><a href={`#/drafts/${s.pieceId}`}>{pieces.get(s.pieceId)?.title ?? '—'}</a></td>
                <td>{journals.get(s.journalId)?.name ?? '—'}</td>
                <td><Badge tone={TONE[s.status]}>{s.status}{s.personal ? ', personal' : ''}</Badge></td>
                <td>{s.respondedAt ? `${fmtDate(s.respondedAt)} (${daysOut(s, today())} d)` : ''}</td>
                <td><button className="link danger small" onClick={() => confirm('Delete this record?') && remove('submissions', s.id)}>delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No submissions {status === 'all' ? 'yet' : `marked ${status}`}.</Empty>
      )}
    </div>
  );
}

const BLANK_JOURNAL = { name: '', url: '', simultaneous: true, responseDays: '' as number | '', fee: '', notes: '' };

function JournalForm({ initial, onDone }: { initial?: Journal; onDone: (j: Journal) => void }) {
  const [f, setF] = useState(initial ? { ...initial, responseDays: initial.responseDays ?? ('' as const) } : BLANK_JOURNAL);
  const save = async () => {
    const j: Journal = {
      id: initial?.id ?? uid('journal'),
      name: f.name.trim(),
      url: f.url.trim(),
      simultaneous: f.simultaneous,
      responseDays: f.responseDays === '' ? undefined : Number(f.responseDays),
      fee: f.fee,
      notes: f.notes,
      createdAt: initial?.createdAt ?? now(),
      updatedAt: now(),
    };
    await put('journals', j);
    onDone(j);
  };
  return (
    <div className="stack">
      <div className="grid2">
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Website or submissions page<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <label>Usual response, days<input type="number" min={0} value={f.responseDays} onChange={(e) => setF({ ...f, responseDays: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
        <label>Fee<input value={f.fee} placeholder="free, $3…" onChange={(e) => setF({ ...f, fee: e.target.value })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.simultaneous} onChange={(e) => setF({ ...f, simultaneous: e.target.checked })} /> Accepts simultaneous submissions</label>
      <label>Notes<textarea rows={2} value={f.notes} placeholder="Reading periods, what they like, editors’ names" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div><button className="primary" disabled={!f.name.trim()} onClick={save}>{initial ? 'Save journal' : 'Add journal'}</button></div>
    </div>
  );
}

function Journals({ data }: { data: Data }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const list = [...data.journals].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="card">
      <div className="actions"><button className="primary" onClick={() => setEditing('new')}>Add a journal</button></div>
      {editing === 'new' && <JournalForm onDone={() => setEditing(null)} />}
      {list.length ? (
        <div className="list">
          {list.map((j) => {
            const st = journalStats(j.id, data.submissions);
            return (
              <div key={j.id} className="row column">
                <div className="row-line">
                  <span className="grow">
                    <strong>{j.url ? <a href={j.url} target="_blank" rel="noreferrer">{j.name}</a> : j.name}</strong>
                    <span className="muted">
                      {' '}· {j.simultaneous ? 'simultaneous OK' : 'exclusive'}{j.responseDays ? ` · usually ${j.responseDays} days` : ''}{j.fee ? ` · ${j.fee}` : ''}
                    </span>
                    <span className="muted small">
                      {st.sent ? `Sent ${st.sent} · ${st.pending} out · ${st.accepted} accepted · ${st.rejected} declined${st.personal ? ` (${st.personal} personal)` : ''}${st.medianDays !== undefined ? ` · answers in ${st.medianDays} days, median` : ''}` : 'Nothing sent yet.'}
                    </span>
                  </span>
                  <button onClick={() => setEditing(editing === j.id ? null : j.id)}>Edit</button>
                </div>
                {editing === j.id && <JournalForm initial={j} onDone={() => setEditing(null)} />}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>No journals yet. Add the places you mean to send to.</Empty>
      )}
    </div>
  );
}

function NewSubmission({ data, pieceId }: { data: Data; pieceId: string }) {
  const [piece, setPiece] = useState(pieceId);
  const [journal, setJournal] = useState('');
  const [version, setVersion] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, show] = useNotice();
  const { journals } = useMaps(data);
  const pieces = data.pieces.filter((p) => p.status !== 'retired' || p.id === piece).sort((a, b) => a.title.localeCompare(b.title));
  const versions = data.versions.filter((v) => v.pieceId === piece).sort((a, b) => b.n - a.n);
  const warnings = piece && journal ? checkSubmission(piece, journal, data.submissions, journals) : [];
  const blocked = warnings.some((w) => w.level === 'block');

  const save = async () => {
    const s: Submission = {
      id: uid('sub'), pieceId: piece, journalId: journal, versionId: version || versions[0]?.id, submittedAt: date,
      status: 'pending', personal: false, notes, createdAt: now(), updatedAt: now(),
    };
    await put('submissions', s);
    const p = data.pieces.find((x) => x.id === piece);
    if (p && p.status === 'drafting') await put('pieces', { ...p, status: 'ready', updatedAt: now() });
    show('Logged. Good luck.');
    go('publish');
  };

  return (
    <div className="card stack">
      <label>
        Piece
        <select value={piece} onChange={(e) => { setPiece(e.target.value); setVersion(''); }}>
          <option value="">Choose a piece…</option>
          {pieces.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.status})</option>)}
        </select>
      </label>
      {versions.length > 0 && (
        <label>
          Version sent
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {versions.map((v, i) => <option key={v.id} value={i === 0 ? '' : v.id}>v{v.n} · {fmtDate(v.createdAt)} · {v.note}{i === 0 ? ' (latest)' : ''}</option>)}
          </select>
        </label>
      )}
      <label>
        Journal
        <span className="field-row">
          <select value={journal} onChange={(e) => setJournal(e.target.value)}>
            <option value="">Choose a journal…</option>
            {[...data.journals].sort((a, b) => a.name.localeCompare(b.name)).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <button onClick={() => setAdding(!adding)}>New journal</button>
        </span>
      </label>
      {adding && <JournalForm onDone={(j) => { setJournal(j.id); setAdding(false); }} />}
      <label>Sent on<input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Notes<input value={notes} placeholder="Submittable, by email, cover letter tweaks…" onChange={(e) => setNotes(e.target.value)} /></label>
      {warnings.map((w, i) => <p key={i} className={`notice ${w.level === 'block' ? 'bad' : 'warn'}`}>{w.message}</p>)}
      <div><button className="primary" disabled={!piece || !journal || blocked} onClick={save}>Log submission</button></div>
      {notice}
    </div>
  );
}
