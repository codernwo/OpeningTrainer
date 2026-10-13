import { useMemo, useState } from 'react';
import { isLearnable, moveNo } from '../lib/analysis';
import { lineFromSans } from '../lib/chess';
import { gameActions, makeDue, type Deviation } from '../lib/gameActions';
import { gameLabel, type PlayedGame } from '../lib/games';
import { useGames } from '../lib/gamesStore';
import { cardFromMoment } from '../lib/mistakes';
import { scopedRepsBoth, useScopeOf } from '../lib/repScope';
import { useApp } from '../lib/store';
import { Icon } from './Icon';
import type { Suggestion } from './GamesView';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const SHOWN = 3;

/** Opens a position in Build, in the repertoire that has it. */
function buildAt(sans: string[], repId?: string) {
  const line = lineFromSans(sans);
  if (!line) return;
  if (repId) useApp.getState().setActiveRep(repId);
  useApp.getState().openLine(line);
}

/** "8.Nxc6 instead of 8.Bxc6": what you decide about leaving your repertoire in a game. Shared by the game review. */
export function decideDeviation(d: Pick<Deviation, 'game' | 'ply' | 'key' | 'expected' | 'repId'>, choice: 'forgot' | 'deliberate') {
  const { updateRep, showToast } = useApp.getState();
  const { updateGame } = useGames.getState();
  const before = d.game.prepChoice;
  updateGame(d.game.id, (g) => ({ ...g, prepChoice: { ply: d.ply, choice, at: Date.now() } }));
  const undo = () => updateGame(d.game.id, (g) => ({ ...g, prepChoice: before }));
  if (choice === 'forgot' && d.repId) {
    updateRep(d.repId, (r) => makeDue(r, d.key, d.expected), 'card due today', { undoable: false });
    showToast(`${d.expected.join(' / ')} comes back in today’s training`, { label: 'Undo', run: undo });
  } else showToast('Noted: played on purpose', { label: 'Undo', run: undo });
}

/** The three answers to "you left your repertoire here". */
export function DeviationButtons({ d }: { d: Deviation }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <button className="btn sm" onClick={() => decideDeviation(d, 'forgot')} title="Your repertoire move comes back in today's training">
        Forgot it
      </button>
      <button className="btn sm" onClick={() => decideDeviation(d, 'deliberate')} title="You chose another move on purpose: nothing to train">
        On purpose
      </button>
      <button className="btn sm ghost" onClick={() => buildAt(d.line, d.repId)} title="Open the position in Build, to add your move or change the line">
        <Icon name="board" size={14} /> Change repertoire
      </button>
    </div>
  );
}

/**
 * What your games ask you to do, in one place: where you left your repertoire (forgot it, on purpose, or change it),
 * replies your opponents played that you have not prepared (most frequent first), and mistakes that can become cards.
 * Everything you deal with disappears from it.
 */
export function GameActions({
  games,
  profileId,
  suggestions,
  onChoose,
  empty,
}: {
  games: PlayedGame[];
  profileId: string;
  suggestions: Suggestion[];
  onChoose: () => void;
  /** Shown when there is nothing to do (otherwise nothing is shown). */
  empty?: React.ReactNode;
}) {
  const allReps = useApp((s) => s.data.repertoires);
  const profiles = useApp((s) => s.data.profiles);
  const scope = useScopeOf(profileId);
  const reps = useMemo(() => scopedRepsBoth(allReps, profileId, scope), [allReps, profileId, scope]);
  const actions = useMemo(() => gameActions(games, reps), [games, reps]);
  const [allDev, setAllDev] = useState(false);
  const [allPrep, setAllPrep] = useState(false);
  const learnable = suggestions.filter((s) => isLearnable(s.moment));
  const { deviations, toPrepare } = actions;

  if (!deviations.length && !toPrepare.length && !suggestions.length) return empty ? <>{empty}</> : null;

  const addLearnable = () => {
    const cards = learnable.map((s) => cardFromMoment(s.game, s.moment, s.game.analysis?.maiaRating ?? profiles.find((p) => p.id === s.game.profileId)?.rating));
    const added = useApp.getState().addMistakes(cards);
    useApp.getState().showToast(`${plural(added, 'card')} added to Train → My mistakes`);
  };

  return (
    <div className="card card-pad stack game-actions" style={{ gap: 12 }}>
      <h3>What your games ask of you</h3>
      {deviations.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <b className="small">Where you left your repertoire ({deviations.length})</b>
          {(allDev ? deviations : deviations.slice(0, SHOWN)).map((d) => (
            <div key={d.game.id} className="action-row stack">
              <div className="small">
                <b>
                  {moveNo(d.ply)}
                  {d.played}
                </b>{' '}
                instead of {d.expected.map((e) => `${moveNo(d.ply)}${e}`).join(' or ')}
                <span className="faint"> · {gameLabel(d.game)}</span>{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), useApp.getState().openGame(d.game.id))}>
                  open
                </a>
              </div>
              <DeviationButtons d={d} />
            </div>
          ))}
          {deviations.length > SHOWN && (
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAllDev((x) => !x)}>
              {allDev ? 'Show fewer' : `Show all ${deviations.length}`}
            </button>
          )}
        </section>
      )}
      {toPrepare.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <b className="small">Replies to prepare ({toPrepare.length})</b>
          {(allPrep ? toPrepare : toPrepare.slice(0, SHOWN)).map((u) => (
            <div key={`${u.key}|${u.played}`} className="action-row row wrap">
              <span className="small" style={{ flex: 1, minWidth: 180 }}>
                <b>
                  {moveNo(u.ply)}
                  {u.played}
                </b>{' '}
                <span className="muted">after {u.line.length ? lastMoves(u.line) : 'the start'}</span>
                <span className="faint"> · {plural(u.count, 'game')}</span>
              </span>
              <button className="btn sm" onClick={() => buildAt([...u.line, u.played], u.repId)} title="Open this position in Build to prepare your answer">
                <Icon name="board" size={14} /> Prepare
              </button>
            </div>
          ))}
          {toPrepare.length > SHOWN && (
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAllPrep((x) => !x)}>
              {allPrep ? 'Show fewer' : `Show all ${toPrepare.length}`}
            </button>
          )}
        </section>
      )}
      {suggestions.length > 0 && (
        <section className="row wrap" style={{ gap: 8 }}>
          <span className="small" style={{ flex: 1, minWidth: 200 }}>
            <b>Mistakes to learn:</b> {plural(suggestions.length, 'mistake')} from your games could become training cards
            {learnable.length ? `, ${learnable.length} of them learnable at your level` : ''}.
          </span>
          {learnable.length > 0 && (
            <button className="btn sm primary" onClick={addLearnable} title="The mistakes players at your level can learn to avoid (Maia's estimate)">
              <Icon name="plus" size={14} /> Add {learnable.length}
            </button>
          )}
          <button className="btn sm" onClick={onChoose}>
            Choose…
          </button>
        </section>
      )}
    </div>
  );
}

/** "… 2.Nf3 Nc6 3.d4": the last moves before a position, for a short label. */
function lastMoves(line: string[]): string {
  const start = Math.max(0, line.length - 3);
  const parts = line.slice(start).map((san, k) => {
    const ply = start + k;
    return ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : k === 0 ? `${Math.floor(ply / 2) + 1}…${san}` : san;
  });
  return (start > 0 ? '… ' : '') + parts.join(' ');
}
