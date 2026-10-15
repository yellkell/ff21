/**
 * THE CROWD BED (DESIGN §3.2, phase 6) — fighters always hear the crowd as
 * a crowd. A layered ambient bed under every bout: a DISTANT murmur that
 * never stops, a MID rumble that swells with the action, and ROAR stings
 * when something lands — a hit, a core rung, a round taken, the win.
 *
 * Until real crowd recordings are sourced (neither repo has any) the bed
 * is SYNTHESISED from the sound kit's noise: filtered loops on the sfx bus
 * so the mix is designed now and the samples drop in later behind the
 * same API. Everything here is gain automation on three nodes — nothing
 * per frame but a couple of ramps.
 *
 * `setCrowdRoar(x)` is the HANDS-UP channel: how much of the crowd has its
 * hands up (0..1), aggregated by the room wire once the audience travels;
 * today the local detector (systems/CrowdSystem.ts) feeds it. It is the
 * one way the audience reaches a fighter's ears — noise, never words.
 */

import { audioContext, sfxOut } from './sfx.js';
import { crowdBus, type CrowdCue } from './crowdBus.js';

const BED_SECONDS = 3;
const MURMUR = 0.055;
const RUMBLE_MAX = 0.16;
const ROAR_MAX = 0.28;
const EXCITE_DECAY = 0.55; // per second, toward zero
const CUE_GAIN: Record<CrowdCue, number> = { hit: 0.22, core: 0.4, round: 0.75, win: 1, lose: 0.5 };

interface Bed {
  ctx: AudioContext;
  murmur: GainNode;
  rumble: GainNode;
  roar: GainNode;
  sources: AudioBufferSourceNode[];
}

let bed: Bed | null = null;
let excite = 0;
let roarLevel = 0; // hands-up, eased by the caller
let wobble = 0;

/** The shared crowd state, readable for HUD/probes. */
export const crowd = {
  active: false,
  /** 0..1 — how loud the crowd is right now (murmur → roar). */
  level: 0,
  /** MY hands, 0..1 (CrowdSystem reads the controllers; MeshSystem puts it
   *  on the wire when I am watching). */
  myRoar: 0,
  /** How much of the whole terrace is up, 0..1 — mine and every watcher's
   *  off the wire. This is what the bed actually swells to. */
  roomRoar: 0,
};

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * BED_SECONDS);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Pink-ish noise (a few cascaded one-poles) reads as a crowd far sooner
  // than white noise does.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return buf;
}

function layer(ctx: AudioContext, buf: AudioBuffer, out: GainNode, type: BiquadFilterType, hz: number, q: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = 0.2;
  src.loopEnd = BED_SECONDS - 0.2;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  src.connect(f).connect(out);
  src.start(ctx.currentTime + Math.random() * 0.5);
  return src;
}

/** THE BED'S BREAKER. Off: the synthesised bed was noise in the headset.
 *  Flip it when real crowd recordings land behind this API. */
export const CROWD_BED = false;

/** Raise the bed (a bout began). Idempotent. */
export function startCrowd(): void {
  if (!CROWD_BED || bed) return;
  const ctx = audioContext();
  const out = sfxOut();
  if (!ctx || !out) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const buf = noiseBuffer(ctx);
  const mk = (): GainNode => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    return g;
  };
  const murmur = mk();
  const rumble = mk();
  const roar = mk();
  const sources = [
    layer(ctx, buf, murmur, 'lowpass', 380, 0.5), // far off, under everything
    layer(ctx, buf, rumble, 'bandpass', 760, 0.55), // the mid, swelling with the action
    layer(ctx, buf, roar, 'bandpass', 1500, 0.4), // the roar's body
  ];
  bed = { ctx, murmur, rumble, roar, sources };
  excite = 0;
  crowd.active = true;
  const t = ctx.currentTime;
  murmur.gain.setValueAtTime(0, t);
  murmur.gain.linearRampToValueAtTime(MURMUR, t + 1.2);
}

/** Lower the bed (back to the lobby). */
export function stopCrowd(): void {
  if (!bed) return;
  const { ctx, murmur, rumble, roar, sources } = bed;
  const t = ctx.currentTime;
  for (const g of [murmur, rumble, roar]) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.8);
  }
  for (const s of sources) s.stop(t + 0.9);
  bed = null;
  crowd.active = false;
  crowd.level = 0;
  excite = 0;
}

/** One cue's worth of excitement — the bed swells and a roar sting fires. */
export function crowdEvent(kind: CrowdCue): void {
  const amount = CUE_GAIN[kind];
  excite = Math.min(1.4, excite + amount);
  if (!bed) return;
  // The sting: a fast swell on the roar layer that the decay then lets go.
  const { ctx, roar } = bed;
  const t = ctx.currentTime;
  const peak = Math.min(ROAR_MAX, ROAR_MAX * amount);
  roar.gain.cancelScheduledValues(t);
  roar.gain.setValueAtTime(roar.gain.value, t);
  roar.gain.linearRampToValueAtTime(peak, t + 0.12);
  roar.gain.linearRampToValueAtTime(peak * 0.35, t + 0.9);
}

/** The HANDS-UP channel: 0..1, how much of the crowd is up. */
export function setCrowdRoar(level: number): void {
  roarLevel = Math.max(0, Math.min(1, level));
}

/** Advance the bed: drain the cue sheet, decay the excitement, ramp gains. */
export function tickCrowd(delta: number): void {
  for (const cue of crowdBus.pending) crowdEvent(cue);
  crowdBus.pending.length = 0;
  if (!bed) return;
  excite = Math.max(0, excite - EXCITE_DECAY * delta * (0.6 + excite));
  wobble += delta;
  // A slow breathing under the murmur so it never reads as a static hiss.
  const breath = 0.5 + 0.5 * Math.sin(wobble * 0.7) * Math.sin(wobble * 0.23 + 1.3);
  const swell = Math.min(1, excite * 0.8 + roarLevel);
  crowd.level = Math.min(1, 0.2 + swell * 0.8);
  const { ctx, murmur, rumble, roar } = bed;
  const t = ctx.currentTime + 0.08;
  murmur.gain.linearRampToValueAtTime(MURMUR * (0.85 + 0.3 * breath), t);
  rumble.gain.linearRampToValueAtTime(RUMBLE_MAX * swell, t);
  // The hands-up roar holds the roar layer open under the stings.
  if (roarLevel > 0.02) roar.gain.linearRampToValueAtTime(Math.max(roar.gain.value, ROAR_MAX * roarLevel * 0.8), t);
}
