import { describe, expect, it } from 'vitest';
import { lineFromSans } from './chess';
import type { PlayedGame } from './games';
import { replyCounts } from './practiceReply';

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
