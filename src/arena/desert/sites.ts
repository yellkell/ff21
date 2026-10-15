/**
 * THE SITES — three places in one desert (DESIGN.md §6.1).
 *
 * The desert used to be one clearing you never left: the same sign, the
 * same skull, the same skyline whether you were reading the wrap, boxing
 * a stranger or standing five abreast against a king. Now the SAME desert
 * has three sites, and the game walks you between them by what you're
 * doing:
 *
 *   TRAILHEAD  the lobby — the edge of GASKET. The signpost under its own
 *              buzzing lamp, the broken fence, a campfire burning low, a
 *              windmill turning against the last light, telegraph poles
 *              marching off toward town. Somewhere you'd wait.
 *   THE FLATS  a match — open ground, nothing to hide behind. The skull
 *              and a dead tree throwing the longest shadow in the game.
 *   BONEYARD   the campaign and every raid — where titans are broken. A
 *              ring of standing wreck-plates around the pit, oil drums
 *              burning, RUSTHOOK's own hook buried to the shank.
 *
 * Every piece is a SURFACE, not a facet: rounded river stones and worn
 * plates in the material kit's rock, rust, bark, bone and wood skins
 * (textures.ts), with enough segments that nothing reads as paper. No
 * litter — the brief was beautiful, not busy. Only ONE site is visible at
 * a time and each collapses to a few static draws; the living bits (fire,
 * the windmill) stay out of the merge. The far layer — sky, sun, terrain,
 * mesas — is shared and simply YAWED per site (SITE_YAW), so the sun band
 * and the skyline sit somewhere new too: the lobby's dying sun hangs to
 * your left, a match's rival stands backlit against it, and a raid's
 * titan is lit full in the face while the squad has the light at its back.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Shape,
  SphereGeometry,
  Sprite,
  TorusGeometry,
  Vector3,
} from 'three';
import { CONFIG } from './config.js';
import { makePaperDouble, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';
import { fence, signpost, skull } from './props.js';
import { barkMat, rockMat, rustMat, softSprite, woodMat } from './textures.js';
import { collapseStatic } from '../merge.js';
import { buildFlankBanks, registerStands } from './audience.js';
import { ARENA_GAP, ARENA_BOUNDS, RAID_RING_RADIUS } from '../../config.js';

export type DesertSite = 'trailhead' | 'flats' | 'boneyard';

/** How far the shared far layer turns for each site (radians about +y).
 *  The sun sits at azimuth (0.35, −0.94) unturned — ahead and to the right.
 *  0.75 swings it to the LEFT-front for the lobby (the TOWN board's side);
 *  0.36 puts it dead behind the far platform so a rival is backlit; the
 *  boneyard adds a half turn so it's behind the squad, on the titan. */
export const SITE_YAW: Record<DesertSite, number> = {
  trailhead: 0.75,
  flats: 0.36,
  boneyard: 0.36 + Math.PI,
};

export interface SiteSet {
  root: Group;
  update(delta: number, time: number): void;
}

const P = CONFIG.palette;

/** Ground height under a WORLD point when the far layer is yawed: the
 *  terrain lives in the far layer's frame, so un-turn the point first. */
function groundAt(x: number, z: number, yaw: number): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return desertHeight(x * c - z * s, x * s + z * c);
}

/* ── fire: crossed emissive tongues, a glow, embers, a guttering light ── */

interface Flame {
  group: Group;
  planes: Mesh[];
  glow: Sprite;
  light: PointLight | null;
  embers: Points;
  emberVel: Float32Array;
  base: number;
  seed: number;
}

/** A small fire: three crossed tongues that breathe and lean under a soft
 *  glow sprite, a spray of embers climbing out of it, and (optionally —
 *  lights are the one thing we ration) a warm point light that gutters
 *  with the flame. */
function makeFlame(scale: number, lit: boolean, seed: number): Flame {
  const group = new Group();
  const planes: Mesh[] = [];
  const tongue = new PlaneGeometry(0.5, 0.9).translate(0, 0.45, 0);
  const cols = ['#ff7a18', '#ffb347', '#ff4d12'];
  for (let i = 0; i < 3; i++) {
    const m = new Mesh(tongue, makePaperDouble(cols[i], 2.4 - i * 0.4));
    m.rotation.y = (i / 3) * Math.PI;
    m.scale.setScalar(scale * (1 - i * 0.18));
    group.add(m);
    planes.push(m);
  }
  const glow = new Sprite(softSprite('#ff8a2a', 0.55));
  glow.scale.set(1.6 * scale, 1.6 * scale, 1);
  glow.position.y = 0.45 * scale;
  group.add(glow);
  const n = 26;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.3 * scale;
    pos[i * 3 + 1] = Math.random() * 1.6 * scale;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.3 * scale;
    vel[i] = 0.3 + Math.random() * 0.5;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const embers = new Points(
    geo,
    new PointsMaterial({ color: 0xffa040, size: 0.035 * scale, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  embers.frustumCulled = false;
  group.add(embers);
  let light: PointLight | null = null;
  if (lit) {
    light = new PointLight(0xff8a2a, 6 * scale, 7 * scale, 2);
    light.position.y = 0.6 * scale;
    group.add(light);
  }
  return { group, planes, glow, light, embers, emberVel: vel, base: scale, seed };
}

function tickFlame(f: Flame, delta: number, time: number): void {
  const t = time * 9 + f.seed;
  f.planes.forEach((p, i) => {
    const k = 1 + Math.sin(t + i * 2.1) * 0.12 + Math.sin(t * 1.7 + i) * 0.08;
    p.scale.set(f.base * (1 - i * 0.18) * (1.05 - (k - 1) * 0.6), f.base * (1 - i * 0.18) * k, 1);
    p.rotation.z = Math.sin(t * 0.6 + i * 1.3) * 0.12;
  });
  const gutter = 0.85 + Math.sin(t * 1.3) * 0.08 + Math.sin(t * 3.1) * 0.07;
  if (f.light) f.light.intensity = 6 * f.base * gutter;
  f.glow.material.opacity = 0.55 * gutter;
  const pos = f.embers.geometry.attributes.position as BufferAttribute;
  const arr = pos.array as Float32Array;
  const top = 1.7 * f.base;
  for (let i = 0; i < f.emberVel.length; i++) {
    arr[i * 3 + 1] += f.emberVel[i] * f.base * delta;
    arr[i * 3] += Math.sin(time * 2 + i) * 0.15 * delta;
    if (arr[i * 3 + 1] > top) {
      arr[i * 3 + 1] = 0.1;
      arr[i * 3] = (Math.random() - 0.5) * 0.3 * f.base;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 0.3 * f.base;
    }
  }
  pos.needsUpdate = true;
}

/* ── shared pieces ─────────────────────────────────────────────────────── */

/** A rounded river stone: a fine sphere squashed and spun, in rock. */
function stone(rng: () => number, mat: MeshStandardMaterial, r: number): Mesh {
  const s = new Mesh(new SphereGeometry(r, 16, 12), mat);
  s.scale.set(1 + (rng() - 0.5) * 0.4, 0.62 + rng() * 0.2, 0.85 + (rng() - 0.5) * 0.3);
  s.rotation.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.4);
  return s;
}

/** A worn iron plate with a bevelled, softened edge (never a razor box). */
function plateGeometry(w: number, h: number, t: number): ExtrudeGeometry {
  const r = Math.min(0.12, w * 0.2, h * 0.2);
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3 });
  geo.translate(0, 0, -t / 2);
  return geo;
}

/* ── TRAILHEAD ─────────────────────────────────────────────────────────── */

/** A stone-ringed campfire: the lobby's hearth. */
function campfire(rng: () => number): { group: Group; flame: Flame } {
  const g = new Group();
  const rock = rockMat('#7a6a5c', { repeat: [2, 1], bumpScale: 0.03 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
    const r = 0.55 + rng() * 0.08;
    const s = stone(rng, rock, 0.11 + rng() * 0.05);
    s.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
    g.add(s);
  }
  const wood = barkMat('#4a3020', { repeat: [2, 1] });
  for (let i = 0; i < 4; i++) {
    const log = new Mesh(new CylinderGeometry(0.05, 0.06, 0.7, 12), wood);
    log.rotation.z = Math.PI / 2 - 0.5;
    log.rotation.y = (i / 4) * Math.PI * 2;
    log.position.set(0, 0.14, 0);
    g.add(log);
  }
  // Char + ember glow in the centre: an emissive disc under the flame.
  const bed = new Mesh(new CylinderGeometry(0.3, 0.34, 0.04, 24), makePaperDouble('#ff5a1a', 1.1));
  bed.position.y = 0.06;
  g.add(bed);
  const flame = makeFlame(0.8, true, 3.1);
  flame.group.position.y = 0.1;
  g.add(flame.group);
  return { group: g, flame };
}

/** An Aermotor-style windmill on a lattice tower, the fan free to spin. */
function windmill(): { group: Group; fan: Group } {
  const g = new Group();
  const steel = rustMat(0x6a5a4c, { roughness: 0.7 });
  const H = 9;
  // Four splayed legs + three rings of cross bracing.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new Mesh(new CylinderGeometry(0.05, 0.07, H, 8), steel);
    leg.position.set(Math.cos(a) * 0.65, H / 2, Math.sin(a) * 0.65);
    leg.lookAt(Math.cos(a) * 0.2, H, Math.sin(a) * 0.2);
    leg.rotateX(Math.PI / 2);
    g.add(leg);
  }
  for (const y of [2.2, 4.6, 7]) {
    const w = 1.3 - (y / H) * 0.9;
    for (let i = 0; i < 4; i++) {
      const bar = new Mesh(new BoxGeometry(w, 0.04, 0.04), steel);
      bar.position.set(0, y, 0);
      bar.rotation.y = (i / 4) * Math.PI * 2;
      bar.translateZ(w / 2);
      g.add(bar);
    }
  }
  // Platform, hub, and the fan.
  const deck = new Mesh(new BoxGeometry(0.9, 0.06, 0.9), steel);
  deck.position.y = H;
  g.add(deck);
  const fan = new Group();
  fan.position.set(0, H + 0.7, 0.55);
  const hub = new Mesh(new CylinderGeometry(0.14, 0.14, 0.2, 16), steel);
  hub.rotation.x = Math.PI / 2;
  fan.add(hub);
  const bladeMat = rustMat('#a89888', { roughness: 0.6 });
  const rim = new Mesh(new TorusGeometry(1.35, 0.025, 8, 48), steel);
  fan.add(rim);
  for (let i = 0; i < 14; i++) {
    const b = new Mesh(new BoxGeometry(0.28, 1.15, 0.015), bladeMat);
    b.position.y = 0.72;
    b.rotation.y = 0.55; // sail pitch
    const spoke = new Group();
    spoke.rotation.z = (i / 14) * Math.PI * 2;
    spoke.add(b);
    fan.add(spoke);
  }
  g.add(fan);
  // Tail vane, the length of the machine behind the hub.
  const boom = new Mesh(new BoxGeometry(0.05, 0.05, 1.6), steel);
  boom.position.set(0, H + 0.7, -0.4);
  g.add(boom);
  const vane = new Mesh(new BoxGeometry(0.02, 0.9, 0.7), bladeMat);
  vane.position.set(0, H + 0.85, -1.3);
  g.add(vane);
  g.traverse((o) => (o.castShadow = true));
  return { group: g, fan };
}

/** Telegraph poles marching off along a line — the road to town. */
function telegraphLine(n: number): Group {
  const g = new Group();
  const wood = woodMat(P.wood, { repeat: [1, 6] });
  for (let i = 0; i < n; i++) {
    const pole = new Group();
    const post = new Mesh(new CylinderGeometry(0.09, 0.12, 6.2, 12), wood);
    post.position.y = 3.1;
    const arm = new Mesh(new BoxGeometry(1.4, 0.1, 0.1), wood);
    arm.position.y = 5.7;
    const arm2 = arm.clone();
    arm2.position.y = 5.2;
    pole.add(post, arm, arm2);
    pole.position.z = -i * 7;
    pole.rotation.z = (i % 2 ? 1 : -1) * 0.02;
    g.add(pole);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** The hooded lamp over the GASKET sign — the one lit thing at the
 *  trailhead besides the fire. Its light is the sign's, so it's real.
 *
 *  The shade is a proper SHADE: a wide mouth facing down over the bulb,
 *  double-sided so you see the lit inside of it from below, capped at the
 *  crown and hung off a gooseneck that reaches out over the board. (It
 *  used to be an open cone flipped apex-down — a spike with the bulb
 *  hanging out the bottom of it, and see-through from every angle but
 *  one.)
 *
 *  And the gooseneck hangs off a STANDPIPE. The sign's post (props.ts
 *  signpost) stops at 2.2 m, well under the arm, and the arm's stub was
 *  drawn where a taller post would have been — so the whole lamp hung in
 *  mid-air beside the board, joined to nothing. A pipe now carries on up
 *  from the top of the post to the arm, and the arm's drop is aimed at
 *  the shade's crown rather than laid alongside it. */
function signLamp(): { group: Group; light: PointLight; bulb: Mesh } {
  const g = new Group();
  const steel = rustMat(0x4c4440, { roughness: 0.75 });
  const X = 0.62; // out over the board, not past its end
  const Y = 2.66; // clear of the sign's top edge
  // THE STANDPIPE: up from the post's top (props.ts: a 0.14 m square post
  // at x −0.05, z −0.12, 2.2 m tall) to the arm, with a collar at the joint.
  const POST_TOP = 2.2;
  const PX = -0.05;
  const PZ = -0.12;
  const armY = Y + 0.2;
  const riser = new Mesh(new CylinderGeometry(0.03, 0.038, armY - POST_TOP + 0.06, 10), steel);
  riser.position.set(PX, (POST_TOP + armY) / 2 + 0.02, PZ);
  const collar = new Mesh(new CylinderGeometry(0.05, 0.05, 0.05, 12), steel);
  collar.position.set(PX, armY, PZ);
  // THE GOOSENECK: a stub off the standpipe, an elbow, and the drop the
  // shade hangs from — one bent arm, every piece touching the next.
  const stub = new Mesh(new CylinderGeometry(0.022, 0.022, 0.42, 10), steel);
  stub.rotation.z = Math.PI / 2;
  stub.position.set(PX + 0.21, armY, PZ);
  const elbowAt = new Vector3(PX + 0.42, armY, PZ);
  const elbow = new Mesh(new SphereGeometry(0.032, 10, 8), steel);
  elbow.position.copy(elbowAt);
  // The drop runs from the elbow to the shade's crown, wherever that is in
  // three dimensions — not a rod rotated in one plane and left short.
  const crownAt = new Vector3(X, Y + 0.11, 0);
  const drop = crownAt.clone().sub(elbowAt);
  const reach = new Mesh(new CylinderGeometry(0.02, 0.02, drop.length(), 10), steel);
  reach.position.copy(elbowAt).addScaledVector(drop, 0.5);
  reach.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), drop.clone().normalize());
  // THE SHADE: a tall cone, mouth down over the bulb — steel outside, and
  // a warm liner just inside it so from underneath you read a lit
  // reflector with the bulb hanging in it, not a flat disc.
  const shade = new Mesh(new ConeGeometry(0.17, 0.24, 24, 1, true), steel.clone());
  (shade.material as MeshStandardMaterial).side = DoubleSide;
  shade.position.set(X, Y, 0);
  const liner = new Mesh(new ConeGeometry(0.158, 0.222, 24, 1, true), makePaperDouble('#ffcf96', 0.5));
  liner.position.set(X, Y - 0.004, 0);
  const cap = new Mesh(new SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  cap.position.set(X, Y + 0.1, 0);
  // The bulb, tucked up INSIDE the mouth so the glow spills, not glares.
  const bulb = new Mesh(new SphereGeometry(0.042, 12, 9), makePaperDouble('#ffd9a0', 1.8));
  bulb.position.set(X, Y - 0.05, 0);
  // The light sits at the mouth, throwing down the board — short reach so
  // it lights the sign and the sand under it, not half the trailhead.
  const light = new PointLight(0xffc27a, 3.2, 4.2, 2);
  light.position.set(X, Y - 0.14, 0.02);
  g.add(riser, collar, stub, elbow, reach, shade, liner, cap, bulb, light);
  return { group: g, light, bulb };
}

function buildTrailhead(yaw: number): SiteSet {
  const root = new Group();
  root.name = 'site-trailhead';
  root.visible = false;
  const rng = makeRng(CONFIG.terrain.seed * 31 + 7);
  const statics = new Group();
  const place = (o: Object3D, x: number, z: number, ry: number, into: Object3D = statics): void => {
    o.position.set(x, groundAt(x, z, yaw), z);
    o.rotation.y = ry;
    into.add(o);
  };

  // The sign, now with its lamp, clear of the raid arc as before.
  const sign = signpost();
  sign.name = 'gasket-sign'; // named so headless probes can look at it
  const lamp = signLamp();
  sign.add(lamp.group);
  place(sign, 8.2, -2.0, -0.85, root); // the lamp flickers: keep it live
  place(fence(), -7, 6, 0.3);
  // The hearth: left-front, four and a half metres out — beyond the wrap's
  // arc and the podium, close enough to warm the TOWN board's side.
  const fire = campfire(rng);
  place(fire.group, -4.6, -3.4, 0, root);
  // The windmill against the sun band (left-front once the far layer
  // turns), and the poles heading off the other way, toward town.
  const mill = windmill();
  place(mill.group, -19, -24, 0.4, root);
  place(telegraphLine(6), 14, -4, -0.6);

  collapseStatic(statics);
  root.add(statics);

  return {
    root,
    update(delta, time) {
      tickFlame(fire.flame, delta, time);
      mill.fan.rotation.z += delta * 0.9;
      // The lamp buzzes: a steady glow with a nervous flicker under it.
      const f = 0.9 + Math.sin(time * 37) * 0.04 + (Math.sin(time * 5.3) > 0.97 ? -0.35 : 0);
      lamp.light.intensity = 4.5 * f;
      (lamp.bulb.material as MeshStandardMaterial).emissiveIntensity = 3.2 * f;
    },
  };
}

/* ── THE FLATS ─────────────────────────────────────────────────────────── */

/** A dead tree: a leaning trunk forking into bare branches. */
function deadTree(rng: () => number): Group {
  const g = new Group();
  const bark = barkMat('#5a4030', { repeat: [1, 3] });
  const branch = (parent: Object3D, len: number, r: number, depth: number): void => {
    const m = new Mesh(new CylinderGeometry(r * 0.55, r, len, 12), bark);
    m.position.y = len / 2;
    const holder = new Group();
    holder.add(m);
    parent.add(holder);
    if (depth === 0) return;
    const kids = 2 + (rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const h = new Group();
      h.position.y = len * (0.55 + rng() * 0.4);
      h.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, 0.45 + rng() * 0.5);
      holder.add(h);
      branch(h, len * (0.55 + rng() * 0.2), r * 0.6, depth - 1);
    }
  };
  branch(g, 3.2, 0.22, 3);
  g.rotation.z = 0.12;
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function buildFlats(yaw: number): SiteSet {
  const root = new Group();
  root.name = 'site-flats';
  root.visible = false;
  const rng = makeRng(CONFIG.terrain.seed * 37 + 11);
  const statics = new Group();
  const place = (o: Object3D, x: number, z: number, ry: number): void => {
    o.position.set(x, groundAt(x, z, yaw), z);
    o.rotation.y = ry;
    statics.add(o);
  };
  place(skull(), -6.8, -1.6, 0.8);
  place(deadTree(rng), 7.6, 2.4, 0.3);
  // A second, smaller tree far out on the other side: the flats' only
  // verticals, and the longest shadows in the game.
  const far = deadTree(rng);
  far.scale.setScalar(0.7);
  place(far, -14, -11, 1.9);
  collapseStatic(statics);
  root.add(statics);
  // AUDIENCE GROUND (§3.2): standing terraces on both flanks, their lips a
  // stride outside the cage wall, looking in on the two platforms.
  {
    const { banks, stands } = buildFlankBanks(0, -ARENA_GAP / 2, ARENA_BOUNDS.halfWidth + 1.2, 0.62, (x, z) => groundAt(x, z, yaw));
    for (const bank of banks) root.add(bank);
    registerStands('flats', stands);
  }
  return { root, update: () => {} };
}

/* ── BONEYARD ──────────────────────────────────────────────────────────── */

/** A standing wreck-plate: a bevelled titan panel driven into the sand,
 *  one rib of structure still on its face. */
function wreckPlate(rng: () => number, mat: MeshStandardMaterial): Group {
  const g = new Group();
  const h = 3.4 + rng() * 2.6;
  const w = 1.4 + rng() * 1.2;
  const plate = new Mesh(plateGeometry(w, h, 0.18), mat);
  plate.position.y = h / 2 - 0.4;
  plate.rotation.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.25);
  g.add(plate);
  const rib = new Mesh(plateGeometry(0.14, h * 0.8, 0.1), mat);
  rib.position.set((rng() - 0.5) * w * 0.6, h / 2 - 0.4, 0.14);
  rib.rotation.copy(plate.rotation);
  g.add(rib);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** An oil drum with a fire in it. */
function burningDrum(lit: boolean, seed: number): { group: Group; flame: Flame } {
  const g = new Group();
  const drum = new Mesh(new CylinderGeometry(0.3, 0.3, 0.9, 28, 1, true), rustMat(0x5a3a2c, { roughness: 0.8, repeat: [3, 1] }));
  drum.position.y = 0.45;
  g.add(drum);
  const band = rustMat(0x3a2820, { roughness: 0.85 });
  for (const y of [0.15, 0.75]) {
    const ring = new Mesh(new TorusGeometry(0.31, 0.02, 8, 28), band);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  const flame = makeFlame(0.6, lit, seed);
  flame.group.position.y = 0.75;
  g.add(flame.group);
  return { group: g, flame };
}

/** RUSTHOOK's hook, buried to the shank — the boneyard's monument. */
function buriedHook(): Group {
  const g = new Group();
  const mat = rustMat(0x5a4736, { roughness: 0.66, repeat: [4, 1] });
  const bend = new Mesh(new TorusGeometry(1.7, 0.28, 14, 56, Math.PI * 1.15), mat);
  bend.rotation.set(0, 0, -0.3);
  bend.position.y = 0.6;
  g.add(bend);
  const shank = new Mesh(new CylinderGeometry(0.26, 0.3, 3.2, 18), mat);
  shank.position.set(1.7, -0.6, 0);
  shank.rotation.z = -0.3;
  g.add(shank);
  const tip = new Mesh(new ConeGeometry(0.28, 0.9, 18), mat);
  tip.position.set(-1.05, 1.95, 0);
  tip.rotation.z = -1.2;
  g.add(tip);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function buildBoneyard(yaw: number): SiteSet {
  const root = new Group();
  root.name = 'site-boneyard';
  root.visible = false;
  const rng = makeRng(CONFIG.terrain.seed * 41 + 13);
  const statics = new Group();
  // Everything clears THE SQUAD'S RING. Every client stands at the origin
  // facing the pit at (0, −6) and sees its teammates on the circle of
  // radius 6 around THAT PIT, on any bearing up to ±144° from its own
  // (combat/layout.ts) — so the far raider can stand nearly straight
  // across the pit, eleven metres out. Nothing that stands up may be
  // inside 9.5 m of the pit's centre. The wreck ring used to be centred
  // on the ORIGIN at 12.5 m, which put its back plates two metres behind
  // the far raider's platform: a wall in that player's face. It is
  // centred on the pit now, at 14 m, and the front (+z, where you stand
  // and the lobby-to-fight cut lands) stays open.
  const PIT_X = 0;
  const PIT_Z = -RAID_RING_RADIUS;
  const KEEP_CLEAR = 9.5;
  const place = (o: Object3D, x: number, z: number, ry: number, into: Object3D = statics): void => {
    const d = Math.hypot(x - PIT_X, z - PIT_Z);
    if (d < KEEP_CLEAR) console.warn(`[boneyard] a prop at (${x.toFixed(1)}, ${z.toFixed(1)}) stands ${d.toFixed(1)} m from the pit — inside the squad's ring`);
    o.position.set(x, groundAt(x, z, yaw), z);
    o.rotation.y = ry;
    into.add(o);
  };
  const plates = [
    rustMat(0x5a4736, { roughness: 0.62 }),
    rustMat(0x474b55, { roughness: 0.6 }),
    rustMat(0x4a4256, { roughness: 0.7 }),
  ];
  const ring = 14;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8 - 0.5) * Math.PI * 1.35; // the whole way round but the front
    const r = ring + (rng() - 0.5) * 2.4;
    const x = PIT_X + Math.sin(a) * r;
    const z = PIT_Z + Math.cos(a) * r;
    place(wreckPlate(rng, plates[i % plates.length]), x, z, -a + (rng() - 0.5) * 0.5);
  }
  place(buriedHook(), -15, -15, 0.6);
  // Drums: two LIT (the light budget), two just burning.
  const drums = [
    burningDrum(true, 1.7),
    burningDrum(true, 4.2),
    burningDrum(false, 8.8),
    burningDrum(false, 12.4),
  ];
  place(drums[0].group, -9.6, -3.2, 0, root);
  place(drums[1].group, 9.6, -3.2, 0, root);
  place(drums[2].group, -7.4, 6.5, 0, root);
  place(drums[3].group, 7.6, 6.2, 0, root);
  collapseStatic(statics);
  root.add(statics);
  // AUDIENCE GROUND: the terraces flank the ring, outside the seats' arc
  // and short of the wreck plates, looking down on the pit and the squad.
  {
    const { banks, stands } = buildFlankBanks(0, -RAID_RING_RADIUS, RAID_RING_RADIUS + 5.2, 0.5, (x, z) => groundAt(x, z, yaw));
    for (const bank of banks) root.add(bank);
    registerStands('boneyard', stands);
  }
  return {
    root,
    update(delta, time) {
      for (const d of drums) tickFlame(d.flame, delta, time);
    },
  };
}

/* ── the set ───────────────────────────────────────────────────────────── */

export function buildSites(): Record<DesertSite, SiteSet> {
  return {
    trailhead: buildTrailhead(SITE_YAW.trailhead),
    flats: buildFlats(SITE_YAW.flats),
    boneyard: buildBoneyard(SITE_YAW.boneyard),
  };
}
