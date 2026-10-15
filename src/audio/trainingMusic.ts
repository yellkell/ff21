/**
 * Aim Training music — the "Aim" track that loops for the whole training
 * session. Training pauses the lobby music (you've left the menu) and starts
 * no battle score, so this fills that gap. TrainingSystem starts it when a
 * session begins and stops it when the session ends (bell, KO, or bail).
 *
 * MusicTrack (WebAudio, see musicTrack.ts), honours the same persisted mute as
 * the lobby music.
 */

import { isMusicMuted } from './menuMusic.js';
import { MusicTrack } from './musicTrack.js';
import { musicVolume } from './musicVolume.js';
import aimUrl from '../assets/music/aim.mp3?url';

const VOLUME = 0.12; // matched to the battle-music floor — music is the floor, SFX the foreground

let audio: MusicTrack | null = null;

/** Loop the aim-training track from the top. No-op if muted. */
export function startTrainingMusic(): void {
  if (isMusicMuted()) return;
  if (!audio) {
    audio = new MusicTrack(aimUrl);
    audio.loop = true;
  }
  audio.volume = VOLUME * musicVolume();
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Stop the aim-training track (the lobby music comes back up on the way out). */
export function stopTrainingMusic(): void {
  audio?.pause();
}
