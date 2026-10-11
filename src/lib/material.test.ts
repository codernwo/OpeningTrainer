import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { capturedBy, materialBalance } from './material';

const line = (s: string) => lineFromSans(s.split(' '))!;

describe('captured pieces', () => {
  it('collects what each side took, cheapest first', () => {
    const l = line('e4 d5 exd5 Qxd5 Nc3 Qxg2 Bxg2');
    expect(capturedBy(l)).toEqual({ white: ['pawn', 'queen'], black: ['pawn', 'pawn'] });
    expect(materialBalance(l.at(-1)!.to)).toBe(8); // queen and pawn against two pawns
  });

  it('counts en passant, not castling, and a promotion shows in the balance', () => {
    const ep = line('e4 a6 e5 d5 exd6');
    expect(capturedBy(ep).white).toEqual(['pawn']);
    const castle = line('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O');
    expect(capturedBy(castle)).toEqual({ white: [], black: [] });
    const promo = line('h4 g5 hxg5 h6 gxh6 Nf6 h7 Ng8 hxg8=Q');
    expect(capturedBy(promo).white).toEqual(['pawn', 'pawn', 'knight']);
    expect(materialBalance(promo.at(-1)!.to)).toBe(3 + 2 + 8); // knight and two pawns taken, a pawn became a queen
    expect(materialBalance(START_KEY)).toBe(0);
  });
});
