/**
 * THE LIGHT SHOW — one conductor for every laser in a set.
 *
 * There used to be two rigs that had never met: four fans on the stage rim
 * raking the floor at chest height on their own 9-beat swing, and four fans
 * on the far wall's crest sweeping on a 2-bar one. Same record, two clocks,
 * nothing behind you. Now every beam in the room — the CREST ring (twelve
 * emitters all the way round the EQ wall's top, spectrum/set.ts) and the
 * CROWN (eight round the stage rim, disco.ts) — asks this file where to
 * point, how bright, and in which of the sleeve's colours. They can't drift
 * apart because they don't keep time themselves.
 *
 * It is a pure function of the show beat (and the act, and the record): no
 * state, no randomness, no audio. Every client on the same beat sees the
 * same show, the look-dev harness can scrub to any moment, and
 * tools/laser-check.mjs can prove the safety rules below without a browser.
 *
 * THE PHRASE is the unit (8 bars, the same 8 the choreography thinks in):
 *
 *   bars 1–7  THE LOOK — one of six, picked per phrase from the act's book:
 *             SWEEP    every fan swings together, one swing per two bars
 *             MIRROR   left half against right: the fans scissor across
 *                      the middle of your view on every downbeat
 *             WAVE     the beams rise and fall as a wave rolling round the
 *                      room, once a bar — the crown and the crest ride the
 *                      same wave, so it rolls out of the stage and on
 *                      round the wall
 *             CHASE    one emitter at a time, running round the room once a
 *                      bar (two heads on the top act), turning every 2 bars
 *             TENT     every beam in the room meets at one point in the sky
 *                      over the far side of the ring, and that point circles
 *             CEILING  the fans flatten into a wide sheet over the ring that
 *                      rises and falls every four bars — the haze ceiling
 *   bar 8     THE GATHER — every beam pulls onto the focus (the record in
 *             the sky), fans folding into pencils, faster as the bar ends
 *   the one   THE HIT — the new phrase's downbeat bursts the gather open
 *             into the next look on one bright flash, and act 0's resting
 *             emitters join in for the burst
 *
 * The count-in is a gather too, so the set's own drop is the first hit.
 *
 * SAFETY, proven by tools/laser-check.mjs:
 *   - nothing over the decks below 25 m from the crest (the set's ring
 *     rule): crest beams never pitch below −0.08 rad, and the farthest a
 *     crest beam travels before it leaves the air over the ring is ~63 m;
 *   - the crown never rakes the floor: its beams climb at least 0.95 rad,
 *     clearing the nearest deck point by more than a head, and never fire
 *     back in across the stage at the GOOPLIATH;
 *   - no strobing: brightness breathes with the kick and flashes once a
 *     phrase — a full-room flash every ~15 s, not three a second.
 */

export type Look = 'sweep' | 'mirror' | 'wave' | 'chase' | 'tent' | 'ceiling';

export const LOOKS: readonly Look[] = ['sweep', 'mirror', 'wave', 'chase', 'tent', 'ceiling'];

const BAR = 4;
export const PHRASE_BEATS = 32;

/** Which looks each act may call. Act 0 stays wide and slow; the chase and
 *  the tent are earned. No duplicates — the no-repeat rule compares looks. */
const BOOK: readonly (readonly Look[])[] = [
  ['sweep', 'wave', 'ceiling'],
  ['sweep', 'mirror', 'wave', 'ceiling', 'tent'],
  ['mirror', 'wave', 'chase', 'tent', 'sweep', 'ceiling'],
  ['mirror', 'chase', 'tent', 'wave', 'ceiling'],
];

/** Where the TENT's beams meet (stage frame: −z is beyond the stage, away
 *  from you): high over the far side of the ring, circling. */
export const APEX = { x: 0, y: 30, z: -20, r: 8, beats: 16 };

/** Pitch limits, radians above the horizon. */
export const CREST_MIN_PITCH = -0.08;
export const CREST_MAX_PITCH = 1.2;
export const CROWN_MIN_PITCH = 0.95;
export const CROWN_MAX_PITCH = 1.52;

export interface Cue {
  beat: number;
  act: number;
  phrase: number;
  /** Beats into the phrase, 0..32. */
  inPhrase: number;
  look: Look;
  /** 0 → 1 across the phrase's last bar: every beam gathers onto the focus. */
  gather: number;
  /** 0 → 1 across the first beat-and-a-bit: the new look bursts out of the gather. */
  open: number;
  /** The drop's flash: 1 on the phrase downbeat, gone inside two beats. */
  hit: number;
  /** Kick envelope, 1 on every beat. */
  kick: number;
  /** The shared swing, −1..1, one full swing per two bars. */
  swing: number;
  /** Counts bars: the colour rotation. */
  step: number;
  /** The chase head, radians round the room (0 behind the stage, π at your back). */
  head: number;
}

export function newCue(): Cue {
  return { beat: 0, act: 0, phrase: 0, inPhrase: 0, look: 'sweep', gather: 0, open: 1, hit: 0, kick: 0, swing: 0, step: 0, head: 0 };
}

/** The record's seed: its looks come in its own order. */
export function seedOf(id: string | null | undefined): number {
  if (!id) return 0;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function hash01(n: number, seed: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

let forced: Look | null = null;

/** Look-dev only (raid-preview.html ?look=): pin every phrase to one look. */
export function forceLook(look: Look | null): void {
  forced = look && LOOKS.includes(look) ? look : null;
}

/** The phrase's look: the book's pick, never the same as the phrase before.
 *  Each phrase steps 1..n−1 places round the act's book from the last, so
 *  no two neighbours can match; the walk is cached, so it's one sum per
 *  phrase, not per frame. */
const walk = { seed: -1, act: -1, phrase: 0, idx: 0 };
export function lookOf(phrase: number, act: number, seed: number): Look {
  if (forced) return forced;
  const book = BOOK[Math.max(0, Math.min(BOOK.length - 1, act))];
  const n = book.length;
  const p = Math.max(0, phrase);
  if (walk.seed !== seed || walk.act !== act || walk.phrase > p) {
    walk.seed = seed;
    walk.act = act;
    walk.phrase = 0;
    walk.idx = seed % n;
  }
  for (let q = walk.phrase + 1; q <= p; q++) walk.idx = (walk.idx + 1 + Math.floor(hash01(q, seed) * (n - 1))) % n;
  walk.phrase = p;
  return book[walk.idx];
}

const smooth = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * Fill `out` for this moment. `beat` is the show beat (negative through the
 * count-in, exactly like match.beat), `act` 0..3, `seed` from seedOf().
 */
export function cueAt(out: Cue, beat: number, act: number, seed = 0): Cue {
  out.beat = beat;
  out.act = act;
  const fb = beat - Math.floor(beat);
  out.kick = Math.max(0, 1 - fb * 2.2);
  out.swing = Math.sin((beat / (BAR * 2)) * Math.PI * 2);
  out.step = Math.floor(beat / BAR);
  // The chase: one lap a bar, from behind the stage, turning every 2 bars.
  const dir = Math.floor(beat / (BAR * 2)) % 2 === 0 ? 1 : -1;
  const lap = (((beat / BAR) % 1) + 1) % 1;
  out.head = dir * lap * Math.PI * 2;

  if (beat < 0) {
    // The count-in: a lazy sweep that gathers onto the record over the
    // last bar, so the drop itself is the first hit.
    out.phrase = -1;
    out.inPhrase = PHRASE_BEATS + beat;
    out.look = 'sweep';
    out.gather = beat >= -BAR ? Math.pow((beat + BAR) / BAR, 2) : 0;
    out.open = 1;
    out.hit = 0;
    return out;
  }
  const phrase = Math.floor(beat / PHRASE_BEATS);
  const inPhrase = beat - phrase * PHRASE_BEATS;
  out.phrase = phrase;
  out.inPhrase = inPhrase;
  out.look = lookOf(phrase, act, seed);
  const last = PHRASE_BEATS - BAR;
  out.gather = inPhrase >= last ? Math.pow((inPhrase - last) / BAR, 2) : 0;
  out.open = smooth(inPhrase / 1.25);
  out.hit = Math.exp(-inPhrase * 1.8);
  return out;
}

export type EmitterKind = 'crest' | 'crown';

export interface Emitter {
  kind: EmitterKind;
  /** Stage-frame position (the stage centre is the origin; you stand at +z). */
  x: number;
  y: number;
  z: number;
  /** Angle round the room: 0 behind the stage, π at your back. */
  a: number;
  /** Index among its own kind. */
  i: number;
}

/** A ring of emitters, half a step off the axis so every one has a side. */
export function emitterRing(kind: EmitterKind, count: number, radius: number, y: number): Emitter[] {
  const out: Emitter[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + 0.5) / count) * Math.PI * 2;
    out.push({ kind, x: Math.sin(a) * radius, y, z: -Math.cos(a) * radius, a, i });
  }
  return out;
}

export interface Aim {
  /** Unit direction, stage frame. */
  dx: number;
  dy: number;
  dz: number;
  /** Brightness multiplier (before the rig's energy). */
  gain: number;
  /** Index into the sleeve's laser colours (wrap it). */
  slot: number;
}

export function newAim(): Aim {
  return { dx: 0, dy: 1, dz: 0, gain: 0, slot: 0 };
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

const _apex: P3 = { x: 0, y: 0, z: 0 };

function towards(em: Emitter, p: P3, out: P3): P3 {
  const x = p.x - em.x;
  const y = p.y - em.y;
  const z = p.z - em.z;
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}

const _look: P3 = { x: 0, y: 0, z: 0 };
const _focus: P3 = { x: 0, y: 0, z: 0 };

/** The angle from a to b round the circle, 0..2π. */
const wrap = (x: number): number => ((x % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/**
 * Where beam `b` (of `beams`) on emitter `em` points right now, how bright,
 * and in which colour. `focus` is the gather's target — the record.
 */
export function aimBeam(cue: Cue, em: Emitter, b: number, beams: number, focus: P3, out: Aim): Aim {
  const crest = em.kind === 'crest';
  const s = beams > 1 ? b / (beams - 1) - 0.5 : 0;
  // Which half of YOUR view it stands in (you face the stage down −z).
  const side = em.x > 0 ? 1 : -1;
  // Home: the crest faces the middle, the crown faces out.
  const home = crest ? -em.a : Math.PI - em.a;
  const beat = cue.beat;
  // The wave rolls round the room once a bar, crown and crest together.
  const wave = 0.5 + 0.5 * Math.sin((beat / BAR) * Math.PI * 2 - em.a);

  let yaw = home;
  let pitch = 0;
  let gate = 1;
  let slot = em.i + cue.step;
  let aimed = false;
  switch (cue.look) {
    case 'sweep':
      yaw = home + cue.swing * (crest ? 0.35 : 0.5) + s * (crest ? 0.9 : 0.5);
      pitch = crest ? 0.07 + 0.05 * Math.sin((beat / 16) * Math.PI * 2 + em.a) : 1.15;
      slot = cue.step + (b % 2);
      break;
    case 'mirror':
      yaw = home + cue.swing * (crest ? 0.45 : 0.6) * side + s * (crest ? 0.5 : 0.4);
      pitch = crest ? 0.05 : 1.1;
      slot = cue.step + (side > 0 ? 0 : 1);
      break;
    case 'wave':
      yaw = home + s * (crest ? 0.6 : 0.45);
      pitch = crest ? 0.24 * wave : 0.98 + 0.45 * wave;
      break;
    case 'chase': {
      yaw = home + cue.swing * (crest ? 0.2 : 0.3) + s * (crest ? 0.7 : 0.5);
      pitch = crest ? 0.1 : 1.2;
      const dir = Math.floor(beat / (BAR * 2)) % 2 === 0 ? 1 : -1;
      // Lit at the head, trailing off behind it.
      let lit = Math.exp(-wrap(dir * (cue.head - em.a)) * 1.6);
      if (cue.act >= 3) lit = Math.max(lit, Math.exp(-wrap(dir * (cue.head + Math.PI - em.a)) * 1.6));
      gate = 0.08 + 0.92 * lit;
      slot = cue.step;
      break;
    }
    case 'tent': {
      const o = (beat / APEX.beats) * Math.PI * 2;
      _apex.x = APEX.x + Math.sin(o) * APEX.r;
      _apex.y = APEX.y;
      _apex.z = APEX.z + Math.cos(o) * APEX.r;
      towards(em, _apex, _look);
      // A whisper of fan so the meeting point blooms instead of pinning.
      const c = Math.cos(s * 0.06);
      const sn = Math.sin(s * 0.06);
      const x = _look.x * c + _look.z * sn;
      _look.z = -_look.x * sn + _look.z * c;
      _look.x = x;
      aimed = true;
      slot = cue.step;
      break;
    }
    case 'ceiling':
      yaw = home + cue.swing * (crest ? 0.12 : 0.2) + s * (crest ? 1.5 : 0.9);
      pitch = crest ? -0.04 + 0.08 * Math.sin((beat / 16) * Math.PI * 2) : 1.0;
      slot = cue.step;
      break;
  }
  if (!aimed) {
    const cp = Math.cos(pitch);
    _look.x = Math.sin(yaw) * cp;
    _look.y = Math.sin(pitch);
    _look.z = Math.cos(yaw) * cp;
  }

  // The gather (the phrase's last bar) and the burst out of it.
  const f = Math.max(cue.gather, 1 - cue.open);
  let x = _look.x;
  let y = _look.y;
  let z = _look.z;
  if (f > 0) {
    towards(em, focus, _focus);
    const k = smooth(f);
    x += (_focus.x - x) * k;
    y += (_focus.y - y) * k;
    z += (_focus.z - z) * k;
    if (f > 0.5) slot = cue.step;
  }

  // The crown never fires back in across the stage: strip any inward lean.
  if (!crest) {
    const ox = Math.sin(em.a);
    const oz = -Math.cos(em.a);
    const out = x * ox + z * oz;
    if (out < 0) {
      x -= ox * out;
      z -= oz * out;
    }
  }

  // Pitch limits, keeping the heading.
  const h = Math.hypot(x, z);
  let p = Math.atan2(y, h);
  const hx = h > 1e-6 ? x / h : Math.sin(home);
  const hz = h > 1e-6 ? z / h : Math.cos(home);
  const lo = crest ? CREST_MIN_PITCH : CROWN_MIN_PITCH;
  const hi = crest ? CREST_MAX_PITCH : CROWN_MAX_PITCH;
  p = Math.max(lo, Math.min(hi, p));
  const cp = Math.cos(p);
  out.dx = hx * cp;
  out.dy = Math.sin(p);
  out.dz = hz * cp;

  // Act 0 rests every other emitter — except through the gather and the burst.
  if (cue.act === 0 && em.i % 2 === 1) gate *= f;
  out.gain = gate * (1 + 1.2 * cue.hit);
  out.slot = slot;
  return out;
}
