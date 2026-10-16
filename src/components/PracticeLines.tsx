import { useEffect, useMemo, useRef, useState } from 'react';
import { keyToFen, lineFromSans, moveFromBoard, uciToArrow } from '../lib/chess';
import { gamesOf, useGames } from '../lib/gamesStore';
import { explorerCacheKey, peekCache, totalGames, warmCache, type ExplorerResult } from '../lib/lichess';
import { practiceLines, type PracticeLine, type ShareOf } from '../lib/practiceLines';
import { replyCounts } from '../lib/practiceReply';
import { isMine, movesAt, reachable, ROOT, type PathStep, type Repertoire } from '../lib/repertoire';
import { moveNo } from '../lib/analysis';
import { playMoveSound } from '../lib/sound';
import { useKey, useScrollToTop } from '../lib/hooks';
import { activeProfile, useApp } from '../lib/store';
import { Board, moveArrow, type Shape } from './Board';
import { OpeningLabel } from './OpeningLabel';
import { AuthorText, PositionLinks, tailOf, useFlash } from './TrainView';

interface Words {
  label: string;
  text: string;
}

const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : '<1%');

/**
 * Practice whole lines: every line of the repertoire (or of the branch you train from), each to its end and past the
 * training depth, the lines you meet most often first. Nothing is graded: the cards keep their schedule.
 */
export function PracticeSession({ rep, start, onExit }: { rep: Repertoire; start: PathStep[]; onExit: () => void }) {
  useScrollToTop();
  const profile = useApp(activeProfile);
  const gamesData = useGames((s) => s.data);
  const startKey = start.at(-1)?.to ?? ROOT;
  const startSans = start.map((s) => s.san);
  const [lines, setLines] = useState<PracticeLine[] | null>(null);
  const [index, setIndex] = useState(0);
  const [k, setK] = useState(0);
  const [shown, setShown] = useState(startKey);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [message, setMessage] = useState<React.ReactNode>(null);
  // The author's words: on your last move (in view until your next one), and on the opponent's move and its position.
  const [mine, setMine] = useState<Words[]>([]);
  const [theirs, setTheirs] = useState<Words[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ lines: 0, good: 0, bad: 0 });
  // A line with a mistake comes again until you play it through without one (or go on with Next line).
  const [missed, setMissed] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [flash, triggerFlash] = useFlash();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  // The lines, once: how often each is met comes from the Lichess database as far as this device looked positions up
  // (as the Tree's line thickness), otherwise from your own games.
  useEffect(() => {
    let alive = true;
    const own = replyCounts(gamesOf(gamesData, rep.profileId), rep.side);
    const query = (key: string) => ({ db: 'lichess' as const, fen: keyToFen(key), ratings: profile?.ratings ?? [], speeds: profile?.speeds ?? [] });
    const theirs = [...reachable(rep.positions, startKey)].filter((key) => !isMine(rep, key) && movesAt(rep, key).length > 1);
    const shareOf: ShareOf = (key, san) => {
      const result = peekCache<ExplorerResult>(explorerCacheKey(query(key)));
      const total = result ? totalGames(result) : 0;
      if (result && total) {
        const m = result.moves.find((x) => x.san === san);
        return m ? totalGames(m) / total : 0;
      }
      const at = own.get(key);
      const played = at ? [...at.values()].reduce((a, b) => a + b, 0) : 0;
      return at && played ? (at.get(san) ?? 0) / played : undefined;
    };
    warmCache(theirs.map((key) => explorerCacheKey(query(key))))
      .catch(() => 0)
      .then(() => alive && setLines(practiceLines(rep, startKey, shareOf)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const line = lines?.[index];
  const steps = line?.steps ?? [];
  const pos = k ? steps[k - 1].to : startKey;
  const played = steps.slice(0, k);
  const next = steps[k];

  const goTo = (i: number) => {
    clearTimers();
    setAttempt((a) => (i === index ? a + 1 : 1));
    setMissed(false);
    setIndex(i);
    setK(0);
    setShown(startKey);
    setShapes([]);
    setMessage(null);
    setTheirs([]);
    setBusy(false);
  };

  // The opponent plays the line's move; at the end of a line, on to the next one — or the same one again after a mistake.
  useEffect(() => {
    if (!line) return;
    if (k === steps.length) {
      setBusy(true);
      if (missed) {
        setMessage(<>End of the line — once more, without a mistake.</>);
        later(() => goTo(index), 1600);
        return;
      }
      setMessage(line.via !== undefined ? <>End of the line ✓ (it transposed after {moveNo(start.length + line.via)}{steps[line.via].san})</> : <>End of the line ✓</>);
      setStats((s) => ({ ...s, lines: s.lines + 1 }));
      later(() => goTo(index + 1), 1400);
      return;
    }
    if (isMine(rep, next.from)) return;
    setBusy(true);
    const t = setTimeout(() => {
      playMoveSound(next);
      setShown(next.to);
      setK(k + 1);
      setBusy(false);
      const said = next.comment?.trim();
      const note = rep.notes[next.to]?.trim();
      setTheirs([...(said ? [{ label: `${moveNo(start.length + k)}${next.san}`, text: said }] : []), ...(note ? [{ label: 'Note', text: note }] : [])]);
    }, k === 0 ? 700 : 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, k]);

  const onMove = (orig: string, dest: string) => {
    if (!next) return;
    const m = moveFromBoard(pos, orig, dest);
    if (!m) return;
    playMoveSound(m);
    if (m.uci === next.uci) {
      triggerFlash('flash-good');
      setShapes([]);
      setMessage(null);
      setStats((s) => ({ ...s, good: s.good + 1 }));
      setShown(next.to);
      setK(k + 1);
      const text = next.comment?.trim();
      setMine(text ? [{ label: `${moveNo(start.length + k)}${next.san}`, text }] : []);
      setTheirs([]);
      return;
    }
    const other = movesAt(rep, pos).some((x) => x.uci === m.uci);
    if (!other) {
      triggerFlash('flash-bad');
      setStats((s) => ({ ...s, bad: s.bad + 1 }));
      setMissed(true);
    }
    setShown(m.to);
    setBusy(true);
    setMessage(
      other ? (
        <>
          Also yours — this line goes on with <b>{next.san}</b>.
        </>
      ) : (
        <>
          Your repertoire plays <b>{next.san}</b> here.
        </>
      ),
    );
    later(() => {
      setShown(pos);
      setBusy(false);
      setShapes([moveArrow(next.uci, rep.side)]);
    }, 650);
  };

  useKey(
    (e) => {
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && lines && index < lines.length) goTo(index + 1);
    },
    [lines, index],
  );

  const header = (
    <div className="row">
      <h2>Practice lines</h2>
      <span className="spacer" />
      <span className="badge mine">{stats.good} right</span>
      <span className="badge gap">{stats.bad} wrong</span>
    </div>
  );

  const unknown = useMemo(() => !!lines?.some((l) => !l.known), [lines]);
  // The same array while nothing changes: a new one would set the board up again and drop a piece you had picked up.
  const lastUci = k ? steps[k - 1]?.uci : start.at(-1)?.uci;
  const lastMove = useMemo(() => (shown === pos && lastUci ? uciToArrow(lastUci) : null), [shown === pos, lastUci]); // eslint-disable-line react-hooks/exhaustive-deps

  if (lines && index >= lines.length) {
    return (
      <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
        <h2>{lines.length ? `All ${lines.length} lines played ✓` : 'No lines here'}</h2>
        {lines.length > 0 && (
          <div className="muted">
            {stats.good} right, {stats.bad} wrong. Practice does not change your training schedule.
          </div>
        )}
        <div className="row">
          {lines.length > 0 && (
            <button
              className="btn primary"
              onClick={() => {
                setStats({ lines: 0, good: 0, bad: 0 });
                goTo(0);
              }}
            >
              Again
            </button>
          )}
          <button className="btn" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const sans = [...startSans, ...played.map((s) => s.san)];
  return (
    <div className="train">
      <div className="board-area">
        <Board
          className={flash}
          position={shown}
          orientation={rep.side}
          movable={line && !busy && next && isMine(rep, pos) ? rep.side : null}
          lastMove={lastMove}
          shapes={shapes}
          onMove={onMove}
        />
      </div>
      <div className="stack train-panel">
        <div className="card card-pad stack">
          {header}
          <div className="small muted">
            {lines ? (
              <>
                Line {index + 1} of {lines.length}
                {attempt > 1 && <> · try {attempt}</>}
                {line?.known && <> · about {pct(line.reach)} of your games{start.length ? ' from here' : ''}</>}
              </>
            ) : (
              'Finding the lines…'
            )}
          </div>
          <div className="progress">
            <div style={{ width: `${lines?.length ? (index / lines.length) * 100 : 0}%` }} />
          </div>
          <div className="small muted train-context">{tailOf(sans) || 'Starting position'}</div>
          <OpeningLabel keys={(lineFromSans(sans) ?? []).map((m) => m.to)} reserve />
          <div className="feedback info">{message ?? (!line ? '…' : next && isMine(rep, pos) ? 'Your move.' : 'Opponent…')}</div>
          <div className="row">
            <button className="btn" onClick={() => goTo(index)} disabled={!line}>
              Restart line
            </button>
            <button className="btn" onClick={() => goTo(index + 1)} disabled={!line} title="Skip to the next line (N)">
              Next line
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onExit}>
              Stop
            </button>
          </div>
          <PositionLinks line={lineFromSans(sans) ?? []} positionKey={pos} orientation={rep.side} />
          <AuthorText words={[...mine, ...theirs]} />
          <div className="small faint">
            Every line to its end{rep.trainDepth ? `, also past move ${rep.trainDepth}` : ''}, the ones you meet most first. A line with a
            mistake comes again until you play it without one (or press Next line). Practice leaves your training schedule alone.
            {unknown && ' Where nothing is known about a position, its replies count as equally often.'}
          </div>
        </div>
      </div>
    </div>
  );
}
