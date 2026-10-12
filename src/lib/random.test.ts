import { describe, expect, it } from 'vitest';
import { shuffle, weightedPick } from './random';

describe('shuffle', () => {
  it('keeps every item', () => {
    const xs = [1, 2, 3, 4, 5, 6];
    expect(shuffle(xs).sort()).toEqual(xs);
    expect(xs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('makes every order about equally likely', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 24000; i++) {
      const k = shuffle(['a', 'b', 'c']).join('');
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const n of seen.values()) expect(n / 24000).toBeGreaterThan(0.14), expect(n / 24000).toBeLessThan(0.193);
  });
});

describe('weightedPick', () => {
  it('follows the weights', () => {
    const n = { a: 0, b: 0, c: 0 };
    const w = { a: 70, b: 25, c: 5 };
    for (let i = 0; i < 20000; i++) n[weightedPick(['a', 'b', 'c'] as const, (x) => w[x])!]++;
    expect(n.a / 20000).toBeCloseTo(0.7, 1);
    expect(n.b / 20000).toBeCloseTo(0.25, 1);
    expect(n.c / 20000).toBeGreaterThan(0.03);
    expect(n.c / 20000).toBeLessThan(0.07);
  });

  it('never picks a weight of zero, and is uniform when all are zero', () => {
    for (let i = 0; i < 500; i++) expect(weightedPick(['a', 'b'], (x) => (x === 'a' ? 0 : 1))).toBe('b');
    const n = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) n[weightedPick(['a', 'b'] as const, () => 0)!]++;
    expect(n.a / 4000).toBeCloseTo(0.5, 1);
    expect(weightedPick([], () => 1)).toBeUndefined();
  });
});
