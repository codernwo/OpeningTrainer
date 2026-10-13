// Today's training: one session for all your repertoires and your mistake cards, and one number for it — the same on
// the Overview, on the Train tab and in the session. In this order: the reviews due in every repertoire you train (not
// paused; each in tree order, so consecutive cards share their context), then your mistake cards (due ones first, then
// new ones up to your limit), then new moves up to your limit, repertoire by repertoire in your Overview order.
import { useMemo } from 'react';
import { mistakeQueue, type MistakeCard } from './mistakes';
import type { Repertoire } from './repertoire';
import { buildQueue, State, type TrainItem } from './srs';
import { activeProfile, orderedReps, useApp, type Profile } from './store';

/** How a player trains, synced with their other devices. */
export interface TrainPrefs {
  /** New moves per session (all repertoires together). */
  newMoves: number;
  /** New mistake cards per session. */
  newMistakes: number;
  /** Review in whole lines instead of single cards. */
  wholeLines: boolean;
}

export const NEW_MOVE_CHOICES = [0, 5, 10, 20, 50];
export const NEW_MISTAKE_CHOICES = [0, 5, 10, 20];

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The player's choices; before they were synced they lived on each device, so those are the starting point. */
export function trainPrefs(profile: Pick<Profile, 'trainPrefs'> | null | undefined): TrainPrefs {
  const local: TrainPrefs = {
    newMoves: Number(stored('new-limit') ?? 10),
    newMistakes: Number(stored('new-limit-mistakes') ?? 10),
    wholeLines: stored('train-whole-lines') === '1',
  };
  return { ...local, ...profile?.trainPrefs };
}

export type TodayPart =
  | { kind: 'review'; repId: string; items: TrainItem[] }
  | { kind: 'new'; repId: string; items: TrainItem[] }
  | { kind: 'mistakes'; cards: MistakeCard[]; due: number };

export interface TodayPlan {
  parts: TodayPart[];
  /** Reviews due in your repertoires. */
  due: number;
  /** Mistake cards in the session (due and new). */
  mistakes: number;
  /** New moves in the session. */
  fresh: number;
  /** All of it: the number shown everywhere. */
  total: number;
}

export function todayPlan(reps: readonly Repertoire[], mistakes: readonly MistakeCard[], prefs: TrainPrefs, now = Date.now()): TodayPlan {
  const parts: TodayPart[] = [];
  const training = reps.filter((r) => !r.paused);
  let due = 0;
  for (const rep of training) {
    const items = buildQueue(rep, { newLimit: 0, now });
    if (items.length) {
      parts.push({ kind: 'review', repId: rep.id, items });
      due += items.length;
    }
  }
  const cards = mistakeQueue([...mistakes], prefs.newMistakes, now);
  if (cards.length) parts.push({ kind: 'mistakes', cards, due: cards.filter((c) => c.card.state !== State.New).length });
  let left = prefs.newMoves;
  let fresh = 0;
  for (const rep of training) {
    if (left <= 0) break;
    const items = buildQueue(rep, { newLimit: left, now }).filter((i) => i.isNew);
    if (items.length) {
      parts.push({ kind: 'new', repId: rep.id, items });
      left -= items.length;
      fresh += items.length;
    }
  }
  return { parts, due, mistakes: cards.length, fresh, total: due + cards.length + fresh };
}

/** Today's plan for the active player, kept up to date with their repertoires, cards and choices. */
export function useTodayPlan(): TodayPlan {
  const data = useApp((s) => s.data);
  const profile = useApp(activeProfile);
  return useMemo(() => {
    const reps = orderedReps(data, data.activeProfileId);
    const cards = (data.mistakes ?? []).filter((m) => m.profileId === data.activeProfileId);
    return todayPlan(reps, cards, trainPrefs(profile));
  }, [data, profile]);
}

/** "23 reviews · 4 mistake cards · 10 new moves" (only the parts there are). */
export function describePlan(p: TodayPlan): string {
  const parts: string[] = [];
  if (p.due) parts.push(`${p.due} ${p.due === 1 ? 'review' : 'reviews'}`);
  if (p.mistakes) parts.push(`${p.mistakes} mistake ${p.mistakes === 1 ? 'card' : 'cards'}`);
  if (p.fresh) parts.push(`${p.fresh} new ${p.fresh === 1 ? 'move' : 'moves'}`);
  return parts.join(' · ');
}
