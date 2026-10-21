/**
 * A sample issue for trying the house styles before anything is fetched
 * (brief §11, milestone 1). The prose is placeholder writing for Desk, not
 * taken from any publication.
 */

import { get, kvGet, now, put, today } from '../db';
import type { Article, Issue } from '../types';
import { countWords, readMinutes } from './text';

export const SAMPLE_ISSUE = 'sample';

const HEDGEROW = `In late autumn, when the leaves have gone and the structure of a field boundary is visible again, you can read a hedge like a ledger. Hawthorn for the stock-proofing, hazel for poles, a single oak left standing because someone, two centuries ago, decided it should be.

For most of the last century the ledger was being torn out. Larger machines wanted larger fields, and the boundaries that slowed them were grubbed up by the mile. What was lost was not only shelter for birds but a way of dividing land that kept water, soil and wildlife moving at walking pace.

The reversal has been quiet. It happens in winter, with spades and spiral guards, on the margins of farms that would never describe themselves as conservation projects. A grant covers the whips; a neighbour lends a tractor with a post-knocker; a weekend becomes three.

## The art of laying

Planting is the easy part. A young hedge needs years of cutting back before it thickens at the base, and the temptation is always to let it run upward into a line of thin trees that keeps nothing in and shelters nothing below.

The old answer is laying: cutting each stem most of the way through near the ground, bending it over, and weaving it between stakes. The partly severed stems keep growing, now sideways, and the hedge becomes dense from the soil up.[^1]

![A laid hedge](desk-image:sample-hedge "A laid hedge in its first spring, pleachers still visible.")

Done well, it lasts for decades. Done badly, it is obvious within a season, which may be why the craft has survived in competitions long after it vanished from ordinary farm work. The judges walk the length of each competitor's chain with their hands behind their backs, looking for gaps, for stakes driven at the wrong angle, for a pleacher cut so deep it will not take.

There are regional styles, and people argue about them. Midland hedges are built to hold cattle, with the brush all leaning to one side; Welsh hedges are laid double, brush out on both faces; in the south they are lower and neater, for sheep. A layer can usually tell where another learned by looking at a hundred yards of work.

## What the birds know

Ornithologists talk about hedges in terms of structure rather than species. What matters to a nesting yellowhammer is not whether a hedge is hawthorn or blackthorn but whether it is thick at the bottom, whether it has a margin of rough grass, whether it is cut every year or every third year.

> A hedge cut every autumn into a neat box is a hedge that never flowers, and a hedge that never flowers never fruits.

The rotation matters more than any single cut. A farm that trims a third of its hedges each winter always has some in flower and some in berry, and the birds move between them through the year.

None of this is new. Most of it was written down in the eighteenth century by people who managed land for a living and had no word for biodiversity. The novelty is only in doing it again, deliberately, on farms where the habit had been lost for two generations.

## A slower ledger

There is no money in hedges, or not much. The grants cover materials and some labour, and a well-kept hedge saves on fencing over the long run. But the people doing the work rarely talk about payback. They talk about the view from the kitchen window, about the first year the hedge was thick enough that the dog could not get through, about a barn owl seen hunting along a line that used to be bare wire.

It is slow work, measured in winters. A hedge planted this year will not be laid for eight or ten, and will not look like much for longer than that. Whoever plants it is writing an entry in the ledger for someone else to read.

[^1]: The partly cut stems are called pleachers. The cut is made at a shallow angle so that rain runs off the wound.`;

const INDEX_CARD = `The index card began as a library tool and ended up as a way of thinking. Its size was fixed early, at three inches by five, and almost everything about how it was used followed from that constraint: one idea to a card, written small, filed by subject.

What makes a card system different from a notebook is that the order is never final. A notebook records thoughts in the sequence they occurred; a box of cards can be shuffled, sorted, split into piles on the floor. The arrangement is a draft that can always be revised.

## One thing to a card

The rule that each card holds a single note sounds trivial and is not. It forces a decision about what the note is. A paragraph copied from a book becomes a quotation with a source; a passing thought becomes a claim that has to stand on its own when it turns up again years later between two cards it was never written to sit beside.

Writers who kept cards often describe the system as a conversation partner. They would go looking for one note and find three others filed nearby, and the juxtaposition would suggest something none of the cards said alone.

* * *

The digital versions of the card box are faster and more forgiving. Links replace filing, search replaces memory, and nothing ever has to be thrown away. Whether that is an improvement depends on what the cards were for. If they were a store of facts, the software wins easily. If they were a way of being made to choose, the cramped little rectangle may still have something to teach.`;

function sampleImage(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1400;
  c.height = 860;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#d9d9d9');
  grad.addColorStop(1, '#8c8c8c');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = 9;
  for (let x = -200; x < c.width + 200; x += 70) {
    g.beginPath();
    g.moveTo(x, c.height);
    g.bezierCurveTo(x + 60, c.height * 0.6, x + 180, c.height * 0.5, x + 320, c.height * 0.42);
    g.stroke();
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
}

function article(id: string, fields: Partial<Article> & { markdown: string }): Article {
  const words = countWords(fields.markdown);
  return {
    id,
    issueId: SAMPLE_ISSUE,
    title: '',
    dek: '',
    author: '',
    publication: '',
    domain: '',
    url: '',
    published: '',
    fetched: today(),
    words,
    read_minutes: readMinutes(words),
    section: '',
    images: [],
    flags: [],
    via: 'paste',
    excluded: false,
    createdAt: now(),
    updatedAt: now(),
    ...fields,
  };
}

/** Writes the sample issue (once) and returns its id. */
export async function installSample(): Promise<string> {
  if ((await get('issues', SAMPLE_ISSUE)) && (await kvGet('sample:v'))) return SAMPLE_ISSUE;
  await put('blobs', { id: 'sample-hedge', kind: 'image', blob: await sampleImage(), width: 1400, height: 860, createdAt: now() });
  const a = article('sample-hedgerow', {
    title: 'The Slow Return of the Hedgerow',
    dek: 'After decades of removal, farmers are replanting the tangled field boundaries that once stitched the countryside together.',
    author: 'A. Sample',
    publication: 'Desk Sample',
    domain: 'sample.desk',
    url: 'https://example.org/hedgerow',
    published: '2026-10-12',
    section: 'Nature',
    images: ['sample-hedge'],
    markdown: HEDGEROW,
  });
  const b = article('sample-index-card', {
    title: 'A Short History of the Index Card',
    dek: 'Three inches by five, one idea to a card, and a habit of thought that outlived the library catalogue.',
    author: 'B. Sample',
    publication: 'Second Sample',
    domain: 'second.sample',
    url: 'https://example.org/index-card',
    published: '2026-09-30',
    section: 'Tools',
    markdown: INDEX_CARD,
  });
  await put('articles', a);
  await put('articles', b);
  const issue: Issue = { id: SAMPLE_ISSUE, order: [a.id, b.id], coverColour: '', subtitle: 'two essays for the autumn', createdAt: now(), updatedAt: now() };
  await put('issues', issue);
  await put('kv', { key: 'sample:v', value: 1 });
  return SAMPLE_ISSUE;
}
