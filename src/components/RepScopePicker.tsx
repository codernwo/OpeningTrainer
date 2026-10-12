import { useMemo } from 'react';
import type { Side } from '../lib/chess';
import { inPlay } from '../lib/repertoire';
import { ALL_IN_PLAY, useRepScope, useScopeOf } from '../lib/repScope';
import { useApp } from '../lib/store';

/** Check against all your repertoires in play, or one of them (the same choice everywhere, see repScope.ts). */
export function RepScopePicker({ profileId, side, label = 'Check against' }: { profileId: string; side?: Side; label?: string }) {
  const all = useApp((s) => s.data.repertoires);
  const scope = useScopeOf(profileId);
  const setScope = useRepScope((s) => s.set);
  const reps = useMemo(() => all.filter((r) => r.profileId === profileId && (!side || r.side === side)), [all, profileId, side]);
  const playing = reps.filter(inPlay).length;
  const value = scope === ALL_IN_PLAY || reps.some((r) => r.id === scope) ? scope : ALL_IN_PLAY;
  return (
    <label className="row small rep-scope" style={{ gap: 6 }}>
      <span className="muted">{label}</span>
      <select className="input sm" value={value} onChange={(e) => setScope(profileId, e.target.value)}>
        <option value={ALL_IN_PLAY}>
          All in play ({playing} {playing === 1 ? 'repertoire' : 'repertoires'})
        </option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.side === 'white' ? 'White' : 'Black'}
            {inPlay(r) ? '' : ', study'})
          </option>
        ))}
      </select>
    </label>
  );
}
