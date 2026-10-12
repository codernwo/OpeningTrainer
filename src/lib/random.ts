// Chance, done fairly.

/** A copy in random order, every order equally likely (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One of the items, each as likely as its weight; uniform when no weight is above zero. */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number, random = Math.random): T | undefined {
  if (!items.length) return undefined;
  const weights = items.map((x) => Math.max(0, weight(x)) || 0);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(random() * items.length)];
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
