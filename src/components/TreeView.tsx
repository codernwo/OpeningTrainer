import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadOpenings, shortName, useOpeningNames, useOpenings } from '../lib/openings';
import { formatLine, keyToFen, moveNumber, uciToArrow } from '../lib/chess';
import { lossLabel } from '../lib/audit';
import { useKey } from '../lib/hooks';
import { explorerCacheKey, peekCache, totalGames, warmCache, type ExplorerResult } from '../lib/lichess';
import {
  buildTree,
  deleteMove,
  deletionImpact,
  findPath,
  isMine,
  movesAt,
  reachable,
  ROOT,
  toMoves,
  type Repertoire,
  type TreeNode,
} from '../lib/repertoire';
import { nagText, nagTitle } from '../lib/nags';
import { tokensToShapes } from '../lib/shapes';
import { State } from '../lib/srs';
import { activeProfile, activeRep, useApp, type Profile } from '../lib/store';
import { Board, type Shape } from './Board';
import { GAP_SHARE } from './BuildView';
import { ChoiceDialog, type Choice } from './Dialog';
import { formatPct } from './ExplorerPanel';
import { Icon } from './Icon';

const ROW_H = 30;
const BOX_H = 22;
const PAD = 16;
/** Horizontal room between columns: expand toggle plus the curve. */
const GUTTER = 44;
const LABEL_FONT = '600 12.5px system-ui, sans-serif';
const SMALL_FONT = '500 11px system-ui, sans-serif';
const NAME_FONT = '600 10.5px system-ui, sans-serif';
/** Room above a box for the opening name of the branch it starts. */
const NAME_H = 14;
/** Top-down: height of one level (box, toggle and the curve to the next level). */
const LEVEL_H = 64;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

type Orientation = 'lr' | 'td';

function readOrientation(): Orientation {
  try {
    const o = localStorage.getItem('tree-orientation');
    if (o === 'lr' || o === 'td') return o;
  } catch {
    /* ignore */
  }
  // On a narrow (phone) screen the tree reads better top-down.
  return typeof innerWidth !== 'undefined' && innerWidth < 700 ? 'td' : 'lr';
}

/** `text`, shortened with an ellipsis to fit `max` pixels. */
function fitText(text: string, font: string, max: number): string {
  if (textWidth(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

type Highlight = 'none' | 'due' | 'flags' | 'rare';

interface LNode {
  id: string;
  col: number;
  /** Place among the leaves (a leaf's index; a branch sits in the middle of its children). */
  pos: number;
  /** Left edge of the box. */
  x: number;
  /** Centre of the box. */
  y: number;
  w: number;
  /** The opening name this move starts (what it adds to the branch's name), shown above the box. */
  name?: { short: string; full: string; shown: string };
  label: string;
  node: TreeNode | null; // null = root or gap ghost
  ghost?: { san: string; share: number };
  share?: number; // popularity of this move among the opponent's choices
  open: boolean;
  children: LNode[];
}

function explorerFor(profile: Profile, key: string): ExplorerResult | undefined {
  return peekCache<ExplorerResult>(explorerCacheKey({ db: 'lichess', fen: keyToFen(key), ratings: profile.ratings, speeds: profile.speeds }));
}

function shareOf(result: ExplorerResult | undefined, san: string): number | undefined {
  if (!result) return undefined;
  const total = totalGames(result);
  const m = result.moves.find((x) => x.san === san);
  return total ? (m ? totalGames(m) / total : 0) : undefined;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

function textWidth(text: string, font: string): number {
  const k = font + text;
  let w = widthCache.get(k);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = font;
      w = measureCtx.measureText(text).width;
    } else w = text.length * 7.5;
    widthCache.set(k, w);
  }
  return w;
}

function boxWidth(label: string, extra?: string) {
  return Math.ceil(16 + textWidth(label, LABEL_FONT) + (extra ? 4 + textWidth(extra, SMALL_FONT) : 0));
}

export function TreeView() {
  const rep = useApp(activeRep)!;
  const profile = useApp(activeProfile)!;
  const { updateRep, showToast, undoLast, goToKey } = useApp.getState();

  const [depth, setDepth] = useState(10); // plies open by default
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight>('none');
  const [showGaps, setShowGaps] = useState(true);
  const [zoom, setZoomState] = useState(1);
  const [orientation, setOrientationState] = useState<Orientation>(readOrientation);
  const setOrientation = (o: Orientation) => {
    setOrientationState(o);
    try {
      localStorage.setItem('tree-orientation', o);
    } catch {
      /* ignore */
    }
  };
  const showNames = useOpeningNames((s) => s.on);
  const setShowNames = useOpeningNames((s) => s.set);
  const openings = useOpenings((s) => s.byKey);
  useEffect(() => {
    if (showNames) void loadOpenings();
  }, [showNames]);
  const names = showNames && !!openings;
  const [cacheTick, setCacheTick] = useState(0);
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode; choices: Choice[] } | null>(null);

  const tree = useMemo(() => buildTree(rep), [rep]);

  // Pull explorer statistics we fetched earlier (browsing or gap analysis) into memory.
  useEffect(() => {
    const keys = [...reachable(rep.positions)]
      .filter((k) => !isMine(rep, k))
      .map((k) => explorerCacheKey({ db: 'lichess', fen: keyToFen(k), ratings: profile.ratings, speeds: profile.speeds }));
    warmCache(keys).then((n) => n && setCacheTick((t) => t + 1));
  }, [rep, profile.ratings, profile.speeds]);

  const byId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    const walk = (ns: TreeNode[]) => ns.forEach((n) => (m.set(n.id, n), walk(n.children)));
    walk(tree);
    return m;
  }, [tree]);

  const isOpen = (n: TreeNode) => n.children.length > 0 && (n.ply < depth - 1) !== toggled.has(n.id);

  const layout = useMemo(() => {
    let leaf = 0;
    const nodes: LNode[] = [];
    const ghostsAt = (key: string, ply: number, prepared: string[]): LNode[] => {
      if (!showGaps || isMine(rep, key) || !prepared.length) return [];
      const result = explorerFor(profile, key);
      if (!result) return [];
      const total = totalGames(result);
      return result.moves
        .filter((m) => !prepared.includes(m.san) && total && totalGames(m) / total >= GAP_SHARE)
        .slice(0, 4)
        .map((m) => {
          const share = totalGames(m) / total;
          const label = `${moveNumber(ply, true)}${m.san}`;
          const g: LNode = {
            id: `gap:${key}:${m.san}`,
            col: ply + 1,
            pos: leaf++,
            x: 0,
            y: 0,
            w: boxWidth(label, formatPct(share)),
            label,
            node: null,
            ghost: { san: m.san, share },
            open: false,
            children: [],
          };
          nodes.push(g);
          return g;
        });
    };
    const place = (n: TreeNode, parentName: string | undefined): LNode => {
      const parentStats = n.mine ? undefined : explorerFor(profile, n.from);
      // Moves outside the explorer's top list come back as 0: too rare to label.
      const rawShare = shareOf(parentStats, n.san);
      const share = rawShare ? rawShare : undefined;
      const flag = rep.engine[n.id];
      const label = `${moveNumber(n.ply, true)}${n.san}${flag ? lossLabel(flag.loss).symbol : ''}${n.transposition ? ' ↪' : ''}`;
      // A move that reaches a newly named opening position carries that name; its branch inherits it.
      // The list sometimes gives a later position a more general name (1.e4 c5 2.Nf3 d6 is "Modern Variations",
      // 3.d4 only "Sicilian Defense"): that is no new opening, the branch keeps its more specific name.
      const o = names ? openings!.get(n.to) : undefined;
      const named = o && o.name !== parentName && !(parentName && parentName.startsWith(o.name)) ? o : undefined;
      const ln: LNode = {
        id: n.id,
        col: n.ply + 1,
        pos: 0,
        x: 0,
        y: 0,
        w: boxWidth(label, share !== undefined ? formatPct(share) : undefined),
        label,
        name: named ? { short: shortName(named.name, parentName), full: `${named.eco} · ${named.name}`, shown: '' } : undefined,
        node: n,
        share,
        open: isOpen(n),
        children: [],
      };
      nodes.push(ln);
      const branchName = named?.name ?? parentName;
      if (ln.open) ln.children = n.children.map((c) => place(c, branchName));
      if (!n.transposition && (ln.open || !n.children.length)) {
        ln.children.push(...ghostsAt(n.to, n.ply + 1, movesAt(rep, n.to).map((m) => m.san)));
      }
      ln.pos = ln.children.length ? (ln.children[0].pos + ln.children.at(-1)!.pos) / 2 : leaf++;
      return ln;
    };
    const rootChildren = tree.map((n) => place(n, undefined));
    rootChildren.push(...ghostsAt(ROOT, 0, movesAt(rep, ROOT).map((m) => m.san)));
    const root: LNode = {
      id: 'root',
      col: 0,
      pos: rootChildren.length ? (rootChildren[0].pos + rootChildren.at(-1)!.pos) / 2 : 0,
      x: 0,
      y: 0,
      w: 56,
      label: 'Start',
      node: null,
      open: true,
      children: rootChildren,
    };
    nodes.push(root);
    const leaves = Math.max(leaf, 1);
    const nameH = names ? NAME_H : 0;
    const maxCol = Math.max(...nodes.map((n) => n.col));

    if (orientation === 'lr') {
      // Columns (one per half-move) as wide as their widest label; leaves one row each.
      const rowH = ROW_H + nameH;
      const colW: number[] = [];
      for (const n of nodes) colW[n.col] = Math.max(colW[n.col] ?? 0, n.w);
      const colX: number[] = [];
      let x = PAD;
      for (let c = 0; c < colW.length; c++) {
        colX[c] = x;
        x += (colW[c] ?? 40) + GUTTER;
      }
      for (const n of nodes) {
        n.x = colX[n.col];
        n.y = PAD + nameH + BOX_H / 2 + n.pos * rowH;
        if (n.name) n.name.shown = fitText(n.name.short, NAME_FONT, (colW[n.col] ?? 60) + GUTTER - 6);
      }
      const maxX = Math.max(...nodes.map((n) => n.x + n.w));
      return { nodes, root, width: maxX + PAD + 40, height: leaves * rowH + PAD * 2 };
    }

    // Top-down: one level per half-move; the leaves side by side, each as wide as the widest box.
    const nameW = Math.min(120, Math.max(0, ...nodes.map((n) => (n.name ? textWidth(n.name.short, NAME_FONT) : 0))));
    const slot = Math.max(64, nameW, ...nodes.map((n) => n.w)) + 14;
    const levelH = LEVEL_H + nameH;
    for (const n of nodes) {
      n.x = PAD + n.pos * slot + (slot - n.w) / 2;
      n.y = PAD + nameH + BOX_H / 2 + n.col * levelH;
      if (n.name) n.name.shown = fitText(n.name.short, NAME_FONT, slot - 6);
    }
    return { nodes, root, width: PAD * 2 + leaves * slot, height: PAD * 2 + (maxCol + 1) * levelH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, depth, toggled, showGaps, rep, profile, cacheTick, orientation, names, openings]);

  const toggle = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const now = Date.now();
  const matches = (n: TreeNode | null): boolean => {
    if (highlight === 'none' || !n) return true;
    if (highlight === 'due') {
      const c = rep.cards[n.id];
      return !!c && c.state !== State.New && c.due <= now;
    }
    if (highlight === 'flags') return !!rep.engine[n.id] && lossLabel(rep.engine[n.id].loss).tone !== 'ok';
    if (highlight === 'rare') {
      const s = shareOf(n.mine ? undefined : explorerFor(profile, n.from), n.san);
      return s !== undefined && s < 0.02;
    }
    return true;
  };

  const focus = byId.get(hovered ?? '') ?? byId.get(selected ?? '') ?? null;
  const focusShapes = rep.shapes?.[focus ? focus.to : ROOT];
  const drawn = useMemo(() => tokensToShapes(focusShapes) as Shape[], [focusShapes]);
  const selectedNode = byId.get(selected ?? '') ?? null;

  const askPrune = (n: TreeNode) => {
    const impact = deletionImpact(rep, n.from, n.uci);
    setDialog({
      title: `Prune branch ${moveNumber(n.ply, true)}${n.san}?`,
      body: (
        <>
          This removes <b>{impact.moves}</b> {impact.moves === 1 ? 'move' : 'moves'}
          {impact.cards > 0 && (
            <>
              {' '}
              and <b>{impact.cards}</b> training card{impact.cards === 1 ? '' : 's'}
            </>
          )}
          . Positions you also reach through another move order are kept.
        </>
      ),
      choices: [
        {
          label: 'Prune',
          kind: 'danger',
          run: () => {
            updateRep(rep.id, (r) => deleteMove(r, n.from, n.uci), `pruned branch ${n.san}`);
            setSelected(null);
            showToast(`Branch pruned (${impact.moves} ${impact.moves === 1 ? 'move' : 'moves'})`, { label: 'Undo', run: undoLast });
          },
        },
      ],
    });
  };

  useKey(
    (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        e.preventDefault();
        askPrune(selectedNode);
      }
    },
    [selectedNode, rep],
  );

  // Zoom keeps the point under the cursor (or between the fingers) in place.
  const scroller = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const el = scroller.current;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const z0 = zoomRef.current;
    if (el && z !== z0) {
      const a = anchor ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      pendingScroll.current = { left: ((el.scrollLeft + a.x) / z0) * z - a.x, top: ((el.scrollTop + a.y) / z0) * z - a.y };
    }
    zoomRef.current = z;
    setZoomState(z);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);
  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    zoomTo(Math.min(1, (el.clientWidth - 8) / layout.width, (el.clientHeight - 8) / layout.height));
    pendingScroll.current = { left: 0, top: 0 };
  };

  // Ctrl + wheel (and a trackpad pinch, which the browser reports as one) zooms.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // A mouse wheel notch (±100) zooms about 20%; a trackpad pinch sends many small steps.
      const step = Math.max(-50, Math.min(50, e.deltaY));
      zoomTo(zoomRef.current * Math.exp(-step * 0.004), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.length > 0]);

  // Drag (mouse or one finger) pans; two fingers pinch to zoom. A tap or click without moving still selects a move.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; left: number; top: number; moved: boolean; dist?: number; zoom?: number } | null>(null);
  const swallowClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const startPan = (x: number, y: number) => {
    const el = scroller.current!;
    gesture.current = { x, y, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) startPan(e.clientX, e.clientY);
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { x: 0, y: 0, left: 0, top: 0, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const el = scroller.current!;
    if (pointers.current.size >= 2 && g.dist) {
      const [a, b] = [...pointers.current.values()];
      const r = el.getBoundingClientRect();
      zoomTo(g.zoom! * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist), { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top });
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) > 6) {
      g.moved = true;
      setDragging(true);
    }
    if (g.moved) {
      el.scrollLeft = g.left - dx;
      el.scrollTop = g.top - dy;
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (gesture.current?.moved) swallowClick.current = true;
    if (pointers.current.size === 1) {
      // From a pinch back to one finger: go on panning from here.
      const [p] = [...pointers.current.values()];
      startPan(p.x, p.y);
      gesture.current!.moved = true;
    } else if (!pointers.current.size) {
      gesture.current = null;
      setDragging(false);
      setTimeout(() => (swallowClick.current = false), 0);
    }
  };

  const allIds = () => [...byId.values()].filter((n) => n.children.length).map((n) => n.id);

  return (
    <div className="tree-layout">
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="tree-toolbar">
          <span className="muted small">Open to move</span>
          <button className="btn sm icon" onClick={() => (setDepth((d) => Math.max(2, d - 2)), setToggled(new Set()))}>
            −
          </button>
          <b className="num" style={{ minWidth: 18, textAlign: 'center' }}>
            {Math.ceil(depth / 2)}
          </b>
          <button className="btn sm icon" onClick={() => (setDepth((d) => d + 2), setToggled(new Set()))}>
            +
          </button>
          <button className="btn sm ghost" onClick={() => (setDepth(200), setToggled(new Set()))} title="Expand all">
            <Icon name="expand" size={14} /> all
          </button>
          <button className="btn sm ghost" onClick={() => setToggled(new Set(allIds().filter((id) => byId.get(id)!.ply < depth - 1)))} title="Collapse all">
            <Icon name="collapse" size={14} /> collapse
          </button>
          <span className="spacer" />
          <select className="input" style={{ height: 28 }} value={highlight} onChange={(e) => setHighlight(e.target.value as Highlight)}>
            <option value="none">Highlight…</option>
            <option value="due">Due for review</option>
            <option value="flags">Engine doubts (?!, ?, ??)</option>
            <option value="rare">Rare moves (&lt;2%)</option>
          </select>
          <label className="row small" style={{ gap: 4 }}>
            <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} /> gaps
          </label>
          <label className="row small" style={{ gap: 4 }} title="Opening names where a branch starts a named opening">
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> names
          </label>
          <span className="tree-tools">
            <button
              className={`btn sm icon ${orientation === 'lr' ? 'on' : ''}`}
              aria-pressed={orientation === 'lr'}
              onClick={() => setOrientation('lr')}
              title="Left to right"
            >
              <Icon name="next" size={15} />
            </button>
            <button
              className={`btn sm icon ${orientation === 'td' ? 'on' : ''}`}
              aria-pressed={orientation === 'td'}
              onClick={() => setOrientation('td')}
              title="Top down"
            >
              <Icon name="next" size={15} className="rot90" />
            </button>
          </span>
          <span className="tree-tools">
            <button className="btn sm icon" onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= MIN_ZOOM} title="Zoom out (Ctrl + scroll, or pinch)">
              <Icon name="zoomOut" size={16} />
            </button>
            <button className="btn sm ghost num zoom-pct" onClick={() => zoomTo(1)} title="Back to 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button className="btn sm icon" onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= MAX_ZOOM} title="Zoom in (Ctrl + scroll, or pinch)">
              <Icon name="zoomIn" size={16} />
            </button>
            <button className="btn sm icon" onClick={fit} title="Fit the whole tree">
              <Icon name="fit" size={15} />
            </button>
          </span>
        </div>
        <div
          ref={scroller}
          className={`tree-scroll ${dragging ? 'dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={(e) => e.pointerType === 'mouse' && onPointerEnd(e)}
          onClickCapture={(e) => {
            // The end of a drag is not a click on the move under the pointer.
            if (swallowClick.current) {
              e.stopPropagation();
              swallowClick.current = false;
            }
          }}
        >
          {tree.length === 0 ? (
            <div className="empty" style={{ margin: 24 }}>
              This repertoire is still empty. Add moves in <b>Build</b> or import a PGN.
            </div>
          ) : (
            <svg
              className="tree-svg"
              width={layout.width * zoom}
              height={layout.height * zoom}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
            >
              <Edges root={layout.root} orientation={orientation} />
              {layout.nodes.map((ln) => {
                if (ln.ghost) {
                  return (
                    <g
                      key={ln.id}
                      className="gap-node"
                      transform={`translate(${ln.x},${ln.y - BOX_H / 2})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const parentKey = ln.id.split(':')[1];
                        goToKey(parentKey);
                      }}
                    >
                      <title>{`Not prepared: ${ln.ghost.san} (${formatPct(ln.ghost.share)} of games). Click to open.`}</title>
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={8} y={15}>
                        {ln.label} <tspan className="size-label">{formatPct(ln.ghost.share)}</tspan>
                      </text>
                    </g>
                  );
                }
                if (!ln.node) {
                  return (
                    <g key={ln.id} className="node opp" transform={`translate(${ln.x},${ln.y - BOX_H / 2})`} onClick={() => goToKey(ROOT)}>
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={10} y={15}>
                        {ln.label}
                      </text>
                    </g>
                  );
                }
                const n = ln.node;
                const card = rep.cards[n.id];
                const due = card && card.state !== State.New && card.due <= now;
                const cls = [
                  'node',
                  n.mine ? 'mine' : 'opp',
                  n.transposition ? 'transposition' : '',
                  selected === n.id ? 'selected' : '',
                  matches(n) ? '' : 'dim',
                ].join(' ');
                const td = orientation === 'td';
                return (
                  <g key={ln.id}>
                    {ln.name && (
                      <text
                        className="branch-name"
                        x={td ? ln.x + ln.w / 2 : ln.x + 2}
                        y={ln.y - BOX_H / 2 - 4}
                        textAnchor={td ? 'middle' : 'start'}
                      >
                        <title>{ln.name.full}</title>
                        {ln.name.shown}
                      </text>
                    )}
                    <g
                      className={cls}
                      transform={`translate(${ln.x},${ln.y - BOX_H / 2})`}
                      onClick={() => setSelected(n.id)}
                      onDoubleClick={() => goToKey(n.to)}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={8} y={15}>
                        {ln.label}
                        {ln.share !== undefined && <tspan className="size-label"> {formatPct(ln.share)}</tspan>}
                      </text>
                      {due && <circle cx={ln.w - 1} cy={1} r={4} fill="var(--due)" />}
                    </g>
                    {n.children.length > 0 && (
                      <g
                        className="toggle"
                        transform={td ? `translate(${ln.x + ln.w / 2},${ln.y + BOX_H / 2 + 9})` : `translate(${ln.x + ln.w + 9},${ln.y})`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggle(n.id)}
                      >
                        <circle r={7} />
                        <text textAnchor="middle" y={4}>
                          {ln.open ? '−' : '+'}
                        </text>
                        {!ln.open && (
                          <text className="size-label" x={12} y={4} textAnchor="start">
                            {toMoves(n.size - 1)}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="section mini-board">
            <Board
              position={focus ? focus.to : ROOT}
              orientation={rep.side}
              movable={null}
              lastMove={focus ? uciToArrow(focus.uci) : null}
              drawn={drawn}
            />
          </div>
          <div className="section stack" style={{ gap: 10 }}>
            {selectedNode ? (
              <NodeDetails rep={rep} node={selectedNode} profile={profile} onOpen={() => goToKey(selectedNode.to)} onPrune={() => askPrune(selectedNode)} />
            ) : (
              <div className="help">
                Click a move to select it; double-click to open it on the build board. Hover over the tree to preview positions.
                Prune the selected branch with <span className="kbd">Delete</span>.
              </div>
            )}
          </div>
        </div>
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <h3>Legend</h3>
          <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
            <span>
              <i style={{ background: 'var(--mine-soft)', border: '1.5px solid var(--mine)' }} />
              Your move (a training card)
            </span>
            <span>
              <i style={{ background: 'var(--surface)', border: '1.5px solid var(--opp)' }} />
              Opponent move · % = how often it is played
            </span>
            <span>
              <i style={{ background: 'var(--gap-soft)', border: '1.5px dashed var(--gap)' }} />
              Gap: played often, not prepared
            </span>
            <span>
              <i style={{ border: '1.5px dashed var(--faint)' }} />↪ Transposition (continued elsewhere)
            </span>
            <span>
              <i style={{ background: 'var(--due)', borderRadius: '50%' }} />
              Due for review
            </span>
            <span>Line thickness = popularity (Lichess database)</span>
          </div>
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Edges({ root, orientation }: { root: LNode; orientation: Orientation }) {
  const paths: React.ReactNode[] = [];
  const walk = (p: LNode) => {
    for (const c of p.children) {
      const toggle = p.node?.children.length ? 16 : 0;
      let d: string;
      if (orientation === 'td') {
        const x1 = p.x + p.w / 2;
        const y1 = p.y + BOX_H / 2 + toggle;
        const x2 = c.x + c.w / 2;
        const y2 = c.y - BOX_H / 2 - (c.name ? NAME_H : 0);
        const my = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
      } else {
        const x1 = p.x + p.w + toggle;
        const y1 = p.y;
        const x2 = c.x;
        const y2 = c.y;
        const mx = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      }
      const width = c.share !== undefined ? 1.5 + c.share * 10 : c.ghost ? 1.5 : 2;
      paths.push(<path key={c.id} className={c.ghost ? 'gap-edge' : 'edge'} d={d} strokeWidth={width} />);
      walk(c);
    }
  };
  walk(root);
  return <g>{paths}</g>;
}

function NodeDetails({
  rep,
  node,
  profile,
  onOpen,
  onPrune,
}: {
  rep: Repertoire;
  node: TreeNode;
  profile: Profile;
  onOpen: () => void;
  onPrune: () => void;
}) {
  const path = useMemo(() => {
    // Reconstruct the line by walking the tree down to this node.
    const find = (ns: TreeNode[], acc: string[]): string[] | null => {
      for (const n of ns) {
        if (n.id === node.id) return [...acc, n.san];
        const r = find(n.children, [...acc, n.san]);
        if (r) return r;
      }
      return null;
    };
    return find(buildTree(rep), []) ?? [node.san];
  }, [rep, node]);

  let due = 0;
  let cards = 0;
  const now = Date.now();
  const visit = (n: TreeNode) => {
    const c = rep.cards[n.id];
    if (c) {
      cards++;
      if (c.state !== State.New && c.due <= now) due++;
    }
    n.children.forEach(visit);
  };
  visit(node);
  const share = node.mine ? undefined : shareOf(explorerFor(profile, node.from), node.san);
  const flag = rep.engine[node.id];
  const edge = movesAt(rep, node.from).find((m) => m.uci === node.uci);
  const comment = edge?.comment;
  const symbols = nagText(edge?.nags);
  const { trainFrom, playFrom } = useApp.getState();

  return (
    <>
      <div style={{ fontWeight: 600 }}>{formatLine(path)}</div>
      <div className="row wrap">
        <span className={`badge ${isMine(rep, node.from) ? 'mine' : 'opp'}`}>{isMine(rep, node.from) ? 'your move' : 'opponent'}</span>
        <span className="badge" title={`${node.size} half-moves`}>
          {toMoves(node.size)} {toMoves(node.size) === 1 ? 'move' : 'moves'} in branch
        </span>
        <span className="badge">
          {node.leaves} {node.leaves === 1 ? 'line' : 'lines'}
        </span>
        {cards > 0 && <span className="badge accent">{cards} cards</span>}
        {due > 0 && <span className="badge due">{due} due</span>}
        {share !== undefined && <span className="badge">{formatPct(share)} played</span>}
        {flag && lossLabel(flag.loss).tone !== 'ok' && (
          <span className="badge gap">
            −{(flag.loss / 100).toFixed(1)} · better {flag.bestSan}
          </span>
        )}
        {(symbols.move || symbols.rest) && (
          <span className="badge" title={nagTitle(edge?.nags)}>
            {symbols.move} {symbols.rest}
          </span>
        )}
        {node.transposition && <span className="badge">transposition</span>}
      </div>
      {comment && <div className="comment-text small muted">{comment}</div>}
      <div className="row wrap">
        <button className="btn primary" onClick={onOpen}>
          <Icon name="board" size={16} /> Open on board
        </button>
        <button className="btn" onClick={() => trainFrom(node.to)} title="Train the branch that starts here">
          <Icon name="train" size={16} /> Train from here
        </button>
        <button className="btn" onClick={() => playFrom(findPath(rep, node.to) ?? [])} title="Play a practice game from this position">
          <Icon name="play" size={16} /> Play from here
        </button>
        <button className="btn danger" onClick={onPrune}>
          <Icon name="scissors" size={16} /> Prune branch
        </button>
      </div>
    </>
  );
}
