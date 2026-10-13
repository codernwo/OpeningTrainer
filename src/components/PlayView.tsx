import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, keyToFen, moveFromBoard, posFromFen, START_KEY, turnOfKey, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import { flagged, hasClock, newClock, press, resumedClock, runFor, showTime, stop, tcLabel, tcPgn, timeLeft, type ClockState, type TimeControl } from '../lib/clock';
import { formatDate, gameId, speedFromTimeControl, type GameResult, type PlayedGame } from '../lib/games';
import { flushGames, holdForGame, useGames, useRatings, type PlayerRatings } from '../lib/gamesStore';
import { positionKeys, prepCheck } from '../lib/insights';
import { CATEGORY_NAMES, categoryOf, RATING_CATEGORIES, runsOf, showRating, stakes, type CategoryRating, type RatingCategory, type RatingRun, type Ratings } from '../lib/rating';
import { useAnalysisQueue } from '../lib/analyzer';
import { playMoveSound, playSound } from '../lib/sound';
import { materialDiff, type Captured } from '../lib/material';
import { createElement } from 'react';
import { loadMaia, MAIA_DOWNLOAD_MB, MAIA_MAX, MAIA_MIN, isMaiaDownloaded, useMaia } from '../lib/maia';
import { chooseOpponentMove, type MoveSource, type OpponentSettings } from '../lib/opponent';
import { findMove, movesAt, type Repertoire } from '../lib/repertoire';
import { ALL_IN_PLAY, scopedReps, useScopeOf, type RepScope } from '../lib/repScope';
import { activeProfile, activeRep, profileRating, useApp, type Profile } from '../lib/store';
import { engine } from '../lib/engine';
import { getToken } from '../lib/lichess';
import { Board } from './Board';
import { Dialog } from './Dialog';
import { GameReview } from './GameReview';
import { GameRow } from './GamesView';
import { OpeningLabel } from './OpeningLabel';
import { Icon } from './Icon';
import { RatingChart } from './RatingChart';
import { RatingDiff } from './RatingDiff';
import { RepScopePicker } from './RepScopePicker';

interface GameConfig {
  start: PlayedMove[];
  color: Side;
  settings: OpponentSettings;
  coach: boolean;
  tc: TimeControl;
  /** Counts for your rating (only with a clock, from the starting position). */
  rated: boolean;
  /** The repertoires your moves are checked against: all in play or one (see repScope.ts). */
  scope?: RepScope;
  /** The colour was drawn at random (and is drawn again for the next game). */
  randomColour?: boolean;
}

const drawColour = (): Side => (Math.random() < 0.5 ? 'white' : 'black');

export function levelName(level: number): string {
  if (level < 1000) return 'beginner';
  if (level < 1400) return 'casual player';
  if (level < 1800) return 'club player';
  if (level < 2100) return 'strong club player';
  if (level < 2400) return 'expert';
  return 'master';
}

function readPrefs(): Partial<{ level: number; mode: OpponentSettings['mode']; coach: boolean; tc: TimeControl; rated: boolean; random: boolean }> {
  try {
    return JSON.parse(localStorage.getItem('play-prefs') ?? '{}');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// A rated game in progress is kept on this device, so it can go on after a reload, a closed page or a visit to
// another page. Your clock keeps running meanwhile, as on Lichess.

interface SavedGame {
  profileId: string;
  startedAt: number;
  config: GameConfig;
  moves: PlayedMove[];
  sources: Source[];
  moveClocks: (number | null)[];
  clock: ClockState | null;
  /** When it was written: the last move, or when you left. */
  savedAt: number;
}
type Resume = SavedGame & { arrivedAt: number };

const CURRENT_KEY = 'play-current';

function readCurrent(profileId: string | null): Resume | null {
  try {
    const g = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null') as SavedGame | null;
    return g && g.profileId === profileId && g.config?.rated && Array.isArray(g.moves) ? { ...g, arrivedAt: Date.now() } : null;
  } catch {
    return null;
  }
}

function writeCurrent(g: SavedGame) {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(g));
  } catch {
    /* storage unavailable: then leaving is a loss, as before */
  }
}

function clearCurrent(startedAt: number) {
  try {
    const g = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null') as SavedGame | null;
    if (g?.startedAt === startedAt) localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

export function PlayView() {
  const profileId = useApp((s) => s.data.activeProfileId);
  const [session, setSession] = useState<{ config: GameConfig; resume?: Resume } | null>(() => {
    const cur = readCurrent(profileId);
    return cur ? { config: cur.config, resume: cur } : null;
  });
  const [round, setRound] = useState(0);
  // A practice game opened from the history: its review, with the analysis.
  const openId = useApp((s) => s.openGameId);
  const review = useGames((s) => (openId ? s.data.games.find((g) => g.id === openId && g.source === 'practice') : undefined));
  // Opening a game's review ends the game on the board (it is saved); coming back shows the setup and the history,
  // or the rated game still in progress.
  useEffect(() => {
    if (review) setSession(null);
    else {
      const cur = readCurrent(profileId);
      if (cur) setSession((s) => s ?? { config: cur.config, resume: cur });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);
  if (review) return <GameReview key={review.id} game={review} />;
  if (session) {
    const game = (
      <GameSession
        key={round}
        config={session.config}
        resume={session.resume}
        onNew={() => setSession(null)}
        onRematch={() => {
          const c = session.config;
          setSession({ config: c.randomColour ? { ...c, color: drawColour() } : c });
          setRound((r) => r + 1);
        }}
      />
    );
    return session.resume ? (
      <WhenMaiaReady
        onGiveUp={() => {
          // The game is already in your history as lost.
          clearCurrent(session.resume!.startedAt);
          setSession(null);
        }}
      >
        {game}
      </WhenMaiaReady>
    ) : (
      game
    );
  }
  return <PlaySetup onStart={(config) => setSession({ config })} />;
}

/** A resumed game waits until the opponent is loaded again (after a reload); that time costs nobody anything. */
function WhenMaiaReady({ children, onGiveUp }: { children: React.ReactNode; onGiveUp: () => void }) {
  const [ready, setReady] = useState(() => useMaia.getState().status === 'ready');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    setError(null);
    engine.terminate();
    loadMaia().then(
      () => alive && setReady(true),
      (e) => alive && setError((e as Error).message),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  if (ready) return <>{children}</>;
  return (
    <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
      <h2>Your rated game</h2>
      {error ? (
        <>
          <div className="notice error small">{error}</div>
          <div className="row wrap">
            <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
            <button className="btn ghost" onClick={onGiveUp}>
              Give up (counts as a loss)
            </button>
          </div>
        </>
      ) : (
        <div className="muted">Resuming… (loading the opponent; the clocks wait)</div>
      )}
    </div>
  );
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

/** Your rating against Maia per tempo, run by run; pick a tempo for its graph, an earlier run to look back on, or
 *  start a new run. */
function RatingCard({ ratings, preferred }: { ratings: PlayerRatings; preferred: RatingCategory | null }) {
  const profile = useApp(activeProfile)!;
  const reps = useApp((s) => s.data.repertoires);
  const all = useGames((s) => s.data.games);
  const games = useMemo(() => all.filter((g) => g.profileId === profile.id && g.source === 'practice'), [all, profile.id]);
  const [viewed, setViewed] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [picked, setPicked] = useState<RatingCategory | null>(null);
  const shownRun = ratings.runs.find((r) => r.run.id === viewed) ?? ratings.current;
  const byCategory = shownRun.ratings.byCategory;
  const played = RATING_CATEGORIES.filter((c) => byCategory[c].games);
  // The tempo chosen in the setup when it has games, else the one played last.
  const latest = played.slice().sort((a, b) => (byCategory[b].lastPlayed ?? 0) - (byCategory[a].lastPlayed ?? 0))[0];
  const shown = picked && byCategory[picked].games ? picked : preferred && byCategory[preferred].games ? preferred : latest;
  const book = useMemo(() => {
    const id = shownRun.run.repId;
    if (id === ALL_IN_PLAY)
      return { label: 'Your whole repertoire (in play)', side: null, ...bookStats(shownRun.games, (side) => scopedReps(reps, profile.id, side, ALL_IN_PLAY)) };
    const rep = id ? reps.find((r) => r.id === id) : undefined;
    return rep
      ? { label: `${rep.name} (${rep.side === 'white' ? '♔ White' : '♚ Black'})`, side: rep.side, ...bookStats(shownRun.games, (side) => (side === rep.side ? [rep] : [])) }
      : null;
  }, [shownRun, reps, profile.id]);
  if (!ratings.runs.some((r) => r.games.length) && ratings.runs.length === 1) return null;
  const isCurrent = shownRun === ratings.current;
  const { won, drawn, lost } = shownRun.record;
  const repName = (id?: string) => (id === ALL_IN_PLAY ? 'whole repertoire' : reps.find((r) => r.id === id)?.name);
  return (
    <div className="card card-pad stack">
      <div className="row wrap">
        <h3>Your rating against Maia</h3>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setCreating(true)} title="Start all ratings again at 400; this run stays to look back on">
          <Icon name="refresh" size={14} /> New run…
        </button>
      </div>
      {ratings.runs.length > 1 && (
        <div className="row wrap" style={{ gap: 6 }} role="tablist" aria-label="Runs">
          {ratings.runs.map((r) => (
            <span
              key={r.run.id}
              role="tab"
              aria-selected={r === shownRun}
              className={`chip ${r === shownRun ? 'on' : ''}`}
              onClick={() => {
                setViewed(r === ratings.current ? null : r.run.id);
                setPicked(null);
              }}
            >
              {r.run.name}
              {r === ratings.current ? ' · now' : ''}
            </span>
          ))}
        </div>
      )}
      <div className="small muted run-summary">
        <b>{shownRun.run.name}</b>
        {repName(shownRun.run.repId) ? ` · ${repName(shownRun.run.repId)}` : ''}
        {shownRun.run.startedAt ? ` · started ${formatDate(shownRun.run.startedAt)}` : ''}
        {` · ${shownRun.games.length} ${shownRun.games.length === 1 ? 'game' : 'games'}`}
        {shownRun.games.length ? ` · ${won} won, ${drawn} drawn, ${lost} lost` : ''}
        {shownRun.peak ? ` · peak ${Math.round(shownRun.peak.rating)} (${CATEGORY_NAMES[shownRun.peak.category].toLowerCase()})` : ''}
        {!isCurrent ? ' · finished' : ''}
      </div>
      <div className="rating-tiles" role="tablist">
        {RATING_CATEGORIES.map((c) => {
          const r = byCategory[c];
          return (
            <button
              key={c}
              role="tab"
              aria-selected={c === shown}
              className={`stat rating-tile ${r.games ? '' : 'faint'} ${c === shown ? 'on' : ''}`}
              disabled={!r.games}
              onClick={() => setPicked(c)}
              title={r.games ? `Show the ${CATEGORY_NAMES[c].toLowerCase()} graph` : undefined}
            >
              <b>{showRating(r)}</b>
              <span>
                {CATEGORY_NAMES[c]} · {r.games} {r.games === 1 ? 'game' : 'games'}
              </span>
            </button>
          );
        })}
      </div>
      {shown ? (
        <RatingChart ratings={shownRun.ratings} category={shown} games={games} />
      ) : (
        <div className="small faint">No rated games in this run yet: every rating starts at 400.</div>
      )}
      {book && (
        <div className="notice small book-stats">
          <b>{book.label}</b>
          {book.games ? (
            <>
              {' '}
              · {book.games} {book.games === 1 ? 'game' : 'games'}
              {book.side ? ` with ${book.side}` : ''}: in your preparation for{' '}
              <b>{book.avgMoves.toFixed(1)}</b> moves on average · <b>you left it</b> {book.youLeft}× · Maia left it {book.theyLeft}× ·
              end of your preparation {book.end}×
            </>
          ) : (
            <> · no rated games{book.side ? ` with ${book.side}` : ''} in this run yet.</>
          )}
        </div>
      )}
      <div className="help">
        Glicko-2, as on Lichess, one rating per tempo; every run starts at 400. A “?” means provisional: not enough games
        yet to be sure, so the rating still moves in big steps. Maia here plays like a person (it does not always play its
        favourite move), so this is a rating on its own scale, close to Lichess but not the same.
      </div>
      {creating && <NewRunDialog profile={profile} runs={ratings.runs.length} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** How the rated games of a run followed your preparation (`repsFor` the colour of each game; none: not counted): for
 *  how many moves, and who left it first. */
function bookStats(games: readonly PlayedGame[], repsFor: (side: Side) => Repertoire[]) {
  let n = 0;
  let plies = 0;
  let youLeft = 0;
  let theyLeft = 0;
  let end = 0;
  for (const g of games) {
    const reps = repsFor(g.myColor);
    if (!reps.length) continue;
    const c = prepCheck(g.moves, positionKeys(g.moves), reps, g.myColor);
    n++;
    if (c.kind === 'none') continue;
    plies += c.ply;
    if (c.kind === 'you-left') youLeft++;
    else if (c.kind === 'opponent-left') theyLeft++;
    else end++;
  }
  return { games: n, avgMoves: n ? plies / n / 2 : 0, youLeft, theyLeft, end };
}

/** A new run: all ratings start again at 400; optionally named, and about one of your repertoires. */
function NewRunDialog({ profile, runs, onClose }: { profile: Profile; runs: number; onClose: () => void }) {
  const allReps = useApp((s) => s.data.repertoires);
  const reps = useMemo(() => allReps.filter((r) => r.profileId === profile.id), [allReps, profile.id]);
  const { updateProfile, showToast } = useApp.getState();
  const [name, setName] = useState('');
  const [repId, setRepId] = useState('');
  const start = () => {
    const run: RatingRun = { id: crypto.randomUUID(), name: name.trim() || `Run ${runs + 1}`, startedAt: Date.now(), ...(repId ? { repId } : {}) };
    updateProfile(profile.id, { ratingRuns: [...(profile.ratingRuns ?? []), run] });
    onClose();
    showToast(`${run.name} started: every rating at 400`, {
      label: 'Undo',
      run: () => {
        const p = useApp.getState().data.profiles.find((x) => x.id === profile.id);
        if (p) updateProfile(p.id, { ratingRuns: (p.ratingRuns ?? []).filter((r) => r.id !== run.id) });
      },
    });
  };
  return (
    <Dialog title="Start a new run" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="small">
          Every rating (bullet, blitz, rapid, classical) starts again at 400, as in a speedrun: beat stronger and stronger
          bots to climb. Your earlier runs stay, with their games and graphs, to look back on.
        </div>
        <div className="field">
          <label className="small">Name</label>
          <input className="input" autoFocus value={name} placeholder={`e.g. Caro-Kann speedrun (or “Run ${runs + 1}”)`} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="small">About an opening (optional)</label>
          <select className="input" value={repId} onChange={(e) => setRepId(e.target.value)}>
            <option value="">No particular opening</option>
            <option value={ALL_IN_PLAY}>Your whole repertoire: all in play, random colour</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.side === 'white' ? 'White' : 'Black'})
              </option>
            ))}
          </select>
          <div className="help">
            For a new opening: the run shows how long your rated games with its colour stayed in your preparation, and who
            left it first — you or Maia. New games are played with its colour. With your whole repertoire, the colour is
            drawn for each game and every game is checked against your repertoires in play for its colour.
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={start}>
            Start the run
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Rated or casual: what you can win or lose against this opponent, and a fair opponent for your rating. */
function RatedSetting(props: {
  rated: boolean;
  canRate: boolean;
  reason: string;
  current: CategoryRating;
  /** The name of the current run (after the first). */
  run: string | null;
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
            {props.run ? ` · ${props.run}` : ''}
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
            <span className="rating-diff down">{signed(s.loss)}</span>. No take-backs and no repertoire hints. If you leave
            during the game, it waits for you here, but your clock keeps running.
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
  // A run about an opening is played with that repertoire's colour; one about your whole repertoire with either.
  const run = runsOf(profile.ratingRuns).at(-1)!;
  const runRep = useApp((s) => (run.repId ? s.data.repertoires.find((r) => r.id === run.repId) : undefined));
  const runColour = run.repId === ALL_IN_PLAY ? 'random' : runRep?.side;
  const [color, setColor] = useState<Side | 'random'>(setup?.color ?? runColour ?? (prefs.random ? 'random' : undefined) ?? rep?.side ?? 'white');
  useEffect(() => {
    if (runColour && !setup?.color) setColor(runColour);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);
  const scope = useScopeOf(profile.id);
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
  // Rated games are a world of their own, apart from your Lichess (or typed-in) rating: the opponent starts at a fair
  // level for your rating against Maia in this tempo, and a level chosen here is not remembered for casual games.
  const [ratedPick, setRatedPick] = useState<number | null>(null);
  useEffect(() => setRatedPick(null), [category]);
  const shownLevel = isRated ? (ratedPick ?? fair) : level;
  const chooseLevel = (l: number) => (isRated ? setRatedPick(l) : setLevel(l));
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isMaiaDownloaded().then(setDownloaded);
  }, []);
  useEffect(() => {
    // A level taken over from a game is not remembered as your usual choice.
    localStorage.setItem(
      'play-prefs',
      JSON.stringify({ level: setup?.level ? (prefs.level ?? level) : level, mode, coach, tc, rated, random: color === 'random' }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, mode, coach, tc, rated, color]);

  const go = async () => {
    setError(null);
    try {
      // Stockfish is not needed while playing; free its memory for Maia (matters on phones and tablets).
      engine.terminate();
      await loadMaia();
      // Rated: the opponent plays like real opponents (not into your preparation), and no hints. Maia also takes into
      // account whom it plays; in a rated game it plays as against an equal, so "Maia 1200" is always the same
      // opponent, whatever your other ratings (its rating is its level).
      onStart({
        start,
        color: color === 'random' ? drawColour() : color,
        randomColour: color === 'random',
        scope,
        coach: isRated ? false : coach,
        tc,
        rated: isRated,
        settings: {
          level: shownLevel,
          playerRating: isRated ? shownLevel : profileRating(profile),
          mode: isRated ? 'realistic' : mode,
          speeds: profile.speeds,
        },
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
            Opponent strength: <span className="num">{shownLevel}</span> <span className="muted">({levelName(shownLevel)})</span>
          </label>
          <input type="range" min={MAIA_MIN} max={MAIA_MAX} step={100} value={shownLevel} onChange={(e) => chooseLevel(Number(e.target.value))} />
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
          <div className="row wrap">
            <button className={`btn ${color === 'white' ? 'primary' : ''}`} onClick={() => setColor('white')}>
              ♔ White
            </button>
            <button className={`btn ${color === 'random' ? 'primary' : ''}`} onClick={() => setColor('random')} title="White or Black, drawn for each game">
              <span className="half-dot" aria-hidden /> Random
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
          run={run.id === 'first' ? null : run.name}
          category={category ? CATEGORY_NAMES[category].toLowerCase() : ''}
          level={shownLevel}
          white={color !== 'black'}
          fair={fair}
          onRated={setRated}
          onLevel={setRatedPick}
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
        <div className="field">
          <RepScopePicker profileId={profile.id} side={color === 'random' ? undefined : color} label="Your repertoire:" />
          <div className="help">
            What your moves are checked against: the “in your repertoire” mark, the hints, and the opponent that stays inside
            your repertoire. One repertoire counts for its own colour; the other colour keeps all in play.
          </div>
        </div>

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
      <RatingCard ratings={ratings} preferred={category} />
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

/** As on Lichess: the opponent's pieces one side is up (drawn like the board's pieces, in the colour of their owner),
 *  and its material advantage; the number always stays in view. */
function CapturedPieces({ pieces, color, plus }: { pieces: Captured[]; color: Side; plus: number }) {
  return (
    <span className="material" title={pieces.length ? `Up in material: ${pieces.join(', ')}` : undefined}>
      <span className="captured cg-wrap">
        {pieces.map((role, i) =>
          createElement('piece', { key: i, className: `${role} ${color}${i > 0 && pieces[i - 1] !== role ? ' gap' : ''}` }),
        )}
      </span>
      {plus > 0 && <span className="material-plus">+{plus}</span>}
    </span>
  );
}

function GameSession({ config, resume, onNew, onRematch }: { config: GameConfig; resume?: Resume; onNew: () => void; onRematch: () => void }) {
  const profile = useApp(activeProfile)!;
  // Your repertoires for the colour you play: all in play, or the one picked (see repScope.ts).
  const allReps = useApp((s) => s.data.repertoires);
  const myReps = useMemo(() => scopedReps(allReps, profile.id, config.color, config.scope ?? ALL_IN_PLAY), [allReps, profile.id, config.color, config.scope]);
  const preparedAt = (key: string) => myReps.flatMap((r) => movesAt(r, key)).filter((m, i, all) => all.findIndex((x) => x.uci === m.uci) === i);
  const inRep = (from: string, uci: string) => myReps.some((r) => !!findMove(r, from, uci));
  const { openLine, showToast, openGame } = useApp.getState();
  const [moves, setMoves] = useState<PlayedMove[]>(resume?.moves ?? config.start);
  const [sources, setSources] = useState<Source[]>(resume?.sources ?? config.start.map(() => 'start'));
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
  const [clock, setClock] = useState<ClockState | null>(() =>
    resume?.clock ? resumedClock(resume.clock, config.color, resume.savedAt, resume.arrivedAt, Date.now()) : timed ? newClock(tc) : null,
  );
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [moveClocks, setMoveClocks] = useState<(number | null)[]>(() => resume?.moveClocks ?? config.start.map(() => null));
  const [, setTick] = useState(0);
  const lowWarned = useRef(!!clock && clock[config.color] < LOW_TIME);

  // The game is kept in your history: when it ends, and when you leave it unfinished.
  const startedAt = useRef(resume?.startedAt ?? Date.now()).current;
  const id = gameId(profile.id, `practice:${startedAt}`);
  const record = useRef({ moves, result, moveClocks, sources });
  record.current = { moves, result, moveClocks, sources };
  // Rated: your rating in this tempo when the game began (shown during the game), and what the game did to it. A
  // resumed game is already in your history (as lost until it ends): then the rating before it.
  const ratings = useRatings(profile.id);
  const category = config.rated ? categoryOf(tc) : null;
  const ratingAtStart = useRef(
    category
      ? ((step) => (step ? { rating: step.before, provisional: step.provisionalBefore } : ratings.byCategory[category]))(ratings.byGame.get(id))
      : null,
  ).current;
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
    if (!record.current.result) {
      save();
      persist();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rated game is kept from your first move on, as lost until it ends: closing or reloading the page cannot undo a
  // loss. And it is kept on this device as it stands, so you can come back to it (your clock runs meanwhile).
  const myMoves = moves.slice(config.start.length).filter((m) => turnOfKey(m.from) === config.color).length;
  const ratedOn = config.rated && myMoves > 0 && !result;
  const persist = () => {
    if (!config.rated) return;
    const { moves: ms, result: r, moveClocks: cs, sources: ss } = record.current;
    if (r) return clearCurrent(startedAt);
    if (!ms.slice(config.start.length).some((m) => turnOfKey(m.from) === config.color)) return;
    writeCurrent({ profileId: profile.id, startedAt, config, moves: ms, sources: ss, moveClocks: cs, clock: clockRef.current, savedAt: Date.now() });
  };
  useEffect(() => {
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves, result]);
  const keep = () => {
    save();
    persist();
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
    if (resume) {
      const away = Math.max(0, resume.arrivedAt - resume.savedAt);
      const c = clockRef.current;
      // Out of time while away, on the opponent's move (on your own move the clock below notices).
      if (c && c.running && c.running !== config.color && c[config.color] <= 0) finish(timeout(moves.at(-1)?.to ?? START_KEY, config.color));
      else
        setNotice({
          text: (
            <>
              Game resumed.
              {c?.running && away >= 1000 ? ` Your clock ran while you were away (${showTime(away)}).` : ''}
            </>
          ),
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = moves.at(-1)?.to ?? START_KEY;
  const turn = turnOfKey(key);
  const myTurn = turn === config.color;
  const coach = config.coach && !config.rated && myReps.length > 0;
  // Still inside the repertoire: every move so far is a prepared move.
  const inBook = useMemo(() => myReps.length > 0 && moves.every((m) => inRep(m.from, m.uci)), [myReps, moves]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useMemo(() => [START_KEY, ...moves.map((m) => m.to)], [moves]);

  const finish = (r: Result) => {
    setResult(r);
    setClock((c) => (c ? stop(c, Date.now()) : c));
    const mine = winner(config.color);
    playSound(r.result === '1/2-1/2' ? 'Draw' : r.result === mine ? 'Victory' : 'Defeat');
  };

  /** A move by either side: on the board, with its sound, and on the clock. As on Lichess, the clock starts once both
   *  sides have made their first move. */
  const sessionMoves = useRef(resume ? resume.moves.length - config.start.length : 0);
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
    chooseOpponentMove(myReps, key, config.settings)
      .then(async (choice) => {
        // Humans take a moment; so does this opponent (less when its clock runs low).
        const c = clockRef.current;
        const budget = c ? timeLeft(c, turn, Date.now()) / 40 : Infinity;
        const wait = Math.min(350 + Math.random() * 700, budget) - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled || !alive.current || !choice || record.current.result) return;
        const leftBook = inBook && !inRep(choice.move.from, choice.move.uci) && preparedAt(key).length > 0;
        play(choice.move, choice.source);
        if (coach && leftBook) {
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
    const prepared = coach && inBook ? preparedAt(key) : [];
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
  const material = useMemo(() => materialDiff(key), [key]);
  const taken = { white: material.white, black: material.black };
  const balance = material.score;
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
            {inBook && !config.rated && <span className="badge mine">in your repertoire</span>}
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
            <div className="small muted">
              Rated game: no take-backs. If you leave, the game waits for you here, but your clock keeps running.
            </div>
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
  if (!moves.length) return <div className="small faint" style={{ height: 116 }}>No moves yet.</div>;
  const tag = (s: Source) =>
    s === 'repertoire' ? <span className="badge mine">book</span> : s === 'database' ? <span className="badge accent">db</span> : s === 'maia' ? <span className="badge">maia</span> : null;
  return (
    // A fixed height: the panel does not grow (and push what is below it) as the game goes on.
    <div ref={box} style={{ height: 116, overflow: 'auto', lineHeight: 2 }}>
      {moves.map((m, i) => (
        // inline-block: the list wraps between moves (nowrap spans without spaces would make one endless line).
        <span key={i} style={{ display: 'inline-block', marginRight: 6, whiteSpace: 'nowrap', opacity: sources[i] === 'start' ? 0.6 : 1 }}>
          {i % 2 === 0 && <span className="faint">{i / 2 + 1}. </span>}
          <b>{m.san}</b> {tag(sources[i])}
        </span>
      ))}
    </div>
  );
}
