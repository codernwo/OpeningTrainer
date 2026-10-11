import { describe, expect, it } from 'vitest';
import type { PlayedGame } from './games';
import { categoryOf, categoryOfPgn, glickoUpdate, PROVISIONAL_RD, ratingsFrom, START } from './rating';

const DAY = 86_400_000;

function game(n: number, opts: Partial<PlayedGame> & { score?: 1 | 0.5 | 0; level?: number }): PlayedGame {
  const myColor = opts.myColor ?? 'white';
  const score = opts.score ?? 1;
  const result = score === 0.5 ? '1/2-1/2' : (score === 1) === (myColor === 'white') ? '1-0' : '0-1';
  const level = opts.level ?? 600;
  return {
    id: `p|practice:${n}`,
    profileId: 'p',
    source: 'practice',
    white: myColor === 'white' ? 'Me' : 'Maia',
    black: myColor === 'black' ? 'Me' : 'Maia',
    whiteElo: myColor === 'white' ? 1500 : level,
    blackElo: myColor === 'black' ? 1500 : level,
    myColor,
    result,
    playedAt: 1_700_000_000_000 + n * 60_000,
    timeControl: '300+0',
    rated: true,
    moves: ['e4'],
    addedAt: 0,
    updatedAt: 0,
    ...opts,
  };
}

describe('categories (Lichess: minutes + 40 × increment)', () => {
  it.each([
    [1, 0, 'bullet'],
    [2, 1, 'bullet'],
    [3, 0, 'blitz'],
    [2, 2, 'blitz'],
    [5, 3, 'blitz'],
    [8, 0, 'rapid'],
    [5, 5, 'rapid'],
    [15, 10, 'rapid'],
    [25, 0, 'classical'],
    [20, 10, 'classical'],
    [60, 60, 'classical'],
  ] as const)('%i+%i is %s', (minutes, increment, category) => {
    expect(categoryOf({ minutes, increment })).toBe(category);
    expect(categoryOfPgn(`${minutes * 60}+${increment}`)).toBe(category);
  });

  it('no clock, no category', () => {
    expect(categoryOfPgn(undefined)).toBeNull();
    expect(categoryOfPgn('-')).toBeNull();
  });
});

describe('Glicko-2 update', () => {
  const me = { rating: 1500, rd: 60, volatility: 0.06 };

  it('agrees with the plain Glicko-2 formulas (colour advantage aside)', () => {
    // Reference values from a straight implementation of Glickman's paper, one game per rating period.
    const avg = (score: number, opp: number, p = me) =>
      (glickoUpdate(p, opp, score, { white: true }).rating + glickoUpdate(p, opp, score, { white: false }).rating) / 2;
    expect(avg(1, 1100) - 1500).toBeCloseTo(2, 0);
    expect(avg(0, 1100) - 1500).toBeCloseTo(-19, 0);
    const start = { rating: START.rating, rd: START.rd, volatility: START.volatility };
    expect(avg(1, 600, start)).toBeGreaterThan(690);
    expect(avg(1, 600, start)).toBeLessThan(720);
    expect(avg(0, 600, start)).toBeGreaterThan(290);
    expect(avg(0, 600, start)).toBeLessThan(315);
  });

  it('wins go up, losses down, a draw against an equal does next to nothing', () => {
    expect(glickoUpdate(me, 1500, 1, { white: true }).rating).toBeGreaterThan(1500);
    expect(glickoUpdate(me, 1500, 0, { white: true }).rating).toBeLessThan(1500);
    expect(Math.abs(glickoUpdate(me, 1500, 0.5, { white: true }).rating - 1500)).toBeLessThan(1.5);
  });

  it('beating a stronger bot is worth more; winning with Black a little more than with White', () => {
    const vs = (opp: number, white = true) => glickoUpdate(me, opp, 1, { white }).rating;
    expect(vs(1900)).toBeGreaterThan(vs(1500));
    expect(vs(1500)).toBeGreaterThan(vs(1100));
    expect(vs(1500, false)).toBeGreaterThan(vs(1500, true));
  });

  it('every game makes the rating surer; a long break makes it less sure', () => {
    const after = glickoUpdate({ ...START }, 600, 1, { white: true });
    expect(after.rd).toBeLessThan(START.rd);
    const steady = glickoUpdate(me, 1500, 1, { white: true });
    const back = glickoUpdate(me, 1500, 1, { white: true, days: 365 });
    expect(back.rd).toBeGreaterThan(steady.rd);
    expect(back.rating - 1500).toBeGreaterThan(steady.rating - 1500);
  });

  it('never more than 700 in one game, never below 0', () => {
    const huge = glickoUpdate({ rating: 400, rd: 350, volatility: 0.09 }, 2600, 1, { white: true });
    expect(huge.rating).toBeLessThanOrEqual(1100);
    expect(glickoUpdate({ rating: 5, rd: 350, volatility: 0.09 }, 600, 0, { white: true }).rating).toBeGreaterThanOrEqual(0);
  });
});

describe('ratings from your rated games', () => {
  it('starts at 400, provisional', () => {
    const r = ratingsFrom([]);
    expect(r.byCategory.blitz).toMatchObject({ rating: 400, games: 0, provisional: true });
  });

  it('only finished rated practice games count, each in its own tempo', () => {
    const games = [
      game(1, {}),
      game(2, { rated: false }),
      game(3, { result: '*' }),
      game(4, { source: 'lichess' }),
      game(5, { timeControl: '60+0' }),
      game(6, { timeControl: undefined }),
    ];
    const r = ratingsFrom(games);
    expect(r.byCategory.blitz.games).toBe(1);
    expect(r.byCategory.bullet.games).toBe(1);
    expect(r.byCategory.rapid.games).toBe(0);
    expect([...r.byGame.keys()].sort()).toEqual(['p|practice:1', 'p|practice:5']);
  });

  it('in the order the games were played, whatever the order they are stored in', () => {
    const games = [game(1, { score: 1, level: 900 }), game(2, { score: 0 }), game(3, { score: 0.5, myColor: 'black', level: 700 })];
    const a = ratingsFrom(games).byCategory.blitz;
    const b = ratingsFrom([...games].reverse()).byCategory.blitz;
    expect(b.rating).toBe(a.rating);
    expect(b.rd).toBe(a.rd);
    const steps = ratingsFrom(games).byGame;
    expect(steps.get('p|practice:1')!.before).toBe(400);
    expect(steps.get('p|practice:2')!.before).toBe(steps.get('p|practice:1')!.after);
  });

  it('winning every game against a bot at your own level climbs, and a dozen games make it established', () => {
    const games: PlayedGame[] = [];
    let level = 600;
    for (let n = 0; n < 12; n++) {
      games.push(game(n, { level, playedAt: 1_700_000_000_000 + n * DAY }));
      level = Math.max(600, Math.round(ratingsFrom(games).byCategory.blitz.rating / 100) * 100);
    }
    const r = ratingsFrom(games).byCategory.blitz;
    expect(r.rating).toBeGreaterThan(1100);
    expect(r.rd).toBeLessThan(PROVISIONAL_RD);
    expect(r.provisional).toBe(false);
  });
});
