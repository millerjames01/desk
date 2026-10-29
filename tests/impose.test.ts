import { describe, expect, it } from 'vitest';
import { creep, padCount, sides, sidesFor } from '../src/read/impose';

describe('imposition', () => {
  it('pads to a multiple of 4', () => {
    expect([5, 6, 7, 8, 9].map(padCount)).toEqual([3, 2, 1, 0, 3]);
  });

  it('lays out an 8-page booklet so it reads in order when folded', () => {
    expect(sides(8).map((s) => [s.left, s.right])).toEqual([
      [8, 1], [2, 7],
      [6, 3], [4, 5],
    ]);
  });

  it('every page appears exactly once, and each sheet folds to consecutive spreads', () => {
    for (const n of [4, 8, 12, 24, 40]) {
      const all = sides(n).flatMap((s) => [s.left, s.right]).sort((a, b) => a - b);
      expect(all).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const s of sides(n)) expect(s.left + s.right).toBe(n + 1);
    }
  });

  it('manual duplex: fronts in order, backs reversed', () => {
    expect(sidesFor(8, 'fronts').map((s) => s.sheet)).toEqual([0, 1]);
    expect(sidesFor(8, 'backs').map((s) => [s.sheet, s.left])).toEqual([[1, 4], [0, 2]]);
  });

  it('cover card is sheet 0; interior is the rest', () => {
    expect(sidesFor(12, 'cover').map((s) => [s.left, s.right])).toEqual([[12, 1]]);
    expect(sidesFor(12, 'interior').every((s) => s.sheet > 0)).toBe(true);
  });

  it('creep moves inner sheets toward the spine', () => {
    expect(creep(0, 0.2)).toEqual({ left: 0, right: -0 });
    const c = creep(3, 0.2);
    expect(c.left).toBeCloseTo(0.6);
    expect(c.right).toBeCloseTo(-0.6);
  });

  it('refuses a page count that cannot fold', () => {
    expect(() => sides(10)).toThrow();
  });
});
