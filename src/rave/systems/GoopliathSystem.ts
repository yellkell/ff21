/**
 * GoopliathSystem — the star of the show, and he knows it.
 *
 * The gel creature on the centre stage runs a full dance kit, all of it on
 * the clock:
 *
 *  - THE POSES: a disco stance vocabulary (goopliath/dancePoses.ts) hit
 *    bar by bar — point-up, rave-Y, floor-stomp, vogue, strut — with the
 *    body SNAPPING between silhouettes (styleEase cranked) instead of the
 *    old boxing ooze. Every 4-bar block picks a new opposing pair.
 *  - THE HOP: his whole tonnage bounces, landing ON each kick, bigger out
 *    of phrase turns — plus the two-step that lurches him across the stage
 *    every beat and the agitation jiggle that keeps the surface alive.
 *  - THE MELT: on quiet phrase turns he collapses into the glob and pours
 *    himself back up — the show-off move, guarded so it never eats a real
 *    telegraph (only fires with no landing due within six beats).
 *  - THE GAZE: he watches YOU, swaying off you with the bar, riding a full
 *    spin out of every second phrase.
 *  - THE ATTACKS stay his big moves: amber-eyed wind-up gestures fire only
 *    for real telegraphs (with follow-up strikes riding every cascade
 *    landing), and while he swings he PLANTS — no hop, no step, dead-on
 *    facing. A gesture that can't start (mid-melt, mid-swing) retries
 *    until its landing is imminent, so the body tell is never silently
 *    dropped.
 *
 * His stage rides RankSystem's sink: as you rise, he stays at the bottom
 * with the floor. In the lobby he's an idle glob nodding to the room loop;
 * in a tutorial he shrinks to the goopling's scale.
 */

import { createSystem, Group, Vector3 } from '@iwsdk/core';
import { GOOP, MUSIC, RING, ringRadius, type MoveKind } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { arena } from '../arena/arena.js';
import { GelCreature } from '../goopliath/GelCreature.js';
import { CREATURE, ATTACKS, type AttackName } from '../goopliath/goopConfig.js';
import { DANCE_COMBOS } from '../goopliath/dancePoses.js';
import { GooFx } from '../../goopliath/splats.js';
import { roll } from '../game/rng.js';
import { match, phraseBeats, type GestureCue } from '../game/state.js';
import { choreoView } from './ChoreoSystem.js';

const GESTURE: Record<MoveKind, AttackName> = {
  beam: 'cross',
  sweep: 'backfist',
  seesaw: 'clap',
  surge: 'spinkick',
  gate: 'hook', // the wide arm swinging the doors shut
  nova: 'uppercut',
  cross: 'backfist', // thrown sideways, across the body — the side laser
  donut: 'clap', // both arms hauling the rim in on the middle
  duckdonut: 'clap', // rim hauled in while the blade swings
  routine: 'overhand', // the slabs coming down on three quarters
  wave: 'backfist', // the first swat of the march
};

/** The quick follow-up strikes inside a multi-landing move. */
const STEP_GESTURE: Record<MoveKind, AttackName> = {
  beam: 'jab',
  sweep: 'hook',
  seesaw: 'hook',
  surge: 'roundhouse',
  gate: 'jab',
  nova: 'jab',
  cross: 'backfist',
  donut: 'hook', // the wide arm sweeping the rim inward
  duckdonut: 'hook',
  routine: 'overhand', // one drop per step of the routine
  wave: 'jab', // one jab per lane of the march
};

/** The two-step floor pattern, one target per beat of the bar (sim units):
 *  step left, gather, step right, gather — the mass visibly rocks. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [-0.34, 0.06],
  [-0.08, -0.12],
  [0.34, 0.06],
  [0.08, -0.12],
];

/** Melt length in beats and the clearance a melt needs before any landing. */
const MELT_BEATS = 1.4;
const MELT_CLEARANCE = 6;

/** Finale entrance (song beats, negative = count-in): the goop is absent,
 *  then DROPS out of the rig onto the MC, landing as a glob that swallows
 *  him and pours itself up to full height for the show. */
const EAT_START = -2.8;
const EAT_LAND = -1.2;

const _head = new Vector3();
const _target = new Vector3();
const _local = new Vector3();
const _up = new Vector3(0, 1, 0);

export class GoopliathSystem extends createSystem({}) {
  private goop?: GelCreature;
  private fx?: GooFx;
  private root?: Group;
  private generation = -1;
  private lastKick = -1;
  private lastBar = -1;
  private lastPhrase = -1;
  private meltUntilBeat = -Infinity;
  private hand: 'left' | 'right' = 'left';
  /** Which generation's finale gulp already fired (one-shot). */
  private gulpedGen = -2;
  /** A gesture that couldn't start (mid-melt/mid-swing): retried with its
   *  remaining charge until the landing is imminent. */
  private pending: { cue: GestureCue; dueBeat: number } | null = null;

  private rebuild(): void {
    this.generation = match.generation;
    const scale = GOOP.scale;
    const z = -ringRadius(match.seats);

    if (!this.goop) {
      this.fx = new GooFx();
      this.scene.add(this.fx.group);
      this.goop = new GelCreature(this.fx);
      this.goop.qualityOverride = GOOP.quality;
      this.root = new Group();
      this.root.add(this.goop.group);
      this.scene.add(this.root);
    }
    // Parent scale converts the man-sized sim into the boss (or a goopling).
    this.root!.scale.setScalar((scale * 1.78) / CREATURE.height);
    this.root!.position.set(0, RING.stageHeight, z);
    // Finale recolour (null restores the classic green).
    this.goop!.tint(match.goopTint);
    this.lastBar = -1;
    this.lastPhrase = -1;
    this.meltUntilBeat = -Infinity;
    this.pending = null;
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const goop = this.goop;
    const root = this.root;
    if (!goop || !root) return;

    // Whose stage is it? The gel holds the lobby, the map, every rehearsal
    // and the finale nights; on MC nights the whole sim sleeps.
    const raidish =
      match.after === 'raid' &&
      (match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium');
    // The green room is goop-free: the raymarched gel is the most expensive
    // draw in the game, and idling it on a menu was pure lag. He appears
    // where he performs — rehearsals, finales, the eat — and nowhere else.
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    if (menuRoom || (raidish && match.bossKind !== 'goop')) {
      root.visible = false;
      return;
    }
    root.visible = true;

    this.fx?.update(delta);

    // He dances to whatever is playing — the set or the lobby loop.
    const inSet = Number.isFinite(match.beat) && match.screen !== 'podium';
    const beat = Number.isFinite(match.beat) ? match.beat : 0;
    const dancing = inSet && beat >= 0;
    const melting = beat < this.meltUntilBeat;

    // THE ENTRANCE: on finale nights the gel isn't there yet — the MC holds
    // the count-in until the goop drops out of the rig and EATS him.
    let introDrop = 0;
    let arriving = false;
    if (match.eatIntro && match.screen === 'countdown') {
      const b = match.beat;
      if (!Number.isFinite(b) || b < EAT_START) {
        root.visible = false;
        arriving = true;
      } else if (b < EAT_LAND) {
        const t = (b - EAT_START) / (EAT_LAND - EAT_START);
        introDrop = (1 - t) * (1 - t) * 6;
        arriving = true;
      } else if (this.gulpedGen !== this.generation) {
        // Touchdown: the swallow. One heavy slam, the surface roils, and
        // the glob starts pouring itself up to full height.
        this.gulpedGen = this.generation;
        sfx.gooSlam();
        goop.sim.agitation = 1;
        if (this.fx) {
          _target.copy(root.position);
          _target.y += 0.5 * root.scale.x;
          this.fx.burst(_target, _up, 14, 3.2);
        }
      }
    }

    // Form: up on his feet for the show — except mid-melt (he deliberately
    // lets himself go) and mid-entrance (he arrives AS a glob, swallows,
    // then pours up).
    goop.setFormTarget(melting || arriving ? 0 : 1);

    this.runGestures(goop, root, beat);

    /* ── the dance ─────────────────────────────────────────────────────── */
    const punching = goop.isPunching;
    goop.styleEase = dancing ? 6 : 1.6;

    // The stage floor under him can sink as the ranks rise — he stays with
    // it, at the bottom, where the floor show belongs.
    const stageY = arena()?.stage.position.y ?? 0;
    let hop = 0;

    if (dancing) {
      const beatInBar = ((Math.floor(beat) % 4) + 4) % 4;
      const bar = Math.floor(beat / MUSIC.beatsPerBar);
      const phrase = Math.floor(beat / phraseBeats());
      const kick = Math.floor(beat);

      if (kick !== this.lastKick) {
        this.lastKick = kick;
        const phraseTurn = kick % phraseBeats() === 0;
        const bounce = phraseTurn ? 0.85 : beatInBar === 0 ? 0.55 : GOOP.danceBounce;
        goop.sim.agitation = Math.min(1, goop.sim.agitation + bounce);
      }

      // THE POSES: a new silhouette every bar, pairs swapped per 4-bar
      // block. Rehearsal gooplings keep to the readable point-up pair.
      if (bar !== this.lastBar && !melting) {
        this.lastBar = bar;
        const block = Math.floor(bar / 4);
        const combo = DANCE_COMBOS[Math.floor(roll(match.seed, 0xda9ce, block) * DANCE_COMBOS.length)];
        goop.setFightStyle(combo[((bar % 2) + 2) % 2].pose);
      }

      // THE MELT: on a quiet even-phrase turn he collapses and re-pours.
      if (phrase !== this.lastPhrase) {
        const phraseWasOdd = this.lastPhrase % 2 === 1;
        this.lastPhrase = phrase;
        if (
          match.screen === 'raid' &&
          phrase > 0 && // he only just poured himself up — let him arrive
          !phraseWasOdd && // odd phrases end in the gaze spin — don't stack
          !punching &&
          this.landingClearance(beat) > MELT_CLEARANCE
        ) {
          this.meltUntilBeat = beat + MELT_BEATS;
        }
        // Phrase turn: the mass slams and sprays.
        if (this.fx && phrase > 0) {
          _target.copy(root.position);
          _target.y += 0.3 * root.scale.x;
          this.fx.burst(_target, _up, 9, 2.6);
        }
      }

      // THE TWO-STEP + THE HOP. Attacks plant him; the melt puddles him.
      if (punching || melting) {
        goop.moveSpeedScale = 1;
        goop.moveTo(_local.set(0, 0, 0));
      } else {
        goop.moveSpeedScale = 2.4; // lurch ON the beat, not toward it
        const step = STEPS[beatInBar];
        goop.moveTo(_local.set(step[0], 0, step[1]));
        // Land ON every kick: peak mid-beat, floor at the beat line.
        const phrasePop = beat % phraseBeats() < 1 ? 1.8 : 1;
        hop = Math.abs(Math.sin(beat * Math.PI)) * 0.045 * root.scale.x * phrasePop;
      }
    } else {
      goop.moveSpeedScale = 1;
      goop.moveTo(_local.set(0, 0, 0));
      this.lastKick = -1;
    }
    root.position.y = RING.stageHeight + stageY + hop + introDrop;

    /* ── the gaze ──────────────────────────────────────────────────────── */
    // He watches YOU — but the watching grooves: the gaze sways off you
    // with the bar and rides a full spin out of every second phrase.
    // Mid-attack the sway dies and he squares up dead-on (that's the tell).
    _head.set(match.headX, match.headY, match.headZ);
    _local.copy(_head).sub(root.position).divideScalar(root.scale.x || 1);
    if (dancing && !punching) {
      const pb = phraseBeats();
      const inPhrase = beat % pb;
      const oddPhrase = Math.floor(beat / pb) % 2 === 1;
      let sway = Math.sin(beat * Math.PI * 0.5) * 0.5;
      if (oddPhrase && inPhrase > pb - 8) {
        sway += ((inPhrase - (pb - 8)) / 8) * Math.PI * 2;
      }
      const dist = Math.hypot(_local.x, _local.z) || 1;
      const ang = Math.atan2(_local.x, _local.z) + sway;
      _local.set(Math.sin(ang) * dist, _local.y, Math.cos(ang) * dist);
    }
    goop.faceToward(_local);

    // A mid-swing limb balloons the raymarch bounds — shed steps exactly then.
    goop.qualityOverride = punching ? GOOP.attackQuality : GOOP.quality;

    goop.update(delta * GOOP.timeScale, _head);
  }

  /** Beats until the next unresolved landing anywhere (∞ if none). */
  private landingClearance(beat: number): number {
    let soonest = Infinity;
    for (const z of choreoView.zones) {
      if (!z.resolved && z.dueBeat - beat < soonest) soonest = z.dueBeat - beat;
    }
    return soonest;
  }

  /** Fire queued gesture cues; keep the latest refused one alive and retry
   *  it with its remaining charge until the landing is on top of us. */
  private runGestures(goop: GelCreature, root: Group, beat: number): void {
    const fresh = match.gestures.splice(0);
    const attempts: { cue: GestureCue; dueBeat: number }[] = fresh.map((cue) => ({
      cue,
      dueBeat: beat + cue.chargeBeats,
    }));
    if (this.pending) attempts.unshift(this.pending);
    this.pending = null;

    for (const attempt of attempts) {
      const remaining = attempt.dueBeat - beat;
      if (remaining < 0.5) continue; // too late — the floor tell carries it
      const name = attempt.cue.step ? STEP_GESTURE[attempt.cue.kind] : GESTURE[attempt.cue.kind];
      const chargeSeconds = Math.max(0.25, remaining * match.beatLen);
      goop.tempoScale = Math.max(0.35, (chargeSeconds * GOOP.timeScale) / ATTACKS[name].telegraph);
      this.hand = this.hand === 'left' ? 'right' : 'left';
      // Swing at head height toward my seat — a SHORT lunge; the floor
      // zones carry the real danger (and the raymarch bounds stay tight).
      _head.set(match.headX, match.headY, match.headZ);
      _target.copy(_head).sub(root.position);
      _target.y = 0;
      const len = _target.length() || 1;
      _target.multiplyScalar((root.scale.x * GOOP.gestureReach) / len).add(root.position);
      _target.y = 1.6;
      if (!goop.throwAttack(name, this.hand, _target)) {
        // Busy (melting or mid-swing): keep the most urgent refusal alive.
        if (!this.pending || attempt.dueBeat < this.pending.dueBeat) this.pending = attempt;
      } else if (beat < this.meltUntilBeat) {
        // A real telegraph outranks the show-off move — stand back up.
        this.meltUntilBeat = -Infinity;
      }
    }
  }
}
