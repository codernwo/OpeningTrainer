import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { addLine, newRepertoire } from './repertoire';
import { practiceLines, type ShareOf } from './practiceLines';

const rep = (side: 'white' | 'black', ...lines: string[][]) => {
  let r = newRepertoire('p', 'R', side);
  for (const l of lines) r = addLine(r, lineFromSans(l)!);
  return r;
};
const sans = (l: { steps: { san: string }[] }) => l.steps.map((s) => s.san).join(' ');
const keyAfter = (moves: string[]) => lineFromSans(moves)!.at(-1)!.to;

describe('practice lines', () => {
  const r = rep(
    'white',
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'],
    ['e4', 'e5', 'Nf3', 'd6', 'd4'],
    ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'],
    ['e4', 'c6', 'd4'],
  );
  // After 1.e4: c5 52%, e5 30%, c6 10%; after 2.Nf3 (vs e5): Nc6 80%, d6 5%.
  const share: ShareOf = (key, san) => {
    const at: Record<string, Record<string, number>> = {
      [keyAfter(['e4'])]: { c5: 0.52, e5: 0.3, c6: 0.1 },
      [keyAfter(['e4', 'e5', 'Nf3'])]: { Nc6: 0.8, d6: 0.05 },
    };
    return at[key] ? (at[key][san] ?? 0) : undefined;
  };

  it('plays every line to its end, the most frequent first', () => {
    const lines = practiceLines(r, START_KEY, share);
    expect(lines.map(sans)).toEqual([
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4',
      'e4 e5 Nf3 Nc6 Bb5 a6 Ba4',
      'e4 c6 d4',
      'e4 e5 Nf3 d6 d4',
    ]);
    expect(lines[0].reach).toBeCloseTo(0.52);
    expect(lines[3].reach).toBeCloseTo(0.015);
    expect(lines.every((l) => l.known)).toBe(true);
  });

  it('starts from a branch', () => {
    const lines = practiceLines(r, keyAfter(['e4', 'e5']), share);
    expect(lines.map(sans)).toEqual(['Nf3 Nc6 Bb5 a6 Ba4', 'Nf3 d6 d4']);
  });

  it('takes replies as equally often where nothing is known, and says so', () => {
    const lines = practiceLines(r, START_KEY, () => undefined);
    // c5 and c6 each a third of the games, in the order of the tree; the two e5 lines a sixth each.
    expect(lines.map(sans)).toEqual(['e4 c5 Nf3 d6 d4 cxd4 Nxd4', 'e4 c6 d4', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4', 'e4 e5 Nf3 d6 d4']);
    expect(lines.every((l) => !l.known)).toBe(true);
  });

  it('covers a transposition with a line through it', () => {
    const t = rep('white', ['d4', 'Nf6', 'c4', 'e6', 'Nc3'], ['c4', 'e6', 'd4', 'Nf6', 'Nc3']);
    const lines = practiceLines(t, START_KEY, () => undefined);
    expect(lines.map(sans).sort()).toEqual(['c4 e6 d4 Nf6 Nc3', 'd4 Nf6 c4 e6 Nc3']);
    expect(lines.filter((l) => l.via !== undefined)).toHaveLength(1);
  });

  it('has no lines where nothing is prepared', () => {
    expect(practiceLines(r, keyAfter(['d4']), share)).toEqual([]);
  });
});
