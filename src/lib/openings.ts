// Opening names for positions, from the list Lichess uses (lichess-org/chess-openings, public domain; see
// src/data/README.md). Loaded the first time a name is needed, as a separate part of the app, and kept in memory.
// A position has a name when one of the listed openings reaches it, by any move order.
import { create } from 'zustand';
import { playSan, START_KEY } from './chess';

export interface Opening {
  eco: string;
  name: string;
}

export const useOpenings = create<{ byKey: Map<string, Opening> | null }>()(() => ({ byKey: null }));

let loading: Promise<void> | null = null;

/** Loads the names (once); components that use `useOpenings` update when they are in. */
export function loadOpenings(): Promise<void> {
  loading ??= import('../data/openings.tsv?raw').then(({ default: tsv }) => {
    useOpenings.setState({ byKey: parseOpenings(tsv) });
  });
  return loading;
}

/** Position key → opening, for every line in the list. Shared beginnings are played only once. */
export function parseOpenings(tsv: string): Map<string, Opening> {
  const byKey = new Map<string, Opening>();
  const prefixKey = new Map<string, string>([['', START_KEY]]);
  for (const row of tsv.split('\n').slice(1)) {
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) continue;
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    let prefix = '';
    let key: string | null = START_KEY;
    for (const san of sans) {
      const next = prefix ? `${prefix} ${san}` : san;
      let k: string | null = prefixKey.get(next) ?? null;
      if (!k) {
        const played = playSan(key, san);
        k = played ? played.to : null;
        if (k) prefixKey.set(next, k);
      }
      if (!k) {
        key = null;
        break;
      }
      prefix = next;
      key = k;
    }
    // The first (most general) name a position gets is kept, as on Lichess.
    if (key && !byKey.has(key)) byKey.set(key, { eco, name });
  }
  return byKey;
}

/** The most specific name along a line: the last position of it that has one. */
export function openingOfLine(byKey: Map<string, Opening>, keys: readonly string[]): Opening | null {
  for (let i = keys.length - 1; i >= 0; i--) {
    const o = byKey.get(keys[i]);
    if (o) return o;
  }
  return null;
}

/** "Sicilian Defense: Najdorf Variation, English Attack" → "Najdorf Variation, English Attack": what a branch adds to the
 *  name of the opening it belongs to. */
export function shortName(name: string, parent?: string): string {
  if (parent && name.startsWith(parent)) {
    const rest = name.slice(parent.length).replace(/^[:,]\s*/, '');
    if (rest) return rest;
  }
  const i = name.indexOf(': ');
  return i >= 0 ? name.slice(i + 2) : name;
}

// ---------------------------------------------------------------------------
// Showing names is a choice (Settings, and the switch in the Tree); on by default, kept on this device.

const PREF = 'show-opening-names';
const read = () => {
  try {
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return true;
  }
};

export const useOpeningNames = create<{ on: boolean; set(on: boolean): void }>()((set) => ({
  on: read(),
  set: (on) => {
    try {
      localStorage.setItem(PREF, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ on });
  },
}));
