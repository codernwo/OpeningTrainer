// Your weak spots in a repertoire, for the practice opponent that aims at them: below each position, how much of
// what you prepared you do not know well yet. A move whose card is due counts fully, one you keep missing (lapses)
// more, a leech most; a new move half (you have not learned it yet). Learned moves that are not due count nothing.
import { edgeId, isMine, movesAt, reachable, type Repertoire, type SrsCard } from './repertoire';
import { isLeech, State } from './srs';

/** How weak you are on one of your moves. */
export function cardWeakness(card: SrsCard | undefined, now = Date.now()): number {
  if (!card) return 0;
  if (card.state === State.New) return 0.5;
  let w = card.due <= now ? 1 : 0;
  w += Math.min(card.lapses, 6) * 0.5;
  if (isLeech(card)) w += 2;
  return w;
}

// Per version of a repertoire (a new object after every change, cards included).
const cache = new WeakMap<Repertoire, Map<string, number>>();

/** The weakness of everything you prepared below `key` (your moves in it, each counted once). */
export function weaknessBelow(rep: Repertoire, key: string, now = Date.now()): number {
  let m = cache.get(rep);
  if (!m) cache.set(rep, (m = new Map()));
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  let w = 0;
  for (const k of reachable(rep.positions, key)) {
    if (!isMine(rep, k)) continue;
    for (const mv of movesAt(rep, k)) w += cardWeakness(rep.cards[edgeId(k, mv.uci)], now);
  }
  m.set(key, w);
  return w;
}

/**
 * The weight of each prepared reply for an opponent that aims at your weak spots: how often people play it (a
 * share; rare replies count as at least 5%) times how weak you are below it. With no weak spots at all it is the
 * popularity alone, as for the opponent that stays inside your repertoire.
 */
export function weakSpotWeights(reps: readonly Repertoire[], replies: readonly { to: string; share: number }[], now = Date.now()): number[] {
  const weak = replies.map((r) => reps.reduce((a, rep) => a + weaknessBelow(rep, r.to, now), 0));
  const any = weak.some((w) => w > 0);
  return replies.map((r, i) => Math.max(r.share, 0.05) * (any ? 0.2 + weak[i] : 1));
}
