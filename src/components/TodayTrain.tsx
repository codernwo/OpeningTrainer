import { useEffect, useState } from 'react';
import { counts } from '../lib/srs';
import { activeProfile, orderedReps, useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { describePlan, NEW_MISTAKE_CHOICES, NEW_MOVE_CHOICES, todayPlan, trainPrefs, useTodayPlan, type TodayPart, type TodayPlan, type TrainPrefs } from '../lib/today';
import { Icon } from './Icon';
import { LineReviewSession } from './LineReview';
import { DeckTabs, MistakeSession } from './MistakesTrain';
import { SavedNote } from './SaveIndicator';
import { ReviewSession, type SessionScore } from './TrainView';

/** The player's training choices, changed here and synced to their other devices. */
export function useTrainPrefs(): [TrainPrefs, (patch: Partial<TrainPrefs>) => void] {
  const profile = useApp(activeProfile);
  const prefs = trainPrefs(profile);
  const set = (patch: Partial<TrainPrefs>) => profile && useApp.getState().updateProfile(profile.id, { trainPrefs: { ...prefs, ...patch } });
  return [prefs, set];
}

/** How many new moves (and mistake cards) a session adds, and whole lines or single cards. */
export function SessionSettings({ mistakes = true }: { mistakes?: boolean }) {
  const [prefs, setPrefs] = useTrainPrefs();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap">
        <span className="muted small">New moves per session</span>
        {NEW_MOVE_CHOICES.map((n) => (
          <span key={n} className={`chip ${prefs.newMoves === n ? 'on' : ''}`} onClick={() => setPrefs({ newMoves: n })} title={n === 0 ? 'Only reviews: no new moves' : undefined}>
            {n}
          </span>
        ))}
      </div>
      {mistakes && (
        <div className="row wrap">
          <span className="muted small">New mistake cards per session</span>
          {NEW_MISTAKE_CHOICES.map((n) => (
            <span key={n} className={`chip ${prefs.newMistakes === n ? 'on' : ''}`} onClick={() => setPrefs({ newMistakes: n })}>
              {n}
            </span>
          ))}
        </div>
      )}
      <label className="row small" style={{ gap: 6, cursor: 'pointer', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={prefs.wholeLines} onChange={(e) => setPrefs({ wholeLines: e.target.checked })} style={{ marginTop: 2 }} />
        <span>
          <b>Play whole lines</b>
          <span className="muted"> — you play all your moves of each line, for the reflex; a move that is not due only counts when you get it wrong.</span>
        </span>
      </label>
      <div className="small faint">The same on all your devices.</div>
    </div>
  );
}

/** The Train tab's first page: one button for today's session over everything. */
export function TodayTrain() {
  const plan = useTodayPlan();
  const [prefs, setPrefs] = useTrainPrefs();
  const myCards = useApp((s) => (s.data.mistakes ?? []).some((m) => m.profileId === s.data.activeProfileId));
  const data = useApp((s) => s.data);
  const autostart = useApp((s) => s.todayAutostart);
  const [session, setSession] = useState<TodayPlan | null>(null);
  const [settings, setSettings] = useState(false);

  // "Train" on the Overview: straight into the session.
  useEffect(() => {
    if (!autostart) return;
    useApp.getState().clearTodayAutostart();
    if (plan.total) setSession(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  if (session) return <TodaySession plan={session} onExit={() => setSession(null)} />;

  const reps = orderedReps(data, data.activeProfileId);
  const paused = reps.filter((r) => r.paused);
  const byRep = new Map<string, { reviews: number; fresh: number }>();
  for (const p of plan.parts) {
    if (p.kind === 'mistakes') continue;
    const x = byRep.get(p.repId) ?? { reviews: 0, fresh: 0 };
    if (p.kind === 'review') x.reviews += p.items.length;
    else x.fresh += p.items.length;
    byRep.set(p.repId, x);
  }
  const mistakes = plan.parts.find((p) => p.kind === 'mistakes');

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }} className="stack">
      <DeckTabs />
      <div className="card card-pad stack today-card">
        <div className="row">
          <h2>Today</h2>
          <span className="spacer" />
          <button className="btn sm ghost" aria-pressed={settings} aria-expanded={settings} onClick={() => setSettings((x) => !x)} title="Session settings">
            <Icon name="settings" size={15} /> Settings
          </button>
        </div>
        <div className="muted">{plan.total ? describePlan(plan) : 'Nothing to train right now: every review is done.'}</div>
        <div>
          <button className="btn primary lg" disabled={!plan.total} onClick={() => setSession(plan)}>
            <Icon name="train" size={18} /> Train ({plan.total})
          </button>
        </div>
        {plan.total > 0 && (
          <ul className="today-list small">
            {reps
              .filter((r) => byRep.has(r.id))
              .map((r) => {
                const x = byRep.get(r.id)!;
                return (
                  <li key={r.id}>
                    <span className="muted">{r.side === 'white' ? '♔' : '♚'}</span> {r.name}
                    <span className="muted">
                      {' '}
                      — {[x.reviews ? `${x.reviews} ${x.reviews === 1 ? 'review' : 'reviews'}` : '', x.fresh ? `${x.fresh} new` : ''].filter(Boolean).join(', ')}
                    </span>
                  </li>
                );
              })}
            {mistakes && mistakes.kind === 'mistakes' && (
              <li>
                <span className="muted">✕</span> My mistakes
                <span className="muted">
                  {' '}
                  — {[mistakes.due ? `${mistakes.due} due` : '', mistakes.cards.length - mistakes.due ? `${mistakes.cards.length - mistakes.due} new` : ''].filter(Boolean).join(', ')}
                </span>
              </li>
            )}
          </ul>
        )}
        {myCards && (
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={prefs.withMistakes} onChange={(e) => setPrefs({ withMistakes: e.target.checked })} />
            Include my mistake cards
            {!prefs.withMistakes && <span className="faint">(train them on their own tab)</span>}
          </label>
        )}
        {paused.length > 0 && (
          <div className="small faint">
            Paused, so left out: {paused.map((r) => r.name).join(', ')}.
          </div>
        )}
        {settings && <SessionSettings mistakes={prefs.withMistakes} />}
      </div>
      <details className="card card-pad help">
        <summary>
          <b style={{ color: 'var(--text)' }}>How today’s session works</b>
        </summary>
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          <div>
            One session for everything you train: first the reviews that are due in each repertoire (one repertoire after the
            other, each in the order of its tree, so the cards share their context), then your mistake cards (the due ones,
            then new ones; opening mistakes and the themes you miss most first), then new moves, up to the number you chose,
            repertoire by repertoire in your Overview order. Paused repertoires are left out.
          </div>
          <div>
            The number on the Overview, on this tab and in the session is the same. To work on one repertoire only, use its tab
            above, or <b>Train from here</b> in the tree or on the build board for one branch.
          </div>
        </div>
      </details>
    </div>
  );
}

function partLabel(part: TodayPart, name: string | undefined): string {
  if (part.kind === 'mistakes') return `My mistakes (${part.cards.length})`;
  return `${name ?? 'Repertoire'}: ${part.kind === 'review' ? 'reviews' : 'new moves'} (${part.items.length})`;
}

/** Today's session: its parts one after another, then one summary. */
function TodaySession({ plan, onExit }: { plan: TodayPlan; onExit: () => void }) {
  const reps = useApp((s) => s.data.repertoires);
  const activeRepId = useApp((s) => s.data.activeRepId);
  const profile = useApp(activeProfile);
  // Whole lines or single cards, as chosen when the session started.
  const [wholeLines] = useState(() => trainPrefs(profile).wholeLines);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState<SessionScore>({ good: 0, bad: 0 });
  const part = plan.parts[index];
  const rep = part && part.kind !== 'mistakes' ? reps.find((r) => r.id === part.repId) : undefined;
  const gone = !!part && part.kind !== 'mistakes' && !rep;

  // The repertoire being trained is the selected one, so "Open in Build" opens the right one.
  useEffect(() => {
    if (rep && rep.id !== activeRepId) useApp.getState().setActiveRep(rep.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // A repertoire deleted meanwhile (here or on another device): skip its part.
  useEffect(() => {
    if (gone) setIndex((i) => i + 1);
  }, [gone]);

  const next = (s: SessionScore) => {
    setScore((t) => ({ good: t.good + s.good, bad: t.bad + s.bad }));
    setIndex((i) => i + 1);
  };

  if (!part) return <TodayDone score={score} onBack={onExit} />;
  if (gone || (part.kind !== 'mistakes' && !rep)) return null;

  const bar = (
    <div className="today-bar small">
      <b>Today</b>
      <span className="muted">
        {' '}
        · part {index + 1} of {plan.parts.length} · {partLabel(part, rep?.name)}
      </span>
    </div>
  );
  let body: React.ReactNode;
  if (part.kind === 'mistakes') body = <MistakeSession key={index} initial={part.cards} onExit={onExit} onDone={next} />;
  else if (wholeLines) body = <LineReviewSession key={index} rep={rep!} items={part.items} start={[]} onExit={onExit} onDone={next} />;
  else
    body = (
      <ReviewSession
        key={index}
        rep={rep!}
        initial={part.items.map((it) => ({ ...it, kind: part.kind === 'new' ? ('learn' as const) : ('review' as const) }))}
        onExit={onExit}
        onDone={next}
      />
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {bar}
      {body}
    </div>
  );
}

function TodayDone({ score, onBack }: { score: SessionScore; onBack: () => void }) {
  const data = useApp((s) => s.data);
  const profile = useApp(activeProfile);
  const [saved, setSaved] = useState<SaveResult | 'saving' | null>('saving');
  useEffect(() => {
    let alive = true;
    saveNow().then((r) => alive && setSaved(r));
    return () => {
      alive = false;
    };
  }, []);
  const reps = orderedReps(data, data.activeProfileId);
  const left = todayPlan(reps, (data.mistakes ?? []).filter((m) => m.profileId === data.activeProfileId), { ...trainPrefs(profile), newMoves: 0, newMistakes: 0 });
  const fresh = reps.filter((r) => !r.paused).reduce((a, r) => a + counts(r).fresh, 0);
  return (
    <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
      <h2>Today done 🎉</h2>
      <div className="stat-row">
        <div className="stat">
          <b style={{ color: 'var(--mine)' }}>{score.good}</b>
          <span>right first time</span>
        </div>
        <div className="stat">
          <b style={{ color: 'var(--gap)' }}>{score.bad}</b>
          <span>wrong (coming back soon)</span>
        </div>
        <div className="stat">
          <b>{left.total}</b>
          <span>still due</span>
        </div>
      </div>
      {fresh > 0 && <div className="small muted">{fresh} new moves are waiting for another day.</div>}
      {saved && <SavedNote state={saved} />}
      <div className="row">
        <button className="btn primary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
