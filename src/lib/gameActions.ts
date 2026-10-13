// What your games ask you to do with your repertoire, in one place (after fetching games, and at the top of Insights):
// - where you left it yourself, and whether that was forgetting (the card comes back today), a choice (nothing to do)
//   or a sign to change the repertoire;
// - replies your opponents played that it has no answer to, most frequent first.
import type { Side } from './chess';
import { edgeId, movesAt, type Repertoire } from './repertoire';
import { playSan } from './chess';
import type { PlayedGame } from './games';
import { positionKeys, prepCheck } from './insights';

/** Games rarely follow a repertoire further than this; checking only the start keeps it quick for many games. */
const PREP_PLIES = 60;

export interface Deviation {
  game: PlayedGame;
  ply: number;
  /** Position before your move, and the moves leading there. */
  key: string;
  line: string[];
  played: string;
  expected: string[];
  /** The repertoire that has the position. */
  repId?: string;
}

export interface ToPrepare {
  key: string;
  ply: number;
  line: string[];
  played: string;
  color: Side;
  count: number;
  lastGame: PlayedGame;
  repId?: string;
}

export interface GameActions {
  /** Not decided yet, most recent game first. */
  deviations: Deviation[];
  /** Most frequent first, then most recent. */
  toPrepare: ToPrepare[];
}

const keysCache = new WeakMap<PlayedGame, string[]>();
const keysOf = (g: PlayedGame) => {
  let k = keysCache.get(g);
  if (!k) keysCache.set(g, (k = positionKeys(g.moves.slice(0, PREP_PLIES))));
  return k;
};

export function gameActions(games: readonly PlayedGame[], reps: readonly Repertoire[]): GameActions {
  const deviations: Deviation[] = [];
  const toPrepare = new Map<string, ToPrepare>();
  const owner = (key: string, side: Side) => reps.find((r) => r.side === side && movesAt(r, key).length > 0)?.id;
  for (const g of [...games].sort((a, b) => b.playedAt - a.playedAt)) {
    if (g.source === 'practice') continue;
    const keys = keysOf(g);
    const prep = prepCheck(g.moves.slice(0, keys.length - 1), keys, reps, g.myColor);
    if (prep.kind === 'you-left') {
      if (g.prepChoice?.ply === prep.ply) continue;
      deviations.push({ game: g, ply: prep.ply, key: keys[prep.ply], line: g.moves.slice(0, prep.ply), played: prep.played, expected: prep.expected, repId: owner(keys[prep.ply], g.myColor) });
    } else if (prep.kind === 'opponent-left') {
      const id = `${keys[prep.ply]}|${prep.played}`;
      const u = toPrepare.get(id);
      if (u) u.count++;
      else
        toPrepare.set(id, {
          key: keys[prep.ply],
          ply: prep.ply,
          line: g.moves.slice(0, prep.ply),
          played: prep.played,
          color: g.myColor,
          count: 1,
          lastGame: g,
          repId: owner(keys[prep.ply], g.myColor),
        });
    }
  }
  return { deviations, toPrepare: [...toPrepare.values()].sort((a, b) => b.count - a.count || b.lastGame.playedAt - a.lastGame.playedAt) };
}

/** "Forgot it": the card of your repertoire move comes back today (its schedule stays otherwise). */
export function makeDue(rep: Repertoire, key: string, sans: readonly string[], now = Date.now()): Repertoire {
  let cards = rep.cards;
  for (const san of sans) {
    const uci = playSan(key, san)?.uci;
    const id = uci && edgeId(key, uci);
    const card = id ? rep.cards[id] : undefined;
    if (!id || !card || card.due <= now) continue;
    if (cards === rep.cards) cards = { ...rep.cards };
    cards[id] = { ...card, due: now, changedAt: now };
  }
  return cards === rep.cards ? rep : { ...rep, cards };
}
