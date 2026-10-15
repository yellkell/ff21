/**
 * IntroSystem — the store-game opening ritual, once per page load, the moment
 * the XR session opens: black, "yellkell.com PRESENTS" for three seconds, the
 * RAVE RAID marquee for three more, then the curtain lifts on the foyer with
 * the board already built behind it.
 *
 * Carried over from FIRE FIGHT's boot intro (iron-balls-boxing,
 * src/experience/BootIntro.ts), including the parts that are easy to get
 * wrong:
 *
 *  - The SHADE is head-locked. A featureless black cover has to follow the
 *    view or turning your head breaks the blackout — and being featureless,
 *    the locking is imperceptible.
 *  - The CARDS are WORLD-LOCKED: planted once, ahead of wherever the player
 *    happens to face as the session opens, so they hold still like a cinema
 *    screen. Head-locked type is a VR-comfort anti-pattern — you notice it
 *    immediately, and it is the fastest way to make somebody take a headset
 *    off. The plant is refined once at 0.15s, because the first session pose
 *    can lag a frame or two and the cards are near-invisible that early.
 *  - The glow behind the marquee is LIVE planes breathing behind the card,
 *    not bloom baked into the canvas — the same treatment the venue's own
 *    signage gets, so the sign reads as lit rather than as a picture of a
 *    lit sign.
 *  - Nothing is hidden or paused behind the shade. The whole foyer keeps
 *    building, which is what makes the reveal instant.
 *  - Not skippable. It is six seconds.
 *
 * The show is timed off the WALL CLOCK, not accumulated frame deltas: a piece
 * of theatre has a running time and should not run fast on a machine dropping
 * frames. It is cued by main.ts from the same moment the web page gets out of
 * the way — NOT by watching `world.session`, which looks equivalent and is
 * not: the emulator holds a session from boot, so the show played to an empty
 * room and the player walked in on the last two seconds.
 */

import { createSystem } from '@iwsdk/core';
import {
  BackSide,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { match } from '../game/state.js';
import { glowTexture } from '../materials/glow.js';
import { font, onFontsReady } from '../ui/fonts.js';

/** Each card: 0.5s in, 2s hold, 0.5s out. */
const CARD = 3;
const FADE = 0.5;
/** …and then the curtain goes, revealing the foyer under it. */
const LIFT_AT = CARD * 2;
const LIFT_FOR = 0.7;
/** How far ahead of the opening gaze the screen is planted (metres). */
const SCREEN_AT = 2.6;

/** THE THROB — the landing page's own keyframes (0% → 6% swell, 6% → 12%
 *  dip, then a slow settle), one cycle per bar at 128 BPM. RAVE and RAID run
 *  it half a beat apart, so the two words trade the kick exactly as they do
 *  on the web page. */
const THROB_PERIOD = 1.875;
const THROB_OFFSET = 0.234;
function throb(t: number): number {
  const f = (((t / THROB_PERIOD) % 1) + 1) % 1;
  if (f < 0.06) return 1 + 0.045 * (f / 0.06);
  if (f < 0.12) return 1.045 - 0.055 * ((f - 0.06) / 0.06);
  return 0.99 + 0.01 * Math.min(1, (f - 0.12) / 0.16);
}

/** Per-card fade envelope, in that card's own local seconds. */
function envelope(t: number): number {
  if (t <= 0 || t >= CARD) return 0;
  if (t < FADE) return t / FADE;
  if (t > CARD - FADE) return (CARD - t) / FADE;
  return 1;
}

const _eye = new Vector3();
const _fwd = new Vector3();

/** main.ts rings `begin` when the player goes through the door; `at` is for
 *  headless captures, which need to know where the show is. */
export const introView: { begin?: () => void; at?: () => number } = {};

/** A canvas panel sized in world metres, re-inked when the house fonts land
 *  (the intro plays long before the woff2s are certain). */
function card(
  w: number,
  h: number,
  px: number,
  draw: (g: CanvasRenderingContext2D, W: number, H: number) => void,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const g = c.getContext('2d')!;
  const render = (): void => {
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    draw(g, c.width, c.height);
  };
  render();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  onFontsReady(() => {
    render();
    tex.needsUpdate = true;
  });
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
  );
  mesh.renderOrder = 10_003;
  return mesh;
}

export class IntroSystem extends createSystem({}) {
  private shade: Mesh<SphereGeometry, MeshBasicMaterial> | null = null;
  /** The world-locked screen: planted once, then left alone. */
  private screen: Group | null = null;
  private publisher!: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** RAVE and RAID are separate cards so each can throb on its own beat —
   *  one mesh could only ever pulse as a block. */
  private words: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private glow: Group | null = null;
  private glowMats: MeshBasicMaterial[] = [];

  private startedAt = 0;
  private cued = false;
  private done = false;
  private planted = false;

  init(): void {
    introView.begin = () => {
      if (!this.done) this.cued = true;
    };
    introView.at = () => (this.startedAt ? (performance.now() - this.startedAt) / 1000 : -1);
  }

  private build(): void {
    // THE SHADE — head-locked, and a sphere rather than a plane so it covers
    // the whole field however you turn. `transparent` at full opacity is
    // load-bearing: it moves the shade into the transparent pass, which
    // three draws after all opaque geometry. An opaque shade gets painted
    // over by every transparent thing in the foyer behind it, and the
    // curtain has to be the last draw of a scene we deliberately never hide.
    const shade = new Mesh(
      new SphereGeometry(6, 20, 14),
      new MeshBasicMaterial({
        color: 0x000000,
        side: BackSide,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    shade.renderOrder = 10_000;
    shade.name = 'live-intro-shade';
    this.scene.add(shade);
    this.shade = shade;

    const screen = new Group();
    screen.name = 'live-intro';

    // CARD ONE: the publisher plate. Plain, white, quiet — the silence over
    // it is where the room loop finishes decoding.
    this.publisher = card(2.4, 1.2, 1200, (g, W, H) => {
      g.font = font(600, 116);
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(255,255,255,0.45)';
      g.shadowBlur = 30;
      g.fillText('yellkell.com', W / 2, H / 2 - 26);
      g.shadowBlur = 0;
      g.font = font(500, 30);
      g.letterSpacing = '14px';
      g.fillStyle = '#9aa0a8';
      g.fillText('PRESENTS', W / 2, H / 2 + 82);
      g.letterSpacing = '0px';
    });
    screen.add(this.publisher);

    // CARD TWO: the marquee. The canvas carries LETTERING ONLY — chromatic
    // ghosts either side and a tight core bloom — and the big glow is live
    // planes breathing behind it.
    const word = (text: string, face: string, glowCss: string, l: string, r: string) =>
      card(3.4, 1.15, 1360, (g, W, H) => {
        g.font = font(700, 300);
        g.letterSpacing = '12px';
        g.fillStyle = l;
        g.fillText(text, W / 2 - 15, H / 2);
        g.fillStyle = r;
        g.fillText(text, W / 2 + 15, H / 2);
        g.shadowColor = glowCss;
        g.fillStyle = face;
        for (const blur of [40, 18]) {
          g.shadowBlur = blur;
          g.fillText(text, W / 2, H / 2);
        }
        g.shadowBlur = 0;
      });
    this.words = [
      word('RAVE', '#b9ffc4', 'rgba(54,224,90,0.95)', 'rgba(255,42,213,0.6)', 'rgba(79,183,255,0.5)'),
      word('RAID', '#ffd9f6', 'rgba(255,42,213,0.95)', 'rgba(54,224,90,0.55)', 'rgba(176,107,255,0.55)'),
    ];
    this.words[0].position.set(0, 0.48, 0.002);
    this.words[1].position.set(0, -0.44, 0.002);

    // The living glow: a wide haze and a hot core behind each word.
    this.glow = new Group();
    this.glowMats = [];
    for (const [i, w] of this.words.entries()) {
      for (const [size, colour] of [
        [3.4, i ? 0xff2ad5 : 0x36e05a],
        [2.1, i ? 0xff8fe4 : 0x9dffb4],
      ] as const) {
        const mat = new MeshBasicMaterial({
          map: glowTexture(),
          color: colour,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        });
        const plane = new Mesh(new PlaneGeometry(size, size * 0.5), mat);
        plane.position.set(0, w.position.y, 0);
        plane.renderOrder = 10_001 + this.glowMats.length;
        this.glowMats.push(mat);
        this.glow.add(plane);
      }
    }
    screen.add(this.glow, ...this.words);

    this.scene.add(screen);
    this.screen = screen;
    match.introUp = true; // the board underneath is off limits until the lift
  }

  /** Plant the screen ahead of the CURRENT gaze: eye height, yaw only (a
   *  downward glance must not tilt the screen into the floor). */
  private plant(): void {
    const screen = this.screen;
    if (!screen) return;
    this.camera.getWorldPosition(_eye);
    this.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    screen.position.copy(_eye).addScaledVector(_fwd, SCREEN_AT);
    screen.lookAt(_eye);
  }

  private finish(): void {
    this.done = true;
    match.introUp = false;
    for (const o of [this.screen, this.shade]) {
      o?.removeFromParent();
      o?.traverse((n) => {
        const m = (n as Mesh).material as MeshBasicMaterial | undefined;
        m?.map?.dispose();
        m?.dispose();
        (n as Mesh).geometry?.dispose();
      });
    }
    this.screen = null;
    this.shade = null;
    this.words = [];
    this.glowMats = [];
  }

  update(): void {
    if (this.done) return;
    if (!this.startedAt) {
      if (!this.cued) return;
      this.build();
      this.plant();
      this.startedAt = performance.now();
    }
    const screen = this.screen;
    const shade = this.shade;
    if (!screen || !shade) return;
    const t = (performance.now() - this.startedAt) / 1000;

    // The first real XR pose lands a frame or two in; re-plant while the
    // cards are still near-invisible, then never move them again.
    if (!this.planted && t >= 0.15) {
      this.planted = true;
      this.plant();
    }

    // Only the shade follows the head.
    this.camera.getWorldPosition(_eye);
    shade.position.copy(_eye);

    const lift = Math.max(0, Math.min(1, (t - LIFT_AT) / LIFT_FOR));
    if (lift > 0) match.introUp = false; // hand the menu back as the black goes
    shade.material.opacity = 1 - lift;
    this.publisher.material.opacity = envelope(t);

    const k = envelope(t - CARD) * (1 - lift);
    this.words.forEach((w, i) => {
      const phase = t - i * THROB_OFFSET;
      // The KICK punches once a bar and then sits still — faithful to the
      // landing page, but on a two-metre sign that reads as a sign that has
      // died. A slow breath underneath keeps it alive between the hits, the
      // way real neon never quite settles.
      const breath = Math.sin(phase * 1.9 + i * 1.1);
      w.material.opacity = k;
      w.scale.setScalar(throb(phase) * (1 + 0.012 * breath));
      w.material.color.setScalar(1 + 0.1 * breath);
    });
    // The signage's own breathing, gated by the card's fade.
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    const s = 0.93 + pulse * 0.14;
    this.glow?.scale.set(s, s, 1);
    this.glowMats.forEach((m, i) => {
      m.opacity = (i % 2 ? 0.55 : 0.4) * (0.72 + pulse * 0.5) * k;
    });

    if (t >= LIFT_AT + LIFT_FOR) this.finish();
  }
}
