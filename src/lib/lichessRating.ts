// Players with a Lichess username get their own rating from Lichess (rapid), refreshed twice a day: it is the rating
// the analysis uses ("would a player at your level find this move?"), and the opponent's starting level in Play.
// Typed in by hand instead when the player chooses so (Settings).
import { create } from 'zustand';
import { fetchLichessRating } from './lichess';
import { useApp, type Profile } from './store';

const FRESH = 12 * 3600_000;
const RETRY = 10 * 60_000;

export type FetchState = 'loading' | 'none' | 'error';
/** Per player: what the last attempt gave (absent once a rating is in). */
export const useLichessRatingState = create<Record<string, FetchState>>()(() => ({}));

const tried = new Map<string, number>();
const inFlight = new Set<string>();

const due = (p: Profile, now: number) =>
  !!p.lichess &&
  !p.ratingManual &&
  (!p.lichessRating || p.lichessRating.user.toLowerCase() !== p.lichess.toLowerCase() || now - p.lichessRating.at > FRESH);

/** Fetches the player's Lichess rating now (`force`: also when it is recent). */
export async function refreshLichessRating(profileId: string, force = false): Promise<void> {
  const p = useApp.getState().data.profiles.find((x) => x.id === profileId);
  const now = Date.now();
  if (!p?.lichess || (!force && !due(p, now))) return;
  const user = p.lichess;
  const key = `${profileId}|${user.toLowerCase()}`;
  if (inFlight.has(key) || (!force && now - (tried.get(key) ?? 0) < RETRY)) return;
  tried.set(key, now);
  inFlight.add(key);
  useLichessRatingState.setState({ [profileId]: 'loading' });
  try {
    const r = await fetchLichessRating(user);
    const cur = useApp.getState().data.profiles.find((x) => x.id === profileId);
    if (cur?.lichess !== user) return; // the username changed meanwhile
    if (!r) {
      useLichessRatingState.setState({ [profileId]: 'none' });
      return;
    }
    useApp.getState().updateProfile(profileId, { lichessRating: { user, ...r, at: Date.now() } });
    useLichessRatingState.setState((s) => {
      const next = { ...s };
      delete next[profileId];
      return next;
    }, true);
  } catch {
    useLichessRatingState.setState({ [profileId]: 'error' });
  } finally {
    inFlight.delete(key);
  }
}

/** Keeps the ratings fresh: at start, and when a username is entered or changed (also on another device). */
export function initLichessRatings() {
  const check = () => {
    const now = Date.now();
    for (const p of useApp.getState().data.profiles) if (due(p, now)) void refreshLichessRating(p.id);
  };
  check();
  useApp.subscribe((s, prev) => {
    if (s.data.profiles !== prev.data.profiles) check();
  });
}
