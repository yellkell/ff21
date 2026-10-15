/**
 * Pub social safety state: who YOU have muted or blocked, persisted across
 * sessions. Keyed by CALLSIGN (lowercased) — the one stable handle we have
 * for a punter across visits (connection ids are per-session).
 *
 *   MUTE  — you stop hearing their voice; they stay visible.
 *   BLOCK — mute plus their avatar and name tag vanish for you.
 *   PAINT — their body renders bare base tone for you (docs/paint.md §6):
 *           the honest backstop against offensive paintings, zero server work.
 *
 * All strictly LOCAL (nothing goes over the wire); SocialSystem owns the
 * A-button panel that toggles them, PubPlayerSystem applies mute/block per
 * frame and the paint bakes (pub + arena) key off socialState.version.
 */

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

const muted = load('ff-pub-muted');
const blocked = load('ff-pub-blocked');
const noPaint = load('ff2-pub-nopaint');

/** Bumped on any toggle — remote-rig paint bake keys fold this in so a
 *  PAINT flip repaints that body immediately. */
export const socialState = { version: 1 };

const keyOf = (name: string): string => name.trim().toLowerCase();

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
  save('ff-pub-muted', muted);
}

export function toggleSocialBlock(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (blocked.has(k)) blocked.delete(k);
  else blocked.add(k);
  save('ff-pub-blocked', blocked);
  socialState.version += 1;
}

/** True when you've hidden THIS player's paint (they render bare for you). */
export function socialPaintHidden(name: string): boolean {
  return noPaint.has(keyOf(name));
}

export function toggleSocialPaintHide(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (noPaint.has(k)) noPaint.delete(k);
  else noPaint.add(k);
  save('ff2-pub-nopaint', noPaint);
  socialState.version += 1;
}
