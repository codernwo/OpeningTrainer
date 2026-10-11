import { useEffect } from 'react';
import { loadOpenings, openingOfLine, useOpeningNames, useOpenings } from '../lib/openings';

/** The name of the opening a line is in (its last named position), when opening names are switched on. */
export function OpeningLabel({ keys, className = 'opening-label small' }: { keys: readonly string[]; className?: string }) {
  const on = useOpeningNames((s) => s.on);
  const byKey = useOpenings((s) => s.byKey);
  useEffect(() => {
    if (on) void loadOpenings();
  }, [on]);
  if (!on || !byKey) return null;
  const o = openingOfLine(byKey, keys);
  if (!o) return null;
  return (
    <span className={className} title={`${o.eco} · ${o.name}`}>
      {o.name}
    </span>
  );
}
