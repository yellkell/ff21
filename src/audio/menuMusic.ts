/**
 * Lobby music — "Dusk", the track that rides under the main menu.
 * It starts the moment you enter VR from the landing page (a user gesture, so
 * autoplay is allowed) and loops while you're in the LOBBY. It pauses the
 * instant you start a bout or aim training, and resumes when you land back in
 * the menu. A mute button on the lobby HUD toggles it, and the choice is
 * REMEMBERED in localStorage — mute it once and it stays silent on every future
 * visit until you un-mute.
 *
 * Rides a MusicTrack (WebAudio) rather than an <audio> element: an audible
 * media element at launch trips a Meta Browser media-session crash in the
 * packaged PWA (see musicTrack.ts). Playback is the AND of
 * three gates — entered VR, in the lobby, not muted — funnelled through sync().
 */

import musicUrl from '../assets/music/dusk.m4a?url';
import { MusicTrack } from './musicTrack.js';
import { musicVolume, onMusicVolume } from './musicVolume.js';

/** FIRE FIGHT 2's OWN mute key. It was 'ibb-music-muted' — Iron Balls
 *  Boxing's — which means a mute set in FF1 on a shared origin carried
 *  over here silently, with the only tell a lit breaker on a settings tab.
 *  A new game starts unmuted. */
const MUTE_KEY = 'ff-music-muted';
const BASE_VOLUME = 0.5;
/** The lobby track's live level: its base scaled by the master music volume. */
function targetVol(): number {
  return BASE_VOLUME * musicVolume();
}

let audio: MusicTrack | null = null;
let entered = false; // has the player entered VR (the autoplay-unlocking gesture)?
let lobbyActive = true; // are we in the menu/lobby (vs a bout or training)?
let fadeTimer: number | null = null;

function stopFade(): void {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

export function isMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private mode — the choice just won't persist */
  }
}

function ensureAudio(): MusicTrack {
  if (!audio) {
    audio = new MusicTrack(musicUrl);
    audio.loop = true;
    audio.volume = targetVol();
  }
  return audio;
}

/** Play only when we've entered VR, are in the lobby, and aren't muted —
 *  otherwise pause. Every state change funnels through here. */
function sync(): void {
  stopFade();
  if (entered && lobbyActive && !isMusicMuted()) {
    const a = ensureAudio();
    a.volume = targetVol();
    void a.play().catch(() => {
      /* autoplay blocked or decode failed — stay silent */
    });
  } else {
    audio?.pause();
  }
}

/** Mark that we're in the lobby WITHOUT starting playback — the victory-sting
 *  handoff calls this the moment we land back in the menu, so that when its
 *  delayed fadeInMenuMusic fires it can tell whether we're STILL there. */
export function noteInLobby(): void {
  lobbyActive = true;
}

/** Bring the lobby music up with a gentle fade — used after the victory sting
 *  hands off. Stays silent if muted, not entered, or out of the lobby. The
 *  lobby check matters: this often fires seconds after the bout ended, and if
 *  the player has already launched ANOTHER bout by then, forcing the lobby
 *  track up would stack it under the new battle score. */
export function fadeInMenuMusic(): void {
  if (!lobbyActive || !(entered && !isMusicMuted())) {
    stopFade();
    audio?.pause();
    return;
  }
  // Already up (e.g. just navigating menu ↔ queue) — leave it, don't re-fade.
  if (audio && !audio.paused && fadeTimer === null) return;
  stopFade();
  const a = ensureAudio();
  // Resume from wherever the level already is — a re-trigger mid-fade must
  // continue the climb, never yank the track back to silence and start over.
  const from = a.paused ? 0 : Math.min(a.volume, targetVol());
  a.volume = from;
  void a.play().catch(() => {
    /* blocked — stay silent */
  });
  const steps = 30; // ~1.5 s at 50 ms
  let i = 0;
  fadeTimer = window.setInterval(() => {
    i += 1;
    const target = targetVol();
    a.volume = Math.min(target, from + ((target - from) * i) / steps);
    if (i >= steps) stopFade();
  }, 50);
}

// Live-scale the lobby track while it's playing steadily (a settings-panel
// slider scrub) — skip mid-fade, the fade recomputes toward the new target.
onMusicVolume(() => {
  if (audio && !audio.paused && fadeTimer === null) audio.volume = targetVol();
});

/**
 * THE READOUT: why the lobby music is or isn't sounding right now, in
 * one word for the settings tab — so a silent headset can say which gate
 * it is stuck behind instead of just being silent.
 */
export function menuMusicStatus(): string {
  if (isMusicMuted()) return 'MUTED';
  if (musicVolume() <= 0.005) return 'VOLUME AT ZERO';
  if (!entered) return 'WAITING FOR THE CURTAIN';
  if (!lobbyActive) return 'PAUSED FOR THE BOUT';
  const a = audio;
  if (!a) return 'NOT STARTED';
  if (a.status === 'failed') return 'DECODE FAILED';
  if (a.status === 'suspended') return 'AUDIO SUSPENDED';
  if (a.status === 'loading') return 'LOADING';
  return a.paused ? 'PAUSED' : 'PLAYING';
}

/**
 * Kick the track's fetch + decode WITHOUT starting playback — called the
 * moment the app boots so that by the time the boot intro's cards have run
 * (6s), the buffer is ready and enterMenuMusic() starts in the same frame.
 */
export function preloadMenuMusic(): Promise<boolean> {
  return ensureAudio().preload();
}

/**
 * Start the lobby music — called when the boot intro's curtain drops (or, in
 * a plain browser, after the enter-VR click has already unlocked audio).
 * No-op if the player muted it on a previous visit or isn't in the lobby.
 */
export function enterMenuMusic(): void {
  entered = true;
  sync();
}

/** Mark whether the player is in the lobby; pauses the music during a bout or
 *  aim training and resumes it on the way back to the menu. */
export function setMenuMusicActive(inLobby: boolean): void {
  lobbyActive = inLobby;
  sync();
}

/** Flip mute (persisted). Returns the new muted state for the HUD glyph. */
export function toggleMusicMuted(): boolean {
  const muted = !isMusicMuted();
  setMuted(muted);
  sync();
  return muted;
}
