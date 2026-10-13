import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { isOpeningCard, mistakeQueue, themeCounts, type MistakeCard } from './mistakes';
import { addLine, newRepertoire, setPaused, type Repertoire } from './repertoire';
import { gradeCard, newCard, Rating, State, syncCards } from './srs';
import { describePlan, todayPlan, trainPrefs } from './today';

const rep = (name: string, side: 'white' | 'black', ...lines: string[][]) => {
  let r = newRepertoire('p', name, side);
  for (const l of lines) r = addLine(r, lineFromSans(l)!);
  return syncCards(r);
};
/** All cards learned at `at`, so they are due a while later. */
const learned = (r: Repertoire, at: number) => ({
  ...r,
  cards: Object.fromEntries(Object.entries(r.cards).map(([id, c]) => [id, gradeCard(c, Rating.Good, at)])),
});
const later = Date.now() + 400 * 86400e3;

const card = (key: string, extra: Partial<MistakeCard> = {}): MistakeCard => ({
  id: `m|p|${key}`,
  profileId: 'p',
  key,
  side: 'white',
  line: [],
  played: 'a3',
  best: ['e4'],
  answer: ['e4'],
  bestEval: 50,
  playedEval: -200,
  kind: 'mistake',
  games: [],
  card: newCard(1000),
  createdAt: 1000,
  updatedAt: 1000,
  ...extra,
});

describe("today's plan", () => {
  const white = learned(rep('White', 'white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), 1000); // 3 own moves, all learned
  const black = rep('Black', 'black', ['e4', 'c5', 'Nf3', 'd6'], ['d4', 'Nf6']); // 3 own moves, all new
  const prefs = { newMoves: 2, newMistakes: 1, wholeLines: false };

  it('reviews of every repertoire first, then mistake cards, then new moves up to the limit', () => {
    const cards = [card(START_KEY), card('other', { card: gradeCard(newCard(1000), Rating.Good, 1000), createdAt: 900 })];
    const plan = todayPlan([white, black], cards, prefs, later);
    expect(plan.parts.map((p) => p.kind)).toEqual(['review', 'mistakes', 'new']);
    expect(plan.due).toBe(3);
    expect(plan.mistakes).toBe(2); // the due one and one new one
    expect(plan.fresh).toBe(2);
    expect(plan.total).toBe(7);
    const fresh = plan.parts[2];
    expect(fresh.kind === 'new' && fresh.repId).toBe(black.id);
    expect(describePlan(plan)).toBe('3 reviews · 2 mistake cards · 2 new moves');
  });

  it('leaves paused repertoires out, and shares the new moves over the repertoires in order', () => {
    const white2 = rep('White 2', 'white', ['d4', 'd5', 'c4']);
    const plan = todayPlan([setPaused(white, true), black, white2], [], { ...prefs, newMoves: 4 }, later);
    expect(plan.due).toBe(0);
    const news = plan.parts.filter((p) => p.kind === 'new');
    expect(news.map((p) => (p.kind === 'new' ? [p.repId, p.items.length] : null))).toEqual([
      [black.id, 3],
      [white2.id, 1],
    ]);
    expect(plan.total).toBe(4);
  });

  it('is empty when there is nothing to do', () => {
    const plan = todayPlan([learned(black, Date.now())], [], { ...prefs, newMoves: 0 }, Date.now());
    expect(plan).toMatchObject({ parts: [], total: 0 });
    expect(describePlan(plan)).toBe('');
  });

  it('takes the synced choices over the device ones', () => {
    expect(trainPrefs({ trainPrefs: { newMoves: 20, wholeLines: true } })).toMatchObject({ newMoves: 20, wholeLines: true, newMistakes: 10 });
  });
});

describe('mistake cards by priority', () => {
  // The position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 (opening) and a bare endgame (not).
  const opening = lineFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])!.at(-1)!.to;
  const endgame = '8/5k2/8/8/8/8/5K2/7R w - -';
  it('puts opening mistakes first', () => {
    const due = (key: string, id: string) => card(key, { id, card: { ...gradeCard(newCard(1000), Rating.Good, 1000), state: State.Review } });
    const cards = [due(endgame, 'late'), due(opening, 'early')];
    expect(isOpeningCard(cards[1])).toBe(true);
    expect(isOpeningCard(cards[0])).toBe(false);
    expect(mistakeQueue(cards, 0, later).map((c) => c.id)).toEqual(['early', 'late']);
  });
  it('counts the themes of a deck', () => {
    expect(themeCounts([]).size).toBe(0);
  });
});
