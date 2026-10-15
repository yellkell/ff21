/**
 * HudSystem — your numbers, OUT of your sightline. A small readout floats
 * off to your LEFT at a natural glance height, turned toward you like a
 * monitor wedge at a gig: the score, the ×multiplier chip (lit only
 * while a chain is alive) and the GROOVE row. Tiny captions, no sentences,
 * and NO LIFE COUNTER — you dance the whole record. The centre of your view belongs to the
 * giant and the blocks.
 *
 * THE CHAIN WARNING is the exception, and it is silent until it matters:
 * take a hit and a row of alarm cells appears, one lit per clipped landing back
 * to back. Three and the night is over. Dodge once and the row vanishes
 * as if it never happened — because the count didn't survive either.
 *
 * THE GRADE takes the centre when the record ends: one big letter, S to
 * F, with the share of landings you survived under it.
 *
 * THE GROOVE ROW is how you see the combo catch: four pips light one per
 * rhythmic swap as it winds up — and once it's running the pips KEEP
 * DANCING: the cycle walks 1-2-3-4 with your swaps, and the pip whose
 * turn it is hops with a lens-glint sparkle, with the points the streak
 * has paid beside. It dies with the streak, so the row always reads
 * "this run". The sparks off the sticks are still the loud half of the
 * answer; this is the quiet ledger.
 *
 * The count-in and the final grade take the centre — they're cards you
 * READ while nothing is trying to kill you — and the flair pops
 * (PERFECT / HIT) kick in just beneath the wedge, so the pop and the
 * numbers it explains live in one glance and never stand between you and
 * the next landing.
 *
 * THE LOOK is the neon district's holo hand, the same one FIRE FIGHT's
 * match UI wears (ui/kit/holo.ts): the wedge is a slim see-through pane
 * with a lit edge tube, the score a padded counter, the pops GLITCH type
 * on a sliver of dark glass. The paint lives in ui/hud.ts; this system
 * owns the planes, the timing and the pips.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Sprite,
  SpriteMaterial,
} from 'three';
import { GRADE, SCORE, TOUR } from '../config.js';
import { trackById } from '../audio/tracks.js';
import { danceHue } from '../game/profile.js';
import { dodgeRate, type Flair, gradeOf, match, me, showBeat } from '../game/state.js';
import { glintTexture, pipTexture, sizedPointsMaterial } from '../materials/glow.js';
import { fontsReady } from '../ui/fonts.js';
import {
  CARD_H as CH,
  CARD_W as CW,
  POP_H,
  POP_W,
  WEDGE_H as SH,
  WEDGE_PIPS,
  WEDGE_W as SW,
  paintCount,
  paintCueing,
  paintGrade,
  paintPop,
  paintWedge,
} from '../ui/hud.js';

const SET_COLORS = ['#8cff70', '#ff6ee0', '#ffd24a'];

/** The groove's own colour — electric ice, never the seat's, so the two
 *  never blur. Turquoise, per the boss. */
const GROOVE_HEX = 0x1cf5c9;
/** An unlit pip: cold slate, an invitation. */
const PIP_COLD_HEX = 0x424b59;

/* THE GROOVE ROW's pips live OFF the canvas, as four points and a glint
 * sprite riding the wedge plane (groovePips below holds the why). These
 * map the painted row (WEDGE_PIPS) into the plane's local metres so the
 * sprite row and the canvas tally keep lining up. */
const PIPS = WEDGE_PIPS.count;
const PX_X = 0.5 / SW; // the wedge plane is 0.5×0.28 m for 512×288 px
const PX_Y = 0.28 / SH;
/** Point size (m) sized so the texture's disc lands at ~22 px. */
const PIP_WU = 0.05;
/** The hop: a jump and a small rebound, measured in the RECORD's beats
 *  (the pips dance to the song like everything else on the show side). */
const HOP_ARC = 0.5;
const HOP_REB = 0.3;

/** The hop's height (0..1) at `tb` show-beats after the swap that threw
 *  it: up-and-over inside half a beat, then a little rebound — a dot
 *  landing, not a dot on a sine wave. Exported for tools. */
export function pipHop(tb: number): number {
  if (tb < 0) return 0;
  if (tb < HOP_ARC) return Math.sin((tb / HOP_ARC) * Math.PI);
  if (tb < HOP_ARC + HOP_REB) return 0.24 * Math.sin(((tb - HOP_ARC) / HOP_REB) * Math.PI);
  return 0;
}

const _head = new Vector3();
const _pipC = new Color();
const _pipWhite = new Color(0xffffff);

/** A seat's colour at FULL neon: hue straight to hsl, no muddying through
 *  the palette's dimmer value curve. */
function seatNeonCss(hue: number): string {
  return `hsl(${Math.round(hue * 360)}, 100%, 62%)`;
}

/**
 * THE POP'S KICK — an underdamped spring settling on 1, the same language
 * the boss's hands are written in (game/poseMotion.ts). It arrives PAST its
 * mark and rocks back instead of easing politely up to size, so a pop lands
 * as a punch rather than a fade-in — and one arriving on the tail of the
 * last re-kicks instead of sliding. Starts near 0.58, tops out ~13% over at
 * ~0.13 s, and is home well inside the 0.9 s the pop holds before it fades.
 *
 * Exported because it cannot be audited any other way: a container's
 * software GL runs this scene at about three frames a second, so the whole
 * bounce lives inside a single frame there and sampling the live plane
 * proves nothing about its shape. tools/perfect-pop.mjs reads the curve
 * straight from here.
 */
export function popScale(age: number): number {
  return 1 - 0.42 * Math.exp(-age * 9) * Math.cos(age * 24);
}

export class HudSystem extends createSystem({}) {
  /** The centre card: count-in, "cueing", the final grade. */
  private cardCanvas = document.createElement('canvas');
  private cardTex!: CanvasTexture;
  private card!: Mesh;
  /** The monitor wedge: the live readout, low off the front-left rim. */
  private stripCanvas = document.createElement('canvas');
  private stripTex!: CanvasTexture;
  private strip!: Mesh;
  /** A plane, not a Sprite — flair text must never roll with the head. */
  private flair!: Mesh;
  private flairMat!: MeshBasicMaterial;
  private flairCanvas = document.createElement('canvas');
  private flairTex!: CanvasTexture;
  private flairAge = 9;
  private lastKey = '';
  /** The groove pips — points on the wedge, not paint (see groovePips). */
  private pips!: Points;
  private pipPos = new Float32Array(PIPS * 3);
  private pipCol = new Float32Array(PIPS * 3);
  private pipSize = new Float32Array(PIPS);
  private pipPosAttr!: BufferAttribute;
  private pipColAttr!: BufferAttribute;
  private pipSizeAttr!: BufferAttribute;
  private pipGlint!: Sprite;
  /** Seconds since the last paid swap answered on the row. */
  private hopAge = 9;
  private lastStreak = 0;

  init(): void {
    this.cardCanvas.width = CW;
    this.cardCanvas.height = CH;
    this.cardTex = new CanvasTexture(this.cardCanvas);
    this.card = new Mesh(
      new PlaneGeometry(0.9, 0.45),
      new MeshBasicMaterial({ map: this.cardTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.card.renderOrder = 30;
    this.card.position.set(0, 0.62, -1.06);
    this.card.rotation.x = -0.5;
    this.scene.add(this.card);

    this.stripCanvas.width = SW;
    this.stripCanvas.height = SH;
    this.stripTex = new CanvasTexture(this.stripCanvas);
    this.strip = new Mesh(
      new PlaneGeometry(0.5, 0.28),
      new MeshBasicMaterial({ map: this.stripTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.strip.renderOrder = 30;
    // Glance height, not floor height: off the left shoulder, a little
    // below eye line, where a look costs a flick of the eyes and never a
    // drop of the chin. Everything on it is CENTRED in the plane — content
    // pushed to the outer edge would sit further into the periphery than
    // the wedge itself, which is how the first pass hid its own numbers.
    this.strip.position.set(-0.52, 1.2, -0.9);
    this.scene.add(this.strip);

    // THE PIPS ride the strip as four real points plus one glint sprite,
    // just proud of the plane so they draw over it. Children of the strip,
    // so its look-at and visibility carry them for free.
    const pipGeo = new BufferGeometry();
    this.pipPosAttr = new BufferAttribute(this.pipPos, 3).setUsage(DynamicDrawUsage);
    this.pipColAttr = new BufferAttribute(this.pipCol, 3).setUsage(DynamicDrawUsage);
    this.pipSizeAttr = new BufferAttribute(this.pipSize, 1).setUsage(DynamicDrawUsage);
    this.pipSize.fill(1);
    pipGeo.setAttribute('position', this.pipPosAttr);
    pipGeo.setAttribute('color', this.pipColAttr);
    pipGeo.setAttribute('aSize', this.pipSizeAttr);
    this.pips = new Points(
      pipGeo,
      sizedPointsMaterial({
        size: PIP_WU,
        map: pipTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.pips.name = 'groove-pips'; // headless probes read the row by name
    this.pips.frustumCulled = false;
    this.pips.renderOrder = 31;
    this.pips.position.z = 0.004;
    this.strip.add(this.pips);
    this.pipGlint = new Sprite(
      new SpriteMaterial({
        map: glintTexture(),
        color: 0xeafffb,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.pipGlint.name = 'groove-glint';
    this.pipGlint.renderOrder = 32;
    this.pipGlint.visible = false;
    this.strip.add(this.pipGlint);

    this.flairCanvas.width = POP_W;
    this.flairCanvas.height = POP_H;
    this.flairTex = new CanvasTexture(this.flairCanvas);
    this.flairMat = new MeshBasicMaterial({
      map: this.flairTex,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    // Smaller than it was, and BENEATH the wedge instead of floating high
    // right: the pop and the numbers it explains now live in one glance,
    // and the action line above stays clear.
    this.flair = new Mesh(new PlaneGeometry(0.76, 0.24), this.flairMat);
    this.flair.renderOrder = 31;
    this.flair.position.set(-0.52, 0.93, -0.88);
    this.scene.add(this.flair);
  }

  update(delta: number): void {
    const inSet = match.screen === 'countdown' || match.screen === 'raid';
    // The record is over: the grade owns the centre while the board reads
    // out the ranks behind it.
    const podium = match.screen === 'podium';
    _head.set(match.headX, match.headY, match.headZ);

    // Flair pops.
    const next = match.flairs.shift();
    if (next) {
      this.drawFlair(next.text, next.tone);
      this.flairAge = 0;
    }
    this.flairAge += delta;
    const t = this.flairAge;
    const fade = Math.max(0, 1 - Math.max(0, t - 0.9) / 0.5);
    this.flair.visible = inSet && fade > 0;
    if (this.flair.visible) this.flair.lookAt(_head);
    // THE KICK (see popScale). Every pop resets the age, so each change
    // bounces on its own — a perfect landing on the tail of the last one
    // re-kicks rather than sliding quietly to the new number.
    const pop = popScale(t);
    this.flair.scale.set(pop, pop, 1);
    this.flairMat.opacity = fade;

    // The count-in and the final grade take the centre; the live game gets
    // the wedge.
    const cardUp = podium || (inSet && match.screen === 'countdown');
    this.card.visible = cardUp;
    this.strip.visible = inSet && !cardUp;
    if (this.strip.visible) this.strip.lookAt(_head);
    this.groovePips(delta);
    if (cardUp) {
      // The count-in and the grade are MOMENTS — hang them at eye line,
      // big, facing you. Nothing else is happening; nothing is blocked.
      this.card.position.set(0, 1.42, -1.55);
      this.card.scale.setScalar(podium ? 1.5 : 1.3);
      this.card.lookAt(_head);
    }

    if (!inSet && !podium) return;

    const d = me();
    const beat = match.beat;
    const countdown = match.screen === 'countdown' && Number.isFinite(beat) && beat < 0;
    // The count-in counts the RECORD's beats — a doubled chart's count of
    // eight eighths ticked past like a stopwatch; four real beats is a
    // count-in you can nod to.
    const count = countdown ? Math.ceil(-showBeat()) : 0;
    const key = [
      match.screen,
      count,
      Number.isFinite(match.beat), // the "cueing the record" card
      match.trackId,
      match.mySeat,
      d?.score,
      d?.combo,
      d?.hits,
      d?.missChain,
      d?.dodges,
      d?.alive,
      match.grooveStreak,
      match.grooveScore,
      fontsReady(), // repaint once Rajdhani lands
      // (The groove pips animate OFF the canvas — see groovePips — so the
      // strip repaints only when a number on it actually changes. The old
      // row repainted this whole texture ten times a beat to move one dot.)
    ].join(':');
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (podium) this.drawGrade();
      else if (cardUp) this.drawCard(count);
      else this.drawStrip();
    }
  }

  /* ── the grade: what the night actually earned you ────────────────────── */

  private drawGrade(): void {
    const g = this.cardCanvas.getContext('2d')!;
    const d = me();
    if (!d) {
      g.clearRect(0, 0, CW, CH);
      this.cardTex.needsUpdate = true;
      return;
    }
    const letter = gradeOf(d);
    paintGrade(g, {
      letter,
      colour: GRADE.colors[letter] ?? '#f4f6fb',
      alive: d.alive,
      // What the night banked — FIRE FIGHT's iron-dollars, the one wallet.
      coins: match.coinsPaid,
      dodges: d.dodges,
      faced: d.dodges + d.hits,
      rate: dodgeRate(d),
      perfects: d.perfects,
    });
    this.cardTex.needsUpdate = true;
  }

  /* ── the centre card: things you READ while nothing hunts you ─────────── */

  private drawCard(count: number): void {
    const g = this.cardCanvas.getContext('2d')!;
    if (!Number.isFinite(match.beat)) {
      // The record is still decoding — the clock stays parked until it's
      // ready, so nothing can land early.
      paintCueing(g);
      this.cardTex.needsUpdate = true;
      return;
    }
    // Clean: the number, the record, and (on tour) the night. No slogan.
    const set = match.tour ? TOUR.sets[match.tour.set] : undefined;
    paintCount(
      g,
      count,
      trackById(match.trackId)?.title ?? null,
      match.tour
        ? { name: `${set?.name ?? 'THE TOUR'} · ${match.tour.song + 1}`, colour: SET_COLORS[match.tour.set % SET_COLORS.length] }
        : null,
    );
    this.cardTex.needsUpdate = true;
  }

  /* ── the wedge: score, ×mult, groove, chain — glanceable ──────────────── */

  private drawStrip(): void {
    const d = me();
    paintWedge(this.stripCanvas.getContext('2d')!, {
      score: d?.score ?? 0,
      mult: d && d.alive && d.combo > 0 ? 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap) : 0,
      seatCss: seatNeonCss(danceHue(match.mySeat, true)),
      alive: d?.alive !== false,
      missChain: d?.missChain ?? 0,
      chainOut: GRADE.chainOut,
      grooveScore: match.grooveScore,
    });
    this.stripTex.needsUpdate = true;
  }

  /**
   * THE PIPS, per frame — four points and a glint on the wedge plane, a
   * 160-byte buffer write a frame, so the row moves at headset rate
   * instead of stepping at the canvas clock's ten frames a beat.
   *
   * And the hop is thrown by the SWAP now, not by the beat clock: the row
   * is the dance's ledger, and a ledger that kept bouncing after the
   * hands stopped was flattering nobody. Every paid swap kicks the turn
   * pip up-and-over with a small rebound on landing (pipHop), the glint
   * riding it; each wind-up pip pops as it lights; stop dancing and the
   * row stands still until the streak lets go. This is the same trigger
   * the stick pulse and the spark burst fire on, so all three answers —
   * loud, felt, ledger — land as one beat-shaped event.
   */
  private groovePips(delta: number): void {
    this.hopAge += delta;
    const streak = match.grooveStreak;
    if (streak !== this.lastStreak) {
      // A paid swap throws the hop; a streak dying cancels it.
      this.hopAge = streak > this.lastStreak ? 0 : 9;
      this.lastStreak = streak;
    }
    const on = this.strip.visible && me()?.alive !== false;
    this.pips.visible = on;
    if (!on) {
      this.pipGlint.visible = false;
      return;
    }

    // The hop clock runs in the record's beats, like the rest of the show.
    const bpm = Number.isFinite(match.bpm) && match.bpm > 0 ? match.bpm : 120;
    const spb = 60 / (match.doubleTime ? bpm / 2 : bpm);
    const hop = pipHop(this.hopAge / spb);

    const running = streak > PIPS;
    const turn = running ? (streak - 1) % PIPS : -1;
    let glintOn = false;
    for (let i = 0; i < PIPS; i++) {
      const lit = running || i < streak;
      const active = i === turn;
      const justLit = !running && i === streak - 1;
      const px = WEDGE_PIPS.x0 + i * WEDGE_PIPS.gap;
      const py = WEDGE_PIPS.y - (active ? hop * 8 : 0);
      this.pipPos[i * 3] = (px - SW / 2) * PX_X;
      this.pipPos[i * 3 + 1] = (SH / 2 - py) * PX_Y;
      this.pipSize[i] = active ? 1 + hop * 0.3 : justLit ? 1 + hop * 0.45 : 1;
      _pipC.setHex(lit ? GROOVE_HEX : PIP_COLD_HEX);
      if ((active || justLit) && hop > 0) _pipC.lerp(_pipWhite, hop * 0.45);
      this.pipCol[i * 3] = _pipC.r;
      this.pipCol[i * 3 + 1] = _pipC.g;
      this.pipCol[i * 3 + 2] = _pipC.b;
      if (active && hop > 0.04) {
        glintOn = true;
        this.pipGlint.position.set(this.pipPos[i * 3], this.pipPos[i * 3 + 1], 0.006);
        this.pipGlint.scale.setScalar(0.034 + hop * 0.03);
        (this.pipGlint.material as SpriteMaterial).opacity = Math.min(1, hop * 1.5);
      }
    }
    this.pipGlint.visible = glintOn;
    this.pipPosAttr.needsUpdate = true;
    this.pipColAttr.needsUpdate = true;
    this.pipSizeAttr.needsUpdate = true;
  }

  private drawFlair(text: string, tone: Flair['tone']): void {
    paintPop(this.flairCanvas.getContext('2d')!, text, tone);
    this.flairTex.needsUpdate = true;
  }
}
