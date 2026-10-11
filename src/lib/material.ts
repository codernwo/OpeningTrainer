// What each side has captured in a game, and who is ahead in material, for the bars next to the board.
import { parseUci, squareFile } from 'chessops/util';
import type { Role } from 'chessops/types';
import { keyToFen, posFromFen, type PlayedMove, type Side } from './chess';

export type Captured = Exclude<Role, 'king'>;

export const PIECE_VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const ORDER: Captured[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

/** The pieces each side has taken, cheapest first. En passant counts; a castling move never does. */
export function capturedBy(moves: readonly PlayedMove[]): Record<Side, Captured[]> {
  const out: Record<Side, Captured[]> = { white: [], black: [] };
  for (const m of moves) {
    const mv = parseUci(m.uci);
    if (!mv || !('from' in mv)) continue;
    const pos = posFromFen(keyToFen(m.from));
    const mover = pos.board.get(mv.from);
    if (!mover) continue;
    const target = pos.board.get(mv.to);
    if (target && target.color !== mover.color && target.role !== 'king') out[mover.color].push(target.role as Captured);
    else if (!target && mover.role === 'pawn' && squareFile(mv.from) !== squareFile(mv.to)) out[mover.color].push('pawn');
  }
  for (const side of ['white', 'black'] as const) out[side].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return out;
}

/** Material on the board, White minus Black (pawn 1, knight and bishop 3, rook 5, queen 9): promotions count. */
export function materialBalance(key: string): number {
  const board = posFromFen(keyToFen(key)).board;
  let n = 0;
  for (const sq of board.occupied) {
    const p = board.get(sq)!;
    n += (p.color === 'white' ? 1 : -1) * PIECE_VALUE[p.role];
  }
  return n;
}
