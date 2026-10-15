/**
 * AvatarSystem — everybody else on the floor.
 *
 * Groupies (bots) dance: they bob on the kick, wave glowsticks, and when a
 * telegraph blooms on their deck they MOVE — to the safe ground if their
 * seeded roll says they'll live, square into the fire if it says they won't.
 * The roll here is the exact roll ChoreoSystem judges with, so what you see
 * a groupie do across the ring always matches what the leaderboard says
 * happened. Remote humans stream their real head/hands into the same rigs.
 *
 * The rigs themselves are the slender humanoids in game/avatars.ts, driven
 * purely by a head position and two hand targets — this system is the brain,
 * that module is the body. The LOCAL player gets no rig at all: you never
 * see your own body, only your controllers.
 *
 * Rigs live in platform-local space under each seat's platform root — rank
 * lifts and eliminations carry them automatically.
 */

import { createSystem } from '@iwsdk/core';
import { type MeshStandardMaterial } from 'three';
import { BOTS, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH } from '../config.js';
import { platformRoot } from '../arena/arena.js';
import { choreoView } from './ChoreoSystem.js';
import type { Zone } from '../choreo/setlist.js';
import { accentHex, buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { buildDancer as buildBlank } from '../game/blankDancer.js';
import { unpackLook } from '../../avatar/paint.js';
import { cleanGear } from '../../avatar/gear.js';
import { PoseMotion, type MotionTuning } from '../game/poseMotion.js';
import { roll } from '../game/rng.js';
import { seatBearing, seatIsNear } from '../game/ring.js';
import { liveSpots, match, type Dancer, showBeat } from '../game/state.js';
import { remotePoses } from '../net/poses.js';


interface Puppet {
  rig: DancerRig;
  seat: number;
  phase: number;
  /** The RENDERED pose — the motion layer carries it toward `tgt`. */
  pose: DancerPose;
  /** The driven target pose (bot choreography, or the remote wire). */
  tgt: DancerPose;
  motion: PoseMotion;
  /** Dance/dodge destination on the deck. */
  tx: number;
  tz: number;
  duck: boolean;
  lastHits: number;
  flash: number;
  slump: number;
}

const CLAMP_X = OCTAGON_HALF_WIDTH - 0.18;
const CLAMP_Z = OCTAGON_HALF_DEPTH - 0.15;
const STAND_HEAD = 1.56;
const DUCK_HEAD = 1.02;

/** Bots: heads chase fast enough to be transparent under driveBot's own
 *  channel eases; hands run underdamped springs, so the stick punched on
 *  the beat whips through its top and settles — dancers, not metronomes. */
const BOT_MOTION: MotionTuning = { headRate: 20, handHz: 3.0, zeta: 0.68 };
/** Remote humans: critically damped — velocity-continuous tracking of the
 *  10 Hz wire that never invents bounce. The old snap-to-latest-sample
 *  lerp turned every real swing into a scalloped arc with a corner at
 *  each packet; a spring carries speed THROUGH the packets. */
const REMOTE_MOTION: MotionTuning = { headRate: 14, handHz: 3.4, zeta: 1 };

export class AvatarSystem extends createSystem({}) {
  private generation = -1;
  private puppets: Puppet[] = [];

  private rebuild(): void {
    this.generation = match.generation;
    for (const p of this.puppets) p.rig.dispose();
    this.puppets = [];
    for (const d of match.players) {
      if (d.kind === 'local') continue; // you never see your own body
      const parent = platformRoot(d.seat);
      if (!parent) continue;
      // WHO WEARS WHAT: the GROUPIES are the house's own figures — the
      // RAVE RAID couture dancer, in their seat's neon (game/avatars.ts).
      // A REAL PERSON wears THE BLANK (game/blankDancer.ts): one town, one
      // body, so the fighter you met in the arena is the dancer beside you
      // here. Their look rides the wire and bakes on arrival.
      const rig =
        d.kind === 'remote'
          ? buildBlank(d.hue, {
              tone: d.tone === 'onyx' ? 'onyx' : 'white',
              gear: cleanGear(d.gear),
              look: unpackLook(d.look),
            })
          : buildDancer(d.hue);
      // DETAIL, decided once — see seatIsNear(). The choreography asks the
      // same question of the same seat, so a far deck loses its dancer's
      // jewellery, its falling blocks and its strike sparks together.
      rig.setDetail(seatIsNear(match.mySeat, d.seat, match.seats));
      parent.add(rig.root);
      const neutral = (): DancerPose => ({
        hx: 0, hy: STAND_HEAD, hz: 0, yaw: 0, pitch: 0, roll: 0,
        lx: -0.3, ly: 1.0, lz: -0.1,
        rx: 0.3, ry: 1.0, rz: -0.1,
        slump: 0,
      });
      this.puppets.push({
        rig,
        seat: d.seat,
        phase: (d.seat * 1.7) % (Math.PI * 2),
        pose: neutral(),
        tgt: neutral(),
        motion: new PoseMotion(),
        tx: 0,
        tz: 0,
        duck: false,
        lastHits: d.hits,
        flash: 0,
        slump: 0,
      });
    }
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    // The groupies DANCE to the record (showBeat), whatever clock the
    // danger runs — a doubled chart had them bobbing at 190 on a 95 BPM
    // strut. Their dodge targets still come from the zones' chart beats.
    const beat = Number.isFinite(match.beat) ? showBeat() : 0;

    for (const p of this.puppets) {
      const d = match.players.find((x) => x.seat === p.seat);
      if (!d) continue;

      // Hit flash: a landing clipped them since last frame.
      if (d.hits > p.lastHits) p.flash = 0.45;
      p.lastHits = d.hits;
      p.flash = Math.max(0, p.flash - delta);

      // Melt on elimination (and reform if a new match revives the rig).
      // Eased here on its own clock; the motion layer's chase is a no-op
      // because pose and target agree.
      const slumpTarget = d.alive ? 0 : 1;
      p.slump += (slumpTarget - p.slump) * Math.min(1, delta * 2.5);
      p.pose.slump = p.slump;
      p.tgt.slump = p.slump;

      // One drive for the whole rig, scaled by each material's authored
      // gain — the suit stays cooler than its own neon trim in every state.
      // Colours route through accentHex() so the white-hot tiers keep
      // their cores through the seat colour AND the flash red.
      const drive = d.alive ? 1.1 + (p.flash > 0 ? 1.6 : 0) : 0.14;
      for (const a of p.rig.accents) {
        const std = a.mat as MeshStandardMaterial;
        if (std.emissive) {
          std.emissiveIntensity = drive * a.gain;
          std.emissive.setHex(accentHex(a, p.flash > 0 ? 0xff4033 : p.rig.baseColor));
        } else {
          // Flat mats (blades, slit, soles, halos): white-cored while the
          // dancer lives; a corpse's sticks go OUT to flat grey — nothing
          // white-hot on a melted figure.
          std.color.setHex(
            p.flash > 0 ? accentHex(a, 0xff4033) : d.alive ? accentHex(a, p.rig.baseColor) : 0x3a3f4a,
          );
        }
      }

      if (d.kind === 'remote') {
        this.driveRemote(p);
      } else {
        this.driveBot(p, d, beat, delta);
      }
      p.motion.step(p.pose, p.tgt, delta, d.kind === 'remote' ? REMOTE_MOTION : BOT_MOTION);

      // Where this dancer stands on their own deck — zone judges read it.
      liveSpots.set(p.seat, { x: p.pose.hx, z: p.pose.hz });

      p.rig.pose(p.pose);
    }
  }

  private driveRemote(p: Puppet): void {
    const pose = remotePoses.get(p.seat);
    if (!pose) return;
    // The wire IS the target; the motion layer does the smoothing (and
    // sanitising — a bad sample can no longer poison the figure).
    const t = p.tgt;
    t.hx = pose.hx;
    t.hy = pose.hy;
    t.hz = pose.hz;
    t.yaw = pose.hyaw;
    t.pitch = pose.hpitch;
    t.roll = pose.hroll;
    t.lx = pose.lx;
    t.ly = pose.ly;
    t.lz = pose.lz;
    t.rx = pose.rx;
    t.ry = pose.ry;
    t.rz = pose.rz;
  }

  private driveBot(p: Puppet, d: Dancer, beat: number, delta: number): void {
    // Bot choreography drives the TARGET pose; its own per-channel eases
    // below stay (they are the authored feel), and the motion layer adds
    // the hand springs on top.
    const t = p.tgt;

    // What's coming for this seat? Mirror the judgement roll so the body
    // language always matches the outcome.
    p.duck = false;
    let want: { x: number; z: number } | null = null;
    if (d.alive && match.playing) {
      let soonest: (typeof choreoView.zones)[number] | null = null;
      let planted = false;
      for (const z of choreoView.zones) {
        if (z.seat !== p.seat || z.resolved) continue;
        if (z.zone.kind === 'sweep') {
          // The sweep is BODY HEIGHT, not floor position — it stacks with
          // any floor zone (DUCK DONUT throws both on one beat), so its
          // roll is judged apart and the duck rides along with the walk.
          const chance = Math.max(0.25, d.skill - z.act * BOTS.actPenalty);
          if (roll(match.seed, 0xb0b, z.seat, z.moveIdx, z.landingIdx) < chance) p.duck = true;
          planted = true;
          continue;
        }
        if (!soonest || z.dueBeat < soonest.dueBeat) soonest = z;
      }
      if (soonest) {
        // The judge's exact formula and exact roll — body language never lies.
        const chance = Math.max(0.25, d.skill - soonest.act * BOTS.actPenalty);
        const willDodge = roll(match.seed, 0xb0b, soonest.seat, soonest.moveIdx, soonest.landingIdx) < chance;
        want = this.spotFor(soonest, p, willDodge);
      } else if (planted) {
        // A lone blade: hold your ground and take it (or duck under it).
        want = { x: p.tx, z: p.tz };
      }
    }
    if (!want) {
      // Idle wander: a lazy seeded orbit around the deck centre.
      want = {
        x: Math.sin(beat * 0.22 + p.phase) * 0.28,
        z: Math.cos(beat * 0.17 + p.phase * 1.3) * 0.22,
      };
    }
    p.tx = Math.max(-CLAMP_X, Math.min(CLAMP_X, want.x));
    p.tz = Math.max(-CLAMP_Z, Math.min(CLAMP_Z, want.z));

    // Glide toward the destination (the figure leans into its own steps).
    const speed = 2.3;
    const dx = p.tx - t.hx;
    const dz = p.tz - t.hz;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      const step = Math.min(dist, speed * delta);
      t.hx += (dx / dist) * step;
      t.hz += (dz / dist) * step;
    }

    // Face the stage (−Z), glancing toward travel.
    const targetYaw = dist > 0.05 ? Math.atan2(-dx, -dz) * 0.35 : 0;
    t.yaw += (targetYaw - t.yaw) * Math.min(1, delta * 6);

    // The bob: down ON the kick, up off it — plus the duck when needed.
    const bounce = d.alive ? Math.abs(Math.sin(beat * Math.PI + p.phase)) * 0.05 : 0;
    const standY = p.duck ? DUCK_HEAD : STAND_HEAD;
    t.hy += (standY - bounce - t.hy) * Math.min(1, delta * 8);

    // The NOD rides the same kick as the bob, and the head lolls across the
    // bar on its own slower clock. Real dancers stream a live neck now; a
    // bot whose head could only swivel would be the one figure in the ring
    // that reads as furniture. A duck pulls the chin right down with it.
    const nod = d.alive ? -0.06 - Math.abs(Math.sin(beat * Math.PI + p.phase)) * 0.14 : 0;
    const targetPitch = p.duck ? nod - 0.45 : nod;
    const targetRoll = d.alive ? Math.sin(beat * 0.3 + p.phase * 1.7) * 0.13 : 0;
    t.pitch += (targetPitch - t.pitch) * Math.min(1, delta * 8);
    t.roll += (targetRoll - t.roll) * Math.min(1, delta * 5);

    // Glowsticks: alternate arms per beat — one punches the air, one rests.
    const wave = Math.sin(beat * Math.PI + p.phase);
    const upL = Math.max(0, wave);
    const upR = Math.max(0, -wave);
    t.lx = t.hx - 0.28 - upL * 0.06;
    t.ly = t.hy - 0.5 + upL * 0.62;
    t.lz = t.hz - 0.08 - upL * 0.05;
    t.rx = t.hx + 0.28 + upR * 0.06;
    t.ry = t.hy - 0.5 + upR * 0.62;
    t.rz = t.hz - 0.08 - upR * 0.05;
  }

  /** Where a groupie stands for a zone, given whether it intends to live. */
  private spotFor(live: (typeof choreoView.zones)[number], p: Puppet, dodge: boolean): { x: number; z: number } {
    const zone: Zone = live.zone;
    // Sweeps never land here — driveBot judges them apart (body height,
    // not floor position) — so this switch only walks the floor zones.
    if (zone.kind === 'sweep') return { x: p.tx, z: p.tz };
    switch (zone.kind) {
      case 'lane': {
        if (zone.yaw) {
          // THE X's arm: the four pockets between the arms all clear BOTH
          // diagonals, so the nearest pocket is always the honest dodge.
          if (!dodge) return { x: Math.cos(zone.yaw) * zone.x, z: -Math.sin(zone.yaw) * zone.x };
          const pockets = [
            { x: 0.55, z: 0 },
            { x: -0.55, z: 0 },
            { x: 0, z: 0.5 },
            { x: 0, z: -0.5 },
          ];
          let best = pockets[0];
          let bestD = Infinity;
          for (const q of pockets) {
            const d2 = Math.hypot(q.x - p.tx, q.z - p.tz);
            if (d2 < bestD) {
              bestD = d2;
              best = q;
            }
          }
          return best;
        }
        if (!dodge) return { x: zone.x, z: p.tz };
        const clear = zone.x > 0 ? zone.x - zone.halfW - 0.38 : zone.x + zone.halfW + 0.38;
        return { x: clear, z: p.tz };
      }
      case 'rail': {
        if (!dodge) return { x: p.tx, z: zone.z };
        // Step off the strip toward whichever side of it has more deck.
        const clear = zone.z > 0 ? zone.z - zone.halfD - 0.32 : zone.z + zone.halfD + 0.32;
        return { x: p.tx, z: clear };
      }
      case 'half': {
        const target = dodge ? -zone.side * 0.42 : zone.side * 0.42;
        return zone.axis === 1 ? { x: p.tx, z: target } : { x: target, z: p.tz };
      }
      case 'gate': {
        // Live: into the safe band. Doomed: square in a danger field.
        const off = zone.at > 0 ? zone.at - zone.half - 0.4 : zone.at + zone.half + 0.4;
        if (zone.axis) {
          return dodge ? { x: p.tx, z: zone.at } : { x: p.tx, z: off };
        }
        return dodge ? { x: zone.at, z: p.tz } : { x: off, z: p.tz };
      }
      case 'nova': {
        const local = zone.bearing - seatBearing(p.seat, match.seats);
        const r = dodge ? 0.55 : -0.55;
        return { x: Math.sin(local) * r, z: Math.cos(local) * r };
      }
      case 'quad': {
        // The whole ring performing the same routine in unison is the best
        // picture this game makes — and the ones who forgot are visibly in
        // the wrong corner a beat before the blocks find them.
        const c = dodge ? zone.corner : (zone.corner + 2) % 4;
        const sx = c & 1 ? 1 : -1;
        const sz = c & 2 ? 1 : -1;
        return { x: sx * 0.46, z: sz * 0.4 };
      }
      case 'donut': {
        // Everyone piles into the middle — with a little seeded scatter so
        // twenty-four decks aren't twenty-four identical statues.
        if (dodge) return { x: Math.sin(p.phase * 2) * 0.1, z: Math.cos(p.phase * 3) * 0.09 };
        const out = zone.innerR + 0.28;
        return { x: Math.sin(p.phase) * out, z: Math.cos(p.phase) * out };
      }
    }
  }
}
