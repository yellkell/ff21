/**
 * ClubMirrorSystem — the pier glass on the club's north wall, and the only
 * place in the game you can see your own body.
 *
 * The trick is theatre, not render-to-texture: behind the glass is a dark
 * recess (built with the club), and this system stands mirrored figures in
 * it. Geometry mirrors are stereo-correct in VR for free, which a Reflector
 * render-to-texture is not, and they cost nothing when nobody's looking.
 *
 * THE SECOND CUT of this system is about what a reflection COSTS. The first
 * built a whole second rig per figure and solved it every frame from a
 * hand-swapped copy of the pose, rebuilt it on every hue or look change,
 * and lit the recess with a PointLight it switched on as you approached —
 * and a light toggled in a forward renderer is a light count change, which
 * recompiles every lit material in the building on the frame you turn to
 * face the glass. None of that survives:
 *
 *  - A room-mate's reflection is a SHADOW of their live puppet: every mesh
 *    gets a twin sharing its geometry, and each frame the twin's world
 *    matrix is the puppet's, multiplied through the reflection across the
 *    wall plane. No second solve, no second pose, and whatever the puppet
 *    wears — paint, gear, the crown, a raised glowstick — is in the glass
 *    because it IS the puppet's geometry. (Three flips face winding for a
 *    negative-determinant matrix by itself.) The one figure still SOLVED
 *    is your own, because there is no live rig of you in the room to
 *    shadow — and it is shadowed the same way from a private source rig
 *    that never enters the scene.
 *  - The twins wear UNLIT materials: the source's colour dimmed toward
 *    smoke plus whatever it was emitting, clipped at the pane. A smoked
 *    mirror shows a dim, flat image, so this is not a compromise, it is
 *    the look — and it needs no light at all. The recess light is gone.
 *  - Chirality is honest now (a true reflection, not swapped hands),
 *    which nobody will notice either, in the other direction.
 *
 * Performance stays the design: the glass SLEEPS as near-black smoke until
 * your head is within CLUB.mirror.range of it. Asleep: nothing is posed,
 * nothing is walked, the recess contents are hidden — the whole feature is
 * one tinted quad. Awake: one solve (yours), one matrix walk per figure in
 * range, up to maxFigures. Reflections beyond reflectRange simply aren't
 * cast (the murk swallows the boundary).
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { mirrorRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { buildCoupe, type CoupeRefs } from '../club/props.js';
import { myHandFlags } from '../club/fingerGun.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/blankDancer.js';
import { customization, myGear, myTone } from '../../menu/customization.js';
import { myLook, paintState } from '../../avatar/paint.js';
import { danceHue } from '../game/profile.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { memberHue, net, inRoom } from '../net/session.js';
import { liveGlasses } from './ClubPropsSystem.js';
import { clubFloorFigures } from './ClubSocialSystem.js';

const _v = new Vector3();
const _q = new Quaternion();
const _fwd = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');

/** How fast the smoke thins/thickens (per-second exponential chase). */
const WAKE_RATE = 6;
/** Pane opacity: asleep (black glass) → awake (light smoke over the room). */
const SMOKE_ASLEEP = 0.93;
const SMOKE_AWAKE = 0.1; // a clean glass: the hall behind it is mirrored live (club/build.ts)
/** How much of a source's own colour survives the smoke, and how much of
 *  what it emits. A smoked mirror is a dim mirror. */
const SMOKE_COLOR = 0.62;
const SMOKE_EMIT = 0.85;

/**
 * The glass, as a clipping plane: keep everything at or BEHIND z = the
 * north wall, discard the rest. A reflection stands as deep as you are
 * far, so pressing up to the pane brings its toes out through the glass
 * and into the room — the one thing that cannot be allowed to happen to a
 * mirror. Clipping is the guarantee.
 */
const GLASS_CLIP = [new Plane(new Vector3(0, 0, -1), CLUB.minZ)];

/** The reflection across the pane, z = glassZ: T(glassZ) · S(1,1,−1) · T(−glassZ). */
function reflectionAcross(glassZ: number): Matrix4 {
  const m = new Matrix4();
  m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 2 * glassZ, 0, 0, 0, 1);
  return m;
}

/** A Y-flip through π, for the coupes (their orientation is written by
 *  hand rather than shadowed). */
const Y_FLIP = new Quaternion(0, 1, 0, 0);

interface Twin {
  src: Object3D;
  twin: Object3D;
}

/** One figure's reflection: the twins of its source's meshes. */
interface Shadow {
  source: Object3D;
  root: Object3D;
  twins: Twin[];
  /** How many drawables the source had when the twins were made — a new
   *  one (the crown, built lazily on first wear) means rebuild. */
  count: number;
  materials: Material[];
}

/** The unlit twin of a lit material: the source's colour dimmed toward
 *  smoke plus what it was emitting, same maps, same transparency, clipped
 *  at the pane. */
function smokedMaterial(src: Material): Material {
  if ((src as SpriteMaterial).isSpriteMaterial) {
    const s = src as SpriteMaterial;
    const m = new SpriteMaterial({
      map: s.map,
      color: s.color.clone().multiplyScalar(SMOKE_EMIT),
      transparent: true,
      opacity: s.opacity * 0.8,
      blending: s.blending,
      depthWrite: false,
    });
    m.clippingPlanes = GLASS_CLIP;
    return m;
  }
  const s = src as MeshStandardMaterial;
  const m = new MeshBasicMaterial({
    map: s.map ?? null,
    transparent: s.transparent,
    opacity: s.opacity,
    side: s.side,
    depthWrite: s.depthWrite,
    blending: s.blending,
  });
  m.color.copy(s.color).multiplyScalar(SMOKE_COLOR);
  if (s.emissive) {
    const k = (s.emissiveIntensity ?? 1) * SMOKE_EMIT;
    m.color.r = Math.min(1, m.color.r + s.emissive.r * k);
    m.color.g = Math.min(1, m.color.g + s.emissive.g * k);
    m.color.b = Math.min(1, m.color.b + s.emissive.b * k);
  }
  m.clippingPlanes = GLASS_CLIP;
  return m;
}

/** Is `o` still in `root`'s tree (not removed with an old gear piece)? */
function isUnder(o: Object3D, root: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

function countDrawables(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh || (o as Sprite).isSprite) n++;
  });
  return n;
}

/** Twin every drawable under `source`. The twins are flat under one root
 *  (no hierarchy — their matrices are written directly). */
function buildShadow(source: Object3D, into: Object3D): Shadow {
  const root = new Mesh();
  root.name = 'mirror-shadow';
  root.matrixAutoUpdate = false;
  const twins: Twin[] = [];
  const materials: Material[] = [];
  source.traverse((o) => {
    let twin: Object3D | null = null;
    if ((o as Mesh).isMesh) {
      const mesh = o as Mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material.map(smokedMaterial) : smokedMaterial(mesh.material);
      const t = new Mesh(mesh.geometry, mat);
      t.renderOrder = mesh.renderOrder;
      for (const m of Array.isArray(mat) ? mat : [mat]) materials.push(m);
      twin = t;
    } else if ((o as Sprite).isSprite) {
      const sprite = o as Sprite;
      const mat = smokedMaterial(sprite.material) as SpriteMaterial;
      const t = new Sprite(mat);
      t.renderOrder = sprite.renderOrder;
      materials.push(mat);
      twin = t;
    }
    if (!twin) return;
    twin.matrixAutoUpdate = false;
    twin.matrixWorldAutoUpdate = false;
    twin.frustumCulled = false;
    root.add(twin);
    twins.push({ src: o, twin });
  });
  into.add(root);
  return { source, root, twins, count: twins.length, materials };
}

function disposeShadow(s: Shadow): void {
  s.root.removeFromParent();
  for (const m of s.materials) m.dispose();
}

/** buildCoupe() hands back a Group with no disposer of its own. */
function disposeCoupe(cup: CoupeRefs): void {
  cup.root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
  });
  cup.root.removeFromParent();
}

const freshPose = (): DancerPose => ({
  hx: 0, hy: 1.55, hz: 0, yaw: 0, pitch: 0, roll: 0,
  lx: -0.25, ly: 1.0, lz: 0, rx: 0.25, ry: 1.0, rz: 0,
  slump: 0,
});

export class ClubMirrorSystem extends createSystem({}) {
  init(): void {
    // Per-material clipping is off by default; the mirror is the only
    // thing in the game that wants it, and it costs nothing for materials
    // that carry no planes.
    this.renderer.localClippingEnabled = true;
  }

  /** 0 asleep … 1 awake — drives the smoke and whether anything is walked. */
  private wake = 0;
  private reflect = reflectionAcross(CLUB.minZ);
  /** Shadows by member idx; −1 is me. Kept while the floor is open. */
  private shadows = new Map<number, Shadow>();
  /** MY source: a private rig, solved from my live head + hands, never in
   *  the scene — its world matrices are what my shadow copies. */
  private me: { rig: DancerRig; hue: number; body: string } | null = null;
  private mine = freshPose();
  /** Mirrored drinks by GLASS id. */
  private cups = new Map<number, CoupeRefs>();
  private lit = false;

  update(delta: number): void {
    const refs = mirrorRefs.current;
    if (!refs) return;
    const M = CLUB.mirror;
    const glassZ = CLUB.minZ;

    const onFloor = (match.screen === 'lobby' || match.screen === 'tour') && inRoom() && !course.active;

    // Head → glass distance (to the pane's span, not its centre), with
    // hysteresis so the boundary doesn't flicker.
    const dx = Math.max(0, Math.abs(match.headX - M.x) - M.w / 2);
    const dz = Math.max(0, match.headZ - glassZ);
    const near = Math.hypot(dx, dz) < M.range + (this.wake > 0.5 ? 0.4 : 0);
    const want = onFloor && near ? 1 : 0;
    this.wake += (want - this.wake) * Math.min(1, WAKE_RATE * delta);
    const awake = this.wake > 0.03;

    refs.pane.opacity = SMOKE_ASLEEP + (SMOKE_AWAKE - SMOKE_ASLEEP) * this.wake;
    refs.figures.visible = awake;
    refs.haze.visible = awake;

    if (!onFloor) {
      // The floor is gone (set out, room left) — give everything back.
      if (this.shadows.size) {
        for (const s of this.shadows.values()) disposeShadow(s);
        this.shadows.clear();
      }
      if (this.me) {
        this.me.rig.dispose();
        this.me = null;
      }
      for (const cup of this.cups.values()) disposeCoupe(cup);
      this.cups.clear();
      this.lit = false;
      return;
    }
    if (!awake) {
      // Asleep: the figures group is hidden, so nothing draws either way.
      // Stand the shadows down once, then do no work at all.
      if (this.lit) {
        for (const s of this.shadows.values()) s.root.visible = false;
        for (const cup of this.cups.values()) cup.root.visible = false;
        this.lit = false;
      }
      return;
    }
    this.lit = true;

    /* ── cast the room into the glass ── */
    const used = new Set<number>();
    const holders = new Set<number>();

    // ME — the reflection this mirror exists for: solve the private rig,
    // then shadow it like anyone else's.
    if (this.readMyPose()) {
      const myIdx = net.myIdx;
      const meMember = net.members.find((m) => m.idx === myIdx);
      const hue = meMember ? memberHue(meMember) : danceHue(Math.max(0, myIdx), true);
      // Rebuilt when my colour OR my body changes: gear, paint and tone are
      // baked into the rig, and the bay is open with the mirror standing —
      // built once, the glass kept showing whatever you walked in wearing.
      const body = `${customization.version}|${paintState.version}`;
      if (this.me && (Math.abs(this.me.hue - hue) > 1e-4 || this.me.body !== body)) {
        this.me.rig.dispose();
        this.me = null;
      }
      if (!this.me) {
        // My tone, gear and paint — the body the arena shows everyone.
        this.me = { rig: buildDancer(hue, { tone: myTone(), gear: myGear(), look: myLook(), sticks: false }), hue, body };
        const old = this.shadows.get(-1);
        if (old) {
          disposeShadow(old);
          this.shadows.delete(-1);
        }
      }
      this.me.rig.setCrown(net.crownIdx !== null && net.crownIdx === myIdx);
      this.me.rig.pose(this.mine);
      // Not in the scene: nothing updates its matrices but us.
      this.me.rig.root.updateMatrixWorld(true);
      this.cast(-1, this.me.rig.root, refs.figures);
      used.add(-1);
      holders.add(myIdx);
    }

    // Room-mates near the glass, nearest first up to the cap.
    const nearby: { idx: number; rig: Object3D; d: number }[] = [];
    for (const [idx, f] of clubFloorFigures) {
      if (!f.shown) continue;
      const d = Math.max(0, f.pose.hz - glassZ);
      if (d > M.reflectRange || Math.abs(f.pose.hx - M.x) > M.reflectRange) continue;
      nearby.push({ idx, rig: f.rig.root, d });
    }
    nearby.sort((a, b) => a.d - b.d);
    for (const n of nearby.slice(0, M.maxFigures)) {
      this.cast(n.idx, n.rig, refs.figures);
      used.add(n.idx);
      holders.add(n.idx);
    }

    // …and every glass those figures are carrying, plus any stood down
    // near the pane.
    this.castGlasses(holders, glassZ, M);

    // Everyone else's reflection stands down; anyone gone is let go.
    for (const [idx, s] of this.shadows) {
      if (!used.has(idx)) s.root.visible = false;
      if (idx >= 0 && !clubFloorFigures.has(idx)) {
        disposeShadow(s);
        this.shadows.delete(idx);
      }
    }
  }

  /** My live head + hands → this.mine, the same frame sendClubPose streams.
   *  False (nothing to cast) until the head entity exists. */
  private readMyPose(): boolean {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return false;
    const p = this.mine;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    p.hx = _v.x;
    p.hy = _v.y;
    p.hz = _v.z;
    p.yaw = _e.y;
    p.pitch = _e.x;
    p.roll = _e.z;
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      let x: number;
      let y: number;
      let z: number;
      if (obj) {
        obj.getWorldPosition(_fwd);
        x = _fwd.x;
        y = _fwd.y;
        z = _fwd.z;
        // …and which way it faces, the same quaternion the floor streams.
        obj.getWorldQuaternion(_q);
        // …and the squeeze, straight off the controller: the glass closes
        // its fist the frame you do, not when your own pose comes back
        // off the wire.
        const gp = this.input.xr.gamepads[hand];
        const trig = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
        const sq = gp?.getButtonValue(InputComponent.Squeeze) ?? 0;
        if (hand === 'left') {
          p.lqx = _q.x;
          p.lqy = _q.y;
          p.lqz = _q.z;
          p.lqw = _q.w;
          p.lt = trig;
          p.lg = sq;
          p.lf = myHandFlags[0];
        } else {
          p.rqx = _q.x;
          p.rqy = _q.y;
          p.rqz = _q.z;
          p.rqw = _q.w;
          p.rt = trig;
          p.rg = sq;
          p.rf = myHandFlags[1];
        }
      } else {
        if (hand === 'left') {
          p.lqw = 0;
          p.lt = p.lg = p.lf = undefined;
        } else {
          p.rqw = 0;
          p.rt = p.rg = p.rf = undefined;
        }
        // No controllers (headless walks): the same resting-hands guess
        // pumpClubPose() streams, so the glass agrees with the room.
        x = p.hx + (hand === 'left' ? -0.25 : 0.25);
        y = Math.max(0.6, p.hy - 0.6);
        z = p.hz - 0.1;
      }
      if (hand === 'left') {
        p.lx = x;
        p.ly = y;
        p.lz = z;
      } else {
        p.rx = x;
        p.ry = y;
        p.rz = z;
      }
    }
    return true;
  }

  /**
   * Shadow `source` into the glass as idx's reflection: build the twins on
   * first sight (or when the source is a different rig, or has grown a
   * drawable — the crown), then copy every drawable's world matrix through
   * the reflection, honouring the source's own visibility down the tree.
   */
  private cast(idx: number, source: Object3D, into: Object3D): void {
    let s = this.shadows.get(idx);
    // Rebuilt when the source is a new rig, or its drawables are not the
    // ones twinned: a count alone missed a piece swapped for another with
    // as many meshes, and the glass kept the old one.
    if (s && (s.source !== source || countDrawables(source) !== s.count || s.twins.some((t) => !isUnder(t.src, source)))) {
      disposeShadow(s);
      s = undefined;
    }
    if (!s) {
      s = buildShadow(source, into);
      this.shadows.set(idx, s);
    }
    s.root.visible = true;
    // Walk the source with a visibility stack: a part hidden by setDetail
    // (or a crown parked invisible) casts nothing, whatever its parent.
    const R = this.reflect;
    const twinsBySrc = s.twins;
    let k = 0;
    const walk = (o: Object3D, vis: boolean): void => {
      const v = vis && o.visible;
      const t = k < twinsBySrc.length && twinsBySrc[k].src === o ? twinsBySrc[k++] : null;
      if (t) {
        t.twin.visible = v;
        if (v) t.twin.matrixWorld.multiplyMatrices(R, o.matrixWorld);
      }
      for (const c of o.children) walk(c, v);
    };
    walk(source, true);
  }

  /**
   * EVERY glass the glass should be holding — pooled by GLASS, cast only if
   * its holder is cast (a blocked dancer's pint must not float across the
   * mirror on its own) or, unheld, on the bodies' proximity rule. Reflected
   * by hand rather than shadowed: a coupe is a surface of revolution and a
   * position plus a mirrored quaternion is the whole of it.
   */
  private castGlasses(holders: Set<number>, glassZ: number, M: typeof CLUB.mirror): void {
    const shown = new Set<number>();
    for (const g of liveGlasses) {
      const cast =
        g.heldBy !== null
          ? holders.has(g.heldBy)
          : g.pos.z - glassZ <= M.reflectRange && Math.abs(g.pos.x - M.x) <= M.reflectRange;
      if (!cast) continue;
      let cup = this.cups.get(g.id);
      if (!cup) {
        cup = buildCoupe();
        cup.root.traverse((o) => {
          const mat = (o as Mesh).material as Material | Material[] | undefined;
          if (!mat) return;
          for (const m of Array.isArray(mat) ? mat : [mat]) m.clippingPlanes = GLASS_CLIP;
        });
        mirrorRefs.current!.figures.add(cup.root);
        this.cups.set(g.id, cup);
      }
      cup.root.visible = true;
      cup.root.position.set(g.pos.x, g.pos.y, 2 * glassZ - g.pos.z);
      cup.root.quaternion.set(-g.quat.x, -g.quat.y, g.quat.z, g.quat.w).multiply(Y_FLIP);
      cup.fill.visible = g.full;
      shown.add(g.id);
    }
    for (const [id, cup] of this.cups) if (!shown.has(id)) cup.root.visible = false;
  }
}
