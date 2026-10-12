import { describe, expect, it } from 'vitest';
import { lineFromSans } from './chess';
import type { PlayedGame } from './games';
import { MIN_SHARE, pickReply, replyCounts, replyWeights } from './practiceReply';

const game = (myColor: 'white' | 'black', moves: string[], extra: Partial<PlayedGame> = {}): PlayedGame =>
  ({ id: Math.random().toString(), profileId: 'p', source: 'pgn', white: 'a', black: 'b', myColor, result: '1-0', playedAt: 0, moves, addedAt: 0, updatedAt: 0, ...extra }) as PlayedGame;

describe('replyCounts', () => {
  it('counts only the opponent moves, in games of that colour', () => {
    const games = [
      game('white', ['e4', 'c5', 'Nf3', 'd6']),
      game('white', ['e4', 'c5', 'Nf3', 'Nc6']),
      game('white', ['e4', 'e5']),
      game('black', ['e4', 'c5', 'd4']),
      game('white', ['e4', 'c5'], { startPly: 2 }),
    ];
    const counts = replyCounts(games, 'white');
    const afterE4 = lineFromSans(['e4'])!.at(-1)!.to;
    const afterNf3 = lineFromSans(['e4', 'c5', 'Nf3'])!.at(-1)!.to;
    expect(Object.fromEntries(counts.get(afterE4)!)).toEqual({ c5: 2, e5: 1 });
    expect(Object.fromEntries(counts.get(afterNf3)!)).toEqual({ d6: 1, Nc6: 1 });
    // White's own moves are not counted.
    expect(counts.get(lineFromSans(['e4', 'c5'])!.at(-1)!.to)).toBeUndefined();
  });
});

describe('replyWeights', () => {
  it('lifts rare replies to a minimum share', () => {
    expect(replyWeights(['a', 'b', 'c'], (s) => ({ a: 900, b: 100, c: 0 })[s]!)).toEqual([900, 100, 1000 * MIN_SHARE]);
  });
  it('is null when nothing was played', () => {
    expect(replyWeights(['a', 'b'], () => 0)).toBeNull();
  });
});

describe('pickReply', () => {
  it('follows your own games without a Lichess connection', async () => {
    const key = lineFromSans(['e4'])!.at(-1)!.to;
    const own = new Map([[key, new Map([['c5', 9], ['e5', 1]])]]);
    const moves = [{ san: 'c5' }, { san: 'e5' }];
    let c5 = 0;
    for (let i = 0; i < 2000; i++) if ((await pickReply(moves, key, { ratings: [], speeds: [], own })).move.san === 'c5') c5++;
    expect(c5 / 2000).toBeGreaterThan(0.85);
    expect(c5 / 2000).toBeLessThan(0.95);
  });

  it('picks evenly when there is nothing to go on', async () => {
    const r = await pickReply([{ san: 'c5' }, { san: 'e5' }], 'x', { ratings: [], speeds: [], own: new Map() }, () => 0.7);
    expect(r).toEqual({ move: { san: 'e5' }, source: 'even' });
  });
});
