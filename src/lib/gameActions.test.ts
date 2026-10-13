import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { gameActions, makeDue } from './gameActions';
import type { PlayedGame } from './games';
import { addLine, edgeId, newRepertoire } from './repertoire';
import { gradeCard, Rating, syncCards } from './srs';

const rep = syncCards(addLine(addLine(newRepertoire('p', 'e4', 'white'), lineFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])!), lineFromSans(['e4', 'c5', 'Nf3'])!));
let n = 0;
const game = (moves: string, extra: Partial<PlayedGame> = {}): PlayedGame =>
  ({ id: `g${++n}`, profileId: 'p', source: 'lichess', white: 'me', black: 'x', myColor: 'white', result: '1-0', playedAt: n * 1000, moves: moves.split(' '), addedAt: 0, updatedAt: 0, ...extra }) as PlayedGame;

describe('what your games ask of your repertoire', () => {
  it('lists where you left it, and the replies to prepare by how often they came', () => {
    const games = [
      game('e4 e5 Nf3 Nc6 Bc4 Bc5'), // you left it: Bc4 instead of Bb5
      game('e4 e6 d4 d5'), // 1...e6 unprepared
      game('e4 e6 d4 d5 Nc3'), // again
      game('e4 d5 exd5'), // 1...d5 unprepared, once
      game('e4 e5 Nf3 Nc6 Bb5 a6'), // followed it to the end
      game('e4 c5 c3', { source: 'practice' }), // practice games do not count
    ];
    const a = gameActions(games, [rep]);
    expect(a.deviations).toHaveLength(1);
    expect(a.deviations[0]).toMatchObject({ ply: 4, played: 'Bc4', expected: ['Bb5'], line: ['e4', 'e5', 'Nf3', 'Nc6'], repId: rep.id });
    expect(a.toPrepare.map((t) => [t.played, t.count])).toEqual([
      ['e6', 2],
      ['d5', 1],
    ]);
  });

  it('does not ask again once you decided', () => {
    const g = game('e4 e5 Nf3 Nc6 Bc4', { prepChoice: { ply: 4, choice: 'deliberate', at: 1 } });
    expect(gameActions([g], [rep]).deviations).toHaveLength(0);
  });

  it('"forgot it" makes the card due today', () => {
    const key = lineFromSans(['e4', 'e5', 'Nf3', 'Nc6'])!.at(-1)!.to;
    const id = edgeId(key, 'f1b5');
    const learned = { ...rep, cards: { ...rep.cards, [id]: gradeCard(rep.cards[id], Rating.Good, 1000) } };
    expect(learned.cards[id].due).toBeGreaterThan(5000);
    const r = makeDue(learned, key, ['Bb5'], 5000);
    expect(r.cards[id].due).toBe(5000);
    expect(r.cards[edgeId(START_KEY, 'e2e4')]).toBe(learned.cards[edgeId(START_KEY, 'e2e4')]);
  });
});
