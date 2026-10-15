/**
 * Tutorial music — the battle cut of "Breakcore" (the longer version from the
 * battle rotation) looping for the whole guided basics tutorial. The tutorial
 * rides a bot bout, during which the lobby music is paused (you've left the
 * menu) and the battle score is suppressed (`if (!app.tutorial)
 * startBattleMusic()`), so nothing else is playing — this fills that gap.
 * TutorialSystem starts it when the tutorial begins and stops it when the
 * tutorial ends (graduation KO, forfeit, or bail).
 *
 * MusicTrack (WebAudio, see musicTrack.ts), honours the same persisted mute as
 * the lobby music.
 */

import { isMusicMuted } from './menuMusic.js';
import { MusicTrack } from './musicTrack.js';
import { musicVolume } from './musicVolume.js';
import breakcoreUrl from '../assets/music/battle/breakcore-drums.mp3?url';

const VOLUME = 0.12; // matched to the battle-music floor — music is the floor, SFX the foreground

let audio: MusicTrack | null = null;

/** Loop the tutorial track from the top. No-op if muted. */
export function startTutorialMusic(): void {
  if (isMusicMuted()) return;
  if (!audio) {
    audio = new MusicTrack(breakcoreUrl);
    audio.loop = true;
  }
  audio.volume = VOLUME * musicVolume();
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Stop the tutorial track (the lobby music comes back up on the way out). */
export function stopTutorialMusic(): void {
  audio?.pause();
}
