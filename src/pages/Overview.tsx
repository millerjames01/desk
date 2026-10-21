import { useState } from 'react';
import { activity, calendar, localDate, streak } from '../activity';
import { now, put } from '../db';
import { daysOut, overdue, totals } from '../publish/publish';
import { SAMPLE_ISSUE } from '../read/sample';
import { fmtDay, plural, type Data } from '../lib';
import type { Article } from '../types';

interface Thing {
  key: string;
  verb: string;
  title: string;
  why: string;
  href: string;
  action: string;
  /** Done in place, without leaving the page. */
  done?: { label: string; run: () => Promise<void> };
}

/**
 * Everything worth doing, best first. The page shows only the first one not
 * skipped today. Writing comes first: it is the practice; the rest serves it.
 */
function candidates(data: Data, today: string, wroteToday: boolean): Thing[] {
  const out: Thing[] = [];
  const drafting = data.pieces.filter((p) => p.status === 'drafting').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const issue = [...data.issues].filter((i) => i.id !== SAMPLE_ISSUE).sort((a, b) => b.id.localeCompare(a.id))[0];
  const arts = issue ? (issue.order.map((id) => data.articles.find((a) => a.id === id)).filter(Boolean) as Article[]) : [];
  const unread = arts.filter((a) => !a.excluded && !a.readAt);
  const tot = totals(data.submissions, data.pieces, today);
  const journals = new Map(data.journals.map((j) => [j.id, j]));

  if (!wroteToday) {
    const p = drafting[0];
    out.push(
      p
        ? { key: `write-${p.id}`, verb: 'Write', title: p.title, why: 'Pick it up where you left it. Save a version when you stop.', href: `#/drafts/${p.id}`, action: 'Open the draft' }
        : { key: 'write-new', verb: 'Write', title: 'Something new, by hand', why: 'A page is enough. Photograph it when you’re done.', href: '#/drafts/capture', action: 'Add the pages' },
    );
  }
  if (issue?.printedAt && unread[0]) {
    const a = unread[0];
    out.push({
      key: `read-${a.id}`, verb: 'Read', title: a.title, why: `${a.publication || a.domain}, ${a.read_minutes} minutes, in your printed ${issue.source ? issue.source.edition : issue.id}.`, href: `#/read/${issue.id}`, action: 'Open the issue',
      done: { label: 'I’ve read it', run: () => put('articles', { ...a, readAt: now(), updatedAt: now() }) },
    });
  }
  if (issue && !issue.printedAt && arts.some((a) => !a.excluded)) {
    out.push({ key: `print-${issue.id}`, verb: 'Print', title: issue.source ? `${issue.source.publication} · ${issue.source.edition}` : `Issue ${issue.id}`, why: `${plural(arts.filter((a) => !a.excluded).length, 'article')} ready. Typeset, check, print, staple.`, href: `#/read/${issue.id}`, action: 'Open the issue' });
  }
  for (const p of tot.idle) out.push({ key: `send-${p.id}`, verb: 'Send', title: p.title, why: 'It’s ready and out nowhere.', href: `#/publish/new?piece=${p.id}`, action: 'Choose a journal' });
  for (const s of data.submissions.filter((s) => overdue(s, journals.get(s.journalId), today))) {
    const j = journals.get(s.journalId);
    out.push({ key: `query-${s.id}`, verb: 'Query', title: j?.name ?? 'a journal', why: `“${data.pieces.find((p) => p.id === s.pieceId)?.title}” has been there ${daysOut(s, today)} days, past their usual ${j?.responseDays}.`, href: '#/publish', action: 'See what’s out' });
  }
  if (!issue || issue.printedAt && !unread.length) out.push({ key: 'issue-new', verb: 'Gather', title: 'The next booklet', why: 'Pick a journal and one of its editions; Desk fetches the stories.', href: '#/read', action: 'Choose an edition' });
  if (wroteToday && drafting[0]) out.push({ key: `write-more-${drafting[0].id}`, verb: 'Write', title: drafting[0].title, why: 'You’ve written today. More is never wrong.', href: `#/drafts/${drafting[0].id}`, action: 'Open the draft' });
  return out;
}

const SKIP_KEY = 'desk:skipped';

function loadSkipped(today: string): string[] {
  try {
    const s = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '{}');
    return s.date === today ? s.keys : [];
  } catch {
    return [];
  }
}

export default function Overview({ data }: { data: Data }) {
  const t = localDate(new Date().toISOString());
  const days = activity(data);
  const wroteToday = !!days.get(t)?.has('write');
  const [skipped, setSkipped] = useState(() => loadSkipped(t));
  const all = candidates(data, t, wroteToday);
  const open = all.filter((c) => !skipped.includes(c.key));
  // Skipped everything that's left? Then the skipped come back.
  const thing = open[0] ?? all[0];

  const skip = () => {
    // Skips last for today only; tomorrow everything is back.
    const keys = open.length > 1 ? [...skipped, thing.key] : [];
    // (With one left, skipping starts the round again.)
    setSkipped(keys);
    try {
      localStorage.setItem(SKIP_KEY, JSON.stringify({ date: t, keys }));
    } catch {
      // Private mode: skips just won't survive a reload.
    }
  };

  const written = streak(days, 'write', t);
  const week = calendar(days, t, 1)[0];

  return (
    <div className="focus">
      <p className="crumb">{fmtDay(t)}</p>
      {thing ? (
        <div className="card one">
          <p className="verb">{thing.verb}</p>
          <h1>{thing.title}</h1>
          <p className="muted">{thing.why}</p>
          <div className="actions">
            <a className="button primary big-button" href={thing.href}>{thing.action}</a>
            {thing.done && <button onClick={thing.done.run}>{thing.done.label}</button>}
            {all.length > 1 && <button className="link" onClick={skip}>Something else</button>}
          </div>
        </div>
      ) : (
        <div className="card one">
          <p className="verb">Nothing pressing</p>
          <h1>Read something, or write a line.</h1>
        </div>
      )}
      <div className="quiet">
        <span className="week" aria-label="This week">
          {week.map((d) => (
            <span key={d.date} className={`dot${d.kinds.size ? ' on' : ''}${d.date === t ? ' today' : ''}${d.date > t ? ' future' : ''}`} title={fmtDay(d.date)} />
          ))}
        </span>
        <span className="muted small">{written > 1 ? `Wrote ${written} days running` : wroteToday ? 'Wrote today' : ' '}</span>
      </div>
    </div>
  );
}
