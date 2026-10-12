// Practice lines: which of your prepared opponent replies comes next. As often as people really play them: the Lichess
// database (when you are connected, with your rating groups and speeds), otherwise your own games of that colour,
// otherwise each equally often.
import { keyToFen, lineFromSans, type Side } from './chess';
import type { PlayedGame } from './games';
import { fetchExplorer, getToken, totalGames } from './lichess';
import { weightedPick } from './random';

/** Opponent moves in your games: position → SAN → how often (the opening only). */
export type ReplyCounts = Map<string, Map<string, number>>;

/** Every prepared reply keeps at least this share, so a rare line still comes up now and then. */
export const MIN_SHARE = 0.03;
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

/** Weights for the prepared replies: the counts, with every reply lifted to at least MIN_SHARE of them. Null when
 *  none of them has been played. */
export function replyWeights(sans: readonly string[], count: (san: string) => number): number[] | null {
  const raw = sans.map((s) => Math.max(0, count(s)));
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return raw.map((w) => Math.max(w, total * MIN_SHARE));
}

export type ReplySource = 'database' | 'games' | 'even';

export interface PracticeContext {
  ratings: number[];
  speeds: string[];
  own: ReplyCounts;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** One of the prepared replies at `key`, as often as it is met. */
export async function pickReply<T extends { san: string }>(
  moves: readonly T[],
  key: string,
  ctx: PracticeContext,
  random = Math.random,
): Promise<{ move: T; source: ReplySource }> {
  if (moves.length > 1 && getToken()) {
    try {
      const stats = await withTimeout(fetchExplorer({ db: 'lichess', fen: keyToFen(key), ratings: ctx.ratings, speeds: ctx.speeds }), 2500);
      const w = replyWeights(
        moves.map((m) => m.san),
        (san) => {
          const hit = stats.moves.find((x) => x.san === san);
          return hit ? totalGames(hit) : 0;
        },
      );
      if (w) return { move: weightedPick(moves, (m) => w[moves.indexOf(m)], random)!, source: 'database' };
    } catch {
      // No database answer in time: your own games instead.
    }
  }
  const at = ctx.own.get(key);
  const w = moves.length > 1 && at ? replyWeights(moves.map((m) => m.san), (san) => at.get(san) ?? 0) : null;
  if (w) return { move: weightedPick(moves, (m) => w[moves.indexOf(m)], random)!, source: 'games' };
  return { move: moves[Math.floor(random() * moves.length)], source: 'even' };
}
