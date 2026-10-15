/**
 * EMBER's voice — the tutorial guide's recorded lines (docs/tutorial-ember.md).
 * Same decode-and-fire pattern as the ring announcer, with one addition: the
 * lines play through an HRTF PannerNode pinned to the guide orb (the same
 * panner graph as pub voice chat), so her voice comes FROM the little light —
 * TutorialSystem moves the panner every frame and keeps the audio listener
 * glued to the player's head.
 *
 * Clips live in src/assets/tutor/<line-id>.mp3. Until they're recorded (or if
 * one fails to decode) sayTutorLine() plays nothing and returns an estimated
 * duration, so captions and line pacing work identically in silence.
 */

import type { Vector3 } from 'three';
import { audioContext, sfxOut } from './sfx.js';
import { estimateLineSeconds } from '../tutorial/script.js';

// Vite bundles each clip to a hashed URL (same pattern as the announcer).
const modules = import.meta.glob('../assets/tutor/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const urls: Record<string, string> = {};
/** Line id → its take stems. Extra takes share the id with a `_N` suffix
 *  (e.g. 'e100' → ['e100', 'e100_2']); a play picks one at random. */
const takes: Record<string, string[]> = {};
for (const [path, url] of Object.entries(modules)) {
  const stem = (path.split('/').pop() ?? '').replace(/\.mp3$/i, '');
  if (!stem) continue;
  urls[stem] = url;
  const base = stem.replace(/_\d+$/, '');
  (takes[base] ??= []).push(stem);
}

const buffers: Record<string, AudioBuffer> = {};
let loadStarted: Promise<void> | null = null;

function load(ctx: AudioContext): Promise<void> {
  loadStarted ??= Promise.all(
    Object.keys(urls).map(async (k) => {
      try {
        const res = await fetch(urls[k]);
        buffers[k] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        /* leave it unloaded — sayTutorLine() falls back to the caption estimate */
      }
    }),
  ).then(() => undefined);
  return loadStarted;
}

/** Decode the clips ahead of time (call when the tutorial begins). */
export function preloadTutorVoice(): void {
  const ctx = audioContext();
  if (ctx) void load(ctx);
}

let panner: PannerNode | null = null;
let current: AudioBufferSourceNode | null = null;
// Where the orb is right now — tracked cheaply while silent, so a starting
// line can snap the panner there instead of ramping every silent frame.
let posX = 0;
let posY = 0;
let posZ = 0;
let hasPos = false;

/** Her voice sits at the orb: HRTF so it pans and falls off like a real spark. */
function ensurePanner(ctx: AudioContext): PannerNode {
  if (panner) return panner;
  panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.5;
  panner.maxDistance = 24;
  // MUCH gentler than chat — she flies to the far platform to mark targets
  // mid-line, and at 0.8 those lines dropped to a quarter volume out there.
  panner.rolloffFactor = 0.4;
  const gain = ctx.createGain();
  gain.gain.value = 1.0;
  panner.connect(gain).connect(sfxOut() ?? ctx.destination);
  return panner;
}

/**
 * Speak one line, hard-stopping whatever she was saying. Returns the seconds
 * the line runs (real clip length, or the caption estimate when unloaded) so
 * the caller can pace captions and follow-up lines off it.
 */
export function sayTutorLine(id: string, text: string): number {
  const est = estimateLineSeconds(text);
  const ctx = audioContext();
  if (!ctx) return est;
  // Lines with several recorded takes rotate at random per play.
  const stems = takes[id];
  const stem = stems && stems.length > 1 ? stems[Math.floor(Math.random() * stems.length)] : id;
  const buf = buffers[stem] ?? buffers[id];
  if (!buf) {
    void load(ctx); // not decoded yet — kick a load for next time
    return est;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  stopTutorVoice();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const p = ensurePanner(ctx);
  // Snap to the orb's current spot — no ramps ran while she was silent.
  if (hasPos) {
    if (p.positionX) {
      p.positionX.setValueAtTime(posX, ctx.currentTime);
      p.positionY.setValueAtTime(posY, ctx.currentTime);
      p.positionZ.setValueAtTime(posZ, ctx.currentTime);
    } else {
      p.setPosition(posX, posY, posZ);
    }
  }
  src.connect(p);
  src.onended = () => {
    if (current === src) current = null;
  };
  src.start();
  current = src;
  return buf.duration;
}

/** True while a decoded clip is actually sounding (drives the orb's pulse). */
export function tutorVoiceActive(): boolean {
  return current !== null;
}

/** True once `id`'s clip is decoded and ready to speak — the tutorial's
 *  opening beat waits (briefly) on its first line so a fresh install's
 *  "Over here." is heard, not just captioned. */
export function tutorLineReady(id: string): boolean {
  return !!buffers[id];
}

/** Cut the current line (beat skipped, tutorial ended). */
export function stopTutorVoice(): void {
  try {
    current?.stop();
  } catch {
    /* already ended */
  }
  current = null;
}

/** Pin her voice to the orb — call every frame while the tutorial runs.
 *  Silent frames just note the position (the next line snaps to it); ramps
 *  are only scheduled while a clip is actually sounding. */
export function setTutorVoicePosition(pos: Vector3): void {
  posX = pos.x;
  posY = pos.y;
  posZ = pos.z;
  hasPos = true;
  if (!current) return;
  const ctx = audioContext();
  if (!ctx || !panner) return;
  const t = ctx.currentTime + 0.04;
  if (panner.positionX) {
    panner.positionX.linearRampToValueAtTime(pos.x, t);
    panner.positionY.linearRampToValueAtTime(pos.y, t);
    panner.positionZ.linearRampToValueAtTime(pos.z, t);
  } else {
    panner.setPosition(pos.x, pos.y, pos.z);
  }
}

/**
 * Her little "notice me" chime — two soft sine notes, synthesized like the
 * rest of the SFX kit so it needs no asset and rides the SFX fader.
 */
export function tutorChime(): void {
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const out = sfxOut() ?? ctx.destination;
  const t0 = ctx.currentTime;
  for (const [freq, at] of [
    [1318.5, 0], // E6
    [1760.0, 0.11], // A6
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(0.16, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
    osc.connect(g).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.5);
  }
}
