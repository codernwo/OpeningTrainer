// Repertoire checks: gaps against what people actually play (Lichess database) and
// move quality (engine).
import { keyToFen, playSan, turnOfKey, type Side } from './chess';
import { evaluate, scoreCp, type Evaluation } from './evaluate';
import { AuthRequiredError, explorerCacheKey, fetchExplorer, peekCache, totalGames, warmCache, type ExplorerResult } from './lichess';
import { buildTree, deletionImpact, edgeId, isMine, movesAt, ROOT, type EngineFlag, type Repertoire, type TreeNode } from './repertoire';

export interface LineRef {
  /** Position the finding is about. */
  key: string;
  /** SAN moves from the start position to `key`. */
  line: string[];
}

export interface Gap extends LineRef {
  san: string;
  /** Share of games at this position in which the opponent plays this move. */
  share: number;
  /** Estimated share of *all* your games (with this colour) that reach this gap, over every move order. */
  reach: number;
  games: number;
  /** Number of move orders (within your repertoire) that lead to this position. */
  routes: number;
}

export interface LineEnd extends LineRef {
  reach: number;
  games: number;
  topMoves: { san: string; share: number }[];
  routes: number;
}

/** A branch of your repertoire you meet in fewer of your games than the threshold: a candidate to trim. `key` is the
 *  position after the opponent's rare reply, `line` the moves to it (ending with that reply). */
export interface RareBranch extends LineRef {
  /** Where the reply is played, and the reply itself. */
  from: string;
  uci: string;
  san: string;
  /** Estimated share of all your games that reach it, over every move order (0: not in the database's list). */
  reach: number;
  routes: number;
  /** Half-moves that go with it if it is deleted (lines that stay reachable another way are kept). */
  plies: number;
}

export interface GapReport {
  gaps: Gap[];
  lineEnds: LineEnd[];
  /** Prepared branches rarer than the threshold (absent in older results). */
  rare?: RareBranch[];
  /** Share of games that stays inside prepared territory (until your lines end). */
  coverage: number;
  positions: number;
  /** Positions that had to be asked from Lichess; the others came from this device's cache (absent in older results). */
  lookups?: number;
  errors: string[];
}

export interface GapOptions {
  ratings: number[];
  speeds: string[];
  /** Ignore everything that happens in fewer than this share of your games. */
  minReach: number;
  maxPly: number;
  /** Also every reply played in at least this share of the games from a position you reach in `minReach` of your
   *  games or more (the rule of the red boxes in Tree and Build, applied to the positions the check walks). */
  localShare?: number;
}

/** A reply played in at least this share of the games from its position is a gap there (Tree, Build, the check). */
export const LOCAL_GAP_SHARE = 0.05;

type Explore = (key: string) => Promise<ExplorerResult>;

/** Walks the repertoire against the database, half-move by half-move. A position you can reach by several move
 *  orders (1.d4 Nf6 2.c4 e6 and 1.d4 e6 2.c4 Nf6) is looked at once, with the shares of all routes added up, so
 *  the percentages are of all your games, whichever way they got there. */
export async function findGaps(
  rep: Repertoire,
  opts: GapOptions,
  onProgress: (done: number, current: string[], lookups: number) => void,
  signal: AbortSignal,
  explorer?: Explore,
): Promise<GapReport> {
  const report: GapReport = { gaps: [], lineEnds: [], coverage: 1, positions: 0, lookups: 0, errors: [] };
  const query = (key: string) => ({ db: 'lichess' as const, fen: keyToFen(key), ratings: opts.ratings, speeds: opts.speeds });
  if (!explorer) {
    // Everything this device asked Lichess before (in the last 30 days) comes from the cache in one go, so a new search
    // only waits for positions it has not seen. The walk itself always covers the whole repertoire.
    const keys = new Set<string>();
    for (const [key, moves] of Object.entries(rep.positions)) {
      if (!isMine(rep, key)) keys.add(key);
      else for (const m of moves) keys.add(m.to);
    }
    await warmCache([...keys].map((k) => explorerCacheKey(query(k))));
  }
  let uncovered = 0;
  const gaps = new Map<string, Gap & { best: number }>();
  const ends = new Map<string, LineEnd & { best: number }>();

  const explore = async (key: string): Promise<ExplorerResult | null> => {
    try {
      if (explorer) return await explorer(key);
      const q = query(key);
      if (peekCache(explorerCacheKey(q)) === undefined) report.lookups!++;
      return await fetchExplorer(q);
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      report.errors.push((e as Error).message);
      return null;
    }
  };

  // Positions waiting per half-move: reach summed over the routes that arrive there, and the line of the likeliest one.
  // `via`: the opponent's move that led there on that line.
  type Via = { from: string; uci: string; san: string };
  type Entry = { reach: number; line: string[]; best: number; routes: number; via?: Via };
  const levels = new Map<number, Map<string, Entry>>();
  const arrive = (ply: number, key: string, reach: number, line: string[], routes = 1, via?: Via) => {
    let level = levels.get(ply);
    if (!level) levels.set(ply, (level = new Map()));
    const e = level.get(key);
    if (!e) level.set(key, { reach, line, best: reach, routes, via });
    else {
      e.reach += reach;
      e.routes += routes;
      if (reach > e.best || (!e.via && via)) {
        e.best = reach;
        e.line = line;
        e.via = via;
      }
    }
  };
  const rare: RareBranch[] = [];
  arrive(0, ROOT, 1, []);

  for (let ply = 0; ply <= opts.maxPly && [...levels.keys()].some((p) => p >= ply); ply++) {
    const level = levels.get(ply);
    if (!level) continue;
    levels.delete(ply);
    for (const [key, { reach, line, routes, via }] of [...level].sort((a, b) => b[1].reach - a[1].reach)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // The reverse of a gap: a reply you prepared that you meet too rarely (only the first one on a branch: the walk
      // does not go on below it).
      if (reach < opts.minReach && via && ply <= opts.maxPly) {
        rare.push({ key, line, ...via, reach, routes, plies: deletionImpact(rep, via.from, via.uci).plies });
        continue;
      }
      if (ply >= opts.maxPly || reach < opts.minReach) continue;
      const prepared = movesAt(rep, key);

      if (isMine(rep, key)) {
        for (const m of prepared) arrive(ply + 1, m.to, reach, [...line, m.san], routes);
        continue;
      }

      onProgress(++report.positions, line, report.lookups!);
      const stats = await explore(key);
      if (!stats) continue;
      const total = totalGames(stats);
      if (!total) continue;

      if (!prepared.length) {
        if (line.length) {
          const prev = ends.get(key);
          if (prev) {
            prev.reach += reach;
            prev.routes += routes;
          } else
            ends.set(key, {
              key,
              line,
              reach,
              best: reach,
              routes,
              games: total,
              topMoves: stats.moves.slice(0, 3).map((m) => ({ san: m.san, share: totalGames(m) / total })),
            });
        }
        continue;
      }

      for (const em of stats.moves) {
        const share = totalGames(em) / total;
        const repMove = prepared.find((m) => m.san === em.san);
        if (repMove) arrive(ply + 1, repMove.to, reach * share, [...line, repMove.san], routes, { from: key, uci: repMove.uci, san: repMove.san });
        else {
          uncovered += reach * share;
          const id = `${key}|${em.san}`;
          const g = gaps.get(id);
          if (g) {
            g.reach += reach * share;
            g.routes += routes;
          } else gaps.set(id, { key, line, san: em.san, share, reach: reach * share, best: reach, games: totalGames(em), routes });
        }
      }
      // Replies you prepared that the database does not list here at all: rarer than anything it shows.
      for (const m of prepared)
        if (!stats.moves.some((em) => em.san === m.san)) arrive(ply + 1, m.to, 0, [...line, m.san], routes, { from: key, uci: m.uci, san: m.san });
    }
  }

  report.coverage = Math.max(0, 1 - uncovered);
  // Every position walked was reached in at least minReach of your games, so a reply common there counts too.
  const keep = (g: Gap) => g.reach >= opts.minReach || (opts.localShare !== undefined && g.share >= opts.localShare);
  report.gaps = [...gaps.values()].filter(keep).map(({ best: _b, ...g }) => g).sort((a, b) => b.reach - a.reach);
  report.lineEnds = [...ends.values()].map(({ best: _b, ...e }) => e).sort((a, b) => b.reach - a.reach);
  // The biggest branches first: where trimming saves the most.
  report.rare = rare.sort((a, b) => b.plies - a.plies || a.reach - b.reach);
  return report;
}

// ---------------------------------------------------------------------------

export interface EngineIssue extends LineRef {
  id: string;
  san: string;
  flag: EngineFlag;
}

export interface EngineOptions {
  maxPly: number;
  localDepth: number;
  /** Only report moves losing at least this many centipawns. */
  threshold: number;
}

function lineScore(evaluation: Evaluation, index = 0) {
  const l = evaluation.lines[index];
  return l ? scoreCp(l) : 0;
}

/** Evaluates every one of your moves; returns the flags to store and the issues above the threshold.
 *  `known`: earlier evaluations (the repertoire's engine flags). A move's evaluation depends only on its position and the
 *  move, not on the rest of the repertoire, so one made at least as deep as asked is reused as is; the result is the
 *  same as evaluating everything again, only the new or deeper evaluations take time. */
export async function engineCheck(
  rep: Repertoire,
  opts: EngineOptions,
  onProgress: (done: number, total: number, line: string[]) => void,
  signal: AbortSignal,
  known?: Record<string, EngineFlag>,
): Promise<{ flags: Record<string, EngineFlag>; issues: EngineIssue[]; evaluated: number; reused: number }> {
  const items: { node: TreeNode; line: string[] }[] = [];
  const walk = (nodes: TreeNode[], line: string[]) => {
    for (const n of nodes) {
      if (n.ply >= opts.maxPly) continue;
      if (n.mine) items.push({ node: n, line });
      walk(n.children, [...line, n.san]);
    }
  };
  walk(buildTree(rep), []);

  const sign = (side: Side) => (side === 'white' ? 1 : -1);
  const flags: Record<string, EngineFlag> = {};
  const issues: EngineIssue[] = [];
  let done = 0;
  let reused = 0;
  for (const { node, line } of items) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = edgeId(node.from, node.uci);
    const prev = known?.[id];
    if (prev && prev.depth >= opts.localDepth) {
      flags[id] = prev;
      if (prev.loss >= opts.threshold) issues.push({ key: node.from, line, id: node.id, san: node.san, flag: prev });
      reused++;
      done++;
      continue;
    }
    onProgress(done, items.length, [...line, node.san]);
    const before = await evaluate(node.from, { multiPv: 3, localDepth: opts.localDepth });
    const best = before.lines[0];
    if (!best) {
      done++;
      continue;
    }
    const idx = before.lines.findIndex((l) => l.uci[0] === node.uci);
    let mine: number;
    let depth = before.depth;
    if (idx >= 0) mine = lineScore(before, idx);
    else {
      const played = playSan(node.from, node.san);
      const after = played ? await evaluate(played.to, { multiPv: 1, localDepth: opts.localDepth }) : null;
      mine = after && after.lines.length ? lineScore(after) : lineScore(before);
      depth = Math.min(depth, after?.depth ?? depth);
    }
    const loss = Math.max(0, (lineScore(before) - mine) * sign(rep.side));
    const flag: EngineFlag = {
      loss: Math.round(loss),
      bestSan: best.san[0] ?? '',
      bestCp: best.mate !== undefined ? null : (best.cp ?? null),
      depth,
      at: Date.now(),
    };
    flags[edgeId(node.from, node.uci)] = flag;
    if (loss >= opts.threshold) issues.push({ key: node.from, line, id: node.id, san: node.san, flag });
    done++;
  }
  onProgress(done, items.length, []);
  issues.sort((a, b) => b.flag.loss - a.flag.loss);
  return { flags, issues, evaluated: items.length - reused, reused };
}

export function lossLabel(loss: number): { symbol: string; tone: 'ok' | 'dubious' | 'mistake' | 'blunder' } {
  if (loss >= 200) return { symbol: '??', tone: 'blunder' };
  if (loss >= 100) return { symbol: '?', tone: 'mistake' };
  if (loss >= 50) return { symbol: '?!', tone: 'dubious' };
  return { symbol: '', tone: 'ok' };
}

/** About how often you reach the end of `steps` in your games with `side`: the shares of the opponent's moves along
 *  this move order, from the database answers this device has (null when one is missing). */
export function reachOfLine(steps: readonly { from: string; san: string }[], side: Side, ratings: number[], speeds: string[]): number | null {
  let reach = 1;
  for (const m of steps) {
    if (turnOfKey(m.from) === side) continue;
    const stats = peekCache<ExplorerResult>(explorerCacheKey({ db: 'lichess', fen: keyToFen(m.from), ratings, speeds }));
    const total = stats ? totalGames(stats) : 0;
    const hit = stats?.moves.find((x) => x.san === m.san);
    if (!total || !hit) return null;
    reach *= totalGames(hit) / total;
  }
  return reach;
}
