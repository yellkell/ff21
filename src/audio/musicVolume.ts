/**
 * Master music volume — one global 0..1 scalar the player sets on the settings
 * panel, persisted to localStorage. Every music track (lobby / battle / finale /
 * training / tutorial) multiplies its own base level by this, so one knob rides
 * the whole score up and down while keeping the relative mix intact. Separate
 * from the music MUTE (menuMusic's `ibb-music-muted`), which is an on/off gate.
 *
 * Tracks register an `onMusicVolume` listener so a slider scrub updates whatever
 * is playing RIGHT NOW (in practice just the lobby track, since the settings
 * panel is lobby-only) without waiting for the next play() call.
 */

const KEY = 'ff-music-vol';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function load(): number {
  try {
    const n = parseFloat(localStorage.getItem(KEY) ?? '');
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch {
    return 1;
  }
}

let vol = load();
const listeners = new Set<() => void>();

/** Current master music volume, 0..1 (1 = full). */
export function musicVolume(): number {
  return vol;
}

/** Set + persist the master music volume; live-updates any playing track. */
export function setMusicVolume(v: number): void {
  vol = clamp01(v);
  try {
    localStorage.setItem(KEY, vol.toFixed(3));
  } catch {
    /* private mode — the choice just won't persist */
  }
  for (const fn of listeners) fn();
}

/** Register a callback fired whenever the master music volume changes, so a
 *  currently-playing track can re-apply its scaled level. */
export function onMusicVolume(fn: () => void): void {
  listeners.add(fn);
}
