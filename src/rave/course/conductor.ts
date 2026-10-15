/**
 * THE CONDUCTOR — one clock owns the ride, and the FLOOR does the talking.
 *
 * The transport advances on SIMULATION delta, not the wall clock: departures,
 * countdowns, wayfinding and lights all read `bars`, so the floor and the
 * sound can never disagree about when a platform leaves. In a room it follows
 * the ROOM's clock instead (see `advance`), which is what lets two people ride
 * the same lap.
 *
 * WHAT USED TO BE HERE: a whole synthesised kit — two detuned saws droning
 * under a lowpass whose root climbed seven semitones between the floor and the
 * skywalk, a kick, a hat, and an arpeggio that opened up as your flow rose. It
 * was a nice piece of code and it was the wrong idea. A generated bed plays
 * whether or not anything is happening, so the one sound out here that carries
 * information — ground counting itself out from under you — had to compete
 * with a backing track for your attention. On a course whose whole argument is
 * that THE FLOOR IS THE INSTRUCTION, that is backwards.
 *
 * So the bed is gone, and what is left is a vocabulary of ACTIONS, each one
 * sounding from the place it happens:
 *
 *   tick   a deck counting out the last bar of its dwell — the countdown,
 *          climbing in pitch and in volume as the beats run out
 *   chime  a clean handover: you stepped, and the ground took you
 *   thud   a slip: the ground went without you
 *   bell   a lap closes
 *
 * They are POSITIONAL, and that is the point of the change rather than a
 * detail of it. A countdown that comes from everywhere is a metronome; a
 * countdown that comes from the deck two steps to your left is information you
 * can act on without looking, which on a course you walk by feel is everything.
 * Each one-shot builds its own panner and lets it fall out of scope — they are
 * short and sparse, and a pool would exist only to save a few allocations a
 * second.
 *
 * (A record can still play over all this — the rave's own shelf, shuffled per
 * headset, see MusicSystem. That is something the player brought with them,
 * which is a different thing from a bed the room insists on.)
 */

import { audioContext, ensureAudio } from '../audio/sfx.js';
import { musicBus } from '../audio/music.js';
import { MUSIC } from './config.js';

const BEAT_SEC = 60 / MUSIC.bpm;
const BAR_SEC = BEAT_SEC * MUSIC.beatsPerBar;

/** Seconds in one VOIDSTEP bar — the unit the room's shared clock counts in. */
export const COURSE_BAR_SEC = BAR_SEC;

/** Where in the world a sound comes from. Omit it and the sound is flat. */
export interface SoundAt {
  x: number;
  y: number;
  z: number;
}

class Conductor {
  bars = 0;
  playing = false;

  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private noiseBuf!: AudioBuffer;

  get barPhase(): number {
    return this.bars - Math.floor(this.bars);
  }

  /**
   * Move the clock on. `roomBars` is the room's own bar count when there is a
   * room (net/session.ts `courseBars`), and this is where co-op is actually
   * won or lost.
   *
   * Seeding the clock once on the way in is not enough. After that it would
   * free-run on FRAME DELTA, so anything that costs this headset time — a
   * decode hitch, a backgrounded tab, a headset that dozed for a second —
   * leaves it permanently riding a different lap from everyone else, and the
   * symptom is riders standing beside their decks rather than on them. So the
   * room's clock is followed continuously.
   *
   * It is followed by RATE, not by jumping: countdowns are timed against
   * `bars`, and yanking the number would fire a backlog of ticks or repeat one
   * already sounded. A small error bends the rate by up to half, which closes
   * a half-second gap in about a second and is invisible on a moving deck.
   * Only a gross error — a headset that genuinely slept — snaps, and at that
   * point a discontinuity is the honest thing.
   */
  advance(dt: number, roomBars?: number | null): void {
    if (!this.playing) return;
    if (roomBars != null && Number.isFinite(roomBars)) {
      const err = roomBars - this.bars;
      if (Math.abs(err) > 2) this.bars = roomBars;
      else this.bars += (dt / BAR_SEC) * (1 + Math.max(-0.5, Math.min(0.5, err)));
    } else {
      this.bars += dt / BAR_SEC;
    }
  }

  /**
   * The door opens: take the clock to the start line.
   *
   * `atBars` is the room's clock. Solo it is 0 and the circuit begins the
   * moment you cross — which is what it always did. In a room it is however
   * long the course has been running, so two people who crossed a minute apart
   * still find the same platform in the same place.
   */
  start(atBars = 0): void {
    this.bars = Number.isFinite(atBars) && atBars > 0 ? atBars : 0;
    this.playing = true;
    this.build();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  /** The door closes: the void goes quiet without cutting a tail short. */
  stop(): void {
    this.playing = false;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    }
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  /** Build the (now very small) graph on the club's context. Idempotent. */
  private build(): void {
    if (this.ctx) return;
    ensureAudio();
    const ctx = audioContext();
    const out = musicBus();
    if (!ctx || !out) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(out);

    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
  }

  /**
   * A panner for one one-shot, or the master itself when the caller didn't say
   * where the sound is. Inverse rolloff over a short reference distance: a deck
   * at your feet is clearly louder than one across the circuit, without the far
   * ones vanishing — you are meant to hear the shape of the whole floor
   * counting, just not equally.
   */
  private outputAt(at?: SoundAt): AudioNode {
    const ctx = this.ctx!;
    if (!at) return this.master!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.6;
    p.maxDistance = 40;
    p.rolloffFactor = 1.15;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else {
      p.setPosition(at.x, at.y, at.z);
    }
    p.connect(this.master!);
    return p;
  }

  /**
   * DEPARTURE COUNTDOWN. Pitch climbs as the beats run out, and it sounds from
   * the deck that is leaving — so a countdown behind you is one you can place
   * without turning round.
   */
  tick(beatsLeft: number, at?: SoundAt): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 900 + (4 - Math.min(4, beatsLeft)) * 180;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 5;
    // The LAST beat is the loud one. A deck three beats out murmurs and a deck
    // about to go speaks up, so the urgency is in the dynamics as well as the
    // pitch — and a floor full of decks at different counts reads as a texture
    // with one clear voice in it rather than as a wall of clicks.
    const urgency = 1 - Math.min(3, Math.max(0, beatsLeft - 1)) / 4;
    g.gain.setValueAtTime(0.04 + 0.05 * urgency, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(bp).connect(g).connect(this.outputAt(at));
    o.start(t);
    o.stop(t + 0.07);
  }

  /** A clean handover: you stepped and the ground took you. */
  chime(step: number, at?: SoundAt): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const penta = [0, 3, 5, 7, 10];
    const f = 440 * Math.pow(2, penta[step % penta.length] / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const m = ctx.createOscillator();
    const mg = ctx.createGain();
    m.frequency.value = f * 2.01;
    mg.gain.value = 90;
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.outputAt(at));
    o.start(t);
    m.start(t);
    o.stop(t + 0.75);
    m.stop(t + 0.75);
  }

  /** A slip: the ground went without you. Low, and under your feet. */
  thud(at?: SoundAt): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(lp).connect(g).connect(this.outputAt(at));
    s.start(t);
    s.stop(t + 0.32);
  }

  /** A lap closes: one deep bell, from the gate that closed it. */
  bell(step: number, at?: SoundAt): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const penta = [0, 3, 5, 7, 10];
    const f = 220 * Math.pow(2, penta[step % penta.length] / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const m = ctx.createOscillator();
    const mg = ctx.createGain();
    m.frequency.value = f * 1.41; // inharmonic partial: bell, not chime
    mg.gain.value = 160;
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.17, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    o.connect(g).connect(this.outputAt(at));
    o.start(t);
    m.start(t);
    o.stop(t + 1.9);
    m.stop(t + 1.9);
  }
}

export const conductor = new Conductor();
