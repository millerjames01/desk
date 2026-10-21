/** report.md for an issue (brief §1): QA results and anything that needs a hand. */

import type { Article, Issue } from '../types';
import type { QaReport } from './qa';

const FLAG_LABEL: Record<string, string> = {
  thin: 'Thin',
  'low-ratio': 'Less than half the page',
  paywall: 'Paywall wording',
  'mid-sentence': 'Ends mid-sentence',
  'link-heavy': 'Mostly links',
  duplicates: 'Repeated paragraphs',
  'no-body': 'No body',
  trimmed: 'Bio trimmed',
  'profile-miss': 'Site profile missed',
};

export function flagLabel(code: string): string {
  return FLAG_LABEL[code] ?? code;
}

export function reportMarkdown(issue: Issue, articles: Article[], qa: QaReport | undefined, notes: string[], printer: string): string {
  const inIssue = issue.order.map((id) => articles.find((a) => a.id === id)).filter((a): a is Article => !!a);
  const held = inIssue.filter((a) => a.excluded);
  const lines: string[] = [`# ${issue.id} report`, ''];
  lines.push(qa ? `Checked ${new Date(qa.at).toLocaleString()}: ${qa.pages} pages, ${qa.pages / 4} sheets. ${qa.ok ? 'No hard errors.' : 'Hard errors: do not print yet.'}` : 'Not typeset yet.', '');

  lines.push('## Articles', '');
  for (const a of inIssue) {
    lines.push(`- ${a.excluded ? '~~' : ''}${a.title}${a.excluded ? '~~ (held out)' : ''}. ${a.publication || a.domain}, ${a.words} words, via ${a.via}.`);
    for (const f of a.flags) lines.push(`  - ${flagLabel(f.code)}: ${f.detail}`);
  }
  lines.push('');

  if (held.length) {
    lines.push('## Needs manual paste', '');
    for (const a of held) lines.push(`- ${a.title}: ${a.url}`);
    lines.push('');
  }

  if (qa?.items.length) {
    for (const [level, title] of [['error', 'Errors'], ['warn', 'Warnings'], ['note', 'Notes']] as const) {
      const items = qa.items.filter((i) => i.level === level);
      if (!items.length) continue;
      lines.push(`## ${title}`, '');
      for (const i of items) lines.push(`- ${i.page ? `p. ${i.page}` : ''}${i.page && i.article ? ', ' : ''}${i.article ?? ''}${i.page || i.article ? ': ' : ''}${i.message}`);
      lines.push('');
    }
  }

  if (notes.length) {
    lines.push('## While adding articles', '');
    for (const n of notes) lines.push(`- ${n}`);
    lines.push('');
  }

  lines.push('## Printing', '');
  lines.push(`Printer: ${printer || 'TBD'}. Cover card about 160–185 g; check the printer's maximum weight.`);
  lines.push('Interior on 90 g uncoated. Booklet: A4 landscape, two-sided, flip on the short edge, scale 100%, no margins. Two staples through the fold.');
  return lines.join('\n') + '\n';
}
