import { describe, expect, it } from 'vitest';
import { ALL_IN_PLAY, scopedReps, scopedRepsBoth } from './repScope';
import { newRepertoire, setStudy } from './repertoire';

describe('which repertoires a game is checked against', () => {
  const e4 = newRepertoire('p', 'e4', 'white');
  const d4 = setStudy(newRepertoire('p', 'd4 (learning)', 'white'), true);
  const caro = newRepertoire('p', 'Caro-Kann', 'black');
  const sicilian = newRepertoire('p', 'Sicilian', 'black');
  const other = newRepertoire('q', 'Other player', 'white');
  const all = [e4, d4, caro, sicilian, other];

  it('all in play: the in-play repertoires of that colour, of that player', () => {
    expect(scopedReps(all, 'p', 'white', ALL_IN_PLAY).map((r) => r.name)).toEqual(['e4']);
    expect(scopedReps(all, 'p', 'black', ALL_IN_PLAY).map((r) => r.name)).toEqual(['Caro-Kann', 'Sicilian']);
  });

  it('one picked: only that one for its colour (a study repertoire too); the other colour keeps all in play', () => {
    expect(scopedReps(all, 'p', 'black', caro.id).map((r) => r.name)).toEqual(['Caro-Kann']);
    expect(scopedReps(all, 'p', 'white', d4.id).map((r) => r.name)).toEqual(['d4 (learning)']);
    expect(scopedReps(all, 'p', 'white', caro.id).map((r) => r.name)).toEqual(['e4']);
    expect(scopedRepsBoth(all, 'p', caro.id).map((r) => r.name)).toEqual(['e4', 'Caro-Kann']);
  });

  it('a repertoire that is gone: back to all in play', () => {
    expect(scopedReps(all, 'p', 'black', 'deleted-id').map((r) => r.name)).toEqual(['Caro-Kann', 'Sicilian']);
  });
});
