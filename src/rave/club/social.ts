/**
 * Club social safety state: who YOU have muted or blocked, persisted across
 * nights. Keyed by DANCER NAME (lowercased) — the one stable handle across
 * visits (relay member indices are per-session). Same law as FIRE FIGHT's
 * club, same store shape:
 *
 *   MUTE  — you stop hearing their voice; they stay visible.
 *   BLOCK — mute plus their figure and name tag vanish for you.
 *
 * Both are strictly LOCAL (nothing crosses the wire); the A-button SOCIAL
 * panel edits them, ClubSocialSystem applies them every frame.
 *
 * The same panel keeps THE MUSIC SWITCH, which lives here for the same
 * reason: it is a thing YOU decided about YOUR night, it belongs to the
 * headset rather than the room, and it should still be true the next time
 * you walk in.
 */

import { SOCIAL_KEYS } from './config.js';

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set((JSON.parse(raw) as string[]).map((n) => n.toLowerCase()));
  } catch {
    /* fresh slate */
  }
  return new Set();
}

function save(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* session-only */
  }
}

const muted = load(SOCIAL_KEYS.muted);
const blocked = load(SOCIAL_KEYS.blocked);

/** THE MUSIC SWITCH: does the club floor's record play for me? Default ON
 *  — a club with no music is a choice, never a state you arrive in. Stored
 *  as the OFF case so a fresh headset (and a wiped store) both mean ON. */
let musicOff = (() => {
  try {
    return localStorage.getItem(SOCIAL_KEYS.music) === 'off';
  } catch {
    return false;
  }
})();

const keyOf = (name: string): string => name.trim().toLowerCase();

/** Is the floor's music playing for me? (The room still hears it either
 *  way — this is my headset's switch, like MUTE and BLOCK.) */
export function clubMusicOn(): boolean {
  return !musicOff;
}

export function toggleClubMusic(): void {
  musicOff = !musicOff;
  try {
    localStorage.setItem(SOCIAL_KEYS.music, musicOff ? 'off' : 'on');
  } catch {
    /* session-only */
  }
}

export function socialMuted(name: string): boolean {
  return muted.has(keyOf(name));
}

export function socialBlocked(name: string): boolean {
  return blocked.has(keyOf(name));
}

export function toggleSocialMute(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (muted.has(k)) muted.delete(k);
  else muted.add(k);
  save(SOCIAL_KEYS.muted, muted);
}

export function toggleSocialBlock(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (blocked.has(k)) blocked.delete(k);
  else blocked.add(k);
  save(SOCIAL_KEYS.blocked, blocked);
}
