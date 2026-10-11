import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { openingOfLine, parseOpenings, shortName } from './openings';

const tsv = readFileSync(new URL('../data/openings.tsv', import.meta.url), 'utf8');
const keyOf = (s: string) => lineFromSans(s.split(' '))!.at(-1)!.to;

describe('opening names', () => {
  const t0 = performance.now();
  const byKey = parseOpenings(tsv);
  const ms = performance.now() - t0;

  it('reads the whole list, quickly', () => {
    expect(byKey.size).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(3000);
  });

  it('names positions, also when reached by another move order', () => {
    expect(byKey.get(keyOf('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'))?.name).toBe('Sicilian Defense: Najdorf Variation');
    expect(byKey.get(keyOf('d4 Nf6 c4 e6 Nc3 Bb4'))?.name).toMatch(/^Nimzo-Indian Defense/);
    expect(byKey.get(keyOf('c4 e6 Nc3 Nf6 d4 Bb4'))?.name).toMatch(/^Nimzo-Indian Defense/);
    expect(byKey.get(START_KEY)).toBeUndefined();
  });

  it('the name of a line is that of its last named position', () => {
    const line = lineFromSans('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3'.split(' '))!;
    expect(openingOfLine(byKey, line.map((m) => m.to))?.name).toMatch(/^Sicilian Defense: Najdorf Variation/);
  });

  it('a branch shows what it adds to its parent', () => {
    expect(shortName('Sicilian Defense: Najdorf Variation, English Attack', 'Sicilian Defense: Najdorf Variation')).toBe('English Attack');
    expect(shortName('Sicilian Defense: Najdorf Variation', 'Sicilian Defense')).toBe('Najdorf Variation');
    expect(shortName('Scandinavian Defense')).toBe('Scandinavian Defense');
  });
});
