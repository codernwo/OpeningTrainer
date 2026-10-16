// Today's training: one session for all your repertoires and your mistake cards, and one number for it — the same on
// the Overview, on the Train tab and in the session. In this order: the reviews due in every repertoire you train (not
// paused; each in tree order, so consecutive cards share their context), then your mistake cards (due ones first, then
// new ones up to your limit), then new moves, each repertoire up to its own number, in your Overview order.
import { useMemo } from 'react';
import { mistakeQueue, type MistakeCard } from './mistakes';
import type { Repertoire } from './repertoire';
import { buildQueue, State, type TrainItem } from './srs';
import { activeProfile, orderedReps, useApp, type Profile } from './store';

/** How a player trains, synced with their other devices. */
export interface TrainPrefs {
  /** New moves per session: from older data, now the starting point of each repertoire's own number. */
  newMoves: number;
  /** New mistake cards per session. */
  newMistakes: number;
  /** Your mistake cards are part of today's session (off: only your repertoires). */
  withMistakes: boolean;
  /** Review in whole lines instead of single cards: from older data, now each repertoire's starting point. */
  wholeLines: boolean;
}

/** A repertoire's own session settings; one that never chose takes what the player had chosen for all of them. */
export function repTraining(rep: Pick<Repertoire, 'newMoves' | 'wholeLines'>, prefs: TrainPrefs): { newMoves: number; wholeLines: boolean } {
  return { newMoves: rep.newMoves ?? prefs.newMoves, wholeLines: rep.wholeLines ?? prefs.wholeLines };
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
    withMistakes: true,
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
  const cards = prefs.withMistakes ? mistakeQueue([...mistakes], prefs.newMistakes, now) : [];
  if (cards.length) parts.push({ kind: 'mistakes', cards, due: cards.filter((c) => c.card.state !== State.New).length });
  let fresh = 0;
  for (const rep of training) {
    const limit = repTraining(rep, prefs).newMoves;
    if (limit <= 0) continue;
    const items = buildQueue(rep, { newLimit: limit, now }).filter((i) => i.isNew);
    if (items.length) {
      parts.push({ kind: 'new', repId: rep.id, items });
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
