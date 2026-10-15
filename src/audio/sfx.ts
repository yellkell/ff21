/**
 * Tiny WebAudio sound kit — every sound is synthesised at runtime (no asset
 * files to ship or load), tuned to the game's industrial robot-wars palette:
 * struck plate steel, servos, pistons, furnace roar. The core building blocks
 * are `tone` (a glided oscillator), `whooshNoise` (bandpassed noise) and
 * `clank` (an inharmonic partial stack with a noisy attack — metal on metal).
 *
 * The AudioContext can only start inside a user gesture, so we unlock it on
 * the first DOM interaction; after that, sounds triggered from the frame loop
 * play fine.
 */

// Two gain stages: the synth SFX sit under `_master` (0.28, the quiet mix bus);
// `_sfxOut` sits ABOVE it as the user's master SFX-volume fader, and the sampled
// clips (cash / announcer / landing, which ride louder than the synth mix) plug
// straight into `_sfxOut` too — so one knob scales EVERY sound while keeping the
// relative balance.
import { cueCrowd } from './crowdBus.js';
import type { TitanStyle } from '../campaign/bosses.js';

type Ctx = AudioContext & { _master?: GainNode; _sfxOut?: GainNode };

const SFX_VOL_KEY = 'ff-sfx-vol';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

let sfxVol = ((): number => {
  try {
    const n = parseFloat(localStorage.getItem(SFX_VOL_KEY) ?? '');
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch {
    return 1;
  }
})();

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC() as Ctx;
    // User master fader → speakers.
    const sfxOut = ctx.createGain();
    sfxOut.gain.value = sfxVol;
    sfxOut.connect(ctx.destination);
    ctx._sfxOut = sfxOut;
    // Quiet synth mix bus → the fader.
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(sfxOut);
    ctx._master = master;
  }
  return ctx;
}

/** The user master SFX bus — sampled clips (cash/announcer/landing) connect
 *  here instead of the raw destination so they ride the SFX-volume fader too. */
export function sfxOut(): GainNode | null {
  return getCtx()?._sfxOut ?? null;
}

/** Current master SFX volume, 0..1 (1 = full). */
export function sfxVolume(): number {
  return sfxVol;
}

/** Set + persist the master SFX volume; live-updates the running bus. */
export function setSfxVolume(v: number): void {
  sfxVol = clamp01(v);
  try {
    localStorage.setItem(SFX_VOL_KEY, sfxVol.toFixed(3));
  } catch {
    /* private mode — the choice just won't persist */
  }
  if (ctx?._sfxOut) ctx._sfxOut.gain.value = sfxVol;
}

function unlock(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'click', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { capture: true });
  }
}

/** Call from a user gesture (e.g. menu click) to make sure audio is live. */
export function ensureAudio(): void {
  unlock();
}

/** The shared AudioContext (voice chat spatialises through it too). */
export function audioContext(): AudioContext | null {
  return getCtx();
}

/** Where a synth voice plugs in: the quiet mix bus — or, while a titan is
 *  speaking, that titan's own level trim on its way there (see onBus). */
let voiceBus: GainNode | null = null;
function mix(c: Ctx): AudioNode {
  return voiceBus ?? c._master!;
}

function ready(): Ctx | null {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c.state === 'running' ? c : null;
}

interface ToneOpts {
  freq: number;
  to?: number; // glide target
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  const c = ready();
  if (!c) return;
  const { freq, to, type = 'sine', dur = 0.12, gain = 0.2, delay = 0 } = o;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(mix(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Bandpass-filtered noise burst — the basis of every whoosh. */
function whooshNoise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (p < 0.12 ? p / 0.12 : 1) * (1 - p) ** 0.8;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(fromHz, t0);
  bp.frequency.exponentialRampToValueAtTime(toHz, t0 + dur * 0.6);
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(mix(c));
  src.start(t0);
}

/**
 * Struck plate steel: an inharmonic partial stack (plate-bell ratios, each
 * slightly detuned) over a sharp noise tick. `base` sets the pitch of the
 * plate, `dur` how long it rings.
 */
function clank(base: number, gain = 0.2, dur = 0.3, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const ratios = [1, 1.51, 2.27, 3.43, 4.83];
  ratios.forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.015);
    const env = c.createGain();
    const g = gain * (1 / (i + 1));
    const d = dur * (1 - i * 0.12);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.04, d));
    osc.connect(env).connect(mix(c));
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  });
  // The impact tick that sells the strike.
  whooshNoise(0.03, gain * 0.7, base * 4, base * 2, delay);
}

/** A slow sub-bass sine swell — the WEIGHT under every big titan moment.
 *  `attack` widens from a thump (0.01) to a groundswell (1s+). */
function subSwell(from: number, to: number, dur: number, gain: number, delay = 0, attack = 0.05): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(attack, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(mix(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * The titan's vocal cords: a five-saw detuned cluster that falls onto its
 * fundamental, driven through a darkening lowpass with an amplitude SHUDDER
 * (an LFO tremor) — a single glided saw reads as a kazoo dive-bomb; this
 * reads as a chest. */
function growl(base: number, dur: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.12);
  env.gain.setValueAtTime(gain, t0 + dur * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  // The shudder: ~11 Hz amplitude flutter, like air chopping through horns.
  const trem = c.createGain();
  trem.gain.value = 1;
  const lfo = c.createOscillator();
  lfo.frequency.value = 10 + Math.random() * 4;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.35;
  lfo.connect(lfoDepth).connect(trem.gain);
  // Darkening body filter.
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(base * 10, t0);
  lp.frequency.exponentialRampToValueAtTime(base * 3.5, t0 + dur);
  for (const det of [-9, -4, 0, 5, 11]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const f = base * (1 + det / 600);
    osc.frequency.setValueAtTime(f * 1.9, t0); // starts high…
    osc.frequency.exponentialRampToValueAtTime(f, t0 + dur * 0.35); // …falls onto the note
    osc.connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  lp.connect(trem).connect(env).connect(mix(c));
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
}

/** A blown HORN note: three detuned squares through a lowpass, pitch sagging
 *  slightly across the note — brass mass instead of a bare square beep.
 *  `sag` is where the pitch ends up (0.55 = the air running out). */
function horn(freq: number, dur: number, gain: number, delay = 0, sag = 0.985): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * 4;
  lp.Q.value = 0.8;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
  env.gain.setValueAtTime(gain, t0 + dur * 0.8);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  for (const det of [-6, 0, 7]) {
    const osc = c.createOscillator();
    osc.type = 'square';
    const f = freq * (1 + det / 600);
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.linearRampToValueAtTime(f * sag, t0 + dur);
    osc.connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  lp.connect(env).connect(mix(c));
}

/** Servo whine: a narrow-banded saw gliding between two pitches. */
function servo(from: number, to: number, dur: number, gain = 0.07, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 7;
  bp.frequency.setValueAtTime(from * 2, t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(1, to * 2), t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(bp).connect(env).connect(mix(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// --- Drone Hunt (arcade cabinet) -----------------------------------------

/** The light-gun shot: a fast downward zap "pew". */
export function huntShot(): void {
  tone({ freq: 1500, to: 280, type: 'square', dur: 0.11, gain: 0.12 });
  tone({ freq: 2400, to: 700, type: 'sawtooth', dur: 0.07, gain: 0.05 });
}

/** A drone destroyed: a small explosion — debris burst + low pop + metal crunch. */
export function huntHit(): void {
  whooshNoise(0.17, 0.17, 1000, 180);
  tone({ freq: 240, to: 60, type: 'square', dur: 0.14, gain: 0.13 });
  tone({ freq: 900, to: 300, type: 'triangle', dur: 0.06, gain: 0.06 });
}

/** A drone got past you (a life lost): a low descending warning bwoop. */
export function huntEscape(): void {
  tone({ freq: 520, to: 120, type: 'sawtooth', dur: 0.3, gain: 0.13 });
  tone({ freq: 260, to: 80, type: 'square', dur: 0.34, gain: 0.08, delay: 0.02 });
}

/** Game over: a short doomy descending arpeggio with a debris tail. */
export function huntOver(): void {
  tone({ freq: 440, type: 'square', dur: 0.16, gain: 0.12 });
  tone({ freq: 330, type: 'square', dur: 0.16, gain: 0.12, delay: 0.16 });
  tone({ freq: 208, type: 'square', dur: 0.34, gain: 0.13, delay: 0.32 });
  whooshNoise(0.42, 0.06, 380, 70, 0.32);
}

// --- Game sounds ---------------------------------------------------------

/** Trigger pulled at the fist — a latch clacks and the furnace lights. */
export function ignite(): void {
  clank(1900, 0.05, 0.06); // igniter latch
  whooshNoise(0.32, 0.15, 140, 850); // furnace catching
  tone({ freq: 70, to: 46, type: 'sine', dur: 0.22, gain: 0.16 }); // sub thump
}

/**
 * A punched ball leaving the fist. Throw and recall are designed as
 * OPPOSITES so they never blur mid-fight: the throw is a deep, smooth,
 * FALLING whoomp — full-bodied departing air over a round sub punch,
 * everything below ~1.2 kHz, nothing bright, nothing metallic. (The recall
 * is its tonal, RISING mirror below.)
 */
export function throwWhoosh(): void {
  whooshNoise(0.38, 0.3, 1000, 190); // full-bodied departing air, falling away
  noiseHit(0.07, 0.15, 750, 260, 0.6); // dull release puff off the glove
  tone({ freq: 120, to: 44, type: 'sine', dur: 0.2, gain: 0.28 }); // the WHOOMP you feel
}

/** Recall pulled — the throw's mirror: a tonal, RISING pull. Two detuned
 *  partials sweep UP like an approaching doppler over air rushing back IN,
 *  with the winch servo spooling underneath. No crack, no kick — magnetic,
 *  not percussive. */
export function recall(): void {
  tone({ freq: 220, to: 980, type: 'sine', dur: 0.3, gain: 0.13 }); // the pull — rising
  tone({ freq: 331, to: 1470, type: 'sine', dur: 0.3, gain: 0.06, delay: 0.02 }); // shimmer above
  whooshNoise(0.36, 0.13, 260, 1900); // air rushing IN — the throw reversed
  servo(180, 700, 0.24, 0.06);
}

/** The ball clamps back into the gauntlet — ARRIVAL, not another whoosh:
 *  a bright latch over a leather slap and a damped thud. Full stop. */
export function catchBall(): void {
  clank(430, 0.15, 0.14);
  noiseHit(0.05, 0.14, 3400, 900, 0.7); // glove slap under the latch
  tone({ freq: 140, to: 88, type: 'triangle', dur: 0.08, gain: 0.18 });
}

/** Mic toggle: a short up-blip when opening, a duller down-blip when muting. */
export function micToggle(on: boolean): void {
  clank(on ? 1300 : 700, 0.05, 0.05);
  tone({ freq: on ? 520 : 360, to: on ? 760 : 240, type: 'sine', dur: 0.08, gain: 0.12 });
}

/** Your ball lands on the opponent — anvil ring over a heavy body. */
export function hitDealt(): void {
  cueCrowd('hit');
  clank(540, 0.26, 0.35);
  tone({ freq: 260, to: 78, type: 'sine', dur: 0.18, gain: 0.3 });
}

/** Aim Training target impacts: disc = bright gong, cutout = hollow armour. */
export function trainingTargetHit(kind: 0 | 1 | 2): void {
  if (kind === 0) {
    clank(920, 0.18, 0.42);
    clank(1380, 0.08, 0.26, 0.015);
    tone({ freq: 740, to: 980, type: 'triangle', dur: 0.11, gain: 0.12 });
  } else if (kind === 1) {
    clank(360, 0.18, 0.28);
    clank(520, 0.08, 0.18, 0.025);
    tone({ freq: 150, to: 72, type: 'triangle', dur: 0.16, gain: 0.18 });
  } else {
    // The octa drone jackpot: a shattering clank under a rising bell run.
    clank(1100, 0.2, 0.4);
    clank(1650, 0.1, 0.3, 0.02);
    [880, 1109, 1319, 1760].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.14, gain: 0.14, delay: 0.04 + i * 0.07 }),
    );
    whooshNoise(0.3, 0.1, 900, 2600);
  }
}

// --- ARCADE titan sounds (the campaign bosses) ------------------------------

/** A ball glancing off titan armour — bright, dead, no give. */
export function armorClank(): void {
  clank(1650, 0.2, 0.12);
  clank(2300, 0.07, 0.07, 0.01);
  whooshNoise(0.05, 0.08, 3200, 1400);
}

/** A ball finding the exposed core — deep bell + electric fizz. */
export function coreHit(): void {
  cueCrowd('core');
  clank(420, 0.3, 0.5);
  clank(840, 0.12, 0.3, 0.02);
  tone({ freq: 1600, to: 320, type: 'sawtooth', dur: 0.22, gain: 0.09 });
  tone({ freq: 190, to: 60, type: 'sine', dur: 0.26, gain: 0.28 });
}

/** Pit klaxon — the two-tone warning horn before a titan surfaces. Real horn
 *  mass (detuned square stack with sag), not a bare square beep. */
export function klaxon(): void {
  for (const d of [0, 0.55]) {
    horn(392, 0.26, 0.13, d);
    horn(311, 0.28, 0.13, d + 0.24);
  }
}

/** The titan surfacing — the ground swelling first, an engine mass under
 *  grinding hydraulics, plate steel stepping as it climbs. */
export function titanRise(): void {
  subSwell(30, 55, 2.6, 0.32, 0, 1.2); // the floor coming up under you
  growl(44, 2.4, 0.11, 0.2); // engine mass
  servo(60, 220, 2.2, 0.1); // main ram
  servo(48, 150, 2.5, 0.06, 0.25); // second ram, slower
  whooshNoise(2.4, 0.14, 60, 240);
  clank(120, 0.12, 0.6, 0.4);
  clank(88, 0.12, 0.7, 0.9);
  clank(95, 0.14, 0.8, 1.3);
  clank(70, 0.12, 0.9, 1.9);
}

/** The titan's voice — a detuned, shuddering chest of a roar over a sub-bass
 *  swell, never twice at exactly the same pitch. `depth` scales with the
 *  titan (bigger boss, deeper voice). */
export function bossRoar(depth = 1): void {
  const base = (58 / depth) * (0.94 + Math.random() * 0.12);
  growl(base, 1.5, 0.26); // the voice
  growl(base * 0.5, 1.7, 0.18, 0.05); // sub-octave chest under it
  subSwell(base * 1.2, base * 0.55, 1.6, 0.26, 0.02, 0.08); // the floor shaking with it
  whooshNoise(1.3, 0.11, 90 * depth, 280, 0.05); // breath
  clank(70, 0.1, 0.9, 0.12); // plates rattling in sympathy
  clank(52, 0.07, 1.1, 0.55);
}

/** An attack charging — a detuned rising whine over building dread, ending
 *  exactly at the strike. */
export function chargeWhine(dur: number): void {
  servo(140, 980, dur, 0.09);
  servo(137, 964, dur, 0.05); // detuned twin — width, not volume
  whooshNoise(dur, 0.05, 200, 1400);
  subSwell(36, 58, dur, 0.14, 0, dur * 0.7); // dread building underneath
}

/** A titan fist crashing onto the platform — punch, then the earth answers. */
export function slamImpact(): void {
  tone({ freq: 80, to: 26, type: 'sine', dur: 0.42, gain: 0.4 }); // the punch
  subSwell(34, 22, 0.9, 0.26, 0.02, 0.01); // the ground's long answer
  clank(140, 0.24, 0.5, 0.01);
  clank(64, 0.12, 0.8, 0.06); // deep chassis boom behind it
  whooshNoise(0.18, 0.2, 300, 80);
  whooshNoise(0.5, 0.07, 160, 40, 0.08); // dust settling
}

/** The horizontal sweep scything across the platform. */
export function sweepWhoosh(): void {
  whooshNoise(0.32, 0.3, 500, 2200);
  whooshNoise(0.4, 0.12, 220, 900, 0.03); // the arm's mass behind the blade
  clank(340, 0.08, 0.16, 0.06);
}

/** The eye beam firing down its marked strip — a detuned twin-saw lance with
 *  real weight underneath. */
export function beamBlast(): void {
  tone({ freq: 1900, to: 240, type: 'sawtooth', dur: 0.34, gain: 0.13 });
  tone({ freq: 1911, to: 236, type: 'sawtooth', dur: 0.34, gain: 0.09 }); // detuned twin
  whooshNoise(0.34, 0.22, 2400, 500);
  subSwell(95, 42, 0.55, 0.24, 0.02, 0.02);
}

/** One mortar shell bursting on the platform — crack plus a distant report. */
export function mortarThump(): void {
  tone({ freq: 130, to: 42, type: 'sine', dur: 0.24, gain: 0.26 });
  subSwell(48, 28, 0.55, 0.18, 0.03, 0.02); // the report rolling out
  whooshNoise(0.1, 0.12, 700, 200);
  clank(240, 0.08, 0.2, 0.01);
}

/** The titan's core venting open — an exposed opportunity. */
export function coreExposed(): void {
  servo(900, 260, 0.4, 0.08);
  tone({ freq: 620, to: 940, type: 'triangle', dur: 0.18, gain: 0.1, delay: 0.05 });
  whooshNoise(0.4, 0.08, 400, 1100);
}

// --- TITAN VOICES: one throat per machine -----------------------------------
//
// The five arcade titans used to share bossRoar — one chest at five sizes, so
// the scrapyard drone and the zaibatsu king were the same animal. Each now
// speaks through what it IS:
//
//   CHROMEHOOK   a feral tow drone — winch ratchet, cable twang, a seized
//                bearing squealing, a thruster that coughs instead of roars.
//   PISTONKAISER a demolition press — a diesel cranking over and catching,
//                a three-chime air horn, steam dumping off the rams.
//   VULTURE      a stealth raptor — a bit-crushed hawk's KREE over a jet
//                turbine; its chatter is a hawk's kek-kek-kek.
//   JUGGERNAUT   a riot APC — the light-bar siren, a blown-out bullhorn
//                barking orders, tread links clattering under the hull.
//   GOLIATH      the kingpin — taiko, a temple gong, and a throat-sung drone
//                whose overtone whistles over the top.
//
// GOOPLIATH keeps the old roar (his own goo kit carries the rest of him).
// Everything is still synthesised: nothing to ship, nothing to wait for.

/** Every voice cue a titan has. 'name' is the intro card; 'stall' the king's
 *  stalled ascent; 'rage' enrage + crown loops; 'gloat' when you go down;
 *  'death' the killing blow, spread across its ~3s collapse; 'breath' the
 *  king's last exhale as he falls forward. */
export type TitanMood = 'name' | 'stall' | 'rage' | 'gloat' | 'death' | 'breath';
type Machine = Exclude<TitanStyle, 'goop'>;

let noiseBuf: AudioBuffer | null = null;

/** A looping white-noise source off one shared 2s buffer (start it at a
 *  random offset so no two bursts are the same grain). */
function noise(c: Ctx): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    const n = c.sampleRate * 2;
    noiseBuf = c.createBuffer(1, n, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/** Attack → hold → exponential release, wired to `dest` (the mix bus). */
function envGain(c: Ctx, t0: number, peak: number, attack: number, dur: number, hold = 0.4, dest: AudioNode = mix(c)): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + Math.min(dur * 0.95, Math.max(attack, dur * hold)));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(dest);
  return g;
}

const curves = new Map<string, Float32Array<ArrayBuffer>>();

/** Soft-clip (tanh) — a speaker cone pushed past what it was built for. */
function drive(c: Ctx, amount: number): WaveShaperNode {
  const key = `d${amount}`;
  let curve = curves.get(key);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5 - 1) * amount) / Math.tanh(amount);
    curves.set(key, curve);
  }
  const ws = c.createWaveShaper();
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

/** Amplitude quantiser — cheap digital grit for a machine's vocoder. */
function crush(c: Ctx, steps: number): WaveShaperNode {
  const key = `c${steps}`;
  let curve = curves.get(key);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.round((i / 511.5 - 1) * steps) / steps;
    curves.set(key, curve);
  }
  const ws = c.createWaveShaper();
  ws.curve = curve;
  return ws;
}

/** One filtered noise strike at an absolute time — clicks, consonants. */
function burst(c: Ctx, t: number, dur: number, freq: number, gain: number, dest: AudioNode = mix(c), type: BiquadFilterType = 'bandpass', q = 5): void {
  const src = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.9);
  src.stop(t + dur + 0.02);
}

/** A ratchet / tread run: pawl clicks whose rate glides `from` → `to` Hz. */
function ratchet(from: number, to: number, dur: number, freq: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  for (let t = 0; t < dur; ) {
    const k = t / dur;
    burst(c, t0 + t, 0.022, freq * (0.94 + Math.random() * 0.12), gain * (0.7 + Math.random() * 0.3));
    t += 1 / Math.max(0.5, from + (to - from) * k);
  }
}

interface PulseOpts {
  dur: number;
  /** Firing rate (Hz) at the start and end. */
  from: number;
  to: number;
  gain: number;
  delay?: number;
  /** 0..1 timing scatter — 0 is a healthy engine, 0.4 a dying one. */
  jitter?: number;
  /** Lowpass over the whole engine. */
  lp?: number;
  /** A pitched body under the noise (the block's own note), Hz. */
  body?: number;
  bodyType?: OscillatorType;
  /** Per-firing decay time constant (s). */
  decay?: number;
  /** 0..1: how far the firings fade by the end. */
  fade?: number;
}

/** An internal-combustion pulse train: every firing a noise-and-body knock
 *  through one lowpass. Diesels, thrusters, coughs. */
function pulses(o: PulseOpts): void {
  const c = ready();
  if (!c) return;
  const { dur, from, to, gain, delay = 0, jitter = 0, lp = 500, body = 0, bodyType = 'sawtooth', decay = 0.025, fade = 0 } = o;
  const t0 = c.currentTime + delay;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lp;
  f.Q.value = 2;
  f.connect(g).connect(mix(c));
  const n = noise(c);
  n.connect(f);
  n.start(t0, Math.random() * 1.9);
  n.stop(t0 + dur + 0.2);
  if (body) {
    const osc = c.createOscillator();
    osc.type = bodyType;
    osc.frequency.setValueAtTime(body, t0);
    osc.frequency.linearRampToValueAtTime(body * Math.sqrt(to / from), t0 + dur);
    const og = c.createGain();
    og.gain.value = 0.6;
    osc.connect(og).connect(f);
    osc.start(t0);
    osc.stop(t0 + dur + 0.2);
  }
  for (let t = 0; t < dur; ) {
    const k = t / dur;
    const amp = gain * (1 - fade * k) * (0.75 + Math.random() * 0.25);
    g.gain.setValueAtTime(Math.max(0.0001, amp), t0 + t);
    g.gain.setTargetAtTime(0.0001, t0 + t + 0.004, decay);
    t += (1 / Math.max(0.5, from + (to - from) * k)) * (1 + (Math.random() * 2 - 1) * jitter);
  }
  g.gain.setTargetAtTime(0.0001, t0 + dur, 0.02);
}

/** A steel cable pulled taut: stretched (stiff-string) harmonics that bend
 *  down onto pitch, the high ones dying first. */
function twang(freq: number, dur: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  for (let h = 1; h <= 6; h++) {
    const f = freq * h * (1 + 0.004 * h * h);
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(f * 1.03, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.08);
    const d = dur / (1 + h * 0.4);
    osc.connect(envGain(c, t0, gain / h ** 0.8, 0.003, d, 0.02));
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }
  whooshNoise(0.02, gain * 0.6, freq * 8, freq * 4, delay);
}

/** A cable SNAPPING — the crack, then the dispersive "tchoo" a released
 *  steel line throws (its high frequencies outrun its lows). */
function snap(gain: number, delay = 0): void {
  whooshNoise(0.05, gain, 4000, 1500, delay);
  for (const [f, d] of [
    [2400, 0.3],
    [1500, 0.42],
    [900, 0.5],
  ] as const) {
    tone({ freq: f, to: f * 0.18, dur: d, gain: gain * 0.35, delay: delay + 0.005 });
  }
}

/** A seized bearing: stick-slip — a near-pure tone whose pitch and level
 *  judder on two unsynced wobbles. */
function squeal(freq: number, dur: number, gain: number, delay = 0, to = freq): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const lfos: OscillatorNode[] = [];
  for (const [rate, depth] of [
    [6.3, 0.03],
    [17.1, 0.012],
  ] as const) {
    const l = c.createOscillator();
    l.frequency.value = rate * (0.9 + Math.random() * 0.2);
    const lg = c.createGain();
    lg.gain.value = freq * depth;
    l.connect(lg).connect(osc.frequency);
    lfos.push(l);
  }
  const trem = c.createGain();
  trem.gain.value = 0.6;
  const tl = c.createOscillator();
  tl.frequency.value = 21 + Math.random() * 5;
  const tg = c.createGain();
  tg.gain.value = 0.4;
  tl.connect(tg).connect(trem.gain);
  lfos.push(tl);
  osc.connect(trem).connect(envGain(c, t0, gain, 0.05, dur, 0.6));
  for (const o of [osc, ...lfos]) {
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

/** A raptor's KREE through a cheap vocoder: a sawtooth rising into the call
 *  and falling off it, FM'd at half its pitch for the rasp, a 38 Hz flutter
 *  for the roughness, breath noise on the same envelope, and the lot
 *  quantised so it reads machine. `fall` is where the pitch ends up. */
function screech(freq: number, dur: number, gain: number, delay = 0, fall = 0.72): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const out = envGain(c, t0, gain, 0.025, dur, 0.35);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  const peak = c.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = freq * 1.1;
  peak.Q.value = 1.4;
  peak.gain.value = 8;
  const grit = crush(c, 24); // a little digital grit — machine, not a chiptune
  grit.connect(hp).connect(peak).connect(out);
  const glide = (p: AudioParam, m: number): void => {
    p.setValueAtTime(freq * 0.85 * m, t0);
    p.exponentialRampToValueAtTime(freq * 1.08 * m, t0 + dur * 0.18);
    p.exponentialRampToValueAtTime(freq * fall * m, t0 + dur);
  };
  const car = c.createOscillator();
  car.type = 'sawtooth';
  glide(car.frequency, 1);
  const mod = c.createOscillator();
  glide(mod.frequency, 0.5);
  const idx = c.createGain();
  idx.gain.value = freq * 1.2;
  mod.connect(idx).connect(car.frequency);
  const flut = c.createOscillator();
  flut.frequency.value = 38;
  const fg = c.createGain();
  fg.gain.value = freq * 0.02;
  flut.connect(fg).connect(car.frequency);
  const cg = c.createGain();
  cg.gain.value = 0.5;
  car.connect(cg).connect(grit);
  const breath = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 1.2;
  bp.Q.value = 3;
  const bg = c.createGain();
  bg.gain.value = 0.6;
  breath.connect(bp).connect(bg).connect(grit);
  for (const o of [car, mod, flut]) {
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  breath.start(t0, Math.random() * 1.9);
  breath.stop(t0 + dur + 0.05);
}

/** A jet turbine spooling `from` → `to` Hz: the whine, its blade-pass
 *  harmonic, and the intake roar a few octaves down. */
function turbine(from: number, to: number, dur: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const out = envGain(c, t0, gain, dur * 0.3, dur, 0.6);
  for (const [m, g] of [
    [1, 1],
    [1.5, 0.35],
  ] as const) {
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(from * m, t0);
    osc.frequency.exponentialRampToValueAtTime(to * m, t0 + dur);
    const og = c.createGain();
    og.gain.value = g;
    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  const roar = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.5;
  bp.frequency.setValueAtTime(from / 4, t0);
  bp.frequency.exponentialRampToValueAtTime(to / 4, t0 + dur);
  const rg = c.createGain();
  rg.gain.value = 1.5;
  roar.connect(bp).connect(rg).connect(out);
  roar.start(t0, Math.random() * 1.9);
  roar.stop(t0 + dur + 0.05);
}

/** The light-bar siren: a square wailing lo↔hi every `period` seconds,
 *  through a horn speaker's band and a little drive. `fromHigh` starts at
 *  the top — with a long period, that's the motor dying under the wail. */
function siren(lo: number, hi: number, period: number, dur: number, gain: number, delay = 0, fromHigh = false): void {
  const [a, b] = fromHigh ? [hi, lo] : [lo, hi];
  const steps: SirenStep[] = [];
  for (let t = 0; t < dur; t += period) {
    steps.push([Math.min(dur, t + period * 0.5), b]);
    if (t + period * 0.5 < dur) steps.push([Math.min(dur, t + period), a]);
  }
  sirenUnit(a, steps, dur, gain, delay);
}

/** [seconds from start, frequency to arrive at] — glided exponentially. */
type SirenStep = [number, number];

/**
 * One electronic siren unit, the way a police car's actually sounds: the
 * controller's square-wave tone driving a 100W horn speaker. The speaker is
 * the sound — no bass at all (a horn can't make it), a hard honk around
 * 1.4 kHz and a second ring near 2.6 kHz, the cone pushed into crunch. The
 * pitch follows `steps` continuously, so a controller switching WHOOP →
 * WAIL → YELP glides mode to mode like the real box does.
 */
function sirenUnit(start: number, steps: SirenStep[], dur: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(start, t0);
  for (const [t, f] of steps) osc.frequency.exponentialRampToValueAtTime(f, t0 + t);
  // A hair of the driver's own hum riding the tone (the 12V supply).
  const hum = c.createOscillator();
  hum.frequency.value = 118;
  const hg = c.createGain();
  hg.gain.value = start * 0.004;
  hum.connect(hg).connect(osc.frequency);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 420;
  hp.Q.value = 0.9;
  const honk = c.createBiquadFilter();
  honk.type = 'peaking';
  honk.frequency.value = 1400;
  honk.Q.value = 1.3;
  honk.gain.value = 6;
  const ring = c.createBiquadFilter();
  ring.type = 'peaking';
  ring.frequency.value = 2600;
  ring.Q.value = 3;
  ring.gain.value = 4;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4600;
  osc.connect(hp).connect(honk).connect(ring).connect(drive(c, 2.5)).connect(lp).connect(envGain(c, t0, gain, 0.02, dur, 0.9));
  for (const o of [osc, hum]) {
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

/**
 * A riot unit lighting up: the WHOOP (the cop's thumb on the button — one
 * fast swoop up and off), straight into the WAIL (one long rise and fall),
 * then switched to YELP (the fast warble) as it rolls in. `k` stretches
 * the pitch (a second unit runs a little off the first).
 */
function policeRun(k: number, gain: number, delay = 0): void {
  const steps: SirenStep[] = [
    [0.22, 1450 * k], // whoop up…
    [0.4, 560 * k], // …and dropped
    [1.15, 1320 * k], // the wail climbing
    [1.5, 820 * k], // and falling off
  ];
  for (let t = 1.5; t < 2.6; t += 0.17) {
    steps.push([t + 0.085, 1480 * k], [t + 0.17, 760 * k]); // yelp
  }
  sirenUnit(480 * k, steps, 2.7, gain, delay);
}

/** Formants (F1, F2, F3) for the bullhorn voice. 'I' is the short i of
 *  "sit"; 'r' is the r-colour (its low F3 is what makes an r an r). */
const FORMANTS: Record<string, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2250, 3000],
  I: [400, 1920, 2550],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  r: [420, 1250, 1600],
};

/**
 * One bullhorn syllable: [onset consonants, vowel (two letters glide: 'rI'
 * is "ri"), seconds, pitch multiplier, coda]. Onsets: s t d p h m. Codas:
 * p s t v ng. A vowel of '-' is a pause `len` long — the full stop between
 * orders.
 */
type Syll = [string, string, number, number?, ('' | 'p' | 's' | 't' | 'v' | 'ng')?];

/** "STOP. RE-SIS-TING." — JUGGERNAUT's line, stress on SIS. */
const STOP_RESISTING: Syll[] = [
  ['st', 'a', 0.24, 1.1, 'p'],
  ['', '-', 0.22],
  ['', 'rI', 0.12, 0.96],
  ['s', 'I', 0.2, 1.08, 's'],
  ['t', 'I', 0.18, 0.9, 'ng'],
];

/** A closed-mouth hum (m, ng): the voice through the nose, all low end. */
function hum(c: Ctx, t: number, f0: number, dur: number, dest: AudioNode): void {
  const n = c.createOscillator();
  n.type = 'sawtooth';
  n.frequency.setValueAtTime(f0, t);
  n.frequency.linearRampToValueAtTime(f0 * 0.92, t + dur);
  const lo = c.createBiquadFilter();
  lo.type = 'lowpass';
  lo.frequency.value = 600;
  const nasal = c.createBiquadFilter();
  nasal.type = 'bandpass';
  nasal.frequency.value = 2500;
  nasal.Q.value = 4;
  const g = envGain(c, t, 0.6, 0.02, dur, 0.5, dest);
  n.connect(lo).connect(g);
  n.connect(nasal).connect(g);
  n.start(t);
  n.stop(t + dur + 0.03);
}

/**
 * A riot-van bullhorn barking orders. The voice is a MAN run through a
 * machine, not a machine pretending: the source is a softened sawtooth with
 * breath mixed in and a pitch that never sits still (two slow wobbles plus
 * the bark's own fall), shaped by three moving formants, consonants as
 * shaped noise — and only THEN crammed through a paper cone's band and
 * driven hard, with the key-up click before and the squelch tail after.
 * `radio` narrows it to a dispatch channel instead.
 */
function bullhorn(sylls: Syll[], base: number, gain: number, delay = 0, radio = false): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = radio ? 700 : 380;
  const cone = c.createBiquadFilter();
  cone.type = 'peaking';
  cone.frequency.value = 1700;
  cone.Q.value = 1.2;
  cone.gain.value = radio ? 9 : 6;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = radio ? 2600 : 3800;
  const bus = c.createGain();
  bus.gain.value = gain;
  hp.connect(cone).connect(drive(c, radio ? 6 : 3)).connect(lp).connect(bus).connect(mix(c));
  burst(c, t0, 0.03, 2600, 0.6, hp); // key-up
  let t = t0 + 0.06;
  for (const [onset, vowel, len, pitch = 1, coda = ''] of sylls) {
    if (vowel === '-') {
      t += len;
      continue;
    }
    const f0 = base * pitch * (0.98 + Math.random() * 0.04);
    for (const ch of onset) {
      if (ch === 's') {
        burst(c, t, 0.1, 4500, 0.55, hp, 'highpass', 0.7);
        t += 0.08;
      } else if (ch === 't') {
        burst(c, t, 0.03, 3200, 0.9, hp);
        t += 0.035;
      } else if (ch === 'p') {
        burst(c, t, 0.02, 1100, 0.9, hp, 'bandpass', 1.5);
        t += 0.03;
      } else if (ch === 'd') {
        burst(c, t, 0.02, 1500, 0.8, hp);
        t += 0.02;
      } else if (ch === 'h') {
        burst(c, t, 0.08, 1600, 0.5, hp, 'bandpass', 0.7); // breath before the vowel
        t += 0.06;
      } else if (ch === 'm') {
        hum(c, t, f0 * 1.05, 0.08, hp);
        t += 0.07;
      }
    }
    const a = FORMANTS[vowel[0]!] ?? FORMANTS.a!;
    const b = FORMANTS[vowel[vowel.length - 1]!] ?? a;
    // The source: a sawtooth softened toward a throat's buzz, breath under
    // it, and a pitch that drifts (a voice never holds a frequency).
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.06, t);
    osc.frequency.linearRampToValueAtTime(f0 * 0.92, t + len);
    const wobbles: OscillatorNode[] = [];
    for (const [rate, depth] of [
      [4.3, 0.012],
      [7.7, 0.008],
    ] as const) {
      const w = c.createOscillator();
      w.frequency.value = rate * (0.85 + Math.random() * 0.3);
      const wg = c.createGain();
      wg.gain.value = f0 * depth;
      w.connect(wg).connect(osc.frequency);
      wobbles.push(w);
    }
    const throat = c.createBiquadFilter();
    throat.type = 'lowpass';
    throat.frequency.value = 2200;
    throat.Q.value = 0.5;
    osc.connect(throat);
    const breath = noise(c);
    const bg = c.createGain();
    bg.gain.value = 0.18;
    breath.connect(bg).connect(throat);
    // Plosive codas clip the vowel short; the rest let it ring into them.
    const vlen = coda === 'p' || coda === 't' ? len * 0.85 : len;
    const env = envGain(c, t, 1, 0.02, vlen, 0.75, hp);
    a.forEach((fa, i) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6 + i * 2;
      bp.frequency.setValueAtTime(fa, t);
      bp.frequency.linearRampToValueAtTime(b[i]!, t + len * (vowel.length > 1 ? 0.45 : 0.8));
      const g = c.createGain();
      g.gain.value = [3.4, 2.4, 1.5][i]!;
      throat.connect(bp).connect(g).connect(env);
    });
    for (const o of [osc, ...wobbles]) {
      o.start(t);
      o.stop(t + len + 0.05);
    }
    breath.start(t, Math.random() * 1.9);
    breath.stop(t + len + 0.05);
    t += len;
    if (coda === 'p') {
      burst(c, t + 0.05, 0.02, 1000, 0.5, hp, 'bandpass', 1.5); // the lips part
      t += 0.08;
    } else if (coda === 't') {
      burst(c, t + 0.03, 0.025, 3200, 0.7, hp);
      t += 0.06;
    } else if (coda === 's') {
      burst(c, t - 0.02, 0.11, 4500, 0.55, hp, 'highpass', 0.7);
      t += 0.09;
    } else if (coda === 'v') {
      hum(c, t - 0.02, f0 * 0.9, 0.09, hp); // voiced…
      burst(c, t - 0.02, 0.09, 3500, 0.3, hp, 'highpass', 0.7); // …and fricative
      t += 0.08;
    } else if (coda === 'ng') {
      hum(c, t - 0.02, f0 * 0.92, 0.17, hp);
      t += 0.15;
    }
    t += 0.05;
  }
  burst(c, t, 0.12, 2400, 0.35, hp, 'highpass', 0.7); // un-key squelch
}

/**
 * SPOKEN LINES — the titans that say WORDS speak a real recorded take, not
 * the formant synth: human timing and stress (generated offline from a
 * speech engine, dropped deeper with a steel-cab resonance baked in — see
 * public/voice/lines/). At runtime the take still goes through the bullhorn
 * cone, the drive and the arena, so it's a man through a machine. A line
 * that hasn't decoded (or never shipped) returns false and the synth
 * bullhorn barks instead — the card is never silent.
 */
const LINE_TAKES = {
  // [0] is the one that ships on the card (David, the "bark" delivery);
  // the rest stay for the soundboard.
  fortress: [
    'voice/lines/juggernaut-david-bark.m4a',
    'voice/lines/juggernaut-onecore-mark-bark.m4a',
    'voice/lines/juggernaut-onecore-david-bark.m4a',
    'voice/lines/juggernaut-onecore-george-bark.m4a',
    'voice/lines/juggernaut-onecore-mark-flat.m4a',
  ],
} as const satisfies Partial<Record<TitanStyle, readonly string[]>>;

/** The take each titan speaks (the soundboard can swap it to audition). */
const lineChoice: Partial<Record<TitanStyle, string>> = { fortress: LINE_TAKES.fortress[0] };
const lineBufs = new Map<string, AudioBuffer | 'loading' | 'missing'>();

function loadLine(url: string): void {
  const c = getCtx();
  if (!c || lineBufs.has(url)) return;
  lineBufs.set(url, 'loading');
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => c.decodeAudioData(b))
    .then((buf) => lineBufs.set(url, buf))
    .catch(() => lineBufs.set(url, 'missing'));
}

/** Start decoding a titan's spoken line at stage setup (it has the whole
 *  warning + rise, ~3.8s, to arrive before the name card). */
export function preloadTitanLines(style: TitanStyle): void {
  const url = lineChoice[style];
  if (url) loadLine(url);
}

/** Every take a titan has, for the soundboard. */
export function titanLineTakes(style: TitanStyle): readonly string[] {
  return (LINE_TAKES as Partial<Record<TitanStyle, readonly string[]>>)[style] ?? [];
}

/** Pick which take a titan speaks (soundboard audition). */
export function setTitanLine(style: TitanStyle, url: string): void {
  lineChoice[style] = url;
  loadLine(url);
}

/** Play a decoded take through the bullhorn chain. False = not ready. */
function bullhornLine(url: string | undefined, gain: number, delay = 0): boolean {
  const c = ready();
  const buf = url ? lineBufs.get(url) : undefined;
  if (!c || !buf || typeof buf === 'string') {
    if (url) loadLine(url);
    return false;
  }
  const t0 = c.currentTime + delay;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 320;
  const cone = c.createBiquadFilter();
  cone.type = 'peaking';
  cone.frequency.value = 1700;
  cone.Q.value = 1.1;
  cone.gain.value = 6;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  const bus = c.createGain();
  bus.gain.value = gain;
  hp.connect(cone).connect(drive(c, 2.2)).connect(lp).connect(bus).connect(mix(c));
  burst(c, t0, 0.03, 2600, 0.5, hp); // key-up
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(hp);
  src.start(t0 + 0.05);
  burst(c, t0 + 0.05 + buf.duration, 0.12, 2400, 0.3, hp, 'highpass', 0.7); // squelch
  return true;
}

/** A temple gong: inharmonic partials, each a slowly BEATING pair (the
 *  bonshō's wah-wah), under a padded-mallet thump — and the tam-tam bloom,
 *  high shimmer swelling up after the strike. */
function gong(freq: number, dur: number, gain: number, delay = 0, bloom = 1): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  [1, 1.52, 2.0, 2.74, 3.31, 4.18, 5.43].forEach((r, i) => {
    for (const det of [0, 0.7 + i * 0.3]) {
      const osc = c.createOscillator();
      osc.frequency.value = freq * r + det;
      const d = dur * (1 - i * 0.1);
      osc.connect(envGain(c, t0, (gain * 0.5) / (i + 1) ** 0.7, 0.012, d, 0.02));
      osc.start(t0);
      osc.stop(t0 + d + 0.05);
    }
  });
  tone({ freq: freq * 1.6, to: freq * 0.7, dur: 0.25, gain: gain * 0.9, delay });
  whooshNoise(0.06, gain * 0.4, 600, 200, delay);
  if (bloom > 0) {
    const shim = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * 0.12 * bloom, t0 + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.7);
    shim.connect(bp).connect(g).connect(mix(c));
    shim.start(t0, Math.random() * 1.9);
    shim.stop(t0 + dur * 0.7 + 0.05);
  }
}

/** A taiko: the membrane's pitch drop, the floor answering, the bachi tick. */
function taiko(freq: number, gain: number, delay = 0): void {
  tone({ freq: freq * 1.8, to: freq, dur: 0.5, gain, delay });
  subSwell(freq * 0.8, freq * 0.5, 0.8, gain * 0.6, delay, 0.005);
  whooshNoise(0.05, gain * 0.5, 900, 250, delay);
}

/** Throat singing: a sawtooth with its period-doubled sub (kargyraa) under a
 *  warm body, while one narrow formant walks the harmonic series `ot`
 *  (start → middle → end, in harmonics) — the overtone whistling over the
 *  drone. `harsh` adds a buzzing square; `fall` bends the drone down. */
function drone(freq: number, dur: number, gain: number, delay = 0, ot: [number, number, number] = [8, 12, 10], harsh = 0, fall = 0.97): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const out = envGain(c, t0, gain, Math.min(0.25, dur * 0.3), dur, 0.6);
  const body = c.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = freq * 6;
  body.Q.value = 0.7;
  body.connect(out);
  const whistle = c.createBiquadFilter();
  whistle.type = 'bandpass';
  whistle.Q.value = 18;
  whistle.frequency.setValueAtTime(freq * ot[0], t0);
  whistle.frequency.linearRampToValueAtTime(freq * ot[1], t0 + dur * 0.5);
  whistle.frequency.linearRampToValueAtTime(freq * ot[2], t0 + dur);
  const wg = c.createGain();
  wg.gain.value = 4;
  whistle.connect(wg).connect(out);
  const vib = c.createOscillator();
  vib.frequency.value = 5;
  const vg = c.createGain();
  vg.gain.value = freq * 0.006;
  vib.connect(vg);
  const voices: Array<[OscillatorType, number, number]> = [
    ['sawtooth', 1, 1],
    ['sawtooth', 0.5, 0.7],
  ];
  if (harsh > 0) voices.push(['square', 1.002, harsh]);
  for (const [type, m, g] of voices) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * m, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * m * fall, t0 + dur);
    vg.connect(osc.frequency);
    const og = c.createGain();
    og.gain.value = g;
    osc.connect(og);
    og.connect(body);
    og.connect(whistle);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  vib.start(t0);
  vib.stop(t0 + dur + 0.05);
}

/** One round in the magazine cooking off. */
function cookOff(gain: number, delay: number): void {
  whooshNoise(0.07, gain, 2400, 600, delay);
  tone({ freq: 160, to: 45, dur: 0.22, gain: gain * 0.8, delay });
  clank(300 + Math.random() * 200, gain * 0.3, 0.15, delay);
}

function hiss(dur: number, gain: number, delay = 0, hp = 2200, attack = 0.03): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  src.connect(f).connect(envGain(c, t0, gain, attack, dur, 0.3));
  src.start(t0, Math.random() * 1.9);
  src.stop(t0 + dur + 0.05);
}

const HOOK_VOICE = (mood: TitanMood, p: number): void => {
  switch (mood) {
    case 'name':
      ratchet(16, 34, 0.55, 2300 * p, 0.12); // the winch reeling in…
      twang(92 * p, 1.0, 0.2, 0.55); // …the cable snapping taut
      clank(150 * p, 0.12, 0.6, 0.58);
      // The voice: a thruster that coughs instead of roars, a bearing
      // squealing over it like a whistle through broken teeth.
      pulses({ dur: 1.7, from: 23, to: 13, jitter: 0.35, gain: 0.34, delay: 0.6, lp: 700 * p, body: 62 * p, fade: 0.5 });
      growl(66 * p, 1.6, 0.13, 0.62);
      squeal(2350 * p, 1.25, 0.05, 0.75, 1900 * p);
      subSwell(44 * p, 30 * p, 1.5, 0.2, 0.6, 0.1);
      break;
    case 'stall':
    case 'rage':
      squeal(2600 * p, 0.6, 0.08, 0, 3300 * p);
      ratchet(38, 44, 0.4, 2500 * p, 0.12);
      pulses({ dur: 1.1, from: 28, to: 18, jitter: 0.3, gain: 0.34, delay: 0.1, lp: 900 * p, body: 74 * p, fade: 0.4 });
      growl(74 * p, 1.1, 0.14, 0.12);
      subSwell(50 * p, 32 * p, 1.1, 0.18, 0.1, 0.05);
      break;
    case 'gloat':
      // Heh. Heh. Heh. — three choked coughs of the engine.
      [0, 0.26, 0.5].forEach((d, i) => {
        pulses({ dur: 0.17, from: 26, to: 22, jitter: 0.2, gain: 0.3 - i * 0.05, delay: d, lp: 1000 * p, body: (96 - i * 8) * p });
        squeal(2200 * p * (1 - i * 0.06), 0.12, 0.04, d + 0.02);
      });
      ratchet(10, 4, 0.5, 2000 * p, 0.08, 0.85);
      break;
    case 'death':
      // The list: bearings groaning as it leans past the point of no return
      // (deathPose — the crash lands ~3s in on its own slam)…
      squeal(2500 * p, 1.4, 0.07, 0, 1300 * p);
      growl(58 * p, 1.6, 0.14, 0.05);
      // …the cable lets go, the winch freewheels, the thruster coughs out.
      snap(0.24, 1.42);
      ratchet(46, 5, 1.4, 2100 * p, 0.1, 1.45);
      pulses({ dur: 2.2, from: 16, to: 3, jitter: 0.45, gain: 0.26, delay: 0.3, lp: 600 * p, body: 50 * p, fade: 0.85 });
      break;
    case 'breath':
      pulses({ dur: 0.5, from: 9, to: 4, jitter: 0.5, gain: 0.2, lp: 500 * p, body: 45 * p, fade: 0.7 });
      break;
  }
};

/** The KAISER HEAVY three-chime air horn (a minor-ish triad, low). */
const KAISER_HORN = [87, 110, 131];

const PISTON_VOICE = (mood: TitanMood, p: number): void => {
  switch (mood) {
    case 'name':
      // The diesel cranks over and CATCHES, then the air horn.
      pulses({ dur: 0.75, from: 3.5, to: 13, gain: 0.36, lp: 320 * p, body: 44 * p, bodyType: 'square', decay: 0.045 });
      pulses({ dur: 2.0, from: 13, to: 11, jitter: 0.08, gain: 0.16, delay: 0.75, lp: 300 * p, body: 46 * p, bodyType: 'square', decay: 0.04, fade: 0.6 });
      for (const f of KAISER_HORN) horn(f * p, 1.45, 0.09, 0.7, 0.97);
      subSwell(43 * p, 40 * p, 1.5, 0.2, 0.7, 0.04);
      clank(110 * p, 0.12, 0.8, 0.7);
      hiss(1.0, 0.15, 2.05); // the rams dump their steam
      break;
    case 'stall':
    case 'rage':
      for (const d of [0, 0.27, 0.54]) {
        horn(92 * p, 0.2, 0.11, d);
        horn(116 * p, 0.2, 0.11, d);
        hiss(0.12, 0.12, d + 0.2);
      }
      pulses({ dur: 1.0, from: 10, to: 24, gain: 0.3, lp: 380 * p, body: 50 * p, bodyType: 'square', decay: 0.03 });
      break;
    case 'gloat':
      // Three smug revs and a toot-TOOOT.
      for (const d of [0, 0.32, 0.62]) pulses({ dur: 0.22, from: 12, to: 22, gain: 0.28, delay: d, lp: 400 * p, body: 52 * p, bodyType: 'square', decay: 0.03 });
      horn(131 * p, 0.14, 0.1, 0.95);
      horn(131 * p, 0.3, 0.1, 1.15);
      break;
    case 'death':
      for (const f of KAISER_HORN) horn(f * p, 1.9, 0.08, 0, 0.55); // the air running out
      pulses({ dur: 2.8, from: 12, to: 1.5, jitter: 0.25, gain: 0.32, delay: 0.2, lp: 300 * p, body: 44 * p, bodyType: 'square', decay: 0.05, fade: 0.7 });
      hiss(2.6, 0.13, 0.35, 1600, 0.2);
      break;
    case 'breath':
      hiss(0.8, 0.1);
      break;
  }
};

const VULTURE_VOICE = (mood: TitanMood, p: number): void => {
  switch (mood) {
    case 'name':
      turbine(900 * p, 3800 * p, 0.9, 0.05);
      ratchet(26, 26, 0.35, 3400, 0.06, 0.45); // plates hackling up
      screech(2900 * p, 1.25, 0.2, 0.42); // KREEEE…
      screech(2200 * p, 0.55, 0.14, 1.72, 0.6); // …aah
      subSwell(60 * p, 34 * p, 1.3, 0.16, 0.42, 0.05);
      break;
    case 'stall':
    case 'rage':
      turbine(2000 * p, 4500 * p, 0.9, 0.05);
      screech(3100 * p, 0.45, 0.2);
      screech(3300 * p, 0.55, 0.2, 0.5, 0.65);
      break;
    case 'gloat':
      for (let i = 0; i < 5; i++) screech((2600 - i * 120) * p, 0.075, 0.14, i * 0.11, 0.85); // kek-kek-kek
      turbine(3000 * p, 2000 * p, 0.8, 0.03, 0.55);
      break;
    case 'death': {
      screech(2800 * p, 1.6, 0.2, 0, 0.32);
      turbine(4200 * p, 260 * p, 3.0, 0.06, 0.1); // spooling down as it drops
      subSwell(70 * p, 30 * p, 2.0, 0.16, 0.2, 0.2);
      const c = ready();
      if (c) for (let i = 0; i < 8; i++) burst(c, c.currentTime + 1 + Math.random() * 1.6, 0.03, 3000 + Math.random() * 2000, 0.12); // shorting out
      break;
    }
    case 'breath':
      turbine(1200 * p, 200 * p, 0.9, 0.04);
      break;
  }
};

const MOVE_MOVE: Syll[] = [
  ['', 'u', 0.2, 1.1],
  ['', 'u', 0.2, 1.1],
];
const REMAIN_SEATED: Syll[] = [
  ['', 'i', 0.12, 1.0],
  ['', 'e', 0.25, 1.02],
  ['s', 'i', 0.18, 1.04],
  ['t', 'e', 0.24, 0.94],
];

const FORTRESS_VOICE = (mood: TitanMood, p: number): void => {
  switch (mood) {
    case 'name':
      siren(620 * p, 1350 * p, 0.95, 1.0, 0.07); // one wail, cut for the order
      // The recorded take through the bullhorn; the synth bark if it is not in.
      if (!bullhornLine(lineChoice.fortress, 0.38, 0.7)) bullhorn(STOP_RESISTING, 112 * p, 0.24, 0.75);
      pulses({ dur: 2.6, from: 8, to: 9, gain: 0.14, lp: 240 * p, body: 38 * p, bodyType: 'square', decay: 0.05 }); // hull idling
      ratchet(13, 13, 2.4, 520 * p, 0.06, 0.1); // tread links
      subSwell(38 * p, 32 * p, 2.2, 0.16, 0.05, 0.4);
      break;
    case 'stall':
    case 'rage':
      siren(700 * p, 1500 * p, 0.19, 1.1, 0.075); // yelp
      bullhorn(MOVE_MOVE, 120 * p, 0.22, 0.35);
      pulses({ dur: 1.2, from: 9, to: 16, gain: 0.22, lp: 280 * p, body: 40 * p, bodyType: 'square', decay: 0.04 });
      break;
    case 'gloat':
      bullhorn(REMAIN_SEATED, 108 * p, 0.2);
      siren(650 * p, 1300 * p, 0.26, 0.26, 0.06, 1.25);
      siren(650 * p, 1300 * p, 0.26, 0.26, 0.06, 1.55);
      break;
    case 'death':
      siren(160 * p, 1350 * p, 5.0, 2.6, 0.075, 0, true); // the motor dying under the wail
      bullhorn(
        [
          ['', 'a', 0.06],
          ['', 'a', 0.06],
          ['', 'a', 0.3, 0.8],
        ],
        110 * p,
        0.18,
        0.2,
      );
      for (const d of [0.6, 1.0, 1.35, 1.5, 1.9, 2.3, 2.7]) cookOff(0.1 + Math.random() * 0.08, d); // the magazine
      ratchet(12, 2, 2.2, 480 * p, 0.06, 0.1); // treads seizing
      break;
    case 'breath':
      siren(140 * p, 700 * p, 2.0, 1.0, 0.05, 0, true);
      break;
  }
};

const KING_VOICE = (mood: TitanMood, p: number): void => {
  switch (mood) {
    case 'name':
      taiko(62 * p, 0.32);
      taiko(58 * p, 0.3, 0.3);
      gong(64 * p, 4.2, 0.2, 0.62);
      drone(55 * p, 2.3, 0.15, 0.78, [8, 12, 10]);
      subSwell(40 * p, 30 * p, 2.0, 0.2, 0.62, 0.3);
      break;
    case 'stall':
      // Each stalled step of the ascent: a drum, and the drone a step lower.
      taiko(60 * p, 0.3);
      drone(52 * p, 0.95, 0.13, 0.05, [6, 9, 8]);
      break;
    case 'rage':
      for (const d of [0, 0.16, 0.32]) taiko(64 * p, 0.28, d);
      gong(80 * p, 3.0, 0.22, 0.36, 1.6);
      drone(58 * p, 1.5, 0.16, 0.42, [10, 15, 12], 0.4);
      break;
    case 'gloat':
      // Hm. Hm-hmm. Then one small bell.
      drone(48 * p, 0.7, 0.12, 0, [6, 7, 6]);
      drone(48 * p, 0.9, 0.12, 0.8, [6, 8, 5]);
      clank(784 * p, 0.06, 1.4, 1.75);
      break;
    case 'death':
      gong(58 * p, 4.5, 0.22);
      drone(54 * p, 2.0, 0.14, 0.12, [10, 7, 5], 0, 0.75);
      break;
    case 'breath':
      // The last exhale as he tips forward — and the deck taking his weight.
      whooshNoise(1.4, 0.12, 500, 150);
      drone(40 * p, 1.4, 0.1, 0, [5, 4, 3], 0, 0.8);
      taiko(48 * p, 0.36, 1.25);
      subSwell(40, 22, 1.2, 0.3, 1.27, 0.01);
      break;
  }
};

const VOICES: Record<Machine, (mood: TitanMood, p: number) => void> = {
  hook: HOOK_VOICE,
  piston: PISTON_VOICE,
  vulture: VULTURE_VOICE,
  fortress: FORTRESS_VOICE,
  king: KING_VOICE,
};

/** Each machine's solo-campaign scale: the size its voice is tuned at. A
 *  raid giant of the same chassis speaks lower (√ of the size ratio). */
const VOICE_SCALE: Record<Machine, number> = { hook: 1.25, piston: 1.5, vulture: 1.8, fortress: 2.15, king: 2.6 };

function voicePitch(style: Machine, scale: number): number {
  const p = Math.sqrt(VOICE_SCALE[style] / Math.max(0.1, scale));
  return Math.min(1.2, Math.max(0.62, p)) * (0.97 + Math.random() * 0.06);
}

/** The generic roar's depth per mood — what GOOPLIATH (and any style
 *  without a throat of its own) falls back to. */
const ROAR_DEPTH: Record<TitanMood, number> = { name: 0.8, stall: 0.5, rage: 1.1, gloat: 1.2, death: 1.0, breath: 0.9 };

let arenaIn: GainNode | null = null;

/**
 * THE ROOM — a titan is a forty-foot machine in a concrete pit, and a dry
 * synth voice is what made them sound like a computer. Every titan voice
 * sends into one shared reverb: a 2.4s stereo tail generated from decaying
 * noise (each channel its own, so it's wide), darkened as it decays the way
 * a big hall's air eats the highs, with a short pre-delay before the walls
 * answer. Built once per context.
 */
function arena(c: Ctx): AudioNode {
  if (arenaIn) return arenaIn;
  const sr = c.sampleRate;
  const len = Math.floor(sr * 2.4);
  const ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // A one-pole lowpass whose cutoff falls with time: the tail darkens.
      const a = 0.25 + 0.7 * k;
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * (1 - k) ** 3 * (k < 0.004 ? k / 0.004 : 1);
    }
  }
  const pre = c.createDelay(0.1);
  pre.delayTime.value = 0.035;
  const conv = c.createConvolver();
  conv.buffer = ir;
  const wet = c.createGain();
  wet.gain.value = 0.55;
  arenaIn = c.createGain();
  arenaIn.connect(pre).connect(conv).connect(wet).connect(c._master!);
  return arenaIn;
}

/** Per-machine level trim, so every throat lands as loud as the old shared
 *  roar did on the name card (measured RMS, offline render): a screech and a
 *  bullhorn are thin, bright things next to a diesel and need lifting. */
const VOICE_GAIN: Record<Machine, number> = { hook: 2.3, piston: 1.15, vulture: 2.5, fortress: 2.0, king: 1.7 };

/** Run `fn` with every synth node it builds routed through a trim of `gain`.
 *  Every node is wired synchronously, so the bus swap is exact. */
function onBus(gain: number, fn: () => void): void {
  const c = ready();
  if (!c) return;
  const g = c.createGain();
  g.gain.value = gain;
  g.connect(c._master!);
  g.connect(arena(c)); // and into the room
  voiceBus = g;
  try {
    fn();
  } finally {
    voiceBus = null;
  }
}

/** A titan speaks. `scale` is the def's scale (raid giants run deeper). */
export function titanVoice(style: TitanStyle, mood: TitanMood, scale: number): void {
  if (style === 'goop') {
    bossRoar(scale * ROAR_DEPTH[mood]);
    return;
  }
  onBus(VOICE_GAIN[style], () => VOICES[style](mood, voicePitch(style, scale)));
}

/** The titan surfacing — each chassis arrives its own way (the intro's
 *  `riseTime`, 2.6s). */
/** A tone through a small cheap horn speaker: bandpassed and driven. */
function beeper(freq: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'square'): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 1.4;
  bp.Q.value = 1.2;
  osc.connect(bp).connect(drive(c, 3)).connect(envGain(c, t0, gain, 0.006, dur, 0.9));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** A blown chime (a steam whistle's pipes, a conch): each pitch a sine-ish
 *  tone that SCOOPS up onto its note as pressure builds, with breath noise
 *  in a narrow band around it. `jump` > 1 overblows to that ratio at `jumpAt`
 *  (the conch's break up to its next partial). */
function blown(freqs: number[], dur: number, gain: number, delay = 0, o: { breath?: number; buzz?: number; jump?: number; jumpAt?: number; formant?: number } = {}): void {
  const c = ready();
  if (!c) return;
  const { breath = 0.5, buzz = 0, jump = 1, jumpAt = 0.6, formant = 0 } = o;
  const t0 = c.currentTime + delay;
  let dest: AudioNode = envGain(c, t0, gain, 0.08, dur, 0.8);
  if (formant) {
    const f = c.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = formant;
    f.Q.value = 1.5;
    f.gain.value = 10;
    f.connect(dest);
    dest = f;
  }
  const vib = c.createOscillator();
  vib.frequency.value = 5.2;
  const vg = c.createGain();
  vg.gain.setValueAtTime(0, t0);
  vg.gain.linearRampToValueAtTime(freqs[0]! * 0.012, t0 + dur); // the vibrato blooms as the player tires
  vib.connect(vg);
  for (const f0 of freqs) {
    for (const [type, g] of [
      ['sine', 1],
      ['sawtooth', buzz],
    ] as const) {
      if (g <= 0) continue;
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0 * 0.88, t0);
      osc.frequency.exponentialRampToValueAtTime(f0, t0 + 0.14);
      if (jump !== 1) {
        osc.frequency.setValueAtTime(f0, t0 + dur * jumpAt);
        osc.frequency.exponentialRampToValueAtTime(f0 * jump, t0 + dur * jumpAt + 0.06);
      }
      osc.frequency.setValueAtTime(f0 * jump, t0 + dur * 0.9);
      osc.frequency.exponentialRampToValueAtTime(f0 * jump * 0.9, t0 + dur); // the cut-off sag
      vg.connect(osc.frequency);
      const og = c.createGain();
      og.gain.value = g / freqs.length;
      osc.connect(og).connect(dest);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    if (breath > 0) {
      const n = noise(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f0 * (jump !== 1 ? Math.sqrt(jump) : 1);
      bp.Q.value = 14;
      const ng = c.createGain();
      ng.gain.value = (breath * 2.5) / freqs.length;
      n.connect(bp).connect(ng).connect(dest);
      n.start(t0, Math.random() * 1.9);
      n.stop(t0 + dur + 0.05);
    }
  }
  vib.start(t0);
  vib.stop(t0 + dur + 0.05);
}

/**
 * A MECHANICAL rotor siren — a motor spinning a slotted drum, chopping air
 * through a horn. No oscillator ever sounded like one because the pitch has
 * MASS: it chases the motor speed (setTarget, not a ramp), so it winds up
 * slow, sags as the motor tires, and moans down when the power's cut. Each
 * entry of `ports` is one ring of slots (the air-raid's two rings a minor
 * third apart are its chord); wind noise rides the same speed.
 */
function rotorSiren(top: number, ports: number[], up: number, hold: number, down: number, gain: number, delay = 0): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const dur = up + hold + down;
  const speed = (p: AudioParam, m: number): void => {
    p.setValueAtTime(top * m * 0.06, t0);
    p.setTargetAtTime(top * m, t0, up / 3); // spinning up against its own inertia
    p.setTargetAtTime(top * m * 0.94, t0 + up, hold / 2 + 0.01); // the motor tiring under load
    p.setTargetAtTime(top * m * 0.05, t0 + up + hold, down / 2.5); // power cut — the moan down
  };
  const horn = c.createBiquadFilter();
  horn.type = 'bandpass';
  horn.frequency.value = top * 1.3;
  horn.Q.value = 0.9;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(gain, t0 + up * 0.7);
  out.gain.setValueAtTime(gain, t0 + up + hold);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  horn.connect(lp).connect(out).connect(mix(c));
  for (const m of ports) {
    // Air chopped by slots is a rounded pulse: a triangle with some saw edge.
    for (const [type, g] of [
      ['triangle', 0.8],
      ['sawtooth', 0.35],
    ] as const) {
      const osc = c.createOscillator();
      osc.type = type;
      speed(osc.frequency, m);
      const og = c.createGain();
      og.gain.value = g / ports.length;
      osc.connect(og).connect(horn);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
  }
  const wind = noise(c);
  const wb = c.createBiquadFilter();
  wb.type = 'bandpass';
  wb.Q.value = 2;
  speed(wb.frequency, ports[0]!);
  const wg = c.createGain();
  wg.gain.value = 0.5;
  wind.connect(wb).connect(wg).connect(out);
  wind.start(t0, Math.random() * 1.9);
  wind.stop(t0 + dur + 0.05);
}

/**
 * The WARNING — the first thing you hear of a fight, during the intro's
 * klaxonTime (1.2s; it may bleed into the rise). Every titan sounds its own
 * alarm instead of the old shared two-tone klaxon — and every one is a
 * PHYSICAL thing, blown or spun, not a beep:
 *  - CHROMEHOOK: a cracked port foghorn — two blasts, the second one chokes.
 *  - PISTONKAISER: the foundry's shift whistle, three pipes on steam.
 *  - VULTURE: an air-raid siren winding up; something screams at its peak.
 *  - JUGGERNAUT: a riot unit lighting up — whoop, wail, yelp — with a
 *    second car behind it. (The STOP RESISTING is the name card's.)
 *  - GOLIATH: the horagai, the samurai war conch, breaking upward.
 * GOOPLIATH keeps the house klaxon.
 */
export function titanWarn(style: TitanStyle, scale: number): void {
  if (style === 'goop') {
    klaxon();
    return;
  }
  const p = voicePitch(style, scale);
  onBus(VOICE_GAIN[style] * 0.6, () => {
    switch (style) {
      case 'hook':
        // A diaphone foghorn off some dead quay: BEEE-ohh (the grunt down at
        // the end is the diaphone's tell)… then a second blast that never
        // gets its air, coughing out through a split reed.
        blown([98 * p, 147 * p], 0.85, 0.45, 0, { breath: 0.5, buzz: 1, jump: 0.72, jumpAt: 0.78, formant: 420 });
        blown([98 * p, 147 * p], 0.45, 0.3, 1.0, { breath: 0.9, buzz: 0.8, jump: 0.8, jumpAt: 0.4, formant: 420 });
        pulses({ dur: 0.45, from: 22, to: 9, jitter: 0.4, gain: 0.22, delay: 1.05, lp: 700 * p, body: 98 * p, fade: 0.8 });
        ratchet(14, 8, 0.4, 900 * p, 0.07, 1.3); // chain settling on the hook
        break;
      case 'piston':
        hiss(0.18, 0.18, 0, 3000, 0.005); // the valve cracks open
        blown([370, 466, 554], 1.15, 0.3, 0.04, { breath: 0.6 });
        break;
      case 'vulture':
        // The air raid: two slot rings a minor third apart, winding up.
        rotorSiren(430 * p, [1, 1.2], 1.0, 0.35, 0.9, 0.5);
        screech(2600 * p, 0.6, 0.09, 1.05, 0.6); // high over it, far off
        break;
      case 'fortress':
        // Police lights up: whoop, wail, yelp — and a second unit behind it,
        // a beat late and a little flat, so it's a squad, not a ringtone.
        policeRun(1, 0.11);
        policeRun(0.93, 0.07, 0.3);
        subSwell(38 * p, 52 * p, 2.4, 0.18, 0.4, 1.0); // the hull, under it all
        break;
      case 'king':
        blown([233 * p], 1.35, 0.42, 0, { breath: 0.8, buzz: 0.6, jump: 4 / 3, jumpAt: 0.55, formant: 820 });
        blown([233 * p * 1.006], 1.35, 0.18, 0.02, { breath: 0, buzz: 0.4, jump: 4 / 3, jumpAt: 0.56 });
        break;
    }
  });
}

export function titanArrive(style: TitanStyle, scale: number): void {
  if (style === 'goop') return;
  // The vulture's flyby is all air and whine — lift it to sit with the rest.
  onBus(style === 'vulture' ? 1.8 : 1, () => arrive(style, voicePitch(style, scale)));
}

function arrive(style: Machine, p: number): void {
  switch (style) {
    case 'hook': {
      // The thruster won't catch: cough… cough… then a ragged run. Scrap
      // shakes loose off the frame and the crooked ram grinds as it hauls.
      for (const d of [0, 0.3, 0.52]) pulses({ dur: 0.12, from: 30, to: 24, gain: 0.3, delay: d, lp: 800 * p, body: 70 * p });
      pulses({ dur: 1.9, from: 12, to: 20, jitter: 0.4, gain: 0.2, delay: 0.7, lp: 900 * p, body: 58 * p, fade: 0.3 });
      servo(70 * p, 180 * p, 2.0, 0.08, 0.6);
      servo(67 * p, 150 * p, 2.0, 0.05, 0.62); // the bent twin, never in step
      squeal(1900 * p, 1.0, 0.03, 0.9, 2300 * p);
      for (let i = 0; i < 9; i++) clank(300 + Math.random() * 600, 0.05 + Math.random() * 0.04, 0.2, 0.7 + Math.random() * 1.8); // junk rattle
      subSwell(36 * p, 48 * p, 2.0, 0.18, 0.6, 0.8);
      break;
    }
    case 'piston':
      // Air brakes dump — PSSHHT — the pump spins up, the diesel takes the
      // load. The strokes themselves land on titanBeat.
      hiss(0.5, 0.26, 0, 1400, 0.004);
      whooshNoise(0.45, 0.2, 3000, 700);
      servo(380 * p, 900 * p, 1.4, 0.05, 0.35); // hydraulic pump
      servo(900 * p, 760 * p, 1.0, 0.04, 1.75);
      pulses({ dur: 2.2, from: 9, to: 14, gain: 0.2, delay: 0.4, lp: 320 * p, body: 48 * p, bodyType: 'square', decay: 0.04 });
      subSwell(32 * p, 44 * p, 2.2, 0.2, 0.4, 0.6);
      break;
    case 'vulture':
      // The flank swoop: a jet coming in and past.
      turbine(1200 * p, 4200 * p, 1.3, 0.05);
      turbine(4200 * p, 1600 * p, 1.2, 0.05, 1.3);
      whooshNoise(1.6, 0.3, 300, 2600, 0.3);
      whooshNoise(0.5, 0.2, 2200, 500, 1.2);
      subSwell(55 * p, 30 * p, 2.0, 0.18, 0.4, 0.6);
      break;
    case 'fortress':
      // Rolling out of the dark: both treads, the hull's diesel, the turret.
      ratchet(10, 16, 2.6, 520 * p, 0.09);
      ratchet(11, 17, 2.6, 610 * p, 0.07, 0.04);
      pulses({ dur: 2.6, from: 7, to: 10, gain: 0.2, lp: 260 * p, body: 40 * p, bodyType: 'square', decay: 0.05 });
      servo(120 * p, 240 * p, 1.2, 0.06, 1.2);
      subSwell(30, 50, 2.6, 0.3, 0, 1.2);
      break;
    case 'king': {
      // OROSHI — the taiko roll: slow single strokes closing into a storm,
      // a drone rising under it. The stalls (titanBeat) break the roll.
      let t = 0;
      for (let gap = 0.5; t < 2.4; gap = Math.max(0.07, gap * 0.8)) {
        taiko(66 * p, 0.1 + 0.18 * (t / 2.4), t);
        t += gap;
      }
      drone(40 * p, 2.6, 0.09, 0.1, [6, 10, 8], 0, 1.08);
      subSwell(30 * p, 45 * p, 2.6, 0.2, 0, 1.4);
      break;
    }
  }
}

/** One stepped beat of an entrance (the hook's winch jerk, the press's
 *  stroke seating, the king's stalled ascent). */
export function titanBeat(style: TitanStyle, scale: number): void {
  const p = style === 'goop' ? 1 : voicePitch(style, scale);
  switch (style) {
    case 'hook':
      armorClank();
      ratchet(30, 30, 0.12, 2200 * p, 0.1);
      twang(110 * p, 0.5, 0.1, 0.02);
      break;
    case 'piston':
      slamImpact();
      hiss(0.35, 0.12, 0.05);
      break;
    case 'king':
      titanVoice(style, 'stall', scale);
      break;
  }
}

/** Attack kinds folded into the families a tell distinguishes. */
type TellFamily = 'beam' | 'sweep' | 'volley' | 'nova' | 'floor' | 'lines' | 'ring' | 'wave' | 'melee';
const TELL_FAMILY: Record<string, TellFamily> = {
  beam: 'beam',
  sweep: 'sweep',
  volley: 'volley',
  nova: 'nova',
  decree: 'nova',
  slam: 'floor',
  seesaw: 'floor',
  surge: 'floor',
  lanes: 'lines',
  cross: 'lines',
  trident: 'lines',
  gate: 'ring',
  donut: 'ring',
  duckdonut: 'ring',
  wave: 'wave',
  melee: 'melee',
};

/**
 * THE TELL — the sound of an attack charging, `dur` seconds from windup to
 * strike. Every machine has its own RISER (the read: it climbs, and it ends
 * exactly on the hit — the old shared chargeWhine's job, now in each
 * chassis's own voice), and over it an ACCENT that names the attack family,
 * so a seasoned ear hears what's coming before the floor lights up.
 * `kind` is the attack kind, or 'melee' for a reach. GOOPLIATH keeps the
 * shared whine (his goo telegraphs carry the rest).
 */
export function titanTell(style: TitanStyle, kind: string, dur: number, scale: number): void {
  if (style === 'goop') {
    chargeWhine(dur);
    return;
  }
  const fam = TELL_FAMILY[kind] ?? 'floor';
  onBus(VOICE_GAIN[style], () => {
    const p = voicePitch(style, scale);
    RISERS[style](dur, p);
    ACCENTS[style][fam](dur, p);
  });
}

const RISERS: Record<Machine, (dur: number, p: number) => void> = {
  // The winch reeling in, faster and faster; the bent ram straining.
  hook: (d, p) => {
    ratchet(6, 34, d, 2300 * p, 0.07);
    servo(90 * p, 420 * p, d, 0.07);
    subSwell(36, 56, d, 0.12, 0, d * 0.7);
  },
  // The diesel revving to the stop; hydraulic pressure building; the valve.
  piston: (d, p) => {
    pulses({ dur: d, from: 8, to: 26, gain: 0.14, lp: 380 * p, body: 48 * p, bodyType: 'square', decay: 0.03 });
    servo(200 * p, 720 * p, d, 0.06);
    hiss(0.26, 0.1, Math.max(0, d - 0.04));
  },
  // The turbine spooling to a scream.
  vulture: (d, p) => {
    turbine(1500 * p, 5200 * p, d, 0.045);
    whooshNoise(d, 0.05, 400, 2600);
  },
  // One slow climb of the rumbler under the engine taking the load.
  fortress: (d, p) => {
    siren(200 * p, 720 * p, d * 2, d, 0.06);
    pulses({ dur: d, from: 7, to: 15, gain: 0.12, lp: 260 * p, body: 40 * p, bodyType: 'square', decay: 0.04 });
  },
  // The throat drone climbing, its overtone walking up the series.
  king: (d, p) => {
    drone(46 * p, d, 0.11, 0, [6, 9, 13], 0, 1.18);
    subSwell(34, 52, d, 0.12, 0, d * 0.7);
  },
};

type Accent = (dur: number, p: number) => void;

const ACCENTS: Record<Machine, Record<TellFamily, Accent>> = {
  hook: {
    beam: (d, p) => squeal(2300 * p, Math.min(1, d * 0.6), 0.05, 0.05, 3400 * p), // the lamp-eye's bearing winding up
    sweep: (_d, p) => {
      ratchet(44, 14, 0.5, 1800 * p, 0.1); // cable paying out
      whooshNoise(0.4, 0.12, 300, 1200, 0.1);
    },
    volley: (_d, p) => {
      for (const t of [0, 0.14, 0.31]) clank((260 + Math.random() * 300) * p, 0.12, 0.25, t); // scrap into the hopper
    },
    nova: (_d, p) => pulses({ dur: 0.7, from: 30, to: 40, jitter: 0.3, gain: 0.3, lp: 1200 * p, body: 80 * p }), // full burn
    floor: (_d, p) => {
      twang(80 * p, 0.8, 0.16); // the hook dropping on its line
      ratchet(22, 22, 0.35, 900 * p, 0.1, 0.05); // chain rattle
    },
    lines: (_d, p) => {
      twang(140 * p, 0.5, 0.12);
      twang(186 * p, 0.5, 0.1, 0.12); // two lines, two notes
    },
    ring: (_d, p) => ratchet(16, 16, 0.7, 700 * p, 0.09), // chain dragging round
    wave: (_d, p) => {
      for (const t of [0, 0.2, 0.4]) pulses({ dur: 0.1, from: 30, to: 26, gain: 0.28, delay: t, lp: 900 * p, body: 72 * p });
    },
    melee: (_d, p) => {
      twang(120 * p, 0.5, 0.12);
      armorClank();
    },
  },
  piston: {
    beam: () => {
      whooshNoise(0.6, 0.16, 180, 500); // the furnace door
      hiss(0.4, 0.07, 0.1, 3000);
    },
    sweep: (_d, p) => {
      servo(300 * p, 120 * p, 0.5, 0.08); // the boom swinging over
      hiss(0.2, 0.1, 0.4);
    },
    volley: (_d, p) => {
      clank(140 * p, 0.16, 0.35); // pneumatic loader: thunk…
      clank(120 * p, 0.16, 0.35, 0.2); // …thunk
      hiss(0.15, 0.12, 0.32);
    },
    nova: (_d, p) => {
      for (const f of KAISER_HORN) horn(f * p, 0.38, 0.08); // a short blast of the horn
    },
    floor: (_d, p) => {
      clank(90 * p, 0.18, 0.8); // the pile driver lifting
      hiss(0.3, 0.1, 0.1);
    },
    lines: (_d, p) => blown([466 * p], 0.3, 0.22, 0, { breath: 0.6 }), // a toot of the shift whistle
    ring: (_d, p) => {
      servo(160 * p, 420 * p, 0.6, 0.07); // the press closing from both sides
      servo(640 * p, 430 * p, 0.6, 0.05);
    },
    wave: () => {
      for (const t of [0, 0.18, 0.36]) hiss(0.1, 0.13, t, 2600, 0.004); // the drumline of valves
    },
    melee: (_d, p) => {
      clank(200 * p, 0.14, 0.3); // the ram cocking
      hiss(0.18, 0.1, 0.12);
    },
  },
  vulture: {
    beam: (_d, p) => {
      ratchet(9, 9, 0.6, 4600, 0.1); // the lens racking focus
      servo(3000 * p, 5200 * p, 0.5, 0.05, 0.05);
    },
    sweep: () => {
      whooshNoise(0.5, 0.22, 400, 3000); // the wings mantling
      ratchet(30, 30, 0.25, 3400, 0.06, 0.05); // feathers hackling
    },
    volley: (_d, p) => {
      screech(2900 * p, 0.08, 0.12, 0, 0.85);
      screech(2700 * p, 0.08, 0.12, 0.12, 0.85); // kek-kek
    },
    nova: (_d, p) => screech(2800 * p, 0.7, 0.16, 0, 0.55),
    floor: (_d, p) => turbine(4200 * p, 1400 * p, 0.6, 0.05), // tipping into the dive
    lines: () => {
      for (const t of [0, 0.1, 0.2]) whooshNoise(0.08, 0.16, 2000, 4800, t); // three blade-feathers flicked out
    },
    ring: (_d, p) => {
      screech(2400 * p, 0.16, 0.11, 0, 1.15);
      screech(2400 * p, 0.16, 0.11, 0.24, 0.75); // circling: up, then down
    },
    wave: () => {
      for (const t of [0, 0.22, 0.44]) whooshNoise(0.16, 0.18, 200, 600, t); // three wingbeats
    },
    melee: (_d, p) => {
      clank(2100, 0.07, 0.08);
      clank(2400, 0.06, 0.07, 0.05); // talons snapping open
      screech(3000 * p, 0.1, 0.1, 0.06, 0.8);
    },
  },
  fortress: {
    beam: (_d, p) => {
      beeper(120 * p, 0.5, 0.06, 0, 'sawtooth'); // the searchlight's ballast humming up
      clank(180 * p, 0.12, 0.2, 0.05); // the relay
    },
    sweep: (_d, p) => servo(120 * p, 260 * p, 0.7, 0.08), // the turret traversing
    volley: (_d, p) => {
      clank(260 * p, 0.14, 0.25); // a shell into the launcher…
      clank(220 * p, 0.14, 0.3, 0.24); // …breech shut
    },
    nova: (_d, p) =>
      bullhorn(
        [
          ['d', 'I', 0.1, 1.02],
          ['sp', 'e', 0.26, 1.08, 's'],
        ],
        116 * p,
        0.2,
      ), // DISPERSE
    floor: (_d, p) => siren(700 * p, 1400 * p, 0.32, 0.32, 0.06), // one whoop
    lines: (_d, p) => {
      clank(520 * p, 0.14, 0.18);
      clank(500 * p, 0.14, 0.18, 0.16); // baton on the shield, twice
    },
    ring: (_d, p) => bullhorn([['m', 'u', 0.22, 1.08, 'v']], 116 * p, 0.2), // MOVE
    wave: (_d, p) => siren(800 * p, 1500 * p, 0.12, 0.36, 0.05), // the yelp
    melee: (_d, p) => {
      clank(330 * p, 0.14, 0.3); // the shield braced
      bullhorn([['h', 'ei', 0.14, 1.1]], 120 * p, 0.16, 0.05); // HEY
    },
  },
  king: {
    beam: (_d, p) => clank(1046 * p, 0.05, 1.1), // one small bell
    sweep: (_d, p) => {
      clank(1568 * p, 0.05, 0.6); // the blade halo — shing
      whooshNoise(0.35, 0.1, 2500, 6000);
    },
    volley: (_d, p) => {
      clank(784 * p, 0.05, 0.9);
      clank(1046 * p, 0.05, 0.9, 0.16); // the shoulder lamps answering
    },
    nova: (_d, p) => blown([233 * p], 0.6, 0.3, 0, { breath: 0.8, buzz: 0.6, formant: 820 }), // a breath of the conch: the decree
    floor: (d, p) => taiko(60 * p, 0.3, Math.max(0, d - 0.02)), // the drum lands the blow
    lines: (_d, p) => {
      twang(196 * p, 0.7, 0.1);
      twang(294 * p, 0.6, 0.08, 0.14); // koto strings, plucked
    },
    ring: (_d, p) => gong(140 * p, 1.2, 0.12, 0, 0), // a small gong
    wave: (_d, p) => {
      taiko(66 * p, 0.22);
      taiko(62 * p, 0.2, 0.2); // don-don
    },
    melee: (_d, p) => {
      clank(2093 * p, 0.04, 0.7); // steel drawn
      whooshNoise(0.25, 0.1, 3000, 7000, 0.05);
    },
  },
};

/** A single solid metallic CLINK — two iron gauntlets striking, not a papery
 *  clap: a short bright inharmonic strike with a tight decay and a touch of
 *  iron body under it. No airy hiss, no cartoon glide. */
export function clap(): void {
  clank(1040, 0.3, 0.12);
  clank(1560, 0.13, 0.07, 0.004); // bright overtone a hair later
  tone({ freq: 300, to: 188, type: 'sine', dur: 0.05, gain: 0.09 }); // iron thump
}

/** Knuckle plates meeting — a deeper, fuller metal DONK with a short ring. */
export function fistBump(): void {
  clank(720, 0.28, 0.22);
  clank(1180, 0.12, 0.13, 0.01);
  tone({ freq: 150, to: 80, type: 'sine', dur: 0.1, gain: 0.14 });
}

export function boundaryBuzz(intensity = 1): void {
  const gain = 0.08 + 0.12 * Math.min(1, intensity);
  tone({ freq: 72, to: 46, type: 'sawtooth', dur: 0.18, gain });
  servo(95, 48, 0.18, 0.07 + 0.05 * Math.min(1, intensity));
  whooshNoise(0.12, 0.06 + 0.06 * Math.min(1, intensity), 95, 520);
}

export function hitTaken(): void {
  cueCrowd('hit');
  clank(760, 0.26, 0.45); // the iron ball ringing off your armour
  tone({ freq: 105, to: 36, type: 'sawtooth', dur: 0.3, gain: 0.3 });
  clank(270, 0.14, 0.26, 0.015); // loose chassis rattle behind it
  whooshNoise(0.12, 0.12, 380, 140);
}

/** Iron on iron: your orbiting ball parries theirs — hammer on anvil. */
export function deflect(): void {
  clank(1240, 0.22, 0.45);
  clank(1860, 0.09, 0.25, 0.02);
  whooshNoise(0.1, 0.1, 2600, 1000);
}

/** Two flying balls blocking each other mid-air — a hard double clink. */
export function ballClash(): void {
  clank(1040, 0.26, 0.42);
  clank(1560, 0.11, 0.22, 0.025); // ricochet ring
  whooshNoise(0.08, 0.11, 3000, 1200);
  tone({ freq: 170, to: 90, type: 'triangle', dur: 0.1, gain: 0.12 });
}

/** A spent ball slamming into the arena's far cage wall — distant boom. */
export function wallThud(): void {
  tone({ freq: 90, to: 38, type: 'sine', dur: 0.28, gain: 0.18 });
  clank(180, 0.08, 0.3, 0.01);
}

// --- pub prop impacts: glass and steel sound NOTHING alike ------------------

/**
 * Glass on a hard surface — a bright, quick 'tink' of high near-pure partials
 * (not the inharmonic ring of struck steel). `hard` is a real bounce; soft is
 * a glass merely set down.
 */
export function glassTap(hard = false): void {
  const g = hard ? 0.16 : 0.1;
  tone({ freq: 2600, type: 'sine', dur: hard ? 0.22 : 0.15, gain: g });
  tone({ freq: 3900, type: 'sine', dur: hard ? 0.14 : 0.09, gain: g * 0.5, delay: 0.004 });
  tone({ freq: 5200, type: 'sine', dur: 0.05, gain: g * 0.3 });
  whooshNoise(0.025, g * 0.4, 6500, 3000); // the glassy attack tick
}

/** Glass meeting glass — a stacked pint clinking onto another. Brighter, two-tone. */
export function glassClink(): void {
  tone({ freq: 3000, type: 'sine', dur: 0.2, gain: 0.14 });
  tone({ freq: 4550, type: 'sine', dur: 0.12, gain: 0.07, delay: 0.006 });
  tone({ freq: 6100, type: 'sine', dur: 0.05, gain: 0.04 });
  whooshNoise(0.02, 0.28, 7500, 3500);
}

/** A steel dart clattering down on the floor — light metal tink + a low rattle. */
export function dartFloor(): void {
  clank(900, 0.1, 0.12);
  clank(1400, 0.05, 0.07, 0.03); // the barrel's second bounce
  tone({ freq: 150, to: 80, type: 'triangle', dur: 0.05, gain: 0.06 });
}

/** A dart biting into the cork board — a soft, dull thock, no ring. */
export function dartStick(): void {
  tone({ freq: 320, to: 150, type: 'sine', dur: 0.06, gain: 0.16 });
  whooshNoise(0.04, 0.12, 1300, 320);
}


/** UI: a relay snapping closed. */
export function uiClick(): void {
  clank(1500, 0.05, 0.04);
  tone({ freq: 110, type: 'sine', dur: 0.04, gain: 0.08 });
}

/** UI: the pointer landing on a panel — the same relay snap as a click/
 *  attachment select, but softer. It fires on every hover, so it sits well
 *  under the click it echoes. */
export function uiHover(): void {
  clank(1500, 0.024, 0.035);
  tone({ freq: 110, type: 'sine', dur: 0.035, gain: 0.038 });
}

/** One strike of the ring bell — long metallic decay. */
function bellStrike(delay: number): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  // Fundamental + inharmonic partials = a passable steel bell.
  for (const [f, g, d] of [[660, 0.3, 1.1], [1320, 0.12, 0.7], [1980, 0.06, 0.45], [392, 0.08, 0.9]] as const) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(env).connect(mix(c));
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }
  // The hammer hitting the bell.
  whooshNoise(0.025, 0.16, 2800, 1500, delay);
}

/** DING DING — a round begins. */
export function roundBell(): void {
  bellStrike(0);
  bellStrike(0.32);
}

/** End-of-round cue. */
export function roundEnd(win: boolean | 'draw'): void {
  cueCrowd(win === true ? 'win' : win === 'draw' ? 'round' : 'lose');
  bellStrike(0);
  if (win === 'draw') {
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.16, delay: 0.24 });
    tone({ freq: 440, type: 'sine', dur: 0.16, gain: 0.12, delay: 0.4 });
  } else if (win) {
    tone({ freq: 523, type: 'triangle', dur: 0.1, gain: 0.2, delay: 0.25 });
    tone({ freq: 784, type: 'triangle', dur: 0.12, gain: 0.2, delay: 0.35 });
  } else {
    tone({ freq: 392, to: 300, type: 'sine', dur: 0.2, gain: 0.2, delay: 0.25 });
  }
}

/** End-of-match fanfare / sad cue. */
export function matchEnd(win: boolean): void {
  if (win) {
    // Wooshing triumph — no tune. A big air-rush builds and lands on a
    // gut-punch impact, then a low power drone (root + octave) rings out.
    const HIT = 0.62; // when the rising whoosh lands
    // The build: two layered noise sweeps rushing upward into the hit.
    whooshNoise(HIT + 0.05, 0.26, 130, 2200);
    whooshNoise(HIT + 0.05, 0.18, 320, 3600, 0.06);
    // Rising sub underneath the build for weight.
    tone({ freq: 60, to: 150, type: 'sine', dur: HIT, gain: 0.22 });
    // The landing: layered strikes + a downward impact whoosh.
    bellStrike(HIT);
    clank(150, 0.16, 0.5, HIT);
    clank(300, 0.1, 0.35, HIT + 0.02);
    whooshNoise(0.5, 0.24, 2600, 200, HIT);
    tone({ freq: 80, to: 44, type: 'sine', dur: 0.45, gain: 0.26, delay: HIT }); // impact thump
    // Triumphant power drone — a sustained root + octave (no melody) that
    // swells in just after the hit and rings out long.
    [98, 196].forEach((f) =>
      tone({ freq: f, to: f * 1.005, type: 'sawtooth', dur: 1.6, gain: 0.1, delay: HIT + 0.04 }),
    );
    bellStrike(HIT + 0.04);
    bellStrike(HIT + 0.55);
  } else {
    bellStrike(0);
    bellStrike(0.28);
    bellStrike(0.56);
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, to: f * 0.9, type: 'sine', dur: 0.24, gain: 0.2, delay: 0.7 + i * 0.16 }),
    );
  }
}

/**
 * Saloon entrance — the swinging-doors-of-a-western-bar sound when someone
 * walks in: a wooden door creak (descending filtered noise + a low wood
 * knock), a spring-hinge twang, then a brass spittoon-ish bell ding.
 */
export function saloonEntry(): void {
  // Hinge creak: filtered noise sweeping down, plus a detuned squeak.
  whooshNoise(0.42, 0.1, 900, 240);
  tone({ freq: 520, to: 240, type: 'sawtooth', dur: 0.32, gain: 0.05 });
  // Two wooden door knocks as the panels swing past the jamb.
  clank(220, 0.12, 0.16, 0.04);
  clank(180, 0.1, 0.18, 0.22);
  // A little entrance bell over the door.
  tone({ freq: 1480, type: 'sine', dur: 0.18, gain: 0.12, delay: 0.12 });
  tone({ freq: 1970, type: 'sine', dur: 0.14, gain: 0.07, delay: 0.16 });
}

// --- GOOPLIATH: wet-gel foley ported from GOOP ------------------------------
// The vendored gel creature (src/goopliath/) calls these. Same synth bus,
// same helpers — the goo just brings its own primitives.

/** Soft-saturation curve (tanh) — rounds transients into a crunchy, organic
 *  edge instead of the clean click of a raw oscillator. Built once. */
const SHAPE = (() => {
  const n = 512;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
})();

/**
 * The wet-impact primitive: a burst of noise driven through a RESONANT
 * low-pass whose cutoff sweeps downward, then lightly saturated. That sweep
 * is what makes it read as a wet "thwuck" of gel rather than a synth beep.
 * `q` controls how vocal/squelchy it is; higher = more of a resonant "bloop".
 */
function noiseHit(
  dur: number,
  gain: number,
  cutFrom: number,
  cutTo: number,
  q = 0.7,
  delay = 0,
): void {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const p = i / frames;
    data[i] = (Math.random() * 2 - 1) * (1 - p) ** 1.5; // fast, natural decay
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(cutFrom, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, cutTo), t0 + dur * 0.75);
  const sh = c.createWaveShaper();
  sh.curve = SHAPE;
  sh.oversample = '2x';
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(lp).connect(sh).connect(g).connect(mix(c));
  src.start(t0);
}

/** One rising bubble 'blip' — the atom of goo. */
function bubble(freq: number, gain = 0.08, delay = 0, dur = 0.07): void {
  tone({ freq, to: freq * 1.45, type: 'sine', dur, gain, delay });
}

/** A wet downward 'blub' — the body of every impact. */
function blub(freq: number, gain: number, dur: number, delay = 0): void {
  tone({ freq, to: freq * 0.38, type: 'triangle', dur, gain, delay });
  tone({ freq: freq * 0.55, to: freq * 0.22, type: 'sine', dur: dur * 1.2, gain: gain * 0.7, delay: delay + 0.008 });
}

/** A fireball landing in the gel. `intensity` 0..1 scales the meat of it. One
 *  cohesive wet THWUCK — a bright slap crack on the front, a resonant gel body
 *  that squelches down in pitch, and a sub you feel. */
export function squelch(intensity = 0.6): void {
  const i = Math.min(1, Math.max(0, intensity));
  // Soft dull slap on the front — the impact arriving, not the star of the show.
  noiseHit(0.035 + 0.02 * i, 0.14 + 0.1 * i, 3000, 900, 0.7);
  // The GROSS part: three overlapping high-resonance squish sweeps, each with
  // a random cutoff and a slightly different start — mud-and-gore foley. The
  // stagger and detune is what makes it read as actual matter squeezing
  // through fingers instead of one clean synth swoop.
  for (let k = 0; k < 3; k++) {
    noiseHit(
      0.09 + Math.random() * 0.06,
      0.13 + 0.11 * i,
      800 + Math.random() * 900,
      80 + Math.random() * 130,
      6 + Math.random() * 3,
      k * 0.02 + Math.random() * 0.012,
    );
  }
  // Fat wet body under the squish.
  noiseHit(0.14 + 0.08 * i, 0.2 + 0.2 * i, 950 + 200 * Math.random(), 130, 2.4);
  // The sucking tail — goo pulling back off the impact (upward high-Q sweep).
  noiseHit(0.14 + 0.06 * i, 0.09 + 0.08 * i, 240, 1100 + Math.random() * 500, 4.5, 0.05 + 0.02 * i);
  blub(135 + 50 * Math.random(), 0.12 + 0.13 * i, 0.11 + 0.06 * i, 0.008); // liquify glug
  tone({ freq: 80, to: 40, type: 'sine', dur: 0.12 + 0.06 * i, gain: 0.14 + 0.16 * i }); // felt sub
  const pops = 2 + Math.round(i * 2);
  for (let p = 0; p < pops; p++) {
    bubble(360 + Math.random() * 520, 0.022 + 0.024 * i, 0.04 + Math.random() * 0.15);
  }
}

/** A lump tearing clean OFF the body — squelch plus a stretchy rip. */
export function tear(): void {
  squelch(1);
  whooshNoise(0.16, 0.14, 300, 1500, 0.02); // the taffy strand snapping upward
  tone({ freq: 320, to: 900, type: 'sawtooth', dur: 0.09, gain: 0.045, delay: 0.03 });
  bubble(700, 0.07, 0.12);
}

/** Goo landing on the floor. */
export function splat(size = 0.5): void {
  const s = Math.min(1, size);
  whooshNoise(0.08 + 0.1 * s, 0.14 + 0.2 * s, 480, 110);
  blub(110, 0.16 + 0.16 * s, 0.13 + 0.08 * s);
  if (s > 0.4) bubble(240, 0.05, 0.09);
}

/** A lump slurping back into the body. */
export function slurp(): void {
  whooshNoise(0.22, 0.11, 190, 850);
  tone({ freq: 130, to: 430, type: 'triangle', dur: 0.2, gain: 0.09 });
  bubble(520, 0.07, 0.16);
  bubble(760, 0.05, 0.22);
}

/** Idle jelly wobble (poked, or landing after a stagger). */
export function gooWobble(intensity = 0.5): void {
  const i = Math.min(1, intensity);
  tone({ freq: 95 + 30 * i, to: 55, type: 'sawtooth', dur: 0.22, gain: 0.05 + 0.06 * i });
  tone({ freq: 52, type: 'sine', dur: 0.26, gain: 0.1 + 0.1 * i });
  bubble(300, 0.04 * i, 0.05);
}

/** The creature pulling itself up into its fighting shape — bubbling swell. */
export function gooRise(): void {
  whooshNoise(1.25, 0.15, 85, 420);
  tone({ freq: 42, to: 95, type: 'sine', dur: 1.15, gain: 0.18 });
  for (let i = 0; i < 6; i++) {
    bubble(240 + i * 130 + Math.random() * 80, 0.05, 0.1 + i * 0.16, 0.08);
  }
}

/** Collapsing back into the glob. */
export function gooSink(): void {
  whooshNoise(0.9, 0.13, 380, 90);
  tone({ freq: 95, to: 40, type: 'sine', dur: 0.85, gain: 0.16 });
  for (let i = 0; i < 4; i++) {
    bubble(620 - i * 120, 0.04, 0.08 + i * 0.14, 0.07);
  }
  splat(0.7);
}

/** Attack telegraph — a rising bubbly whine ending exactly at the strike. */
export function gooCharge(dur: number): void {
  tone({ freq: 90, to: 640, type: 'sawtooth', dur, gain: 0.055 });
  whooshNoise(dur, 0.05, 160, 1200);
  for (let i = 0; i < 4; i++) {
    bubble(300 + i * 180, 0.045, dur * (0.25 + i * 0.18), 0.06);
  }
}

/** A gel limb whipping out. */
export function gooWhoosh(): void {
  whooshNoise(0.28, 0.24, 260, 1500);
  tone({ freq: 150, to: 55, type: 'triangle', dur: 0.16, gain: 0.14 });
}

/** Its strike landing — a wet sledgehammer you feel in your teeth. */
export function gooSlam(): void {
  tone({ freq: 85, to: 22, type: 'sine', dur: 0.5, gain: 0.46 }); // deep gut sub, felt
  noiseHit(0.22, 0.4, 1900, 100, 1.5); // the big wet body caving in
  noiseHit(0.06, 0.2, 4200, 1300, 0.7); // duller front slap — weight, not sting
  noiseHit(0.24, 0.16, 640, 100, 5.0, 0.015); // watery glug under the impact
  tone({ freq: 140, to: 44, type: 'sine', dur: 0.22, gain: 0.22, delay: 0.005 }); // low thud
}

/** The spinning attack — a long sweeping rotor of air and slime. */
export function spinWhoosh(): void {
  whooshNoise(0.4, 0.22, 180, 1300);
  whooshNoise(0.34, 0.14, 500, 2000, 0.08);
  tone({ freq: 90, to: 240, type: 'sawtooth', dur: 0.32, gain: 0.06 });
  bubble(340, 0.05, 0.2);
}

/** The kick — heavier, lower, a whole limb's worth of gel in flight. */
export function kickWhoosh(): void {
  whooshNoise(0.3, 0.28, 160, 900);
  tone({ freq: 120, to: 45, type: 'triangle', dur: 0.24, gain: 0.18 });
  blub(140, 0.1, 0.14, 0.05);
}

/** The KO collapse — everything lets go at once. */
export function koSplat(): void {
  splat(1);
  blub(70, 0.3, 0.3, 0.02);
  whooshNoise(0.5, 0.2, 300, 60, 0.02);
  for (let i = 0; i < 8; i++) {
    bubble(180 + Math.random() * 700, 0.05, 0.05 + Math.random() * 0.5);
  }
}
