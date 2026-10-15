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
    // A gentle glue compressor between the synth mix and the fader: forty
    // hand-tuned one-shots will never sit at exactly one loudness, so the
    // bus evens the spread — the big landings lose a little of their spike,
    // the small ticks keep their place, and the SFX slider scales ONE
    // coherent level instead of a lottery. Soft knee, low ratio: glue, not
    // pumping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -24;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.004;
    glue.release.value = 0.18;
    glue.connect(sfxOut);
    // Quiet synth mix bus → the glue → the fader.
    const master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(glue);
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
  osc.connect(g).connect(c._master!);
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
  src.connect(bp).connect(g).connect(c._master!);
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
    osc.connect(env).connect(c._master!);
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
  osc.connect(g).connect(c._master!);
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
  lp.connect(trem).connect(env).connect(c._master!);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
}

/** A blown HORN note: three detuned squares through a lowpass, pitch sagging
 *  slightly across the note — brass mass instead of a bare square beep. */
function horn(freq: number, dur: number, gain: number, delay = 0): void {
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
    osc.frequency.linearRampToValueAtTime(f * 0.985, t0 + dur);
    osc.connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  lp.connect(env).connect(c._master!);
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
  osc.connect(bp).connect(env).connect(c._master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// --- SUPER OCTAGON (the club's arcade cabinet) ----------------------------
// Carried over from FIRE FIGHT's pub cabinet, where these four were born.

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
 *  exactly at the strike. Like gooCharge, this is a WARNING first: a step
 *  louder than it was, still under the landing. */
export function chargeWhine(dur: number): void {
  servo(140, 980, dur, 0.11);
  servo(137, 964, dur, 0.06); // detuned twin — width, not volume
  whooshNoise(dur, 0.06, 200, 1400);
  subSwell(36, 58, dur, 0.16, 0, dur * 0.7); // dread building underneath
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
  clank(760, 0.26, 0.45); // the iron ball ringing off your armour
  tone({ freq: 105, to: 36, type: 'sawtooth', dur: 0.3, gain: 0.3 });
  clank(270, 0.14, 0.26, 0.015); // loose chassis rattle behind it
  whooshNoise(0.12, 0.12, 380, 140);
}

/** PERFECT! — the last-instant dodge's payoff, and hitTaken's opposite
 *  pole by construction: ALL TONE, no clank, no noise. It fires right
 *  beside a landing's crash, and anything percussive there reads as
 *  taking the hit (the old glass clink — a struck plate — did exactly
 *  that). So: a quick rising fifth with a sparkle climbing off the top —
 *  the kit's reward vocabulary (the recall's rise), pitched over the mix
 *  and gone in a third of a second. Rising = good; falling and banging =
 *  hit. (It used to be described as an octave over the routine's ticks;
 *  those are wooden knocks now, and this is the last pitched cue in the
 *  set — deliberately, because a payoff is allowed to sing where a
 *  metronome is not.) */
export function perfectChime(): void {
  tone({ freq: 1046.5, type: 'triangle', dur: 0.07, gain: 0.15 }); // C6, the pickup
  tone({ freq: 1568, type: 'triangle', dur: 0.2, gain: 0.19, delay: 0.06 }); // G6 — the lift
  tone({ freq: 2093, to: 3136, type: 'sine', dur: 0.18, gain: 0.06, delay: 0.08 }); // the sparkle off the top
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

/** Glass meeting glass — a stacked pint clinking onto another. Brighter,
 *  two-tone. (The attack tick used to spike 0.28 — twice anything else in
 *  its family — and stabbed at high slider settings.) */
export function glassClink(): void {
  tone({ freq: 3000, type: 'sine', dur: 0.2, gain: 0.14 });
  tone({ freq: 4550, type: 'sine', dur: 0.12, gain: 0.07, delay: 0.006 });
  tone({ freq: 6100, type: 'sine', dur: 0.05, gain: 0.04 });
  whooshNoise(0.02, 0.12, 7500, 3500);
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

/** The dumbwaiter's little lift — a soft servo travel with a settle tick.
 *  `up` pitches the run rising or sinking. */
export function dumbwaiter(up: boolean): void {
  servo(up ? 110 : 200, up ? 200 : 110, 0.55, 0.045);
  clank(up ? 900 : 600, 0.05, 0.06, 0.5);
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
    osc.connect(env).connect(c._master!);
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
  src.connect(lp).connect(sh).connect(g).connect(c._master!);
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

/** Attack telegraph — a rising bubbly whine ending exactly at the strike.
 *  The single most load-bearing sound in the game (it IS the warning), so
 *  it sits a step above the old whisper — clearly audible under the mix
 *  without competing with the landing it announces. */
export function gooCharge(dur: number): void {
  tone({ freq: 90, to: 640, type: 'sawtooth', dur, gain: 0.07 });
  whooshNoise(dur, 0.065, 160, 1200);
  for (let i = 0; i < 4; i++) {
    bubble(300 + i * 180, 0.055, dur * (0.25 + i * 0.18), 0.06);
  }
}

/** A gel limb whipping out. */
export function gooWhoosh(): void {
  whooshNoise(0.28, 0.24, 260, 1500);
  tone({ freq: 150, to: 55, type: 'triangle', dur: 0.16, gain: 0.14 });
}

/** Its strike landing — a wet sledgehammer you feel in your teeth. */
export function gooSlam(): void {
  tone({ freq: 85, to: 22, type: 'sine', dur: 0.5, gain: 0.4 }); // deep gut sub, felt
  noiseHit(0.22, 0.36, 1900, 100, 1.5); // the big wet body caving in
  noiseHit(0.06, 0.2, 4200, 1300, 0.7); // duller front slap — weight, not sting
  noiseHit(0.24, 0.16, 640, 100, 5.0, 0.015); // watery glug under the impact
  tone({ freq: 140, to: 44, type: 'sine', dur: 0.22, gain: 0.22, delay: 0.005 }); // low thud
}

/** THE GATE slamming shut — the whole deck flooding at once EXCEPT the
 *  gap. It used to borrow slamImpact, the boxing titan's metal fist — the
 *  one landing whose sound spoke a different language from its own visual
 *  (walls of goo-light). Now it's the flood family's biggest voice: two
 *  wave fronts breaking together, deeper and wider than the seesaw's
 *  half-flood, with the DOORWAY itself singing through it — a thin bright
 *  column of air where the gap stands. */
export function gateSlam(): void {
  whooshNoise(0.4, 0.3, 200, 1300); // the near wall arriving
  whooshNoise(0.4, 0.24, 260, 1500, 0.03); // the far wall a breath behind
  noiseHit(0.3, 0.36, 800, 80, 2.4); // both fronts breaking at once
  tone({ freq: 62, to: 26, type: 'sine', dur: 0.5, gain: 0.36 }); // the deck answering
  tone({ freq: 1180, to: 880, type: 'sine', dur: 0.28, gain: 0.05, delay: 0.05 }); // the gap, singing
}

/** Half the deck flooding at once — a wave front breaking over the line.
 *  (Seesaw and surge landings: they used to borrow the slam's thud.) */
export function floodCrash(): void {
  whooshNoise(0.34, 0.3, 240, 1600); // the wall of goo arriving
  noiseHit(0.28, 0.32, 900, 90, 2.2); // the break
  tone({ freq: 70, to: 30, type: 'sine', dur: 0.45, gain: 0.34 });
  bubble(220, 0.06, 0.16, 0.08);
  bubble(320, 0.05, 0.3, 0.06);
}

/** THE CROSSFIRE: a laser thrown from a side rail, raking across the deck.
 *  Reads sideways on purpose — the beam's blast is a flat wall of noise,
 *  this one is a pitch that TRAVELS, so the ear places it off to one side
 *  even when the eye was looking the other way. */
export function railZap(): void {
  tone({ freq: 1750, to: 320, type: 'sawtooth', dur: 0.2, gain: 0.1 }); // the shot leaving the rail
  whooshNoise(0.24, 0.22, 3200, 420); // and crossing
  noiseHit(0.12, 0.2, 2400, 700, 3.0); // the deck taking it
  tone({ freq: 120, to: 52, type: 'sine', dur: 0.26, gain: 0.24, delay: 0.02 });
}

/* THE ROUTINE MAKES NO CUE SOUND AT ALL. Three passes tried to give it
 * one — a C-major arpeggio pitched by step number, then a dry wooden
 * count through the lesson, then a single knock a beat ahead of each
 * landing — and each pass was less wrong than the last without ever
 * being right. The move already tells you everything, twice: the taught
 * marks carry their step numbers in dots, and from there the blocks are
 * VISIBLY falling for two beats before they crush. A cue on top of a
 * danger you can watch descend is a metronome for a clock you can see.
 *
 * What stays is quadCrash below — the blocks actually landing. That is
 * not a cue, it is the event. */

/** The blocks landing on the three quarters you didn't learn. */
export function quadCrash(): void {
  noiseHit(0.22, 0.34, 1100, 130, 1.4); // slabs meeting deck
  tone({ freq: 96, to: 34, type: 'sine', dur: 0.4, gain: 0.36 });
  clank(180, 0.12, 0.22, 0.02);
  squelch(0.5);
}

/** THE DONUT closing — the mirror of the pie: the rim rushing INWARD and
 *  piling up on the safe circle. Everything sweeps up in pitch (the pie's
 *  roll falls away), so the ear knows which way the danger is moving. */
export function donutSlam(): void {
  whooshNoise(0.34, 0.26, 260, 2600); // the rim rushing in
  tone({ freq: 140, to: 420, type: 'sawtooth', dur: 0.3, gain: 0.08 }); // closing
  noiseHit(0.16, 0.34, 1800, 500, 2.0, 0.28); // piling onto the circle
  tone({ freq: 88, to: 40, type: 'sine', dur: 0.36, gain: 0.3, delay: 0.28 });
}

/** The pie detonating — one shockwave rolling over the whole ring. */
export function novaBoom(): void {
  noiseHit(0.4, 0.36, 3000, 120, 1.6); // the blast front
  whooshNoise(0.7, 0.15, 2200, 200, 0.05); // rolling outward
  tone({ freq: 60, to: 24, type: 'sine', dur: 0.8, gain: 0.36 }); // sub drop
  subSwell(40, 26, 1.0, 0.2, 0.05, 0.05);
  clank(90, 0.11, 0.6, 0.14); // the room answering
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
