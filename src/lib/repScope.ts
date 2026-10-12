// Which repertoire your games are checked against: all the repertoires you have in play, or one of them. One choice
// per player, kept on this device, used everywhere a game is held against your preparation (game review, Insights,
// practice games); a single repertoire counts for its own colour, and the other colour keeps all in play.
import { create } from 'zustand';
import type { Side } from './chess';
import { inPlay, type Repertoire } from './repertoire';

/** 'in-play', or the id of one repertoire. */
export type RepScope = string;
export const ALL_IN_PLAY: RepScope = 'in-play';

const KEY = 'rep-scope';

function read(): Record<string, RepScope> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, RepScope>;
  } catch {
    return {};
  }
}

export const useRepScope = create<{ byProfile: Record<string, RepScope>; set: (profileId: string, scope: RepScope) => void }>()((set, get) => ({
  byProfile: read(),
  set: (profileId, scope) => {
    const byProfile = { ...get().byProfile, [profileId]: scope };
    set({ byProfile });
    try {
      localStorage.setItem(KEY, JSON.stringify(byProfile));
    } catch {
      /* ignore */
    }
  },
}));

/** The player's choice (all in play unless they picked one). */
export const useScopeOf = (profileId: string | null) => useRepScope((s) => (profileId ? s.byProfile[profileId] : undefined) ?? ALL_IN_PLAY);

/** The repertoires a game with `side` is checked against. */
export function scopedReps(all: readonly Repertoire[], profileId: string | null, side: Side, scope: RepScope): Repertoire[] {
  const mine = all.filter((r) => r.profileId === profileId && r.side === side);
  if (scope !== ALL_IN_PLAY) {
    const one = mine.find((r) => r.id === scope);
    if (one) return [one];
  }
  return mine.filter(inPlay);
}

/** The same for both colours at once (for checks over games of either colour). */
export function scopedRepsBoth(all: readonly Repertoire[], profileId: string | null, scope: RepScope): Repertoire[] {
  return [...scopedReps(all, profileId, 'white', scope), ...scopedReps(all, profileId, 'black', scope)];
}
