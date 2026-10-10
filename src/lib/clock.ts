// A chess clock for practice games: minutes per side plus an increment per move, like on Lichess.
// The clock of the side to move runs from the first move on; the increment is added after each move made on a
// running clock. All times in milliseconds.
import type { Side } from './chess';

export interface TimeControl {
  /** Minutes per side; 0 = no clock. */
  minutes: number;
  /** Seconds added after each move. */
  increment: number;
}

export interface ClockState {
  white: number;
  black: number;
  /** Whose clock runs (null before the first move and after the game). */
  running: Side | null;
  /** When the running clock was last started. */
  since: number;
}

export const hasClock = (tc: TimeControl | undefined): tc is TimeControl => !!tc && tc.minutes > 0;

export function newClock(tc: TimeControl): ClockState {
  const ms = tc.minutes * 60_000;
  return { white: ms, black: ms, running: null, since: 0 };
}

export function timeLeft(c: ClockState, side: Side, now: number): number {
  return c.running === side ? c[side] - (now - c.since) : c[side];
}

/** `mover` has made a move: their time is taken off (plus the increment back), and the other clock starts. */
export function press(c: ClockState, mover: Side, now: number, incrementMs: number): ClockState {
  const other: Side = mover === 'white' ? 'black' : 'white';
  const wasRunning = c.running === mover;
  const left = wasRunning ? c[mover] - (now - c.since) + incrementMs : c[mover];
  return { ...c, [mover]: left, running: other, since: now };
}

/** Stops the clock (the game is over), keeping the time left. */
export function stop(c: ClockState, now: number): ClockState {
  if (!c.running) return c;
  return { ...c, [c.running]: timeLeft(c, c.running, now), running: null, since: now };
}

/** Restarts the clock for `side` (after a takeback, say), without changing the time left. */
export function runFor(c: ClockState, side: Side, now: number): ClockState {
  const stopped = stop(c, now);
  return { ...stopped, running: side, since: now };
}

/** The side whose flag has fallen, if any. */
export function flagged(c: ClockState, now: number): Side | null {
  return c.running && timeLeft(c, c.running, now) <= 0 ? c.running : null;
}

/** "5:00", "0:42", and tenths under ten seconds ("0:09.3"), as on Lichess. */
export function showTime(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(Math.floor(t / 100) / 10).toFixed(1)}`;
  const s = Math.ceil(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "5+3" / "No clock". */
export const tcLabel = (tc: TimeControl | undefined) => (hasClock(tc) ? `${tc.minutes}+${tc.increment}` : 'No clock');

/** As in PGN headers and on Lichess: seconds + increment ("300+3"). */
export const tcPgn = (tc: TimeControl) => `${tc.minutes * 60}+${tc.increment}`;
