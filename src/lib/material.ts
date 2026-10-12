// Who is ahead in material, for the bars next to the board. As on Lichess, only the difference is shown: per kind of
// piece, the ones one side has more of (two knights traded each way show nothing), and the points it is up.
import type { Role } from 'chessops/types';
import { keyToFen, posFromFen, type Side } from './chess';

export type Captured = Exclude<Role, 'king'>;

export const PIECE_VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
/** Biggest first, as on Lichess. */
const ORDER: Captured[] = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

/** Per side, the opponent's pieces it is up (what it has taken and not given back), biggest first; and the points,
 *  White minus Black. Counted on the board, so promotions count too (a new queen is a queen up, the pawn a pawn down). */
export function materialDiff(key: string): { white: Captured[]; black: Captured[]; score: number } {
  const board = posFromFen(keyToFen(key)).board;
  const count: Record<Side, Record<Captured, number>> = {
    white: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0 },
    black: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0 },
  };
  let score = 0;
  for (const sq of board.occupied) {
    const p = board.get(sq)!;
    if (p.role === 'king') continue;
    count[p.color][p.role]++;
    score += (p.color === 'white' ? 1 : -1) * PIECE_VALUE[p.role];
  }
  const out = { white: [] as Captured[], black: [] as Captured[], score };
  for (const role of ORDER) {
    const d = count.white[role] - count.black[role];
    for (let i = 0; i < Math.abs(d); i++) out[d > 0 ? 'white' : 'black'].push(role);
  }
  return out;
}

/** Material on the board, White minus Black (pawn 1, knight and bishop 3, rook 5, queen 9): promotions count. */
export const materialBalance = (key: string): number => materialDiff(key).score;
