import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, keyToFen, moveFromBoard, posFromFen, START_KEY, turnOfKey, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import { flagged, hasClock, newClock, press, runFor, showTime, stop, tcLabel, tcPgn, timeLeft, type ClockState, type TimeControl } from '../lib/clock';
import { gameId, speedFromTimeControl, type GameResult, type PlayedGame } from '../lib/games';
import { flushGames, holdForGame, useGames, useRatings } from '../lib/gamesStore';
import { CATEGORY_NAMES, categoryOf, RATING_CATEGORIES, showRating, stakes, type CategoryRating, type Ratings } from '../lib/rating';
import { useAnalysisQueue } from '../lib/analyzer';
import { playMoveSound, playSound } from '../lib/sound';
import { capturedBy, materialBalance, type Captured } from '../lib/material';
import { createElement } from 'react';
import { loadMaia, MAIA_DOWNLOAD_MB, MAIA_MAX, MAIA_MIN, isMaiaDownloaded, useMaia } from '../lib/maia';
import { chooseOpponentMove, type MoveSource, type OpponentSettings } from '../lib/opponent';
import { findMove, movesAt, type Repertoire } from '../lib/repertoire';
import { activeProfile, activeRep, profileRating, useApp } from '../lib/store';
import { engine } from '../lib/engine';
import { getToken } from '../lib/lichess';
import { Board } from './Board';
import { GameReview } from './GameReview';
import { GameRow } from './GamesView';
import { OpeningLabel } from './OpeningLabel';
import { Icon } from './Icon';
import { RatingDiff } from './RatingDiff';

interface GameConfig {
  start: PlayedMove[];
  color: Side;
  settings: OpponentSettings;
  coach: boolean;
  tc: TimeControl;
  /** Counts for your rating (only with a clock, from the starting position). */
  rated: boolean;
}

export function levelName(level: number): string {
  if (level < 1000) return 'beginner';
  if (level < 1400) return 'casual player';
  if (level < 1800) return 'club player';
  if (level < 2100) return 'strong club player';
  if (level < 2400) return 'expert';
  return 'master';
}

function readPrefs(): Partial<{ level: number; mode: OpponentSettings['mode']; coach: boolean; tc: TimeControl; rated: boolean }> {
  try {
    return JSON.parse(localStorage.getItem('play-prefs') ?? '{}');
  } catch {
    return {};
  }
}

export function PlayView() {
  const [game, setGame] = useState<GameConfig | null>(null);
  const [round, setRound] = useState(0);
  // A practice game opened from the history: its review, with the analysis.
  const openId = useApp((s) => s.openGameId);
  const review = useGames((s) => (openId ? s.data.games.find((g) => g.id === openId && g.source === 'practice') : undefined));
  // Opening a game's review ends the game on the board (it is saved); coming back shows the setup and the history.
  useEffect(() => {
    if (review) setGame(null);
  }, [review]);
  if (review) return <GameReview key={review.id} game={review} />;
  if (game) return <GameSession key={round} config={game} onNew={() => setGame(null)} onRematch={() => setRound((r) => r + 1)} />;
  return <PlaySetup onStart={setGame} />;
}

const TC_PRESETS: TimeControl[] = [
  { minutes: 0, increment: 0 },
  { minutes: 1, increment: 0 },
  { minutes: 3, increment: 0 },
  { minutes: 3, increment: 2 },
  { minutes: 5, increment: 0 },
  { minutes: 5, increment: 3 },
  { minutes: 10, increment: 0 },
  { minutes: 10, increment: 5 },
  { minutes: 15, increment: 10 },
  { minutes: 30, increment: 0 },
];

/** Minutes per side (0 = no clock) and the increment, with the usual choices as shortcuts. */
function TimeSetting({ tc, onChange }: { tc: TimeControl; onChange: (tc: TimeControl) => void }) {
  return (
    <div className="field">
      <label>
        Time: <span className="num">{hasClock(tc) ? `${tc.minutes} min + ${tc.increment} s` : 'no clock'}</span>
      </label>
      <div className="row wrap" style={{ gap: 6 }}>
        {TC_PRESETS.map((p) => (
          <span
            key={tcLabel(p)}
            className={`chip ${tc.minutes === p.minutes && (tc.increment === p.increment || !hasClock(p)) ? 'on' : ''}`}
            onClick={() => onChange(p)}
          >
            {hasClock(p) ? tcLabel(p) : '∞'}
          </span>
        ))}
      </div>
      <div className="tc-sliders">
        <label className="small muted">
          Minutes per side <b className="num">{tc.minutes || '∞'}</b>
          <input type="range" min={0} max={60} step={1} value={tc.minutes} onChange={(e) => onChange({ ...tc, minutes: Number(e.target.value) })} />
        </label>
        <label className={`small muted ${hasClock(tc) ? '' : 'disabled'}`}>
          Increment per move <b className="num">{tc.increment} s</b>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={tc.increment}
            disabled={!hasClock(tc)}
            onChange={(e) => onChange({ ...tc, increment: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="help">0 minutes: no clock, take all the time you want. With a clock, running out of time loses the game.</div>
    </div>
  );
}

/** Your practice games, newest first: open one for its analysis and to make training cards of your mistakes. */
function PlayHistory({ ratings }: { ratings: Ratings }) {
  const profileId = useApp((s) => s.data.activeProfileId);
  const all = useGames((s) => s.data.games);
  const current = useAnalysisQueue((s) => s.current);
  const [showAll, setShowAll] = useState(false);
  const games = useMemo(
    () => all.filter((g) => g.source === 'practice' && g.profileId === profileId).sort((a, b) => b.playedAt - a.playedAt),
    [all, profileId],
  );
  if (!games.length) return null;
  const shown = showAll ? games : games.slice(0, 8);
  const score = games.reduce(
    (acc, g) => {
      const mine = g.myColor === 'white' ? '1-0' : '0-1';
      if (g.result === mine) acc.w++;
      else if (g.result === '1/2-1/2') acc.d++;
      else if (g.result !== '*') acc.l++;
      return acc;
    },
    { w: 0, d: 0, l: 0 },
  );
  return (
    <div className="card">
      <div className="section row wrap">
        <h3>Your practice games</h3>
        <span className="spacer" />
        <span className="small muted">
          {games.length} {games.length === 1 ? 'game' : 'games'} · {score.w} won, {score.d} drawn, {score.l} lost
        </span>
      </div>
      <div className="section small muted" style={{ paddingTop: 0 }}>
        Open a game for the analysis: its key moments, and your mistakes as training cards.
      </div>
      <div className="game-list">
        {shown.map((g) => (
          <GameRow key={g.id} game={g} analysing={current === g.id} rating={ratings.byGame.get(g.id)} />
        ))}
      </div>
      {games.length > shown.length && (
        <div className="section">
          <button className="btn sm ghost" onClick={() => setShowAll(true)}>
            Show all {games.length}
          </button>
        </div>
      )}
    </div>
  );
}

/** Your rating against Maia per tempo, once you have played rated games. */
function RatingCard({ ratings }: { ratings: Ratings }) {
  if (!RATING_CATEGORIES.some((c) => ratings.byCategory[c].games)) return null;
  return (
    <div className="card card-pad stack">
      <h3>Your rating against Maia</h3>
      <div className="rating-tiles">
        {RATING_CATEGORIES.map((c) => {
          const r = ratings.byCategory[c];
          return (
            <div key={c} className={`stat ${r.games ? '' : 'faint'}`}>
              <b>{showRating(r)}</b>
              <span>
                {CATEGORY_NAMES[c]} · {r.games} {r.games === 1 ? 'game' : 'games'}
              </span>
            </div>
          );
        })}
      </div>
      <div className="help">
        Glicko-2, as on Lichess, one rating per tempo; everyone starts at 400. A “?” means provisional: not enough games
        yet to be sure, so the rating still moves in big steps. Maia here plays like a person (it does not always play its
        favourite move), so this is a rating on its own scale, close to Lichess but not the same.
      </div>
    </div>
  );
}

/** Rated or casual: what you can win or lose against this opponent, and a fair opponent for your rating. */
function RatedSetting(props: {
  rated: boolean;
  canRate: boolean;
  reason: string;
  current: CategoryRating;
  category: string;
  level: number;
  white: boolean;
  fair: number;
  onRated: (r: boolean) => void;
  onLevel: (l: number) => void;
}) {
  const { rated, canRate, current, level, fair } = props;
  const s = stakes(current, level, props.white);
  const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');
  return (
    <div className="field">
      <label className={`row ${canRate ? '' : 'disabled'}`} style={{ cursor: canRate ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={rated && canRate} disabled={!canRate} onChange={(e) => props.onRated(e.target.checked)} />
        <b>Rated</b>
        {canRate && (
          <span className="muted">
            · your {props.category} rating <b className="num">{showRating(current)}</b>
          </span>
        )}
      </label>
      {!canRate ? (
        <div className="help">{props.reason}</div>
      ) : rated ? (
        <>
          <div className="help">
            Against Maia {level}: win <span className="rating-diff up">{signed(s.win)}</span> · draw{' '}
            <span className={`rating-diff ${s.draw > 0 ? 'up' : s.draw < 0 ? 'down' : ''}`}>{signed(s.draw)}</span> · loss{' '}
            <span className="rating-diff down">{signed(s.loss)}</span>. No take-backs and no repertoire hints; leaving the
            game counts as a loss.
          </div>
          {fair !== level && (
            <div className="help row wrap" style={{ gap: 6 }}>
              A fair opponent for you now:
              <button className="btn sm" onClick={() => props.onLevel(fair)}>
                Maia {fair}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="help">Casual: take-backs and hints allowed; your rating stays as it is.</div>
      )}
    </div>
  );
}

function PlaySetup({ onStart }: { onStart: (g: GameConfig) => void }) {
  const rep = useApp(activeRep);
  const profile = useApp(activeProfile)!;
  const start = useApp((s) => s.playStart);
  const setup = useApp((s) => s.playSetup);
  const playFrom = useApp((s) => s.playFrom);
  const maia = useMaia();
  const prefs = readPrefs();
  const clampLevel = (r: number) => Math.min(MAIA_MAX, Math.max(MAIA_MIN, Math.round(r / 100) * 100));
  // From a game review: the opponent's rating in that game.
  const [level, setLevel] = useState(setup?.level ? clampLevel(setup.level) : (prefs.level ?? clampLevel(profileRating(profile))));
  const [color, setColor] = useState<Side>(setup?.color ?? rep?.side ?? 'white');
  const [mode, setMode] = useState<OpponentSettings['mode']>(prefs.mode ?? 'realistic');
  const [coach, setCoach] = useState(prefs.coach ?? true);
  const [tc, setTc] = useState<TimeControl>(prefs.tc ?? { minutes: 0, increment: 0 });
  const [rated, setRated] = useState(prefs.rated ?? true);
  const ratings = useRatings(profile.id);
  const category = hasClock(tc) ? categoryOf(tc) : null;
  // Rated: with a clock, from the starting position (a game from a chosen position is practice, not a rated game).
  const canRate = !!category && start.length === 0;
  const isRated = rated && canRate;
  const current = ratings.byCategory[category ?? 'blitz'];
  const fair = clampLevel(current.rating);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isMaiaDownloaded().then(setDownloaded);
  }, []);
  useEffect(() => {
    // A level taken over from a game is not remembered as your usual choice.
    localStorage.setItem('play-prefs', JSON.stringify({ level: setup?.level ? (prefs.level ?? level) : level, mode, coach, tc, rated }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, mode, coach, tc, rated]);

  const go = async () => {
    setError(null);
    try {
      // Stockfish is not needed while playing; free its memory for Maia (matters on phones and tablets).
      engine.terminate();
      await loadMaia();
      // Rated: the opponent plays like real opponents (not into your preparation), and no hints.
      onStart({
        start,
        color,
        coach: isRated ? false : coach,
        tc,
        rated: isRated,
        settings: { level, playerRating: profileRating(profile), mode: isRated ? 'realistic' : mode, speeds: profile.speeds },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = maia.status === 'downloading' || maia.status === 'loading';

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }} className="stack">
      <div className="card card-pad stack" style={{ gap: 16 }}>
        <div>
          <h2>Play a practice game</h2>
          <div className="muted">Against a human-like opponent: it plays like a real person of the chosen rating.</div>
        </div>

        <div className="field">
          <label>Start from</label>
          <div className="row wrap">
            <span>
              {setup?.label ? (
                <>
                  {setup.label} <span className="muted small">({start.length ? `move ${Math.floor(start.length / 2) + 1}, ${turnOfKey(start.at(-1)!.to)} to move` : 'start'})</span>
                </>
              ) : start.length ? (
                formatLine(start.map((m) => m.san))
              ) : (
                'the starting position'
              )}
            </span>
            {start.length > 0 && (
              <button className="btn sm ghost" onClick={() => playFrom([])}>
                <Icon name="x" size={14} /> from move 1
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>
            Opponent strength: <span className="num">{level}</span> <span className="muted">({levelName(level)})</span>
          </label>
          <input type="range" min={MAIA_MIN} max={MAIA_MAX} step={100} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <div className="range-scale small faint">
            <span>{MAIA_MIN}</span>
            {/* Under the player's own rating on the slider, kept clear of the end labels. */}
            <span
              className="range-mark"
              style={{ left: `${Math.min(82, Math.max(18, (((isRated ? current.rating : profileRating(profile)) - MAIA_MIN) / (MAIA_MAX - MAIA_MIN)) * 100))}%` }}
            >
              {isRated && category ? `your ${CATEGORY_NAMES[category].toLowerCase()} rating ${showRating(current)}` : `your rating ≈ ${profileRating(profile)}`}
            </span>
            <span>{MAIA_MAX}</span>
          </div>
        </div>

        <div className="field">
          <label>You play</label>
          <div className="row">
            <button className={`btn ${color === 'white' ? 'primary' : ''}`} onClick={() => setColor('white')}>
              ♔ White
            </button>
            <button className={`btn ${color === 'black' ? 'primary' : ''}`} onClick={() => setColor('black')}>
              ♚ Black
            </button>
          </div>
        </div>

        <TimeSetting tc={tc} onChange={setTc} />

        <RatedSetting
          rated={rated}
          canRate={canRate}
          reason={!category ? 'Rated games need a clock.' : 'Rated games start from the starting position; this one is casual.'}
          current={current}
          category={category ? CATEGORY_NAMES[category].toLowerCase() : ''}
          level={level}
          white={color === 'white'}
          fair={fair}
          onRated={setRated}
          onLevel={setLevel}
        />

        <div className="field">
          <label>Opponent's opening choices</label>
          <label className={`row ${isRated ? 'disabled' : ''}`} style={{ alignItems: 'flex-start', cursor: isRated ? 'default' : 'pointer' }}>
            <input type="radio" checked={isRated || mode === 'realistic'} disabled={isRated} onChange={() => setMode('realistic')} style={{ marginTop: 4 }} />
            <span>
              <b>Like real opponents</b>
              <div className="help">
                Plays what people at this level actually play (Lichess database), then thinks for itself. Tests whether your
                preparation holds up — including moves you have not prepared.
              </div>
            </span>
          </label>
          <label className={`row ${isRated ? 'disabled' : ''}`} style={{ alignItems: 'flex-start', cursor: isRated ? 'default' : 'pointer' }}>
            <input type="radio" checked={!isRated && mode === 'repertoire'} disabled={isRated} onChange={() => setMode('repertoire')} style={{ marginTop: 4 }} />
            <span>
              <b>Stay inside my repertoire</b>
              <div className="help">
                Follows your prepared lines as long as they last (popular replies more often), then plays on as a human
                would. Good for rehearsing what you studied.
              </div>
            </span>
          </label>
          {isRated && <div className="help">In a rated game the opponent always plays like real opponents.</div>}
          {!getToken() && (
            <div className="help">Tip: connect Lichess in Settings so the opponent can use real game statistics.</div>
          )}
        </div>

        <label className={`row ${isRated ? 'disabled' : ''}`} style={{ cursor: isRated ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={coach && !isRated} disabled={isRated} onChange={(e) => setCoach(e.target.checked)} />
          Tell me when I leave my repertoire{isRated ? ' (not in rated games)' : ''}
        </label>

        {maia.status === 'downloading' && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="small muted">Downloading Maia… {maia.progress}%</div>
            <div className="progress">
              <div style={{ width: `${maia.progress}%` }} />
            </div>
          </div>
        )}
        {(error || maia.error) && <div className="notice error small">{error || maia.error}</div>}

        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={go}>
            <Icon name="play" size={16} />{' '}
            {busy ? 'Preparing…' : downloaded === false ? `Download Maia (±${MAIA_DOWNLOAD_MB} MB) and start` : 'Start game'}
          </button>
          {downloaded === false && <span className="small muted">One-time download, then it works offline too.</span>}
        </div>
      </div>
      <RatingCard ratings={ratings} />
      <PlayHistory ratings={ratings} />
      <div className="help">
        Opponent: Maia-3 by the CSSLab (University of Toronto) — a network trained on millions of human games that predicts
        what a player of a given rating would play. In the opening it uses the Lichess database at the same level, like Noctie.
      </div>
    </div>
  );
}

type Source = MoveSource | 'you' | 'start';

interface Result {
  text: string;
  result: GameResult;
  termination: string;
}

const winner = (side: Side): GameResult => (side === 'white' ? '1-0' : '0-1');
const sideName = (side: Side) => (side === 'white' ? 'White' : 'Black');
const otherSide = (side: Side): Side => (side === 'white' ? 'black' : 'white');

function isGameOver(key: string, history: string[]): Result | null {
  const pos = posFromFen(keyToFen(key));
  const outcome = pos.outcome();
  if (outcome) {
    if (!outcome.winner)
      return pos.isStalemate()
        ? { text: 'Draw by stalemate', result: '1/2-1/2', termination: 'Stalemate' }
        : { text: 'Draw (insufficient material)', result: '1/2-1/2', termination: 'Insufficient material' };
    return { text: `${sideName(outcome.winner)} wins by checkmate`, result: winner(outcome.winner), termination: 'Checkmate' };
  }
  if (history.filter((k) => k === key).length >= 3) return { text: 'Draw by threefold repetition', result: '1/2-1/2', termination: 'Threefold repetition' };
  return null;
}

/** Out of time: a loss, unless the other side has nothing left to mate with (then a draw, as on Lichess). */
function timeout(key: string, side: Side): Result {
  const pos = posFromFen(keyToFen(key));
  if (pos.hasInsufficientMaterial(otherSide(side)))
    return { text: `Draw: ${sideName(side)} ran out of time, but ${sideName(otherSide(side))} cannot win`, result: '1/2-1/2', termination: 'Time forfeit' };
  return { text: `${sideName(otherSide(side))} wins on time`, result: winner(otherSide(side)), termination: 'Time forfeit' };
}

/** One side's clock: big digits, red when low, highlighted while it runs. */
function ClockFace({ ms, running, low, label }: { ms: number; running: boolean; low: boolean; label: string }) {
  return (
    <div className={`clock ${running ? 'running' : ''} ${low ? 'low' : ''}`} aria-label={`${label}: ${showTime(ms)}`}>
      {showTime(ms)}
    </div>
  );
}

const LOW_TIME = 10_000;

/** The pieces one side has taken (drawn like the board's pieces, in the colour of their owner), and its material
 *  advantage when it has one. */
function CapturedPieces({ pieces, color, plus }: { pieces: Captured[]; color: Side; plus: number }) {
  return (
    <span className="captured cg-wrap" title={pieces.length ? `Captured: ${pieces.join(', ')}` : undefined}>
      {pieces.map((role, i) =>
        createElement('piece', { key: i, className: `${role} ${color}${i > 0 && pieces[i - 1] !== role ? ' gap' : ''}` }),
      )}
      {plus > 0 && <span className="material-plus">+{plus}</span>}
    </span>
  );
}

function GameSession({ config, onNew, onRematch }: { config: GameConfig; onNew: () => void; onRematch: () => void }) {
  const rep = useApp(activeRep);
  const profile = useApp(activeProfile)!;
  const { openLine, showToast, openGame } = useApp.getState();
  const [moves, setMoves] = useState<PlayedMove[]>(config.start);
  const [sources, setSources] = useState<Source[]>(config.start.map(() => 'start'));
  const [result, setResult] = useState<Result | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState<{ text: React.ReactNode; takeback?: boolean } | null>(null);
  const [orientation, setOrientation] = useState<Side>(config.color);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // The clock (none when the time is unlimited), and the time left after each move, for the game record.
  const tc = config.tc;
  const timed = hasClock(tc);
  const [clock, setClock] = useState<ClockState | null>(() => (timed ? newClock(tc) : null));
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [moveClocks, setMoveClocks] = useState<(number | null)[]>(() => config.start.map(() => null));
  const [, setTick] = useState(0);
  const lowWarned = useRef(false);

  // The game is kept in your history: when it ends, and when you leave it unfinished.
  const startedAt = useRef(Date.now()).current;
  const id = gameId(profile.id, `practice:${startedAt}`);
  const record = useRef({ moves, result, moveClocks });
  record.current = { moves, result, moveClocks };
  // Rated: your rating in this tempo when the game began (shown during the game), and what the game did to it.
  const ratings = useRatings(profile.id);
  const category = config.rated ? categoryOf(tc) : null;
  const ratingAtStart = useRef(category ? ratings.byCategory[category] : null).current;
  const ratingStep = config.rated ? ratings.byGame.get(id) : undefined;
  const save = () => {
    const { moves: ms, moveClocks: cs } = record.current;
    // Only games in which you played a move.
    const mine = ms.slice(config.start.length).some((m) => turnOfKey(m.from) === config.color);
    if (!mine) return;
    // A rated game you leave before it ends is lost, as on Lichess.
    const r: Result | null =
      record.current.result ??
      (config.rated ? { text: 'You left the game', result: winner(otherSide(config.color)), termination: 'Abandoned' } : null);
    const me = { name: profile.name, elo: profileRating(profile) };
    const maia = { name: 'Maia', elo: config.settings.level };
    const now = Date.now();
    const game: PlayedGame = {
      id,
      profileId: profile.id,
      source: 'practice',
      white: config.color === 'white' ? me.name : maia.name,
      black: config.color === 'black' ? me.name : maia.name,
      whiteElo: config.color === 'white' ? me.elo : maia.elo,
      blackElo: config.color === 'black' ? me.elo : maia.elo,
      myColor: config.color,
      result: r?.result ?? '*',
      termination: r?.termination ?? 'Unfinished',
      playedAt: now,
      speed: timed ? speedFromTimeControl(tcPgn(tc)) : undefined,
      timeControl: timed ? tcPgn(tc) : undefined,
      rated: config.rated,
      moves: ms.map((m) => m.san),
      clocks: timed ? cs : undefined,
      startPly: config.start.length || undefined,
      addedAt: now,
      updatedAt: now,
    };
    const games = useGames.getState();
    if (games.data.games.some((g) => g.id === id)) games.updateGame(id, (g) => ({ ...game, addedAt: g.addedAt, dismissed: g.dismissed }));
    else games.addGames([game]);
  };
  useEffect(() => {
    if (result) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => () => {
    if (!record.current.result) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rated game is kept from your first move on, as lost until it ends: closing or reloading the page cannot undo a
  // loss. When the page is hidden or closed, the moves so far are written too.
  const myMoves = moves.slice(config.start.length).filter((m) => turnOfKey(m.from) === config.color).length;
  const ratedOn = config.rated && myMoves > 0 && !result;
  const keep = () => {
    save();
    void flushGames(); // written at once, not after the usual short delay
  };
  useEffect(() => {
    if (ratedOn && myMoves === 1) keep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratedOn, myMoves]);
  useEffect(() => {
    if (!ratedOn) return;
    const onHide = () => document.visibilityState === 'hidden' && keep();
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // older Safari
    };
    addEventListener('pagehide', keep);
    addEventListener('beforeunload', warn);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      removeEventListener('pagehide', keep);
      removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratedOn]);

  // While the game goes on, the analysis of other games waits (Maia and the clock need the computer).
  useEffect(() => {
    holdForGame(!result);
    return () => holdForGame(false);
  }, [result]);

  useEffect(() => {
    playSound('GenericNotify');
    // The board in full view from the first move on (on a phone the setup may have been scrolled down).
    window.scrollTo({ top: 0 });
  }, []);

  const key = moves.at(-1)?.to ?? START_KEY;
  const turn = turnOfKey(key);
  const myTurn = turn === config.color;
  const coachRep: Repertoire | null = config.coach && !config.rated && rep && rep.side === config.color ? rep : null;
  // Still inside the repertoire: every move so far is a prepared move.
  const inBook = useMemo(() => !!rep && moves.every((m) => !!findMove(rep, m.from, m.uci)), [rep, moves]);

  const history = useMemo(() => [START_KEY, ...moves.map((m) => m.to)], [moves]);

  const finish = (r: Result) => {
    setResult(r);
    setClock((c) => (c ? stop(c, Date.now()) : c));
    const mine = winner(config.color);
    playSound(r.result === '1/2-1/2' ? 'Draw' : r.result === mine ? 'Victory' : 'Defeat');
  };

  /** A move by either side: on the board, with its sound, and on the clock. As on Lichess, the clock starts once both
   *  sides have made their first move. */
  const sessionMoves = useRef(0);
  const play = (m: PlayedMove, source: Source) => {
    const mover = turnOfKey(m.from);
    setMoves((ms) => [...ms, m]);
    setSources((ss) => [...ss, source]);
    const c = clockRef.current;
    sessionMoves.current++;
    if (c) {
      const next = sessionMoves.current < 2 ? c : press(c, mover, Date.now(), tc.increment * 1000);
      clockRef.current = next;
      setClock(next);
      setMoveClocks((cs) => [...cs, Math.round(next[mover] / 100) / 10]);
    } else setMoveClocks((cs) => [...cs, null]);
    playMoveSound(m);
  };

  // The clock ticks while it runs; a flag that falls ends the game.
  useEffect(() => {
    if (!clock?.running || result) return;
    const t = setInterval(() => {
      const c = clockRef.current;
      if (!c?.running) return;
      const now = Date.now();
      const out = flagged(c, now);
      if (out) {
        finish(timeout(record.current.moves.at(-1)?.to ?? START_KEY, out));
        return;
      }
      if (c.running === config.color && !lowWarned.current && timeLeft(c, config.color, now) < LOW_TIME && c[config.color] >= LOW_TIME) {
        lowWarned.current = true;
        playSound('LowTime');
      }
      setTick((x) => x + 1);
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock?.running, clock?.since, result]);

  useEffect(() => {
    const over = isGameOver(key, history);
    if (over) {
      if (!result) finish(over);
      return;
    }
    if (myTurn || result) return;
    let cancelled = false;
    setThinking(true);
    setError(null);
    const started = Date.now();
    chooseOpponentMove(rep, key, config.settings)
      .then(async (choice) => {
        // Humans take a moment; so does this opponent (less when its clock runs low).
        const c = clockRef.current;
        const budget = c ? timeLeft(c, turn, Date.now()) / 40 : Infinity;
        const wait = Math.min(350 + Math.random() * 700, budget) - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled || !alive.current || !choice || record.current.result) return;
        const leftBook = inBook && rep && !findMove(rep, choice.move.from, choice.move.uci) && movesAt(rep, key).length > 0;
        play(choice.move, choice.source);
        if (coachRep && leftBook) {
          setNotice({ text: <>The opponent left your preparation with {choice.move.san} — you are on your own now.</> });
        }
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setThinking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myTurn, result, retry]);

  const onMove = (orig: string, dest: string) => {
    if (!myTurn || result || thinking) return;
    const m = moveFromBoard(key, orig, dest);
    if (!m) return;
    const prepared = coachRep && inBook ? movesAt(coachRep, key) : [];
    setNotice(
      prepared.length && !prepared.some((p) => p.uci === m.uci)
        ? { text: <>You left your repertoire: you prepared <b>{prepared.map((p) => p.san).join(' or ')}</b> here.</>, takeback: true }
        : null,
    );
    play(m, 'you');
  };

  const flaggedOut = result?.termination === 'Time forfeit';
  const takeBack = () => {
    // Undo your last move (and the reply to it), back to a position where it is your turn. The time used stays used.
    for (let n = moves.length - 1; n >= config.start.length; n--) {
      if (turnOfKey(moves[n].from) !== config.color) continue;
      setMoves(moves.slice(0, n));
      setSources(sources.slice(0, n));
      setMoveClocks(moveClocks.slice(0, n));
      setResult(null);
      setNotice(null);
      setClock((c) => (c && (c.running || result) ? runFor(c, config.color, Date.now()) : c));
      return;
    }
  };

  const sans = moves.map((m) => m.san);
  const resultTag = result?.result ?? '*';
  const pgn = `[Event "Practice game"]\n[White "${config.color === 'white' ? 'You' : `Maia ${config.settings.level}`}"]\n[Black "${
    config.color === 'black' ? 'You' : `Maia ${config.settings.level}`
  }"]\n[Result "${resultTag}"]\n${timed ? `[TimeControl "${tcPgn(tc)}"]\n` : ''}\n${formatLine(sans)} ${resultTag}\n`;
  const lastMove = useMemo(() => (moves.length ? uciToArrow(moves[moves.length - 1].uci) : null), [moves]);

  const status = result
    ? result.text
    : thinking
      ? `Maia ${config.settings.level} is thinking…`
      : myTurn
        ? 'Your move'
        : '';

  const now = Date.now();
  const botSide = otherSide(config.color);
  const face = (side: Side, label: string) =>
    clock && (
      <ClockFace
        ms={timeLeft(clock, side, now)}
        running={clock.running === side}
        low={timeLeft(clock, side, now) < LOW_TIME}
        label={label}
      />
    );
  const taken = useMemo(() => capturedBy(moves), [moves]);
  const balance = useMemo(() => materialBalance(key), [key]);
  const ahead = (side: Side) => (side === 'white' ? balance : -balance);

  return (
    <div className="train">
      <div className="board-col with-bars">
        <div className="clock-bar">
          <span className="bar-name small muted">Maia {config.settings.level}</span>
          <CapturedPieces pieces={taken[botSide]} color={config.color} plus={ahead(botSide)} />
          {face(botSide, 'Maia')}
        </div>
        <div className="board-area">
          <Board
            position={key}
            orientation={orientation}
            movable={myTurn && !result && !thinking ? config.color : null}
            lastMove={lastMove}
            onMove={onMove}
          />
        </div>
        <div className="clock-bar">
          <span className="bar-name small muted">
            You{ratingAtStart ? ` ${showRating(ratingAtStart)}` : ''}
            {clock ? ` · ${tcLabel(tc)}` : ''}
            {config.rated ? ' · rated' : ''}
          </span>
          <CapturedPieces pieces={taken[config.color]} color={botSide} plus={ahead(config.color)} />
          {face(config.color, 'You')}
        </div>
      </div>
      <div className="stack">
        <div className="card card-pad stack">
          <div className="row">
            <span className="avatar" style={{ background: '#6b5bd6', width: 28, height: 28 }}>
              M
            </span>
            <div>
              <b>Maia {config.settings.level}</b>
              <div className="small muted">
                {levelName(config.settings.level)} · plays {config.color === 'white' ? 'Black' : 'White'} · {tcLabel(tc)}
                {category ? ` · rated ${CATEGORY_NAMES[category].toLowerCase()}` : ''}
              </div>
            </div>
            <span className="spacer" />
            {inBook && rep && !config.rated && <span className="badge mine">in your repertoire</span>}
          </div>
          <OpeningLabel keys={history} />
          <div className={`feedback ${result ? 'info' : myTurn ? 'good' : 'info'}`}>{status}</div>
          {result && category && ratingStep && (
            <div className="row wrap rating-result">
              <span className="muted">{CATEGORY_NAMES[category]} rating</span>
              <span className="num">{Math.round(ratingStep.before)}</span>→
              <b className="num">{showRating({ rating: ratingStep.after, provisional: ratingStep.provisional })}</b>
              <RatingDiff before={ratingStep.before} after={ratingStep.after} />
            </div>
          )}
          {config.rated && !result && (
            <div className="small muted">Rated game: no take-backs; leaving the game counts as a loss.</div>
          )}
          {notice && (
            <div className="notice small row wrap">
              <span style={{ flex: 1 }}>{notice.text}</span>
              {notice.takeback && (
                <button className="btn sm" onClick={takeBack} disabled={flaggedOut}>
                  Take back
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="notice error small row wrap">
              <span style={{ flex: 1 }}>{error}</span>
              <button className="btn sm" onClick={() => setRetry((r) => r + 1)}>
                Try again
              </button>
            </div>
          )}
          <MoveList moves={moves} sources={sources} />
          <div className="row wrap">
            {!config.rated && (
              <button className="btn" onClick={takeBack} disabled={thinking || flaggedOut || moves.length <= config.start.length}>
                <Icon name="undo" size={16} /> Take back
              </button>
            )}
            {!result ? (
              <button
                className="btn"
                onClick={() => finish({ text: `${sideName(botSide)} wins (you resigned)`, result: winner(botSide), termination: 'Resignation' })}
              >
                <Icon name="flag" size={16} /> Resign
              </button>
            ) : (
              <button className="btn primary" onClick={onRematch}>
                <Icon name="refresh" size={16} /> Play again
              </button>
            )}
            <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board">
              <Icon name="flip" />
            </button>
          </div>
          {result && (
            <div className="row wrap">
              <button className="btn primary sm" onClick={() => openGame(id)} title="The engine's analysis of this game, and your mistakes as training cards">
                <Icon name="games" size={14} /> Analyse this game
              </button>
              <span className="small muted">Saved in your practice games.</span>
            </div>
          )}
          {/* During a rated game: no analysis, no copying the game out (only after it ends). */}
          {!(config.rated && !result) && (
          <div className="row wrap">
            <button className="btn sm ghost" onClick={() => openLine(moves)} title="Load this game on the build board to add moves to your repertoire">
              <Icon name="board" size={14} /> Open in Build
            </button>
            <button
              className="btn sm ghost"
              onClick={() => navigator.clipboard?.writeText(pgn).then(() => showToast('PGN copied'), () => showToast('Could not copy'))}
            >
              <Icon name="copy" size={14} /> Copy PGN
            </button>
            <a
              className="btn sm ghost"
              href={`https://lichess.org/analysis/pgn/${encodeURIComponent(formatLine(sans).replace(/ /g, '_'))}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={14} /> Analyse on Lichess
            </a>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={onNew}>
              New game…
            </button>
          </div>
          )}
        </div>
        <div className="help">
          Tags: <span className="badge mine">book</span> your prepared line · <span className="badge accent">db</span> Lichess
          games at this level · <span className="badge">maia</span> the network's own choice.
        </div>
      </div>
    </div>
  );
}

function MoveList({ moves, sources }: { moves: PlayedMove[]; sources: Source[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll the list itself to the newest move. (scrollIntoView would scroll the whole page too: on a phone, where the
    // list is under the board, the board would slide out of view after every move.)
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);
  if (!moves.length) return <div className="small faint">No moves yet.</div>;
  const tag = (s: Source) =>
    s === 'repertoire' ? <span className="badge mine">book</span> : s === 'database' ? <span className="badge accent">db</span> : s === 'maia' ? <span className="badge">maia</span> : null;
  return (
    <div ref={box} style={{ maxHeight: 220, overflow: 'auto', lineHeight: 2 }}>
      {moves.map((m, i) => (
        <span key={i} style={{ marginRight: 6, whiteSpace: 'nowrap', opacity: sources[i] === 'start' ? 0.6 : 1 }}>
          {i % 2 === 0 && <span className="faint">{i / 2 + 1}. </span>}
          <b>{m.san}</b> {tag(sources[i])}
        </span>
      ))}
    </div>
  );
}
