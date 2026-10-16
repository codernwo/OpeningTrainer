// Practice whole lines: every line of a repertoire (or of one branch), each played to its end, the lines you will meet
// most often first. Nothing is graded: it is for exploring and rehearsing, the cards keep their schedule.
//
// How often you meet a line is the share of your games that follow it: the opponent's moves along the way, each as a
// share of the games in its position (the Lichess database as far as this device has looked positions up, otherwise
// your own games, otherwise each prepared reply equally often); your own moves count fully. A position reached by
// several move orders goes on from the most frequent one; each other move order gets a line of its own that runs
// through the transposition to an end, so every move of the repertoire is in at least one line.
import { isMine, movesAt, type Repertoire } from './repertoire';

export interface LineStep {
  from: string;
  to: string;
  uci: string;
  san: string;
  comment?: string;
}

export interface PracticeLine {
  /** The moves from the start position to the end of the line. */
  steps: LineStep[];
  /** About which share of your games follow this line to its end. */
  reach: number;
  /** False when some position had no counts, so its replies were taken as equally often. */
  known: boolean;
  /** The step that transposes into a position another line goes on from. */
  via?: number;
}

/**
 * How often the opponent plays `san` at `key`, as a share of the games there: 0 when the position is known but the move
 * is not among the counted ones, undefined when nothing is known about the position.
 */
export type ShareOf = (key: string, san: string) => number | undefined;

/** A prepared reply nobody plays (in the counts) still comes up, last. */
const RARE = 0.001;

/** The factor of each move at `key`: 1 for your moves, the opponent's share for theirs. */
function factors(rep: Repertoire, key: string, shareOf: ShareOf): { f: Map<string, number>; known: boolean } {
  const moves = movesAt(rep, key);
  const f = new Map<string, number>();
  if (isMine(rep, key)) {
    for (const m of moves) f.set(m.uci, 1);
    return { f, known: true };
  }
  const shares = moves.map((m) => shareOf(key, m.san));
  if (shares.every((s) => s === undefined)) {
    for (const m of moves) f.set(m.uci, 1 / moves.length);
    return { f, known: moves.length <= 1 };
  }
  moves.forEach((m, i) => f.set(m.uci, Math.max(shares[i] ?? 0, RARE)));
  return { f, known: true };
}

export function practiceLines(rep: Repertoire, start: string, shareOf: ShareOf): PracticeLine[] {
  const fac = new Map<string, ReturnType<typeof factors>>();
  const factorsAt = (key: string) => {
    let x = fac.get(key);
    if (!x) fac.set(key, (x = factors(rep, key, shareOf)));
    return x;
  };

  // The most frequent way to every position (moves only make a line rarer, so the first time a position comes off this
  // queue is its best way; equal ones keep the order they were found in, so the shortest move order wins a tie).
  const best = new Map<string, { reach: number; parent?: { from: string; step: LineStep } }>([[start, { reach: 1 }]]);
  const done = new Set<string>();
  const heap = new Heap();
  heap.push(1, start);
  for (let key = heap.pop(); key !== undefined; key = heap.pop()) {
    if (done.has(key)) continue;
    done.add(key);
    const reach = best.get(key)!.reach;
    const { f } = factorsAt(key);
    for (const m of movesAt(rep, key)) {
      if (done.has(m.to)) continue;
      const r = reach * f.get(m.uci)!;
      const had = best.get(m.to);
      if (!had || r > had.reach) {
        best.set(m.to, { reach: r, parent: { from: key, step: { from: key, to: m.to, uci: m.uci, san: m.san, comment: m.comment } } });
        heap.push(r, m.to);
      }
    }
  }

  const isTree = (from: string, uci: string, to: string) => {
    const p = best.get(to)?.parent;
    return !!p && p.from === from && p.step.uci === uci;
  };
  const treeChildren = (key: string) => movesAt(rep, key).filter((m) => isTree(key, m.uci, m.to));

  const measure = (steps: LineStep[]) => {
    let reach = 1;
    let known = true;
    for (const s of steps) {
      const x = factorsAt(s.from);
      reach *= x.f.get(s.uci) ?? 0;
      known &&= x.known;
    }
    return { reach, known };
  };

  const lines: PracticeLine[] = [];
  const walk = (key: string, path: LineStep[], onPath: Set<string>) => {
    const moves = movesAt(rep, key);
    // An end; a position whose moves all transpose elsewhere is covered by the lines through those transpositions.
    if (!moves.length && path.length) lines.push({ steps: path, ...measure(path) });
    for (const m of moves) {
      const step: LineStep = { from: key, to: m.to, uci: m.uci, san: m.san, comment: m.comment };
      if (isTree(key, m.uci, m.to)) {
        walk(m.to, [...path, step], new Set(onPath).add(m.to));
        continue;
      }
      // Another move order into a position that goes on elsewhere: through the transposition, then the most frequent
      // way on to an end (unless that would go round in a circle).
      const steps = [...path, step];
      const seen = new Set(onPath).add(m.to);
      let at = m.to;
      for (;;) {
        const next = treeChildren(at)
          .map((c) => ({ c, r: best.get(c.to)!.reach }))
          .sort((a, b) => b.r - a.r)[0]?.c;
        if (!next || seen.has(next.to)) break;
        steps.push({ from: at, to: next.to, uci: next.uci, san: next.san, comment: next.comment });
        seen.add(next.to);
        at = next.to;
      }
      lines.push({ steps, ...measure(steps), via: path.length });
    }
  };
  if (done.has(start)) walk(start, [], new Set([start]));

  // Most frequent first; equally frequent lines stay in the order of the tree.
  return lines.map((l, i) => ({ l, i })).sort((a, b) => b.l.reach - a.l.reach || a.i - b.i).map((x) => x.l);
}

/** A max-heap of positions by reach; equal ones come out in the order they went in. */
class Heap {
  private items: { r: number; n: number; key: string }[] = [];
  private n = 0;
  push(r: number, key: string) {
    const a = this.items;
    a.push({ r, n: this.n++, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): string | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top.key;
  }
  private before(x: { r: number; n: number }, y: { r: number; n: number }) {
    return x.r > y.r || (x.r === y.r && x.n < y.n);
  }
}
