import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, outcome, type PlayedGame } from '../lib/games';
import { START, type RatingCategory, type Ratings } from '../lib/rating';
import { useApp } from '../lib/store';
import { RatingDiff } from './RatingDiff';

/** Your rating in one tempo, game by game: the line is the rating, the band its uncertainty (± RD), which narrows as
 *  you play. Hover a point for the game; click to open it. */
export function RatingChart({ ratings, category, games }: { ratings: Ratings; category: RatingCategory; games: PlayedGame[] }) {
  const openGame = useApp((s) => s.openGame);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  // The start (400 ± 350), then the rating after each game.
  const pts = useMemo(() => {
    const steps = [...ratings.byGame.entries()].filter(([, s]) => s.category === category);
    return [
      { id: null as string | null, rating: START.rating, rd: START.rd, before: START.rating, at: steps[0]?.[1].playedAt ?? 0 },
      ...steps.map(([id, s]) => ({ id: id as string | null, rating: s.after, rd: s.rd, before: s.before, at: s.playedAt })),
    ];
  }, [ratings, category]);
  if (pts.length < 2) return null;

  const H = 170;
  const L = 36;
  const R = 8;
  const T = 8;
  const B = 18;
  const values = pts.map((p) => p.rating);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 60) / 100) * 100);
  const hi = Math.ceil((Math.max(...values) + 60) / 100) * 100;
  const step = hi - lo > 800 ? 200 : 100;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const clampY = (v: number) => Math.min(hi, Math.max(lo, v));
  const x = (k: number) => L + (k / (pts.length - 1)) * (width - L - R);
  const y = (v: number) => T + (1 - (clampY(v) - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, k) => `${x(k).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' L');
  const band =
    pts.map((p, k) => `${x(k).toFixed(1)},${y(p.rating + p.rd).toFixed(1)}`).join(' L') +
    ' L' +
    [...pts]
      .map((p, k) => ({ p, k }))
      .reverse()
      .map(({ p, k }) => `${x(k).toFixed(1)},${y(p.rating - p.rd).toFixed(1)}`)
      .join(' L');

  const near = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const k = Math.round(((clientX - r.left - L) / (width - L - R)) * (pts.length - 1));
    return Math.max(0, Math.min(pts.length - 1, k));
  };
  const h = hover !== null ? pts[hover] : null;
  const hg = h?.id ? byId.get(h.id) : undefined;
  const o = hg ? outcome(hg) : null;
  const opp = hg ? (hg.myColor === 'white' ? hg.blackElo : hg.whiteElo) : undefined;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div
        ref={box}
        className="trend rating-chart"
        onPointerMove={(e) => setHover(near(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const p = pts[near(e.clientX)];
          if (p.id) openGame(p.id);
        }}
      >
        <svg width={width} height={H} role="img" aria-label={`Rating after each game, from ${pts[0].rating} to ${Math.round(pts.at(-1)!.rating)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} className="grid" />
              <text x={L - 6} y={y(v) + 3} className="axis" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <path d={`M${band} Z`} className="band" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />}
          <path d={`M${line}`} className="avg" />
          {pts.map((p, k) => (
            <circle key={k} cx={x(k)} cy={y(p.rating)} r={hover === k ? 5 : 4} className={`rating-dot ${k === 0 ? 'start' : ''}`} />
          ))}
          <text x={L} y={H - 4} className="axis">
            start
          </text>
          <text x={width - R} y={H - 4} className="axis" textAnchor="end">
            {pts.length - 1} {pts.length === 2 ? 'game' : 'games'} · {formatDate(pts.at(-1)!.at)}
          </text>
        </svg>
        {h && (
          <div className="trend-tip" style={{ left: Math.min(width - 190, Math.max(0, x(hover!) - 90)) }}>
            {h.id ? (
              <>
                <b className="num">{Math.round(h.rating)}</b> <RatingDiff before={h.before} after={h.rating} />{' '}
                <span className="muted">± {Math.round(h.rd)}</span>
                <div className="small muted">
                  {o === 'win' ? 'Won' : o === 'loss' ? 'Lost' : o === 'draw' ? 'Draw' : 'Game'} vs Maia {opp ?? ''} · {formatDate(h.at)}
                  {hg?.termination && hg.termination !== 'Normal' ? ` · ${hg.termination.toLowerCase()}` : ''}
                </div>
              </>
            ) : (
              <>
                <b className="num">{START.rating}</b> <span className="muted">± {START.rd}</span>
                <div className="small muted">Where everyone starts</div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="legend small muted">
        <span>
          <i className="key-line" /> rating after each game (click to open)
        </span>
        <span>
          <i className="key-band" /> uncertainty (± RD): narrows as you play
        </span>
      </div>
    </div>
  );
}
