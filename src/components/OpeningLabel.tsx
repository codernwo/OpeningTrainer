import { useEffect } from 'react';
import { loadOpenings, openingOfLine, useOpeningNames, useOpenings } from '../lib/openings';

/** The name of the opening a line is in (its last named position), when opening names are switched on. */
/** `reserve`: keep the line's height when there is no name (training panels, so nothing below moves). */
export function OpeningLabel({ keys, className = 'opening-label small', reserve }: { keys: readonly string[]; className?: string; reserve?: boolean }) {
  const on = useOpeningNames((s) => s.on);
  const byKey = useOpenings((s) => s.byKey);
  useEffect(() => {
    if (on) void loadOpenings();
  }, [on]);
  const o = on && byKey ? openingOfLine(byKey, keys) : null;
  if (!o) return reserve && on ? <span className={className}>&nbsp;</span> : null;
  return (
    <span className={className} title={`${o.eco} · ${o.name}`}>
      {o.name}
    </span>
  );
}
