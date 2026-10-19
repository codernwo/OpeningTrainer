import { useEffect, useRef, useState } from 'react';
import { formatLine } from '../lib/chess';
import { engineCheck, findGaps, LOCAL_GAP_SHARE, lossLabel } from '../lib/audit';
import { engineChanged, gapFilters, gapsChanged, savedEngine, savedGaps } from '../lib/checkResults';
import { StatusMark, toggleKeep, tourItems, trimBranch, type TourItem } from './CheckTour';
import { toMoves } from '../lib/repertoire';
import { rareId } from '../lib/checkResults';
import type { CheckTour } from '../lib/store';
import { AuthRequiredError, getToken, startLogin } from '../lib/lichess';
import { activeProfile, activeRep, useApp } from '../lib/store';
import { formatPct } from './ExplorerPanel';
import { Icon } from './Icon';

export function AuditView() {
  const rep = useApp(activeRep)!;
  const profile = useApp(activeProfile)!;
  const { goToSans, updateRep, setView } = useApp.getState();

  // 2% by default: a reply you meet in one of every fifty games with this colour. Your last choice is remembered.
  const [gapOpts, setGapOptsState] = useState(() => ({ minReach: Number(localStorage.getItem('gap-min-reach')) || 0.02, maxPly: 20 }));
  const setGapOpts = (fn: (o: typeof gapOpts) => typeof gapOpts) =>
    setGapOptsState((o) => {
      const next = fn(o);
      try {
        localStorage.setItem('gap-min-reach', String(next.minReach));
      } catch {
        /* ignore */
      }
      return next;
    });
  // Also the replies common in a position you reach often (≥5% there): the rule of the red boxes in Tree and Build.
  const [localRule, setLocalRuleState] = useState(() => localStorage.getItem('gap-local') !== '0');
  const setLocalRule = (v: boolean) => {
    setLocalRuleState(v);
    try {
      localStorage.setItem('gap-local', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const [gapRun, setGapRun] = useState<{ done: number; line: string[]; lookups: number } | null>(null);
  const [gapError, setGapError] = useState<Error | null>(null);
  // The last results stay (synced with your data) until you run the check again: work through them one by one.
  const saved = useApp((s) => s.data.checks?.[rep.id]);
  const saveChecks = useApp((s) => s.saveChecks);
  const gaps = saved?.gaps?.report ?? null;
  const issues = saved?.engine?.issues ?? null;
  const [hideDone, setHideDone] = useState(() => localStorage.getItem('check-hide-done') === '1');
  const toggleHideDone = (v: boolean) => {
    setHideDone(v);
    try {
      localStorage.setItem('check-hide-done', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const [engOpts, setEngOpts] = useState(() => ({
    threshold: saved?.engine?.threshold ?? 50,
    maxPly: 24,
    localDepth: saved?.engine?.depth ?? 16,
  }));
  const [evaluateAll, setEvaluateAll] = useState(false);
  const [engRun, setEngRun] = useState<{ done: number; total: number; line: string[] } | null>(null);
  const [engError, setEngError] = useState<Error | null>(null);

  const abort = useRef<AbortController | null>(null);
  // Leaving the page stops a running check (it would otherwise keep the engine busy).
  useEffect(() => () => abort.current?.abort(), []);

  const runGaps = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setGapError(null);
    setGapRun({ done: 0, line: [], lookups: 0 });
    try {
      const report = await findGaps(
        rep,
        { ratings: profile.ratings, speeds: profile.speeds, ...gapOpts, localShare: localRule ? LOCAL_GAP_SHARE : undefined },
        (done, line, lookups) => setGapRun({ done, line, lookups }),
        ctrl.signal,
      );
      saveChecks(rep.id, { gaps: savedGaps(rep, report, gapOpts.minReach, filters, localRule ? LOCAL_GAP_SHARE : undefined) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setGapError(e as Error);
    } finally {
      setGapRun(null);
    }
  };

  const runEngine = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setEngError(null);
    setEngRun({ done: 0, total: 0, line: [] });
    try {
      const { flags, issues, evaluated, reused } = await engineCheck(
        rep,
        engOpts,
        (done, total, line) => setEngRun({ done, total, line }),
        ctrl.signal,
        evaluateAll ? undefined : rep.engine,
      );
      updateRep(rep.id, (r) => ({ ...r, engine: { ...r.engine, ...flags } }), 'engine check', { undoable: false });
      saveChecks(rep.id, { engine: { ...savedEngine(rep, issues, engOpts.threshold, engOpts.localDepth), evaluated, reused } });
      setEvaluateAll(false);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setEngError(e as Error);
    } finally {
      setEngRun(null);
    }
  };

  const stop = () => abort.current?.abort();

  const tourTo = useApp((s) => s.tourTo);
  /** Opens an item on the build board and remembers the list, so Build can go on to the next one. */
  const open = (kind: CheckTour['kind'], items: TourItem[], item: TourItem) => {
    const ids = items.map((x) => x.id);
    tourTo({ repId: rep.id, kind, ids, index: ids.indexOf(item.id) });
    goToSans(item.line);
  };
  const filters = gapFilters({ ratings: profile.ratings, speeds: profile.speeds, maxPly: gapOpts.maxPly });
  const gapChange = saved?.gaps ? gapsChanged(rep, saved.gaps, filters) : null;
  // A higher threshold than the search used is a filter on its results; a lower one needs a new search.
  const shownMin = Math.max(gapOpts.minReach, saved?.gaps?.minReach ?? 0);
  const needsLower = !!saved?.gaps && gapOpts.minReach < saved.gaps.minReach;
  // The rule of common replies: shown when on, and found only by a search that used it.
  const localShown = localRule && saved?.gaps?.localShare !== undefined;
  const needsLocal = !!saved?.gaps && localRule && saved.gaps.localShare === undefined;
  const engChange = saved?.engine ? engineChanged(rep, saved.engine) : null;
  const engSettings =
    !!saved?.engine && (engOpts.threshold !== saved.engine.threshold || (saved.engine.depth !== undefined && engOpts.localDepth !== saved.engine.depth));
  const gapItems = tourItems(rep, saved, 'gaps').filter((it) => (it.reach ?? 1) >= shownMin || (localShown && (it.share ?? 0) >= LOCAL_GAP_SHARE));
  const endItems = tourItems(rep, saved, 'ends');
  const trimItems = tourItems(rep, saved, 'trim');
  const engineItems = tourItems(rep, saved, 'engine');
  // A reply you added since the check moves its games inside your preparation (at least until that line ends).
  const coverage = gaps
    ? Math.min(1, gaps.coverage + gapItems.reduce((a, it) => a + (it.status.state !== 'open' ? (it.reach ?? 0) : 0), 0))
    : 0;
  const doneCount = (items: TourItem[]) => items.filter((x) => x.status.state === 'done').length;
  const visible = (items: TourItem[]) => (hideDone ? items.filter((x) => x.status.state !== 'done') : items);

  // Engine flags saved from an earlier run, so results survive a reload.
  const storedIssues = Object.values(rep.engine).filter((f) => f.loss >= engOpts.threshold).length;

  return (
    <div className="audit-grid">
      <div className="card">
        <div className="section stack" style={{ gap: 8 }}>
          <div className="row">
            <Icon name="target" />
            <h2>Gaps in your preparation</h2>
          </div>
          <div className="help">
            Walks through your repertoire and compares every position where the opponent is to move with what is actually
            played in the Lichess database (filters of <b>{profile.name}</b>). You see which replies you are still missing,
            sorted by how often you will meet them.
          </div>
          <div className="help">
            The percentage is <b>of all your games with {rep.side === 'white' ? 'White' : 'Black'}</b> (like Chessbook): the shares of the
            opponent’s moves multiplied along the line. A reply played 10% of the time, in a position you reach in 20% of your
            games, counts as 2%. The red boxes in the Tree and on the build board look at one position at a time instead: a reply
            played in at least 5% of the games from that position (tick the option below to see those here too).
          </div>
          <div className="row wrap">
            <span className="muted small">Ignore what occurs in less than</span>
            {[0.005, 0.01, 0.02, 0.05].map((v) => (
              <span key={v} className={`chip ${gapOpts.minReach === v ? 'on' : ''}`} onClick={() => setGapOpts((o) => ({ ...o, minReach: v }))}>
                {formatPct(v)}
              </span>
            ))}
            <span className="muted small">of your games</span>
          </div>
          <label className="row small" style={{ alignItems: 'flex-start', cursor: 'pointer', fontWeight: 400 }}>
            <input type="checkbox" checked={localRule} onChange={(e) => setLocalRule(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Also every reply played in {formatPct(LOCAL_GAP_SHARE)} or more of the games <b>from a position you reach in at least{' '}
              {formatPct(gapOpts.minReach)}</b> of your games — the rule of the red boxes in the Tree and the build board, so they
              match here. Such a reply can itself be rarer than {formatPct(gapOpts.minReach)} of your games.
            </span>
          </label>
          <div className="row">
            {gapRun ? (
              <>
                <button className="btn" onClick={stop}>
                  Stop
                </button>
                <span className="small muted">
                  {gapRun.done} positions checked{gapRun.lookups ? ` (${gapRun.lookups} asked from Lichess)` : ''}…{' '}
                  {formatLine(gapRun.line.slice(-6), Math.max(0, gapRun.line.length - 6))}
                </span>
              </>
            ) : (
              <button className={`btn ${!gaps || gapChange || needsLower || needsLocal ? 'primary' : ''}`} onClick={runGaps}>
                {gaps ? 'Find gaps again' : 'Find gaps'}
              </button>
            )}
          </div>
          {saved?.gaps && !gapRun && (
            <StaleNote
              stale={
                gapChange === 'repertoire'
                  ? 'You changed this repertoire since this search (✓ shows what you dealt with). When you are done, search again to see where it stands now, including deeper in what you added.'
                  : gapChange === 'unknown'
                    ? 'This search was made before the app kept track of changes. Search again to be sure it is up to date.'
                  : gapChange === 'filters'
                    ? `${profile.name}’s Lichess filters (ratings, time controls) changed since this search. Search again to use them.`
                    : needsLower
                      ? `These results go down to ${formatPct(saved.gaps.minReach)} of your games. Search again to go down to ${formatPct(gapOpts.minReach)}.`
                      : needsLocal
                        ? `This search did not yet look for replies common in a position you reach often (${formatPct(LOCAL_GAP_SHARE)} there). Search again to include them.`
                        : null
              }
              fresh="Up to date: you have not changed this repertoire since this search."
              how="The search always walks your whole repertoire; positions this device looked up in the last 30 days come from its cache, so only new ones are asked from Lichess."
            />
          )}
          {!getToken() && (
            <div className="notice small">
              This needs your Lichess account to be connected.{' '}
              <button className="btn sm" onClick={() => startLogin()}>
                Log in with Lichess
              </button>
            </div>
          )}
          {gapError && (
            <div className="notice error">
              {gapError.message}{' '}
              {gapError instanceof AuthRequiredError && (
                <button className="btn sm" onClick={() => setView('settings')}>
                  Settings
                </button>
              )}
            </div>
          )}
        </div>
        {gaps && (
          <>
            <div className="section">
              <div className="coverage-ring">
                <span className="big-count">{Math.round(coverage * 100)}%</span>
                <span className="muted">
                  of your games stay inside your preparation until your lines end · {gaps.positions} positions checked
                  {coverage > gaps.coverage && ` · ${Math.round(gaps.coverage * 100)}% at the check, the rest is what you added since`}
                </span>
              </div>
              <div className="progress" style={{ marginTop: 8 }}>
                <div style={{ width: `${coverage * 100}%`, background: 'var(--mine)' }} />
              </div>
            </div>
            <div className="section">
              <div className="row wrap" style={{ marginBottom: 6 }}>
                <h3>
                  Missing replies ({gapItems.length}
                  {doneCount(gapItems) ? ` · ${doneCount(gapItems)} done` : ''})
                </h3>
                <span className="spacer" />
                <label className="row small muted" style={{ gap: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hideDone} onChange={(e) => toggleHideDone(e.target.checked)} /> hide done
                </label>
              </div>
              {saved?.gaps && (
                <div className="small faint" style={{ marginBottom: 6 }}>
                  Found {timeAgo(saved.gaps.at)}, from {formatPct(shownMin)} of your games
                  {gaps.lookups !== undefined && ` (${gaps.positions} positions, ${gaps.lookups} of them asked from Lichess)`}. Click one to open it
                  on the board; the board then takes you to the next. ✓ means your repertoire now has the reply and your answer.
                </div>
              )}
              {gapItems.length === 0 && <div className="empty">No gaps above the threshold. Nice!</div>}
              <div className="result-list">
                {visible(gapItems).map((it) => {
                  const g = gaps.gaps.find((x) => `${x.key}|${x.san}` === it.id)!;
                  return (
                    <div key={it.id} className={`result-item ${it.status.state}`} onClick={() => open('gaps', visible(gapItems), it)} title="Open this position to add a reply">
                      <span
                        className={`badge gap num ${g.reach < shownMin ? 'local' : ''}`}
                        title={
                          g.reach < shownMin
                            ? `${formatPct(g.reach)} of your games: played in ${formatPct(g.share)} of the games from a position you reach in ${formatPct(g.reach / g.share)} of yours`
                            : `${formatPct(g.reach)} of your games`
                        }
                      >
                        {formatPct(g.reach)}
                      </span>
                      <LineWithLast line={g.line} last={g.san} />
                      <span className="faint small num">
                        {formatPct(g.share)} here{g.routes > 1 ? ` · ${g.routes} move orders` : ''}
                      </span>
                      <StatusMark status={it.status} />
                    </div>
                  );
                })}
              </div>
            </div>
            {gaps.lineEnds.length > 0 && (
              <div className="section">
                <h3 style={{ marginBottom: 6 }}>
                  Lines that end early{doneCount(endItems) ? ` (${doneCount(endItems)} extended)` : ''}
                </h3>
                <div className="help" style={{ marginBottom: 6 }}>
                  Your preparation stops here while many games continue. Not a problem, but you may want to go further.
                </div>
                <div className="result-list">
                  {visible(endItems)
                    .slice(0, 15)
                    .map((it) => {
                      const g = gaps.lineEnds.find((x) => x.key === it.id)!;
                      return (
                        <div key={it.id} className={`result-item ${it.status.state}`} onClick={() => open('ends', visible(endItems).slice(0, 15), it)}>
                          <span className="badge num">{formatPct(g.reach)}</span>
                          <span className="result-line">
                            {formatLine(g.line)} → {g.topMoves.map((m) => `${m.san} ${formatPct(m.share)}`).join(', ')}
                          </span>
                          <StatusMark status={it.status} />
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
            <div className="section">
              <div className="row wrap" style={{ marginBottom: 6 }}>
                <h3>
                  Rare lines to trim{gaps.rare ? ` (${trimItems.length}${doneCount(trimItems) ? ` · ${doneCount(trimItems)} done` : ''})` : ''}
                </h3>
              </div>
              <div className="help" style={{ marginBottom: 6 }}>
                The reverse of a gap: replies you prepared that you meet in fewer than {formatPct(saved?.gaps?.minReach ?? gapOpts.minReach)} of your
                games, with everything after them — each costs training time. The biggest first. Click one to look at it on the
                board and change it there; <b>Delete</b> takes the branch out (Undo is possible), <b>Keep</b> marks one that matters
                however rare it is (a trap, a critical try, a line you love). Lines that stay reachable by another move order are
                not deleted.
              </div>
              {!gaps.rare ? (
                <div className="empty">This search is older than this list. Search again to see the rare lines.</div>
              ) : trimItems.length === 0 ? (
                <div className="empty">Nothing rarer than the threshold. Lean!</div>
              ) : (
                <div className="result-list">
                  {visible(trimItems).map((it) => {
                    const b = gaps.rare!.find((x) => rareId(x) === it.id)!;
                    const moves = toMoves(b.plies);
                    const gone = it.status.note === 'deleted';
                    const kept = it.status.note === 'kept';
                    return (
                      <div
                        key={it.id}
                        className={`result-item ${it.status.state}`}
                        onClick={() => !gone && open('trim', visible(trimItems).filter((x) => x.status.note !== 'deleted'), it)}
                        title={gone ? 'Deleted' : 'Open this line on the board'}
                      >
                        <span className="badge num" title={b.reach ? `${formatPct(b.reach)} of your games` : 'Not among the replies the database lists here'}>
                          {b.reach ? formatPct(b.reach) : '—'}
                        </span>
                        <LineWithLast line={b.line.slice(0, -1)} last={b.san} />
                        <span className="faint small num">
                          {moves} {moves === 1 ? 'move' : 'moves'}
                          {b.routes > 1 ? ` · ${b.routes} move orders` : ''}
                        </span>
                        {!gone && (
                          <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                            <button className="btn sm ghost" aria-pressed={kept} onClick={() => toggleKeep(rep, it.id)} title="Rare, but you want it">
                              {kept ? 'Kept ✓' : 'Keep'}
                            </button>
                            {!kept && (
                              <button className="btn sm ghost danger" onClick={() => trimBranch(rep, b)} title={`Delete ${b.san} and the moves after it`}>
                                <Icon name="trash" size={14} /> Delete
                              </button>
                            )}
                          </span>
                        )}
                        <StatusMark status={it.status} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {gaps.errors.length > 0 && <div className="section notice error small">{gaps.errors.slice(0, 3).join(' · ')}</div>}
          </>
        )}
      </div>

      <div className="card">
        <div className="section stack" style={{ gap: 8 }}>
          <div className="row">
            <Icon name="audit" />
            <h2>Engine check</h2>
          </div>
          <div className="help">
            Checks every move <i>you</i> play. First with the Lichess cloud evaluation (deep and fast); where there is none,
            Stockfish 19 runs in your browser. Moves clearly worse than the best move are marked (?!, ?, ??) — in the tree
            too.
          </div>
          <details className="advanced">
            <summary className="small muted">
              Advanced · flag from {(engOpts.threshold / 100).toFixed(1)} pawn, depth {engOpts.localDepth}
            </summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <div className="row wrap">
                <span className="muted small">Flag from</span>
                {[30, 50, 100].map((v) => (
                  <span key={v} className={`chip ${engOpts.threshold === v ? 'on' : ''}`} onClick={() => setEngOpts((o) => ({ ...o, threshold: v }))}>
                    {(v / 100).toFixed(1)} pawn
                  </span>
                ))}
              </div>
              <div className="row wrap">
                <span className="muted small">Local depth</span>
                {[12, 16, 20].map((v) => (
                  <span key={v} className={`chip ${engOpts.localDepth === v ? 'on' : ''}`} onClick={() => setEngOpts((o) => ({ ...o, localDepth: v }))}>
                    {v}
                  </span>
                ))}
              </div>
              {issues && (
                <label className="row small muted" style={{ gap: 4, cursor: 'pointer' }} title="Also evaluate the moves that were evaluated before">
                  <input type="checkbox" checked={evaluateAll} onChange={(e) => setEvaluateAll(e.target.checked)} /> Evaluate every move again
                </label>
              )}
              <div className="help">
                The defaults suit most repertoires: 0.5 pawn catches real inaccuracies without flagging matters of taste, and
                depth 16 is quick and reliable in the opening.
              </div>
            </div>
          </details>
          <div className="row">
            {engRun ? (
              <>
                <button className="btn" onClick={stop}>
                  Stop
                </button>
                <span className="small muted num">
                  {engRun.done}/{engRun.total} · {formatLine(engRun.line.slice(-4), Math.max(0, engRun.line.length - 4))}
                </span>
              </>
            ) : (
              <>
                <button className={`btn ${!issues || engChange || engSettings ? 'primary' : ''}`} onClick={runEngine}>
                  {issues ? 'Check again' : 'Check my moves'}
                </button>
              </>
            )}
          </div>
          {saved?.engine && !engRun && (
            <StaleNote
              stale={
                engChange === 'repertoire'
                  ? 'You changed your moves in this repertoire since this check. Check again to rate the new ones.'
                  : engChange === 'unknown'
                    ? 'This check was made before the app kept track of changes. Check again to be sure it is up to date.'
                  : engSettings
                    ? `These results are from ${(saved.engine.threshold / 100).toFixed(1)} pawn${saved.engine.depth ? `, depth ${saved.engine.depth}` : ''}. Check again with the new setting.`
                    : null
              }
              fresh="Up to date: you have not changed your moves since this check."
              how="A move’s evaluation depends only on its position, so moves already evaluated at least this deep keep it and only new or deeper ones take time. The result is the same as evaluating everything again."
            />
          )}
          {engRun && engRun.total > 0 && (
            <div className="progress">
              <div style={{ width: `${(engRun.done / engRun.total) * 100}%` }} />
            </div>
          )}
          {engError && <div className="notice error">{engError.message}</div>}
          {!issues && storedIssues > 0 && (
            <div className="help">
              An earlier check found {storedIssues} dubious {storedIssues === 1 ? 'move' : 'moves'} (see the tree, highlight
              “Engine doubts”).
            </div>
          )}
        </div>
        {issues && (
          <div className="section">
            <div className="row wrap" style={{ marginBottom: 6 }}>
              <h3>
                Dubious moves ({issues.length}
                {doneCount(engineItems) ? ` · ${doneCount(engineItems)} done` : ''})
              </h3>
              <span className="spacer" />
              <label className="row small muted" style={{ gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={hideDone} onChange={(e) => toggleHideDone(e.target.checked)} /> hide done
              </label>
            </div>
            {saved?.engine && (
              <div className="small faint" style={{ marginBottom: 6 }}>
                Checked {timeAgo(saved.engine.at)}, from {(saved.engine.threshold / 100).toFixed(1)} pawn
                {saved.engine.evaluated !== undefined && ` (${saved.engine.evaluated} evaluated, ${saved.engine.reused} kept from before)`}. ✓ means you
                changed the move or added the engine’s move.
              </div>
            )}
            {issues.length === 0 && <div className="empty">All moves within the margin. 👍</div>}
            <div className="result-list">
              {visible(engineItems).map((item) => {
                const it = issues.find((x) => x.id === item.id)!;
                const l = lossLabel(it.flag.loss);
                return (
                  <div key={it.id} className={`result-item ${item.status.state}`} onClick={() => open('engine', visible(engineItems), item)}>
                    <span className="badge gap num">−{(it.flag.loss / 100).toFixed(1)}</span>
                    <LineWithLast line={it.line} last={it.san} suffix={l.symbol} />
                    <span className="small">
                      better: <b>{it.flag.bestSan}</b>
                    </span>
                    <StatusMark status={item.status} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Under a check's button: whether its saved results still describe the repertoire. */
function StaleNote({ stale, fresh, how }: { stale: string | null; fresh: string; how: string }) {
  if (!stale)
    return (
      <div className="small muted row" style={{ gap: 6 }}>
        <span className="status-mark done">
          <Icon name="check" size={14} />
        </span>
        {fresh}
      </div>
    );
  return (
    <div className="notice small stale-note">
      <b>{stale}</b> <span className="muted">{how}</span>
    </div>
  );
}

function timeAgo(t: number): string {
  const min = (Date.now() - t) / 60000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  const d = Math.round(min / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "1. e4 e5 2. Nf3 **Nc6**" – the whole line with the move in question in bold. */
function LineWithLast({ line, last, suffix = '' }: { line: string[]; last: string; suffix?: string }) {
  const prefix = formatLine(line);
  const full = formatLine([...line, last]);
  return (
    <span className="result-line">
      {prefix}
      <b>
        {full.slice(prefix.length)}
        {suffix}
      </b>
    </span>
  );
}
