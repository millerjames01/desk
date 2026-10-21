/**
 * Saddle-stitch imposition (brief §4.5): A5 pages, two up on A4 landscape,
 * printed duplex and flipped on the short edge, folded, stapled.
 *
 * Pages are 1-based. Sheet 0 is the outermost (the cover card).
 */

export interface Side {
  sheet: number;
  face: 'front' | 'back';
  left: number;
  right: number;
}

export function padCount(pages: number): number {
  return (4 - (pages % 4)) % 4;
}

export function sides(total: number): Side[] {
  if (total % 4) throw new Error(`Booklet page count must be a multiple of 4, got ${total}`);
  const out: Side[] = [];
  for (let s = 0; s < total / 4; s++) {
    out.push({ sheet: s, face: 'front', left: total - 2 * s, right: 1 + 2 * s });
    out.push({ sheet: s, face: 'back', left: 2 + 2 * s, right: total - 1 - 2 * s });
  }
  return out;
}

export type Layout = 'booklet' | 'fronts' | 'backs' | 'cover' | 'interior';

/**
 * Which sides print, in order:
 * - booklet: every side, for printers that duplex on their own
 * - fronts, then backs: for manual duplex. Backs run in reverse so the
 *   printed stack goes straight back in, flipped
 * - cover / interior: the card sheet alone, or everything inside it, when the
 *   card has to go through a different tray
 */
export function sidesFor(total: number, layout: Layout): Side[] {
  const all = sides(total);
  switch (layout) {
    case 'booklet':
      return all;
    case 'fronts':
      return all.filter((s) => s.face === 'front');
    case 'backs':
      return all.filter((s) => s.face === 'back').reverse();
    case 'cover':
      return all.filter((s) => s.sheet === 0);
    case 'interior':
      return all.filter((s) => s.sheet > 0);
  }
}

/**
 * Creep: in a folded stack the inner sheets push out past the outer ones at
 * the fore-edge, so their text sits further out. Each sheet's pages move
 * toward the spine by `perSheet` mm times its depth. Returns the signed x
 * shift in mm for the left and right page of a side.
 */
export function creep(sheet: number, perSheet: number): { left: number; right: number } {
  const d = sheet * perSheet;
  return { left: d, right: -d };
}

export function sheetCount(total: number): number {
  return Math.ceil(total / 4);
}
