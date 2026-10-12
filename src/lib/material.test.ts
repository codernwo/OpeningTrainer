import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { materialBalance, materialDiff } from './material';

const end = (s: string) => lineFromSans(s.split(' '))!.at(-1)!.to;

describe('material difference (as on Lichess)', () => {
  it('only what one side is up: trades cancel out, biggest first', () => {
    // White took a pawn and the queen; Black two pawns: net, White is a queen up and Black a pawn.
    const d = materialDiff(end('e4 d5 exd5 Qxd5 Nc3 Qxg2 Bxg2'));
    expect(d).toEqual({ white: ['queen'], black: ['pawn'], score: 8 });
    expect(materialDiff(end('e4 d5 exd5 Qxd5 Nc3 Qxd2+ Bxd2'))).toEqual({ white: ['queen'], black: ['pawn'], score: 8 });
  });

  it('equal trades show nothing', () => {
    // Each side lost a knight and a pawn: nothing to show.
    expect(materialDiff(end('e4 e5 Nf3 Nc6 Nxe5 Nxe5 d4 Nc6 d5 Nb4 c3 Nxd5 exd5'))).toEqual({ white: [], black: [], score: 0 });
    // Pawns and knights traded one each, White also took the bishop: only the bishop shows (+3).
    expect(materialDiff(end('e4 d5 exd5 Qxd5 Nc3 Qa5 Nf3 Nf6 Bc4 Bg4 O-O e6 d4 Bxf3 Qxf3 Qb6 Qxf6'))).toEqual({ white: ['bishop'], black: [], score: 3 });
    expect(materialDiff(START_KEY)).toEqual({ white: [], black: [], score: 0 });
  });

  it('promotions count (a queen up, a pawn down) and en passant is a pawn', () => {
    const promo = end('h4 g5 hxg5 h6 gxh6 Nf6 h7 Ng8 hxg8=Q');
    expect(materialDiff(promo)).toEqual({ white: ['queen', 'knight', 'pawn'], black: [], score: 9 + 3 + 1 });
    expect(materialBalance(promo)).toBe(13);
    expect(materialDiff(end('e4 a6 e5 d5 exd6')).white).toEqual(['pawn']);
  });
});
