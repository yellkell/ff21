/**
 * WHO HEARS WHOM — the one table every voice path reads (DESIGN §3.2,
 * phase 6). The mechanics live elsewhere (net/voice.ts pins duel and mesh
 * voices to heads, pub/voice/* is the club's PCM relay); this module only
 * answers the question they all ask before opening a mic or an ear.
 *
 *   RANKED    silence. No mic, no ears. The ladder is played alone with
 *             the noise of the crowd — trash talk is for the club.
 *   DUEL      quick and private bouts: the two fighters hear each other.
 *   BRAWL     2v2 / FFA: every fighter on the platforms.
 *   RAID      the squad, from the lobby through the run.
 *   CLUB      spatial — the whole floor, falling off with distance.
 *   AUDIENCE  watchers hear the fighters and each other; fighters never
 *             hear a watcher's words, only the crowd as a crowd (the
 *             hands-up roar — audio/crowd.ts). The audience wire itself
 *             lands with the presence work; the rule is settled here.
 *
 * The SETTINGS breaker (audio/voicePref.ts) is the master switch on top:
 * off means off everywhere, whatever the table says.
 */

import { app } from '../menu/appState.js';
import { voiceEnabled } from '../audio/voicePref.js';

export type VoiceContext = 'ranked' | 'duel' | 'brawl' | 'raid' | 'club' | 'audience';

export interface VoiceRule {
  /** May my microphone transmit here? */
  speak: boolean;
  /** Whose words reach my ears here. */
  hear: 'nobody' | 'fighters' | 'squad' | 'room' | 'everyone';
  why: string;
}

export const VOICE_RULES: Record<VoiceContext, VoiceRule> = {
  ranked: { speak: false, hear: 'nobody', why: 'the ladder is played in silence' },
  duel: { speak: true, hear: 'fighters', why: 'the two fighters hear each other' },
  brawl: { speak: true, hear: 'fighters', why: 'every fighter on the platforms' },
  raid: { speak: true, hear: 'squad', why: 'the squad, lobby through the run' },
  club: { speak: true, hear: 'room', why: 'the whole floor, spatial' },
  audience: { speak: true, hear: 'everyone', why: 'watchers hear all; fighters hear no watcher' },
};

/** Which room the arena's voice is about to open into, read off the app
 *  state at the moment a bout connects (ranked is flagged before the host
 *  or join call goes out; the arcade mode names the rest). */
export function currentVoiceContext(): VoiceContext {
  // A WATCHER hears everyone — fighters and the terrace alike. (The other
  // half of the rule lives on the fighters' side: MeshSystem never opens a
  // watcher's voice to them, whatever this says about the watcher's ears.)
  if (app.spectating) return 'audience';
  if (app.fromRanked) return 'ranked';
  if (app.arcade === 'raid') return 'raid';
  if (app.arcade === '2v2' || app.arcade === 'ffa') return 'brawl';
  return 'duel';
}

/** May the mic transmit in `ctx`? (The settings breaker wins.) */
export function voiceAllowed(ctx: VoiceContext = currentVoiceContext()): boolean {
  return voiceEnabled() && VOICE_RULES[ctx].speak;
}

/** May anyone's words be played back in `ctx`? (The settings breaker wins.) */
export function hearAllowed(ctx: VoiceContext = currentVoiceContext()): boolean {
  return voiceEnabled() && VOICE_RULES[ctx].hear !== 'nobody';
}
