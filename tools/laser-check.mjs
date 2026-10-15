#!/usr/bin/env node
/**
 * THE LIGHT SHOW, headless — does every laser in a set keep the room's rules?
 *
 *   node tools/laser-check.mjs
 *
 * Pure maths, no browser: drives src/rave/arena/lightshow.ts (the conductor
 * both rigs follow) through whole sets — every act, a spread of records,
 * the count-in, every phrase's gather and hit, sampled every 16th note —
 * and asserts:
 *
 *   - DETERMINISM: the same beat gives the same show, so every client sees
 *     one show;
 *   - THE BOOK: a phrase never repeats the look before it, and every act's
 *     book gets played;
 *   - THE CREST stays out of the ring's air: no crest beam ever comes below
 *     25 m over the decks (the set's ring rule);
 *   - THE CROWN clears every dancer: no crown beam passes through the air
 *     over a deck below head height (+ margin), and none fires back in
 *     across the stage at the GOOPLIATH;
 *   - THE GATHER lands: on the last beat of a phrase every crest beam points
 *     at the record;
 *   - NO STROBE: the full-room flash fires once a phrase and nowhere else;
 *   - PALETTE DISCIPLINE: no sleeve's laser colour speaks danger (amber→red,
 *     goo green), and neither does the void's hue wheel.
 *
 * Exit 1 on any failure.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APEX,
  LOOKS,
  PHRASE_BEATS,
  aimBeam,
  cueAt,
  emitterRing,
  lookOf,
  newAim,
  newCue,
  seedOf,
} from '../src/rave/arena/lightshow.ts';
import { PALETTES } from '../src/rave/arena/spectrum/palettes.ts';

const here = dirname(fileURLToPath(import.meta.url));
// The ring's numbers, read from the source so this check can't drift from it.
const config = readFileSync(join(here, '../src/rave/config.ts'), 'utf8');
const num = (key) => {
  const m = config.match(new RegExp(`${key}:\\s*([0-9.]+)`));
  if (!m) throw new Error(`config.ts: no ${key}`);
  return Number(m[1]);
};
const STAGE_R = num('stageRadius');
const STAGE_H = num('stageHeight');
const RING_MIN = num('minRadius');
const SEATS_MAX = num('maxSeats');
const SPACING = num('seatSpacing');
const RING_MAX = Math.max(RING_MIN, (SEATS_MAX * SPACING) / (Math.PI * 2));
const DECK_R = 0.98;
/** A tall dancer's head with an arm up, metres above the deck. */
const HEAD = 2.2;

// The rigs exactly as they're hung (spectrum/set.ts, disco.ts).
const WALL_R = 52;
const crest = emitterRing('crest', 12, WALL_R - 1, 31);
const CREST_BEAMS = 5;
const CREST_LEN = 140;
const crown = emitterRing('crown', 8, STAGE_R * 0.9, STAGE_H + 0.08); // stage.ts CROWN_Y + 0.03
const CROWN_BEAMS = 3;
const CROWN_LEN = 34;
const FOCUS = { x: 0, y: 52, z: -78 };

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const TRACKS = ['combat', 'morning', 'money', 'target', 'final', 'discoball', 'voidstep', 'nosuchtrack'];
const SET_BEATS = 24 * PHRASE_BEATS;
const STEP = 1 / 16; // exact in binary, so every downbeat is sampled on the nose

// ── determinism ─────────────────────────────────────────────────────────
{
  let same = true;
  const a = newCue();
  const b = newCue();
  const aa = newAim();
  const bb = newAim();
  for (let beat = -8; beat < 200 && same; beat += 0.37) {
    for (const act of [0, 1, 2, 3]) {
      cueAt(a, beat, act, seedOf('combat'));
      cueAt(b, beat, act, seedOf('combat'));
      for (const em of [...crest, ...crown]) {
        aimBeam(a, em, 1, 3, FOCUS, aa);
        aimBeam(b, em, 1, 3, FOCUS, bb);
        if (aa.dx !== bb.dx || aa.dy !== bb.dy || aa.dz !== bb.dz || aa.gain !== bb.gain || aa.slot !== bb.slot) same = false;
      }
    }
  }
  check('determinism: one beat, one show', same);
}

// ── the book ────────────────────────────────────────────────────────────
{
  let repeats = 0;
  const seen = [new Set(), new Set(), new Set(), new Set()];
  for (const t of TRACKS) {
    const seed = seedOf(t);
    for (const act of [0, 1, 2, 3]) {
      for (let p = 0; p < 60; p++) {
        const l = lookOf(p, act, seed);
        seen[act].add(l);
        if (p > 0 && l === lookOf(p - 1, act, seed)) repeats++;
      }
    }
  }
  check('the book: no look twice in a row', repeats === 0, `${repeats} repeats`);
  check(
    'the book: act 0 stays calm (no chase, no tent)',
    !seen[0].has('chase') && !seen[0].has('tent'),
    [...seen[0]].join(' '),
  );
  const all = new Set([...seen[0], ...seen[1], ...seen[2], ...seen[3]]);
  check('the book: every look gets played', LOOKS.every((l) => all.has(l)), [...all].join(' '));
}

// ── the sweep: crest + crown, every act, every record, the whole set ────
{
  const cue = newCue();
  const aim = newAim();
  let crestLow = Infinity;
  let crestWorst = '';
  let crownLow = Infinity;
  let crownWorst = '';
  let inward = 0;
  let flashes = 0;
  let strayFlash = 0;
  let gatherMiss = 0;
  let maxGain = 0;
  for (const t of TRACKS) {
    const seed = seedOf(t);
    for (const act of [0, 1, 2, 3]) {
      let prevHit = 0;
      for (let beat = -8; beat < SET_BEATS; beat += STEP) {
        cueAt(cue, beat, act, seed);
        // The flash: count rising edges past half.
        if (cue.hit > 0.5 && prevHit <= 0.5) {
          flashes++;
          const inP = ((beat % PHRASE_BEATS) + PHRASE_BEATS) % PHRASE_BEATS;
          if (inP > 0.05) strayFlash++;
        }
        prevHit = cue.hit;
        for (const em of crest) {
          for (let b = 0; b < CREST_BEAMS; b++) {
            aimBeam(cue, em, b, CREST_BEAMS, FOCUS, aim);
            maxGain = Math.max(maxGain, aim.gain);
            // Lowest point over the ring's air (r ≤ ring + deck): the beam's
            // height is linear along it, so it's lowest where it enters or
            // leaves that disc.
            const R = RING_MAX + DECK_R + 1;
            const qa = aim.dx * aim.dx + aim.dz * aim.dz;
            const qb = 2 * (em.x * aim.dx + em.z * aim.dz);
            const qc = em.x * em.x + em.z * em.z - R * R;
            const disc = qb * qb - 4 * qa * qc;
            if (qa > 1e-9 && disc > 0) {
              const r0 = Math.max(0, (-qb - Math.sqrt(disc)) / (2 * qa));
              const r1 = Math.min(CREST_LEN, (-qb + Math.sqrt(disc)) / (2 * qa));
              if (r1 > r0) {
                const y = em.y + aim.dy * (aim.dy < 0 ? r1 : r0);
                if (y < crestLow) {
                  crestLow = y;
                  crestWorst = `${t} act ${act} beat ${beat.toFixed(2)} ${cue.look} crest ${em.i}/${b}`;
                }
              }
            }
            if (cue.gather > 0.98) {
              const fx = FOCUS.x - em.x;
              const fy = FOCUS.y - em.y;
              const fz = FOCUS.z - em.z;
              const fl = Math.hypot(fx, fy, fz);
              const cos = (aim.dx * fx + aim.dy * fy + aim.dz * fz) / fl;
              if (cos < Math.cos(0.12)) gatherMiss++;
            }
          }
        }
        for (const em of crown) {
          for (let b = 0; b < CROWN_BEAMS; b++) {
            aimBeam(cue, em, b, CROWN_BEAMS, FOCUS, aim);
            const ox = Math.sin(em.a);
            const oz = -Math.cos(em.a);
            if (aim.dx * ox + aim.dz * oz < -1e-6) inward++;
            // Through the air over ANY deck position on ANY ring size: the
            // decks sit in the annulus [RING_MIN − DECK_R, RING_MAX + DECK_R].
            for (let s = 0; s <= CROWN_LEN; s += 0.05) {
              const x = em.x + aim.dx * s;
              const z = em.z + aim.dz * s;
              const r = Math.hypot(x, z);
              if (r < RING_MIN - DECK_R || r > RING_MAX + DECK_R) continue;
              // Decks stand on the common floor (stage root y 0); clearance over it.
              const y = em.y + aim.dy * s;
              if (y < crownLow) {
                crownLow = y;
                crownWorst = `${t} act ${act} beat ${beat.toFixed(2)} ${cue.look} crown ${em.i}/${b}`;
              }
              break; // the first sample inside the annulus is the lowest (beams climb)
            }
          }
        }
      }
    }
  }
  check('crest: never below 25 m over the decks', crestLow >= 25, `lowest ${crestLow.toFixed(2)} m (${crestWorst})`);
  check(`crown: clears a dancer's reach (${HEAD} m) over every deck`, crownLow >= HEAD, `lowest ${crownLow.toFixed(2)} m (${crownWorst})`);
  check('crown: never fires back across the stage', inward === 0, `${inward} inward beams`);
  check('gather: every crest beam on the record at the end of the bar', gatherMiss === 0, `${gatherMiss} misses`);
  check('no strobe: the flash fires only on a phrase downbeat', strayFlash === 0 && flashes > 0, `${flashes} flashes, ${strayFlash} stray`);
  check('gain stays bounded', maxGain <= 2.21, `max ${maxGain.toFixed(2)}`);
}

// ── the tent meets where it says ────────────────────────────────────────
{
  const cue = newCue();
  const aim = newAim();
  let worst = 0;
  for (let beat = 8; beat < 24; beat += 0.25) {
    cueAt(cue, beat, 2, 0);
    cue.look = 'tent';
    cue.gather = 0;
    cue.open = 1;
    const o = (beat / APEX.beats) * Math.PI * 2;
    const ax = APEX.x + Math.sin(o) * APEX.r;
    const az = APEX.z + Math.cos(o) * APEX.r;
    for (const em of crest) {
      aimBeam(cue, em, 2, 5, FOCUS, aim);
      // Closest approach of the beam to the apex.
      const vx = ax - em.x;
      const vy = APEX.y - em.y;
      const vz = az - em.z;
      const along = vx * aim.dx + vy * aim.dy + vz * aim.dz;
      const miss = Math.hypot(vx - aim.dx * along, vy - aim.dy * along, vz - aim.dz * along);
      worst = Math.max(worst, miss);
    }
  }
  check('tent: the crest meets at the apex', worst < 0.5, `worst miss ${worst.toFixed(3)} m`);
}

// ── palette discipline ──────────────────────────────────────────────────
function hsl(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}
/** Danger's half of the wheel: red → amber → yellow, and goo green. */
const dangerHue = (h) => h < 0.18 || h > 0.97 || (h > 0.2 && h < 0.46);
{
  const bad = [];
  for (const [key, p] of Object.entries(PALETTES)) {
    for (const hex of [...p.lasers, p.accent]) {
      const c = hsl(hex);
      if (c.s > 0.35 && dangerHue(c.h)) bad.push(`${key} #${hex.toString(16).padStart(6, '0')}`);
    }
  }
  check('palettes: no sleeve laser speaks danger', bad.length === 0, bad.join(', '));
  const wheel = config.match(/LASER_HUES = \[([^\]]+)\]/);
  const hues = wheel ? wheel[1].split(',').map(Number) : [];
  const off = hues.filter(dangerHue);
  check('hue wheel: no danger hues', hues.length > 0 && off.length === 0, `hues ${hues.join(', ')}`);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(failures ? 1 : 0);
