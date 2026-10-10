// Sounds for moves and games: the free sound sets Enigmahack made for Lichess (AGPL-3.0-or-later; see
// public/sounds/README.md). Chosen in Settings, remembered per device; off is an option.
import type { PlayedMove } from './chess';

export const SOUND_SETS = ['sfx', 'piano', 'nes', 'futuristic'] as const;
export type SoundSet = (typeof SOUND_SETS)[number] | 'off';
export type SoundName = 'Move' | 'Capture' | 'Check' | 'GenericNotify' | 'LowTime' | 'Victory' | 'Defeat' | 'Draw';

export const SOUND_SET_NAMES: Record<SoundSet, string> = { sfx: 'SFX', piano: 'Piano', nes: 'NES', futuristic: 'Futuristic', off: 'Off' };

const KEY = 'sound-set';

export function soundSet(): SoundSet {
  try {
    const s = localStorage.getItem(KEY) as SoundSet | null;
    return s && (s === 'off' || (SOUND_SETS as readonly string[]).includes(s)) ? s : 'sfx';
  } catch {
    return 'sfx';
  }
}

export function setSoundSet(s: SoundSet) {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* ignore */
  }
}

const players = new Map<string, HTMLAudioElement>();

export function playSound(name: SoundName, set: SoundSet = soundSet()) {
  if (set === 'off' || typeof Audio === 'undefined') return;
  const url = `${import.meta.env.BASE_URL}sounds/${set}/${name}.mp3`;
  let a = players.get(url);
  if (!a) {
    a = new Audio(url);
    a.preload = 'auto';
    a.volume = 0.7;
    players.set(url, a);
  }
  try {
    a.currentTime = 0;
    // Browsers refuse to play before the first tap or click on the page; that is fine.
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** The sound of a move: a check, a capture or a plain move. */
export function playMoveSound(m: Pick<PlayedMove, 'san'>) {
  playSound(/[+#]/.test(m.san) ? 'Check' : m.san.includes('x') ? 'Capture' : 'Move');
}
