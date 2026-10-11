import { describe, expect, it } from 'vitest';
import { flagged, newClock, press, runFor, showTime, stop, tcLabel, timeLeft, resumedClock } from './clock';

describe('chess clock', () => {
  it('starts with the first move, runs for the side to move, adds the increment after a move', () => {
    let c = newClock({ minutes: 3, increment: 2 });
    expect(timeLeft(c, 'white', 5000)).toBe(180_000); // nothing runs before the first move
    c = press(c, 'white', 1000, 2000); // 1.e4: no time used, no increment yet
    expect(c).toMatchObject({ white: 180_000, running: 'black' });
    expect(timeLeft(c, 'black', 4000)).toBe(177_000);
    c = press(c, 'black', 4000, 2000); // Black thought 3 s, gets 2 s back
    expect(c).toMatchObject({ black: 179_000, running: 'white' });
    c = press(c, 'white', 14_000, 2000);
    expect(c.white).toBe(172_000);
  });

  it('a flag falls when the running clock reaches zero; a stopped clock keeps its time', () => {
    let c = press(newClock({ minutes: 1, increment: 0 }), 'white', 0, 0);
    expect(flagged(c, 59_999)).toBeNull();
    expect(flagged(c, 60_000)).toBe('black');
    c = stop(c, 30_000);
    expect(c).toMatchObject({ black: 30_000, running: null });
    expect(flagged(c, 999_999)).toBeNull();
    c = runFor(c, 'black', 40_000);
    expect(timeLeft(c, 'black', 41_000)).toBe(29_000);
  });

  it('shows the time as on Lichess', () => {
    expect(showTime(300_000)).toBe('5:00');
    expect(showTime(42_300)).toBe('0:43');
    expect(showTime(9_340)).toBe('0:09.3');
    expect(showTime(-5)).toBe('0:00.0');
    expect(showTime(3_600_000)).toBe('1:00:00');
    expect(tcLabel({ minutes: 0, increment: 5 })).toBe('No clock');
    expect(tcLabel({ minutes: 5, increment: 3 })).toBe('5+3');
  });
});

describe('resuming a game after being away', () => {
  const t0 = 1_000_000;
  // 3+0; White (me) has 150 s, Black 170 s.
  const base = { white: 150_000, black: 170_000, running: 'white' as const, since: t0 };

  it('my clock ran while I was away', () => {
    // Saved 10 s into my move, back 60 s later, ready 5 s after that (loading the opponent).
    const c = resumedClock(base, 'white', t0 + 10_000, t0 + 70_000, t0 + 75_000);
    expect(timeLeft(c, 'white', t0 + 75_000)).toBe(150_000 - 70_000);
    expect(c.running).toBe('white');
    expect(timeLeft(c, 'black', t0 + 75_000)).toBe(170_000);
  });

  it("the opponent's did not: away on its move costs me, not it", () => {
    const theirs = { ...base, running: 'black' as const };
    const c = resumedClock(theirs, 'white', t0 + 2_000, t0 + 62_000, t0 + 64_000);
    expect(timeLeft(c, 'black', t0 + 64_000)).toBe(168_000);
    expect(timeLeft(c, 'white', t0 + 64_000)).toBe(90_000);
    expect(c.running).toBe('black');
  });

  it('long away: my flag has fallen', () => {
    const c = resumedClock(base, 'white', t0, t0 + 3_600_000, t0 + 3_600_500);
    expect(flagged(c, t0 + 3_600_500)).toBe('white');
  });

  it('clocks that had not started stay as they were', () => {
    const idle = { white: 180_000, black: 180_000, running: null, since: 0 };
    expect(resumedClock(idle, 'white', t0, t0 + 60_000, t0 + 61_000)).toEqual(idle);
  });
});
