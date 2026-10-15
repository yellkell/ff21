/**
 * THE BALL — how a raid is called from the club floor.
 *
 * Someone calls it (from the SOCIAL panel or the board) and a mirror ball
 * is winched down out of the ceiling to hang in front of them for sixty
 * seconds, turning slowly, wearing a countdown plate: the song (or the
 * fight — THE BELL, club/bell.ts), who called it, the seconds left, and
 * who has touched in — one orbiting pip per
 * dancer, in their colour. TOUCH the
 * ball (hand close + trigger) to join the set; touch again to step back
 * out; the caller's touch waves it away. When the relay's clock runs out,
 * the caller and everyone holding a pip leave for the ring together — and
 * the floor keeps dancing without them.
 *
 * This module is the ball's body: the mesh kit and the spawn math.
 * ClubBallSystem drives it from net.ball.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { PALETTE, hueToColor } from '../config.js';
import { glintTexture, glowSprite } from '../materials/glow.js';
import { trackById } from '../audio/tracks.js';
import { CLUB } from './config.js';
import { fightLabel, type BellMode } from './bell.js';
import { font } from '../ui/fonts.js';

export const BALL_TOUCH_RADIUS = 0.42;

/** Where a called ball hangs: ahead of the caller's head, chest-high,
 *  clamped into the hall so it never spawns inside the bar or a wall — and
 *  clear of the menu board's airspace, so the plate is never hidden behind
 *  the menus for the very dancer who called it. */
export function ballSpawnPos(head: Vector3, fwd: Vector3): [number, number, number] {
  const fx = fwd.x;
  const fz = fwd.z;
  const len = Math.hypot(fx, fz) || 1;
  let x = head.x + (fx / len) * 1.35;
  let z = head.z + (fz / len) * 1.35;
  x = Math.max(-CLUB.halfW + 1.2, Math.min(CLUB.bar.x - 1.0, x));
  z = Math.max(CLUB.minZ + 2.4, Math.min(CLUB.quiet.minZ - 0.6, z));
  // The board floats at (0, 1.42, −1.6): a ball called from the spawn would
  // hang right behind it. Slide such a ball out past the board's edge.
  if (Math.abs(x) < 1.3 && z > -2.7 && z < -0.7) {
    x = x >= 0 ? 1.6 : -1.6;
  }
  return [x, 1.5, z];
}

/** The dome's crown: over the middle of the floor the ball drops from the
 *  top tier of the white dome (build_club.py DOME: r 3.0 at 5.6 m). */
const CROWN_R = 3.0;

/**
 * Where the cable that lowers THE BALL is anchored — the local ceiling
 * over a spot on the floor. The corner rooms cap at door height, the
 * dome's crown covers the middle of the floor, its first tread the
 * floor's rim, and the
 * main slab takes the rest of the hall.
 */
export function ballAnchor(x: number, z: number): { y: number; bare: boolean } {
  for (const r of [CLUB.quiet, CLUB.arcade, CLUB.step]) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return { y: CLUB.roomCeilH, bare: false };
  }
  const d = Math.hypot(x - CLUB.floor.x, z - CLUB.floor.z);
  if (d < CROWN_R) return { y: CLUB.domeH, bare: false };
  if (d < 3.3) return { y: CLUB.ceilH + 0.55, bare: false }; // the dome's first tread
  return { y: CLUB.ceilH, bare: false };
}

export interface BallVisual {
  group: Group;
  /** Spin this. */
  ball: Mesh;
  /** The GLIMMER: facet glints popping and dying across the ball's skin.
   *  Call every frame — the sparks ride the sphere, so the spin carries
   *  them round the room the way a real mirror ball throws its dots. */
  twinkle(dt: number): void;
  /** THE CABLE: stretch the stem from the ball's crown to `len` metres up
   *  (group-local), so the ball visibly hangs from the ceiling it was
   *  lowered out of, wherever the group currently is on its way. */
  setCable(len: number): void;
  /** The countdown/track/joins plate under the ball (yaw-billboard it). */
  plate: Mesh;
  /** Repaint the plate. */
  paint(opts: {
    seconds: number;
    /** What the ball calls: 'rave' reads the record; a fight reads its name. */
    mode: BellMode;
    /** A titan raid called HARDCORE — the plate says so under the fight. */
    hardcore?: boolean;
    trackId: string;
    callerName: string;
    joinNames: string[];
    mine: boolean;
    joined: boolean;
    inReach: boolean;
  }): void;
  /** One orbiting pip per joined dancer, tinted their hue. */
  /** One pip per dancer touched in, each in the hue that dancer wears. */
  setPips(hues: number[]): void;
  dispose(): void;
}

export function buildBallVisual(): BallVisual {
  const group = new Group();
  group.name = 'raid-ball';

  // The mirror ball itself — painted facets (nothing to reflect in a
  // procedural room), a hot core halo, and the cable it is winched down
  // on (setCable stretches this stub to the ceiling every frame).
  const facets = document.createElement('canvas');
  facets.width = facets.height = 128;
  const fg = facets.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const glint = Math.random();
      const l = glint > 0.86 ? 96 : 50 + Math.floor(glint * 30);
      fg.fillStyle = `hsl(${210 + glint * 40}, 20%, ${l}%)`;
      fg.fillRect(x * 8, y * 8, 7, 7);
    }
  }
  const ballTex = new CanvasTexture(facets);
  ballTex.colorSpace = SRGBColorSpace;
  const ball = new Mesh(new SphereGeometry(0.24, 18, 12), new MeshBasicMaterial({ map: ballTex, color: PALETTE.mirror }));
  group.add(ball);
  const stem = new Mesh(
    new CylinderGeometry(0.008, 0.008, 0.5, 6),
    new MeshStandardMaterial({ color: 0x22262e, metalness: 0.8, roughness: 0.4 }),
  );
  stem.position.y = 0.49;
  group.add(stem);
  // The unit stem spans 0.24..0.74 (ball crown upward); setCable rescales
  // that span to reach the anchor.
  const setCable = (len: number): void => {
    const l = Math.max(0.02, len);
    stem.scale.y = l / 0.5;
    stem.position.y = 0.24 + l / 2;
  };
  group.add(glowSprite(0xffffff, 0.9, 0.4));

  // THE GLIMMER — a handful of four-point lens glints living on the facet
  // skin. Each one waits, then flares somewhere new: a fast bloom-and-die
  // over a few tenths of a second, in white with the odd champagne or
  // stage-cyan catch. Children of the BALL, not the group, so the spin
  // carries every live spark around the room — the closest thing a painted
  // mirror ball gets to actually throwing light.
  const GLINT_TINTS = [0xffffff, 0xffffff, 0xffffff, 0xffd24a, PALETTE.cyan];
  interface Glint {
    sprite: Sprite;
    /** Seconds until the next flare while dark; life left while lit. */
    wait: number;
    life: number;
    /** Full lifespan of the current flare (for the envelope). */
    span: number;
    peak: number;
  }
  const glints: Glint[] = [];
  for (let i = 0; i < 6; i++) {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: glintTexture(),
        color: 0xffffff,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.visible = false;
    ball.add(sprite);
    glints.push({ sprite, wait: 0.1 + Math.random() * 0.8, life: 0, span: 0, peak: 0 });
  }

  const twinkle = (dt: number): void => {
    for (const g of glints) {
      if (g.life > 0) {
        g.life -= dt;
        if (g.life <= 0) {
          g.sprite.visible = false;
          g.wait = 0.12 + Math.random() * 0.85;
          continue;
        }
        // sin envelope: snap up, soften out — a catch of light, not a lamp.
        const t = 1 - g.life / g.span;
        const env = Math.sin(Math.min(1, t) * Math.PI);
        g.sprite.scale.setScalar(g.peak * (0.35 + 0.65 * env));
        (g.sprite.material as SpriteMaterial).opacity = env;
        continue;
      }
      g.wait -= dt;
      if (g.wait > 0) continue;
      // Flare somewhere new on the sphere — biased to the upper half, where
      // the room's light would actually be striking the facets.
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 1.6 - 0.6);
      const r = 0.247;
      g.sprite.position.set(
        Math.cos(el) * Math.sin(az) * r,
        Math.sin(el) * r,
        Math.cos(el) * Math.cos(az) * r,
      );
      (g.sprite.material as SpriteMaterial).color.setHex(
        GLINT_TINTS[Math.floor(Math.random() * GLINT_TINTS.length)],
      );
      g.span = 0.22 + Math.random() * 0.3;
      g.life = g.span;
      g.peak = 0.09 + Math.random() * 0.1;
      g.sprite.visible = true;
    }
  };

  // The plate.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 300;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  const plate = new Mesh(
    new PlaneGeometry(0.78, 0.457),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }),
  );
  plate.position.y = -0.52;
  plate.renderOrder = 26;
  group.add(plate);

  // Join pips: parked hidden; setPips shows one per joined dancer.
  const pipHolder = new Group();
  group.add(pipHolder);
  const pips: Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    const pip = new Mesh(new SphereGeometry(0.028, 10, 8), new MeshBasicMaterial({ color: 0xffffff }));
    pip.visible = false;
    pipHolder.add(pip);
    pips.push(pip);
  }

  const paint: BallVisual['paint'] = ({ seconds, mode, hardcore, trackId, callerName, joinNames, mine, joined, inReach }) => {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 300);
    g.fillStyle = 'rgba(7,5,14,0.82)';
    g.beginPath();
    g.roundRect(4, 4, 504, 292, 26);
    g.fill();
    g.lineWidth = inReach ? 6 : 3;
    g.strokeStyle = inReach ? '#ffd24a' : 'rgba(255,42,213,0.8)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // The clock — the headline.
    g.font = font(700, 92);
    g.fillStyle = seconds <= 10 ? '#ffd24a' : '#f4f6fb';
    if (seconds <= 5) {
      g.shadowColor = '#ffd24a';
      g.shadowBlur = 26;
    }
    g.fillText(String(Math.max(0, seconds)), 256, 74);
    g.shadowBlur = 0;

    g.font = font(700, 30);
    if (mode === 'rave') {
      const track = trackById(trackId);
      g.fillStyle = '#4fb7ff';
      g.fillText(`♪ ${track ? track.title : 'SHUFFLE'}`, 256, 140);
    } else {
      // THE BELL: a fight on the ball wears hazard amber, the arena's own
      // colour for something about to happen.
      g.fillStyle = '#ffb03a';
      g.fillText(`⚔ ${fightLabel(mode)}${hardcore ? ' · HARDCORE' : ''}`, 256, 140);
    }
    g.font = font(600, 24);
    g.fillStyle = 'rgba(232,236,242,0.75)';
    // "hosts", not "calls": whoever sends the ball up is running that set,
    // and the floor reads the line as an invitation to someone's night —
    // the wire still calls them the caller, because that is what they did.
    g.fillText(`${callerName} hosts`, 256, 176);

    // One short state line — the touch teaches the rest.
    g.font = font(700, 26);
    if (mine) {
      g.fillStyle = '#ff5040';
      g.fillText('touch to call it off', 256, 218);
    } else if (joined) {
      g.fillStyle = '#36e05a';
      g.fillText('ON — touch to step out', 256, 218);
    } else {
      g.fillStyle = '#ffd24a';
      g.fillText(mode === 'rave' ? 'touch to dance' : 'touch to ride along', 256, 218);
    }

    if (joinNames.length) {
      g.font = font(600, 22);
      g.fillStyle = 'rgba(232,236,242,0.6)';
      const names = joinNames.slice(0, 6).join(' · ');
      const extra = joinNames.length > 6 ? ` +${joinNames.length - 6}` : '';
      g.fillText(`${names}${extra}`, 256, 258, 480);
    }
    tex.needsUpdate = true;
  };

  const setPips: BallVisual['setPips'] = (hues) => {
    pips.forEach((pip, i) => {
      const hue = hues[i];
      if (hue === undefined) {
        pip.visible = false;
        return;
      }
      const a = (i / Math.max(1, hues.length)) * Math.PI * 2;
      pip.position.set(Math.sin(a) * 0.34, 0.02, Math.cos(a) * 0.34);
      (pip.material as MeshBasicMaterial).color.setHex(hueToColor(hue, 0.62));
      pip.visible = true;
    });
    pipHolder.visible = hues.length > 0;
  };

  return {
    group,
    ball,
    twinkle,
    setCable,
    plate,
    paint,
    setPips,
    dispose() {
      group.removeFromParent();
      ballTex.dispose();
      tex.dispose();
      group.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshBasicMaterial)?.dispose?.();
      });
    },
  };
}
