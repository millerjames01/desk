import { activity, calendar, localDate, streak, type Kind } from '../activity';
import { daysOut, overdue, totals } from '../publish/publish';
import { SAMPLE_ISSUE } from '../read/sample';
import { countWords } from '../read/text';
import { fmtDay, plural, type Data } from '../lib';
import type { Article } from '../types';

const KIND_LABEL: Record<Kind, string> = { write: 'wrote', read: 'read', send: 'sent' };

export default function Overview({ data }: { data: Data }) {
  const t = localDate(new Date().toISOString());
  const days = activity(data);
  const weeks = calendar(days, t, 16);
  const writeStreak = streak(days, 'write', t);
  const readStreak = streak(days, 'read', t);
  const wroteToday = days.get(t)?.has('write');

  const issue = [...data.issues].filter((i) => i.id !== SAMPLE_ISSUE).sort((a, b) => b.id.localeCompare(a.id))[0];
  const arts = issue ? (issue.order.map((id) => data.articles.find((a) => a.id === id)).filter(Boolean) as Article[]) : [];
  const unread = arts.filter((a) => !a.excluded && !a.readAt);
  const held = arts.filter((a) => a.excluded);

  const active = data.pieces.filter((p) => p.status === 'drafting').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const weekAgo = Date.now() - 7 * 86400000;
  const versionsThisWeek = data.versions.filter((v) => Date.parse(v.createdAt) > weekAgo).length;
  const tot = totals(data.submissions, data.pieces, t);
  const journals = new Map(data.journals.map((j) => [j.id, j]));
  const late = data.submissions.filter((s) => overdue(s, journals.get(s.journalId), t));

  const next: { text: string; href: string }[] = [];
  if (!wroteToday) next.push({ text: active[0] ? `Write: pick up “${active[0].title}”` : 'Write: start something, by hand', href: active[0] ? `#/drafts/${active[0].id}` : '#/drafts/capture' });
  if (issue && held.length) next.push({ text: `Fix ${plural(held.length, 'held-out article')} in ${issue.id}`, href: `#/read/${issue.id}` });
  if (issue && !issue.printedAt && arts.length) next.push({ text: `Typeset and print ${issue.id}`, href: `#/read/${issue.id}` });
  if (unread.length && issue?.printedAt) next.push({ text: `Read: ${unread[0].title}`, href: `#/read/${issue.id}` });
  if (!issue) next.push({ text: 'Start this month’s reading issue', href: '#/read' });
  for (const p of tot.idle.slice(0, 2)) next.push({ text: `Send out “${p.title}”: it’s ready and nowhere`, href: `#/publish/new?piece=${p.id}` });
  for (const s of late.slice(0, 2)) next.push({ text: `Query ${journals.get(s.journalId)?.name}: ${daysOut(s, t)} days on “${data.pieces.find((p) => p.id === s.pieceId)?.title}”`, href: '#/publish' });

  return (
    <>
      <div className="head">
        <p className="crumb">{fmtDay(t)}</p>
        <h1>The desk</h1>
        <p className="lede">
          {writeStreak ? `Writing ${plural(writeStreak, 'day')} running` : 'No writing streak yet'}
          {readStreak ? ` · reading ${plural(readStreak, 'day')}` : ''}
          {wroteToday ? ' · written today' : ''}
        </p>
      </div>

      {next.length > 0 && (
        <div className="card">
          <h3>Next</h3>
          <ul className="next">
            {next.map((n, i) => <li key={i}><a href={n.href}>{n.text}</a></li>)}
          </ul>
        </div>
      )}

      <div className="cards3">
        <a className="card tile" href={issue ? `#/read/${issue.id}` : '#/read'}>
          <h3>Read</h3>
          {issue ? (
            <>
              <p className="big">{arts.length - held.length}</p>
              <p className="muted">articles in {issue.id} · {unread.length} unread{issue.printedAt ? ' · printed' : ''}</p>
            </>
          ) : <p className="muted">No issue yet.</p>}
        </a>
        <a className="card tile" href="#/drafts">
          <h3>Drafts</h3>
          <p className="big">{active.length}</p>
          <p className="muted">
            in progress · {plural(versionsThisWeek, 'version')} this week · {data.pieces.reduce((n, p) => n + countWords(p.working), 0).toLocaleString()} words on the desk
          </p>
        </a>
        <a className="card tile" href="#/publish">
          <h3>Publish</h3>
          <p className="big">{tot.out}</p>
          <p className="muted">out now · {plural(tot.accepted, 'acceptance')} · {late.length ? `${late.length} overdue` : 'none overdue'}</p>
        </a>
      </div>

      <div className="card">
        <h3>Sixteen weeks</h3>
        <div className="calendar" role="img" aria-label="Days with reading, writing or sending">
          {weeks.map((w, i) => (
            <div key={i} className="week">
              {w.map((d) => (
                <span
                  key={d.date}
                  className={`day${d.date > t ? ' future' : ''}${d.date === t ? ' today' : ''}`}
                  title={`${fmtDay(d.date)}${d.kinds.size ? ': ' + [...d.kinds].map((k) => KIND_LABEL[k]).join(', ') : ''}`}
                >
                  {d.kinds.has('write') && <i className="w" />}
                  {d.kinds.has('read') && <i className="r" />}
                  {d.kinds.has('send') && <i className="s" />}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="legend muted small"><i className="w" /> wrote (a version saved or a page captured) <i className="r" /> read (an article ticked) <i className="s" /> sent</p>
        <p className="muted small">Counted from the record itself, never stored, so it can’t drift and can’t be padded.</p>
      </div>
    </>
  );
}
