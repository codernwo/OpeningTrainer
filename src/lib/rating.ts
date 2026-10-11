// Your rating against the Maia bots: Glicko-2, as on Lichess, one rating per tempo. It is not stored but worked out
// from your rated practice games, in the order they were played, so every device arrives at the same number.
//
// Glicko-2 (Glickman) keeps a rating, its uncertainty (RD) and a volatility. A large RD means big steps; every game
// makes it smaller, and not playing makes it grow again. The constants are Lichess' (lila: modules/rating Glicko.scala,
// scalachess: rating/glicko/model.scala), except the start: everyone begins at 400 ±350 and climbs by beating stronger
// bots. A bot's strength does not change: its rating is its level, with a small fixed uncertainty.
// Note: this Maia samples its moves like a person rather than always playing its first choice, so the scale is its
// own; it is close to Lichess ratings but not the same.
import type { PlayedGame } from './games';
import type { TimeControl } from './clock';

export type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';
export const RATING_CATEGORIES: RatingCategory[] = ['bullet', 'blitz', 'rapid', 'classical'];
export const CATEGORY_NAMES: Record<RatingCategory, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' };

/** As on Lichess: the expected length of a game, minutes + 40 moves × the increment. Bullet under 3 minutes, blitz
 *  3–8, rapid 8–25, classical longer. */
export function categoryOf(tc: TimeControl): RatingCategory {
  const est = tc.minutes * 60 + 40 * tc.increment;
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

/** "300+3" → its category. */
export function categoryOfPgn(tc: string | undefined): RatingCategory | null {
  const m = tc ? /^(\d+)\+(\d+)$/.exec(tc) : null;
  return m ? categoryOf({ minutes: Number(m[1]) / 60, increment: Number(m[2]) }) : null;
}

export const START = { rating: 400, rd: 350, volatility: 0.09 };
const SCALE = 173.7178;
const TAU = 0.75;
const MAX_VOLATILITY = 0.1;
const MIN_RD = 45;
/** Never more uncertain than a newcomer (Lichess allows 500, but starts there too). */
const MAX_RD = 350;
/** Lichess does not go below 400; here 400 is where everyone starts, so losses may take you lower. */
const MIN_RATING = 0;
/** At most this much up or down in one game (Lichess). */
const MAX_DELTA = 700;
/** Below this uncertainty a rating is established; above it is shown with a "?". */
export const PROVISIONAL_RD = 110;
/** RD grows while you do not play: from 60 to 110 in a year. */
const PERIODS_PER_DAY = 0.21436;
/** White's small edge, in rating points (Lichess, standard chess). */
const WHITE_ADVANTAGE = 11.782457;
export const BOT_RD = 60;

export interface Glicko {
  rating: number;
  rd: number;
  volatility: number;
}

/** One game against an opponent of fixed rating; `score` 1, ½ or 0; `days` since your previous game in this tempo. */
export function glickoUpdate(p: Glicko, opponent: number, score: number, opts: { white: boolean; days?: number; opponentRd?: number }): Glicko {
  // Uncertainty grows with the time you did not play.
  let phi = p.rd / SCALE;
  if (opts.days && opts.days > 0) phi = Math.min(MAX_RD / SCALE, Math.sqrt(phi * phi + opts.days * PERIODS_PER_DAY * p.volatility * p.volatility));
  const edge = (opts.white ? 1 : -1) * (WHITE_ADVANTAGE / 2);
  const mu = (p.rating + edge - 1500) / SCALE;
  const muj = (opponent - edge - 1500) / SCALE;
  const phij = (opts.opponentRd ?? BOT_RD) / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phij * phij) / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g * (mu - muj)));
  const v = 1 / (g * g * E * (1 - E));
  const delta = v * g * (score - E);

  // The new volatility (Glickman's step 5, the Illinois algorithm).
  const a = Math.log(p.volatility * p.volatility);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const volatility = Math.min(MAX_VOLATILITY, Math.exp(A / 2));
  const phiStar = Math.sqrt(phi * phi + volatility * volatility);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * g * (score - E);

  const raw = 1500 + SCALE * muNew - edge;
  const rating = Math.max(MIN_RATING, Math.min(p.rating + MAX_DELTA, Math.max(p.rating - MAX_DELTA, raw)));
  const rd = Math.min(MAX_RD, Math.max(MIN_RD, SCALE * phiNew));
  return { rating, rd, volatility };
}

export interface CategoryRating extends Glicko {
  games: number;
  provisional: boolean;
  lastPlayed: number | null;
}

export interface Ratings {
  byCategory: Record<RatingCategory, CategoryRating>;
  /** Per rated game: the rating before and after it (and its uncertainty after it), in the order played. */
  byGame: Map<string, RatingStep>;
}

export interface RatingStep {
  category: RatingCategory;
  before: number;
  after: number;
  rd: number;
  provisionalBefore: boolean;
  provisional: boolean;
  playedAt: number;
}

const fresh = (): CategoryRating => ({ ...START, games: 0, provisional: true, lastPlayed: null });

/** A rated game: a practice game with a clock, finished, flagged as rated when it was played. */
export const isRatedGame = (g: PlayedGame) => g.source === 'practice' && !!g.rated && g.result !== '*' && !!categoryOfPgn(g.timeControl);

const DAY = 86_400_000;

/** All ratings of a player, worked out from their rated games in the order they were played. */
export function ratingsFrom(games: readonly PlayedGame[]): Ratings {
  const byCategory = Object.fromEntries(RATING_CATEGORIES.map((c) => [c, fresh()])) as Record<RatingCategory, CategoryRating>;
  const byGame: Ratings['byGame'] = new Map();
  const rated = games.filter(isRatedGame).sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  for (const g of rated) {
    const category = categoryOfPgn(g.timeControl)!;
    const cur = byCategory[category];
    const bot = g.myColor === 'white' ? g.blackElo : g.whiteElo;
    if (!bot) continue;
    const mine = g.myColor === 'white' ? '1-0' : '0-1';
    const score = g.result === mine ? 1 : g.result === '1/2-1/2' ? 0.5 : 0;
    const days = cur.lastPlayed ? (g.playedAt - cur.lastPlayed) / DAY : 0;
    const next = glickoUpdate(cur, bot, score, { white: g.myColor === 'white', days });
    byCategory[category] = { ...next, games: cur.games + 1, provisional: next.rd >= PROVISIONAL_RD, lastPlayed: g.playedAt };
    byGame.set(g.id, {
      category,
      before: cur.rating,
      after: next.rating,
      rd: next.rd,
      provisionalBefore: cur.provisional,
      provisional: next.rd >= PROVISIONAL_RD,
      playedAt: g.playedAt,
    });
  }
  return { byCategory, byGame };
}

/** "1340?" while provisional, as on Lichess. */
export const showRating = (r: Pick<CategoryRating, 'rating' | 'provisional'>) => `${Math.round(r.rating)}${r.provisional ? '?' : ''}`;

/** What a game against `opponent` would do to your rating: after a win, a draw and a loss (rounded, as shown). */
export function stakes(r: CategoryRating, opponent: number, white: boolean, now = Date.now()) {
  const days = r.lastPlayed ? (now - r.lastPlayed) / DAY : 0;
  const diff = (score: number) => Math.round(glickoUpdate(r, opponent, score, { white, days }).rating) - Math.round(r.rating);
  return { win: diff(1), draw: diff(0.5), loss: diff(0) };
}
