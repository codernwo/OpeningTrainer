// What your opponents played against a colour in your games: the order of the practice lines falls back on it where
// this device has no Lichess database counts for a position.
import { lineFromSans, type Side } from './chess';
import type { PlayedGame } from './games';

/** Opponent moves in your games: position → SAN → how often (the opening only). */
export type ReplyCounts = Map<string, Map<string, number>>;

/** How far into a game its moves are counted. */
const OPENING_PLIES = 30;

export function replyCounts(games: readonly PlayedGame[], side: Side): ReplyCounts {
  const out: ReplyCounts = new Map();
  const theirs = side === 'white' ? 1 : 0;
  for (const g of games) {
    if (g.myColor !== side || g.startPly) continue;
    const line = lineFromSans(g.moves.slice(0, OPENING_PLIES)) ?? [];
    line.forEach((m, ply) => {
      if (ply % 2 !== theirs) return;
      const at = out.get(m.from) ?? new Map<string, number>();
      at.set(m.san, (at.get(m.san) ?? 0) + 1);
      out.set(m.from, at);
    });
  }
  return out;
}
