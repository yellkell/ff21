/**
 * Club voice chat — capture + spatial playback, carried over whole from
 * FIRE FIGHT's club (src/pub/voice/), where this exact design survived
 * contact with the headset browsers:
 *
 *  - CAPTURE is plain Web Audio, not WebCodecs: a ScriptProcessor taps the
 *    mic, box-averages down to ~16 kHz, and ships small Int16 PCM frames.
 *    (Opus/AudioEncoder was unreliable on Quest Browser — mic worked on one
 *    page and sat dead on another.)
 *  - PLAYBACK feeds each punter's frames into their own HRTF PannerNode
 *    pinned to their avatar's head, listener glued to your camera — the
 *    room sounds like a room, voices fall off with distance, and the bar
 *    hubbub happens by itself.
 *
 * Frames ride the SAME room WebSocket as everything else, as binary:
 *   client → server :  [8-byte LE float64 sample rate][Int16 LE mono PCM]
 *   server → client :  [1-byte id length][ascii sender id][the above]
 *
 * A muted/blocked punter's frames are dropped at the door (their id is fed
 * to setVoiceSpeakerMuted by the social system each frame).
 */

import type { Quaternion, Vector3 } from 'three';
import { audioContext } from '../audio/sfx.js';
import { SOCIAL_KEYS } from './config.js';

/* ── the master switch (SYSTEM tab; default ON) ─────────────────────────── */

let voicePref = ((): boolean => {
  try {
    return localStorage.getItem(SOCIAL_KEYS.voice) !== 'off';
  } catch {
    return true;
  }
})();

export function voiceEnabled(): boolean {
  return voicePref;
}

export function setVoiceEnabled(on: boolean): void {
  voicePref = on;
  try {
    localStorage.setItem(SOCIAL_KEYS.voice, on ? 'on' : 'off');
  } catch {
    /* session-only */
  }
  if (!on) stopVoiceCapture();
}

/* ── capture ────────────────────────────────────────────────────────────── */

export type VoiceSender = (frame: ArrayBuffer) => void;

const TARGET_RATE = 16000; // speech band — keeps the relay light
const FRAME_SAMPLES = 2048; // ScriptProcessor block size at the context rate
const SILENCE_RMS = 0.006; // below this it's room tone; don't send a frame

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let sink: GainNode | null = null;
/** Muted element the mic stream is also attached to — Chromium quirk: a
 *  getUserMedia stream routed through WebAudio pumps SILENCE unless it is
 *  also sunk into a media element. Muted so you never hear yourself. */
let pump: HTMLAudioElement | null = null;
let running = false;
let muted = false;
let sender: VoiceSender | null = null;

export function isVoiceCapturing(): boolean {
  return running;
}
export function isVoiceMuted(): boolean {
  return muted;
}
/** Flip mute; returns the new muted state. */
export function toggleVoiceMuted(): boolean {
  muted = !muted;
  return muted;
}

/**
 * Ask for the mic and start streaming PCM frames. Resolves true once live;
 * false if voice is off, there's no context, or permission is denied. Safe
 * to call more than once — only the first start takes.
 */
export async function startVoiceCapture(send: VoiceSender): Promise<boolean> {
  if (running) return true;
  if (!voicePref) return false;
  const ctx = audioContext();
  if (!ctx) {
    console.warn('[club voice] no audio context — mic disabled');
    return false;
  }
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* a gesture will resume it shortly */
    }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[club voice] getUserMedia unavailable — mic disabled');
    return false;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    console.warn('[club voice] microphone permission denied', err);
    return false;
  }

  sender = send;

  pump = new Audio();
  pump.srcObject = stream;
  pump.muted = true;
  void pump.play().catch(() => {});

  source = ctx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but rock-solid across the headset
  // browsers, and needs no separate worklet module to bundle.
  processor = ctx.createScriptProcessor(FRAME_SAMPLES, 1, 1);
  const inRate = ctx.sampleRate;
  const factor = Math.max(1, Math.round(inRate / TARGET_RATE));
  const outRate = inRate / factor;

  processor.onaudioprocess = (e: AudioProcessingEvent): void => {
    if (muted || !sender) return;
    const input = e.inputBuffer.getChannelData(0);
    const outLen = Math.floor(input.length / factor);
    if (outLen === 0) return;
    const pcm = new Int16Array(outLen);
    let sumSq = 0;
    for (let i = 0; i < outLen; i++) {
      // Box-average each group of `factor` samples — a cheap anti-alias.
      let acc = 0;
      for (let j = 0; j < factor; j++) acc += input[i * factor + j];
      const s = acc / factor;
      sumSq += s * s;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    // Don't flood the relay with silence — only send when someone's talking.
    if (Math.sqrt(sumSq / outLen) < SILENCE_RMS) return;
    const out = new ArrayBuffer(8 + pcm.byteLength);
    new DataView(out).setFloat64(0, outRate, true);
    new Int16Array(out, 8).set(pcm);
    sender(out);
  };

  // Pull the graph without echoing the mic back into the room (silent sink).
  sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(processor).connect(sink).connect(ctx.destination);
  running = true;
  return true;
}

export function stopVoiceCapture(): void {
  running = false;
  if (processor) processor.onaudioprocess = null;
  source?.disconnect();
  processor?.disconnect();
  sink?.disconnect();
  if (pump) {
    pump.srcObject = null;
    pump = null;
  }
  for (const t of stream?.getTracks() ?? []) t.stop();
  source = null;
  processor = null;
  sink = null;
  stream = null;
  sender = null;
  muted = false;
}

/* ── spatial playback ───────────────────────────────────────────────────── */

const JITTER = 0.12; // s of lead before a speaker starts — absorbs network jitter
const SPEAKING_MS = 350; // recent-frame window for the "is talking" swell

interface Speaker {
  panner: PannerNode;
  gain: GainNode;
  nextTime: number; // scheduling cursor in ctx time
  lastFrame: number; // performance.now() of the last frame
}

const speakers = new Map<string, Speaker>();

function ensureSpeaker(id: string): Speaker | null {
  const ctx = audioContext();
  if (!ctx) return null;
  const existing = speakers.get(id);
  if (existing) return existing;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 24;
  panner.rolloffFactor = 1.1;
  const gain = ctx.createGain();
  gain.gain.value = 1.5; // voices sit just above the music bed
  panner.connect(gain).connect(ctx.destination);

  const speaker: Speaker = { panner, gain, nextTime: 0, lastFrame: 0 };
  speakers.set(id, speaker);
  return speaker;
}

/** Punters YOU have muted/blocked — their frames are dropped at the door. */
const mutedSpeakers = new Set<string>();

export function setVoiceSpeakerMuted(id: string, m: boolean): void {
  if (m) mutedSpeakers.add(id);
  else mutedSpeakers.delete(id);
}

/** Who is currently gated off, for headless checks. Read-only. */
export function mutedSpeakerIds(): string[] {
  return [...mutedSpeakers].sort();
}

/** Decode (just int16→float) and queue one PCM frame from punter `id`. */
export function pushVoiceFrame(id: string, frame: ArrayBuffer): void {
  if (frame.byteLength <= 8) return;
  if (!voicePref) return; // voice chat off — hear no one
  if (mutedSpeakers.has(id)) return; // muted/blocked — dropped unheard
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const speaker = ensureSpeaker(id);
  if (!speaker) return;

  const rate = new DataView(frame).getFloat64(0, true) || 16000;
  const pcm = new Int16Array(frame, 8);
  if (pcm.length === 0) return;
  const buf = ctx.createBuffer(1, pcm.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;

  const src = ctx.createBufferSource();
  src.buffer = buf; // the context resamples `rate` → output rate automatically
  src.connect(speaker.panner);
  const now = ctx.currentTime;
  // Fallen behind (a talk gap or a stall)? Re-prime the jitter buffer
  // rather than dumping a backlog all at once.
  if (speaker.nextTime < now + 0.005) speaker.nextTime = now + JITTER;
  src.start(speaker.nextTime);
  speaker.nextTime += buf.duration;
  speaker.lastFrame = performance.now();
}

/** Move a speaker's panner to their head (world space). Call every frame. */
export function setVoiceSpeakerPosition(id: string, pos: Vector3): void {
  const speaker = speakers.get(id);
  const ctx = audioContext();
  if (!speaker || !ctx) return;
  const t = ctx.currentTime + 0.04;
  const p = speaker.panner;
  if (p.positionX) {
    p.positionX.linearRampToValueAtTime(pos.x, t);
    p.positionY.linearRampToValueAtTime(pos.y, t);
    p.positionZ.linearRampToValueAtTime(pos.z, t);
  } else {
    p.setPosition(pos.x, pos.y, pos.z);
  }
}

const _fwd = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0 };

/** Glue the audio listener to your camera. Call every frame. */
export function updateVoiceListener(pos: Vector3, quat: Quaternion): void {
  const ctx = audioContext();
  if (!ctx) return;
  const l = ctx.listener;
  const { x, y, z, w } = quat;
  // forward = −Z, up = +Y, both rotated by the camera orientation.
  _fwd.x = -(2 * (x * z + w * y));
  _fwd.y = -(2 * (y * z - w * x));
  _fwd.z = -(1 - 2 * (x * x + y * y));
  _up.x = 2 * (x * y - w * z);
  _up.y = 1 - 2 * (x * x + z * z);
  _up.z = 2 * (y * z + w * x);
  const t = ctx.currentTime + 0.04;
  if (l.positionX) {
    l.positionX.linearRampToValueAtTime(pos.x, t);
    l.positionY.linearRampToValueAtTime(pos.y, t);
    l.positionZ.linearRampToValueAtTime(pos.z, t);
    l.forwardX.linearRampToValueAtTime(_fwd.x, t);
    l.forwardY.linearRampToValueAtTime(_fwd.y, t);
    l.forwardZ.linearRampToValueAtTime(_fwd.z, t);
    l.upX.linearRampToValueAtTime(_up.x, t);
    l.upY.linearRampToValueAtTime(_up.y, t);
    l.upZ.linearRampToValueAtTime(_up.z, t);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
  }
}

/** True if `id` produced voice frames in the last fraction of a second. */
export function isSpeaking(id: string): boolean {
  const speaker = speakers.get(id);
  return !!speaker && performance.now() - speaker.lastFrame < SPEAKING_MS;
}

/** Tear down a speaker when their punter leaves. */
export function removeVoiceSpeaker(id: string): void {
  const speaker = speakers.get(id);
  if (!speaker) return;
  speaker.panner.disconnect();
  speaker.gain.disconnect();
  speakers.delete(id);
}

/** Drop every speaker (leaving a room). */
export function clearVoiceSpeakers(): void {
  for (const id of [...speakers.keys()]) removeVoiceSpeaker(id);
  mutedSpeakers.clear();
}
