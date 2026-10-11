/** A rating change as on Lichess: +12 in green, −8 in red. */
export function RatingDiff({ before, after }: { before: number; after: number }) {
  const d = Math.round(after) - Math.round(before);
  return <span className={`rating-diff ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0'}</span>;
}
