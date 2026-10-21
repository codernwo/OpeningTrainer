import { describe, expect, it } from 'vitest';
import { lineFromSans } from './chess';
import { addLine, edgeId, newRepertoire, type Repertoire } from './repertoire';
import { gradeCard, Rating, syncCards } from './srs';
import { cardWeakness, weakSpotWeights, weaknessBelow } from './weakSpots';

const keyAfter = (sans: string[]) => lineFromSans(sans)!.at(-1)!.to;
const NOW = Date.now();

/** Black: after 1.e4 c5 (Sicilian) and 1.e4 e5 (open game), all cards learned well and not due. */
function rep(): Repertoire {
  let r = newRepertoire('p', 'B', 'black');
  for (const l of [['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'], ['d4', 'd5', 'c4', 'e6']]) r = addLine(r, lineFromSans(l)!);
  r = syncCards(r);
  const long = NOW - 1000;
  r = { ...r, cards: Object.fromEntries(Object.entries(r.cards).map(([id, c]) => [id, { ...gradeCard(c, Rating.Easy, long), due: NOW + 30 * 86400e3 }])) };
  return r;
}

describe('weak spots', () => {
  it('counts due, missed and new cards, not the ones you know', () => {
    const r = rep();
    const card = r.cards[edgeId(keyAfter(['e4']), 'c7c5')];
    expect(cardWeakness(card, NOW)).toBe(0);
    expect(cardWeakness({ ...card, due: NOW - 1 }, NOW)).toBe(1);
    expect(cardWeakness({ ...card, due: NOW - 1, lapses: 4 }, NOW)).toBe(1 + 2 + 2);
  });

  it('sends the opponent where you are weak, by popularity otherwise', () => {
    let r = rep();
    const e4 = { to: keyAfter(['e4']), share: 0.5 };
    const d4 = { to: keyAfter(['d4']), share: 0.5 };
    expect(weakSpotWeights([r], [e4, d4], NOW)).toEqual([0.5, 0.5]);
    // A move in the Sicilian (after 1.e4 c5 2.Nf3 d6 3.d4) is due and was missed twice.
    const id = edgeId(keyAfter(['e4', 'c5', 'Nf3', 'd6', 'd4']), 'c5d4');
    r = { ...r, cards: { ...r.cards, [id]: { ...r.cards[id], due: NOW - 1, lapses: 2 } } };
    expect(weaknessBelow(r, e4.to, NOW)).toBe(2);
    const [we4, wd4] = weakSpotWeights([r], [e4, d4], NOW);
    expect(we4 / wd4).toBeCloseTo((0.5 * 2.2) / (0.5 * 0.2));
  });
});
