/**
 * CourseVoidSystem — VOIDSTEP's world: SPECTRUM, hung round a circuit.
 *
 * The same world the raid and the foyer stand in (arena/spectrum/set.ts) —
 * the 360° equaliser wall, the record turning in the sky, ripples racing
 * over the glass, lasers off the wall's crest — arranged round the route
 * you RIDE instead of a ring of dancers, its glass starting outside the
 * circuit's widest reach. The course's live kit plays on the music bus, so
 * the wall is literally what you're stepping to; laps open the acts.
 *
 * VOIDSTEP wears its own sleeve (palettes.ts: ABYSS) and the world DUCKS
 * while the ground under you counts itself out — the house law that danger
 * never competes with scenery, applied to the only danger there is out here.
 */

import { createSystem } from '@iwsdk/core';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { PALETTE } from '../config.js';
import { SpectrumSet } from '../arena/spectrum/set.js';
import { ENERGY } from '../course/config.js';
import { applyDim } from '../course/dimmer.js';
import { panelTexture, textPanel } from '../course/textures.js';
import { course, G } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { font } from '../ui/fonts.js';

/** The floor's height under the circuit. */
export const FLOOR_Y = -0.06;

/** Does VOIDSTEP's floor reflect? The raid and the foyer stand on black
 *  glass that doubles the world; out here it doubled every deck too, and a
 *  floor full of upside-down machinery under a route you have to read at a
 *  glance is noise. So VOIDSTEP's floor is matte: no deck reflections, no
 *  wall in the glass, no horizon glow under the rim. (The raid keeps its
 *  glass — this is SpectrumSet's `reflective` option, set per world.) */
export const FLOOR_REFLECTS = false;

/** Where the scenery starts — comfortably outside the circuit's widest reach. */
const INNER = 13;

/** The DANGER sign's height as a fraction of its width. */
const DANGER_ASPECT = 0.25;

/**
 * DANGER in lit red glass, chevrons leaning in from each end — the same sign
 * THE STEP hangs on the club side of the portal (club/build.ts), redrawn
 * without its steel backing because out here there is nothing to bolt it to.
 *
 * Two passes for the word and the strokes alike: a wide halo under a crisp
 * core. That is what makes a canvas read as a gas tube rather than as red
 * paint, and it is the one trick every neon in this building uses.
 */
function dangerTexture(): CanvasTexture {
  const W = 1024;
  const H = Math.round(W * DANGER_ASPECT);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);

  const red = '#ff2233';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The word has to FIT between the chevrons. Sized off the canvas height
  // and then measured, because a tracked-out 'DANGER' at the club sign's
  // proportions runs straight under the strokes on a wider board and comes
  // out reading '⟪ANGE⟫'.
  g.font = font(700, Math.round(H * 0.5));
  g.letterSpacing = '14px';
  g.shadowColor = red;
  g.shadowBlur = H * 0.5;
  g.fillStyle = red;
  g.fillText('DANGER', W / 2, H / 2 + 1);
  g.shadowBlur = H * 0.16;
  g.fillStyle = '#ffd9d9';
  g.fillText('DANGER', W / 2, H / 2 + 1);
  g.shadowBlur = 0;
  g.letterSpacing = '0px';

  g.strokeStyle = red;
  g.lineWidth = Math.max(2, H * 0.07);
  g.lineCap = 'round';
  g.shadowColor = red;
  g.shadowBlur = H * 0.3;
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1] as const) {
      const x = W / 2 + side * (W * 0.36 + i * H * 0.22);
      g.beginPath();
      g.moveTo(x - side * H * 0.14, H * 0.24);
      g.lineTo(x + side * H * 0.06, H / 2);
      g.lineTo(x - side * H * 0.14, H * 0.76);
      g.stroke();
    }
  }
  g.shadowBlur = 0;

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class CourseVoidSystem extends createSystem({}) {
  private spectrum!: SpectrumSet;
  private danger!: Mesh;
  private dangerMat!: MeshBasicMaterial;
  private card!: Mesh;
  private cardMat!: MeshBasicMaterial;
  private clock = 0;
  private warning: Mesh | undefined;

  init(): void {
    const root = courseRoot();

    // ── the world: SPECTRUM, the raid's own, hung round the circuit — the
    // course's live kit IS its music, so the EQ wall plays what you step to.
    this.spectrum = new SpectrumSet(root, { floorIn: INNER, reflective: FLOOR_REFLECTS });
    this.spectrum.root.name = 'course-spectrum';
    this.spectrum.root.position.y = FLOOR_Y;
    this.spectrum.setActive(true);

    // THE ROOM CHECK — the only words in the whole place, dead ahead of the
    // home pad because that is the way you arrive facing.
    //
    // Everything else out here is learned by doing and is therefore not
    // written down: the floor's colours are the instruction, the invitation
    // is a circle of light on the ground, and stepping is a thing a body
    // already knows how to do. This one cannot be learned by doing — a body
    // that finds a real wall halfway through a step has been failed by the
    // experience rather than by the room — so it is said once, in as few
    // words as it can be said in, and then it goes.
    //
    // It goes for good on your first step. There was a second card here
    // that took over at that point and explained the route; it was four
    // lines of a manual for a game with no controls, in a place whose whole
    // argument is that it doesn't need one.
    //
    // The one thing it does still say is WHICH WAY. The circuit is a loop
    // with a direction — home, east, up, north, west, home (course/score.ts)
    // — and the first leg out of the pad runs to (2.60, 0, −1.20) while you
    // arrive facing −z, which puts it on your right. Nothing else in the
    // view says so until the invitation lights up on the floor a beat
    // later, and that is a circle on the ground you have to be looking down
    // to find. A body that turns the wrong way off the pad has been failed
    // by the room in the same way the space check exists to prevent, so it
    // is said in the same place, once, and it leaves with the card.
    const room = panelTexture({
      title: 'CLEAR 1.8 × 1.8 m',
      lines: ['STAND IN THE MIDDLE AND RECENTRE'],
      way: 'right',
      width: 2.5,
      accent: PALETTE.cyan,
      color: '#dcf1ff',
    });
    // Single-sided: it faces the pad, and mirror writing seen from the air
    // is worse than a card that simply isn't there from behind.
    this.cardMat = new MeshBasicMaterial({
      map: room.tex,
      transparent: true,
      depthWrite: false,
    });
    this.card = new Mesh(new PlaneGeometry(2.5, 2.5 * room.aspect), this.cardMat);
    this.card.position.set(0, 1.6, -2.5);
    // OVER THE AIR. The void's glow layers (shafts, horizon, dust) are
    // transparent and carry render orders of their own, so a card left at
    // zero got sorted among them and had haze blended over its lower half
    // — which is exactly where the words sit, and why the bottom line read
    // as grey while the title stayed sharp. The only writing in the place
    // draws last.
    this.card.renderOrder = 24;
    root.add(this.card);

    // DANGER, hung over the room check.
    //
    // THE STEP wears one of these on the club side of the portal, and the
    // reasoning carries through the door: a doorway with moving ground
    // behind it has earned a warning, and a warning is allowed to be a
    // word. What the card below it says is a room instruction — clear the
    // space, stand in it, recentre. What this says is why that instruction
    // is not advice. They belong together, so they arrive and leave together.
    //
    // No backing plate and no drop rods, unlike the club's: there is no
    // ceiling out here to hang anything from, and the void kit's whole law
    // is that darkness is given shape by LIGHT ONLY. So it is lit gas in
    // mid-air — the one red thing in a place of cyan and magenta, which is
    // exactly the job DECOR.danger does indoors.
    const cardH = 2.5 * room.aspect;
    const signW = 1.9;
    const signH = signW * DANGER_ASPECT;
    this.dangerMat = new MeshBasicMaterial({
      map: dangerTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false, // lit gas reads through the tone curve, like every neon here
    });
    this.danger = new Mesh(new PlaneGeometry(signW, signH), this.dangerMat);
    this.danger.renderOrder = 24;
    this.danger.position.set(0, 1.6 + cardH / 2 + 0.18 + signH / 2, -2.5);
    root.add(this.danger);
  }

  update(dt: number): void {
    if (!course.active) return;
    this.clock += dt;

    if (course.roomWarn && !this.warning) this.raiseRoomWarning();

    // The notice goes on your first step — by then you demonstrably have the
    // floor — and comes back for the next crossing, because that is a fresh
    // start and the room may be a different room.
    const want = G.handovers === 0 ? 1 : 0;
    this.cardMat.opacity += (want - this.cardMat.opacity) * Math.min(1, dt * 3);
    this.card.visible = this.cardMat.opacity > 0.01;
    // The warning is part of the same notice, so it goes when the notice
    // goes. A DANGER left hanging over nothing after the card beneath it has
    // faded would be a sign about the void in general, which is scenery — and
    // scenery that says DANGER is how a warning stops meaning anything.
    this.dangerMat.opacity = this.cardMat.opacity;
    this.danger.visible = this.card.visible;

    // Energy: the world ducks while the ground you own is counting itself
    // out — and harder still for the beat after a missed step, so the whole
    // void goes with the thud. Danger never competes with scenery.
    const target = G.slipFlash > 0
      ? ENERGY.slipped
      : G.groundLeaving
        ? ENERGY.ducked
        : Math.min(1, ENERGY.base + G.flow * ENERGY.flowBonus);
    G.energy += (target - G.energy) * Math.min(1, dt * ENERGY.ease);
    applyDim(G.energy);

    const beat = G.transport.bars * 4;
    const energy = G.energy;

    // The world plays the kit: laps open the acts, the record turns once
    // every sixteen bars, and `energy` carries the duck — danger dims it all.
    this.spectrum.update(dt, beat, Math.min(course.laps, 3), energy, {
      trackId: 'voidstep',
      title: 'VOIDSTEP',
      progress: ((G.transport.bars / 16) % 1 + 1) % 1,
      live: true,
    });
  }

  /** The play-area courtesy: say so, plainly, before the first ride. */
  private raiseRoomWarning(): void {
    const { w, d } = course.roomWarn!;
    this.warning = textPanel({
      title: 'ROOM CHECK',
      lines: [
        `this play area reads ${w.toFixed(1)} × ${d.toFixed(1)} m`,
        'steps may land past your boundary',
      ],
      width: 1.7,
      color: '#ffd6a0',
      accent: 0xffb000,
    });
    // Beside the room check, not behind you: a warning you have to turn
    // round to find is a warning nobody reads.
    this.warning.position.set(2.1, 1.35, -2.1);
    this.warning.rotation.y = -Math.PI / 6;
    courseRoot().add(this.warning);
  }
}
