/**
 * Hover traffic for the NEON district: a cross street (lanes per site) plus
 * sky lanes over the rooftops. Cars are clones of vehicles.glb roots (userData.kind,
 * forward = +X); emissive groups are child meshes (userData.group). A police
 * car runs through every so often at ~25 m/s with a double-flash light bar
 * and one moving light. Cosmetic only — seeded so every client could share it.
 *
 * What sells them at 10–40 m is LIGHT, so every street car also carries:
 *  - halos: additive sprites on the head and tail bars that only bloom when
 *    you're looking at that end of the car (fade by view angle),
 *  - the wet road: an underglow pool in the car's hover colour, headlights
 *    thrown down the street ahead, and two light streaks lying on the asphalt
 *    pointing back at your eye — how a lamp reflects in a rain-soaked street,
 *  - police: a strobe flare over the roof bar that flashes with it.
 * Paint and glass reflect the site's own environment map (set per Traffic).
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';

export interface Lane {
  z: number;
  dir: 1 | -1;
  y: number;
  minGap: number;
  maxGap: number;
  sky?: boolean;
}

/** Cross street behind the plaza's north alley (43-46 m beyond the pit) + sky lanes. */
export const PLAZA_LANES: Lane[] = [
  { z: -52.4, dir: 1, y: 0.85, minGap: 1.6, maxGap: 4.5 },
  { z: -49.6, dir: -1, y: 0.85, minGap: 1.6, maxGap: 4.5 },
  { z: -70, dir: 1, y: 30, minGap: 2.5, maxGap: 6, sky: true },
  { z: -95, dir: -1, y: 44, minGap: 2.5, maxGap: 7, sky: true },
  { z: 40, dir: 1, y: 52, minGap: 3, maxGap: 8, sky: true },
];
/** Cross street at the back street's mouth (40-44 m ahead of the lobby spot) + sky lanes. */
export const BACKSTREET_LANES: Lane[] = [
  { z: -43.4, dir: 1, y: 0.85, minGap: 1.6, maxGap: 4.5 },
  { z: -40.6, dir: -1, y: 0.85, minGap: 1.6, maxGap: 4.5 },
  { z: -78, dir: 1, y: 26, minGap: 2.5, maxGap: 6, sky: true },
  { z: -96, dir: -1, y: 41, minGap: 2.5, maxGap: 7, sky: true },
  { z: -122, dir: 1, y: 58, minGap: 3, maxGap: 8, sky: true },
];
const X_SPAWN = 75;
const KINDS = ['sedan', 'sedan_b', 'taxi', 'taxi', 'van'];
/** Each kind's hover/underglow colour (matches kit_cars accent). */
const GLOW: Record<string, number> = {
  sedan: 0x1ad8ff,
  sedan_b: 0xff1f8c,
  taxi: 0xffbf26,
  van: 0x40ff8c,
  police: 0x2a5aff,
};
const HEAD = 0xd8f2ff;
const TAIL = 0xff1a14;

// --- shared FX textures (one each, made once) --------------------------------
let glowTex: Texture | null = null;
let streakTex: Texture | null = null;
function radialGlow(): Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  glowTex.colorSpace = SRGBColorSpace;
  return glowTex;
}
/** A wet-road reflection: bright at the lamp end (v=0), smeared out toward the viewer. */
function roadStreak(): Texture {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(32, 128);
  for (let y = 0; y < 128; y++) {
    const v = y / 127;
    const along = Math.pow(1 - v, 1.6) * (0.75 + 0.25 * Math.sin(v * 40) * (1 - v)); // ripple breakup
    for (let x = 0; x < 32; x++) {
      const u = Math.abs(x / 31 - 0.5) * 2;
      const a = Math.max(0, along * Math.pow(1 - u * u, 2));
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  g.putImageData(img, 0, 0);
  streakTex = new CanvasTexture(c);
  streakTex.colorSpace = SRGBColorSpace;
  return streakTex;
}
function additive(color: number, map: Texture, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
}
function sprite(color: number, opacity: number): Sprite {
  const s = new Sprite(
    new SpriteMaterial({ color, map: radialGlow(), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }),
  );
  s.userData.base = opacity;
  return s;
}

interface CarFx {
  head: Sprite;
  tail: Sprite;
  flare?: Sprite;
  pool?: Mesh;
  headStreak?: Mesh;
  tailStreak?: Mesh;
  beam?: Mesh;
}

interface Car {
  car: Object3D;
  lane: Lane;
  speed: number;
  police: boolean;
  groups: Record<string, Object3D>;
  phase: number;
  fx: CarFx;
  len: number;
  /** The speed this car wants; `speed` is what it's doing (it queues behind slower cars). */
  cruise: number;
}

const _eye = new Vector3();
const _p = new Vector3();
const _fwd = new Vector3();

export class Traffic {
  private templates: Record<string, Object3D> = {};
  private cars: Car[] = [];
  private timers: number[];
  private policeCooldown = 6;
  private policeLight = new PointLight(0xff1010, 0, 18, 1.6);
  private seed = 0x5eed;
  private streakGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  private poolGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(
    private parent: Group,
    fleet: Object3D,
    private lanes: Lane[] = PLAZA_LANES,
    env?: Texture | null,
  ) {
    this.timers = lanes.map(() => this.rnd() * 2);
    fleet.traverse((o) => {
      if (o.userData?.iwsdk !== 'vehicle') return;
      // Per-site copy with its OWN materials, so each district's reflections
      // land on the paint and glass (clones of it share these materials).
      const tpl = o.clone(true);
      const done = new Map<Material, Material>();
      tpl.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as Material;
        let m = done.get(src);
        if (!m) {
          m = src.clone();
          const sm = m as MeshStandardMaterial;
          if (sm.isMeshStandardMaterial && env && !mesh.userData.group?.startsWith?.('strobe')) {
            sm.envMap = env;
            sm.envMapIntensity = 1.4;
          }
          done.set(src, m);
        }
        mesh.material = m;
      });
      this.templates[o.userData.kind] = tpl;
    });
    parent.add(this.policeLight);
  }

  /** Swap the reflections in once the site's env map arrives (it loads after the fleet). */
  setEnv(env: Texture): void {
    for (const tpl of Object.values(this.templates)) {
      tpl.traverse((c) => {
        const sm = (c as Mesh).material as MeshStandardMaterial | undefined;
        if (sm?.isMeshStandardMaterial) {
          sm.envMap = env;
          sm.envMapIntensity = 1.4;
          sm.needsUpdate = true;
        }
      });
    }
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed ?? 0x5eed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private spawn(lane: Lane, kind: string): void {
    const tpl = this.templates[kind];
    if (!tpl) return;
    const car = tpl.clone(true);
    car.position.set(-lane.dir * X_SPAWN, lane.y, lane.z);
    car.rotation.set(0, lane.dir > 0 ? 0 : Math.PI, 0);
    const groups: Record<string, Object3D> = {};
    car.traverse((o) => {
      if (o.userData?.group) groups[o.userData.group] = o;
    });
    const police = kind === 'police';
    const len = (tpl.userData.length as number) ?? 4.7;
    const glow = GLOW[kind] ?? 0x1ad8ff;
    // Halos ride the car (car-local: +X forward); sky cars get bigger, dimmer ones.
    const k = lane.sky ? 2.2 : 1;
    const fx: CarFx = { head: sprite(HEAD, 0.9), tail: sprite(TAIL, 0.85) };
    fx.head.position.set(len / 2 + 0.05, 0.62, 0);
    fx.head.scale.set(2.6 * k, 0.9 * k, 1);
    fx.tail.position.set(-len / 2 - 0.05, 0.66, 0);
    fx.tail.scale.set(2.4 * k, 0.8 * k, 1);
    car.add(fx.head, fx.tail);
    if (police) {
      fx.flare = sprite(0xff1010, 0);
      fx.flare.position.set(0.05, 1.45, 0);
      fx.flare.scale.set(3.2, 1.6, 1);
      car.add(fx.flare);
    }
    if (!lane.sky) {
      // Road FX live in the site group (they must lie flat on the street, not ride the hover bob).
      fx.pool = new Mesh(this.poolGeo, additive(glow, radialGlow(), 0.55));
      fx.pool.scale.set(len * 1.1, 1, 2.6);
      fx.headStreak = new Mesh(this.streakGeo, additive(HEAD, roadStreak(), 0.42));
      fx.tailStreak = new Mesh(this.streakGeo, additive(TAIL, roadStreak(), 0.5));
      // Headlights thrown down the road ahead.
      fx.beam = new Mesh(this.streakGeo, additive(HEAD, roadStreak(), 0.3));
      fx.beam.scale.set(2.4, 1, 11);
      fx.beam.rotation.y = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (const m of [fx.pool, fx.headStreak, fx.tailStreak, fx.beam]) {
        m.renderOrder = 6;
        this.parent.add(m);
      }
    }
    this.parent.add(car);
    const cruise = police ? 24 + this.rnd() * 6 : (lane.sky ? 18 : 9) + this.rnd() * 6;
    this.cars.push({ car, lane, police, groups, fx, len, cruise, speed: cruise, phase: this.rnd() * 10 });
  }

  private dispose(c: Car): void {
    this.parent.remove(c.car);
    for (const m of [c.fx.pool, c.fx.headStreak, c.fx.tailStreak, c.fx.beam]) {
      if (!m) continue;
      this.parent.remove(m);
      (m.material as Material).dispose();
    }
    for (const s of [c.fx.head, c.fx.tail, c.fx.flare]) s?.material.dispose();
  }

  /** `eye`: the viewer's world position (halo angle fade + road streak direction). */
  update(dt: number, time: number, eye?: Vector3): void {
    this.lanes.forEach((lane, i) => {
      this.timers[i] -= dt;
      if (this.timers[i] > 0) return;
      // Entry still occupied by a slow car? Try again in a moment.
      const x0 = -lane.dir * X_SPAWN;
      if (this.cars.some((c) => c.lane === lane && Math.abs(c.car.position.x - x0) < c.len + 4)) {
        this.timers[i] = 0.5;
        return;
      }
      this.timers[i] = lane.minGap + this.rnd() * (lane.maxGap - lane.minGap);
      let kind = KINDS[Math.floor(this.rnd() * KINDS.length)];
      this.policeCooldown -= this.timers[i];
      if (!lane.sky && this.policeCooldown <= 0) {
        kind = 'police';
        this.policeCooldown = 12 + this.rnd() * 20;
      }
      this.spawn(lane, kind);
    });
    // Eye in the site group's frame (the plaza group is lowered for the stage).
    if (eye) this.parent.worldToLocal(_eye.copy(eye));
    // Lane discipline: nobody drives through the car in front. Each car
    // eases toward its cruise speed but never closes inside a safe gap of the
    // one ahead in its lane (the police run is faster, so it queues too —
    // it's a back street, not a chase).
    for (const lane of this.lanes) {
      const queue = this.cars.filter((c) => c.lane === lane).sort((a, b) => (b.car.position.x - a.car.position.x) * lane.dir);
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        let want = c.cruise;
        const ahead = queue[i - 1];
        if (ahead) {
          const gap = (ahead.car.position.x - c.car.position.x) * lane.dir - (ahead.len + c.len) / 2;
          const safe = 2.5 + c.speed * 0.35;
          if (gap < safe) want = Math.min(want, ahead.speed * Math.max(0, gap / safe));
        }
        c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 4 : 1.2));
      }
    }
    let flash: number | null = null;
    let at: Object3D | null = null;
    for (const c of this.cars) {
      c.car.position.x += c.lane.dir * c.speed * dt;
      c.car.position.y = c.lane.y + 0.05 * Math.sin(time * 1.7 + c.phase);
      c.car.rotation.x = 0.02 * Math.sin(time * 1.3 + c.phase);
      const fx = c.fx;
      if (eye) {
        // Head halo blooms only when the nose points your way; tail likewise.
        _fwd.set(c.lane.dir, 0, 0);
        _p.copy(_eye).sub(c.car.position).normalize();
        const facing = _fwd.dot(_p);
        fx.head.material.opacity = (fx.head.userData.base as number) * Math.max(0, facing) ** 0.7;
        fx.tail.material.opacity = (fx.tail.userData.base as number) * Math.max(0, -facing) ** 0.7;
        if (fx.pool && fx.headStreak && fx.tailStreak) {
          const x = c.car.position.x;
          const z = c.lane.z;
          fx.pool.position.set(x, 0.03, z);
          fx.beam?.position.set(x + (c.lane.dir * c.len) / 2 - c.lane.dir * 0.3, 0.032, z);
          for (const [s, dx, show] of [
            [fx.headStreak, (c.lane.dir * c.len) / 2, Math.max(0, facing)],
            [fx.tailStreak, (-c.lane.dir * c.len) / 2, Math.max(0, -facing)],
          ] as const) {
            s.position.set(x + dx, 0.035, z);
            // lie along the ground toward the eye: local +Z of the streak -> eye
            s.rotation.y = Math.atan2(_eye.x - s.position.x, _eye.z - s.position.z);
            s.scale.set(0.9, 1, 7);
            s.visible = show > 0.02;
            (s.material as MeshBasicMaterial).opacity = (s === fx.headStreak ? 0.42 : 0.5) * (0.35 + 0.65 * show);
          }
        }
      }
      if (!c.police) continue;
      const ph = (time * 2.5) % 1;
      const red = ph < 0.12 || (ph > 0.2 && ph < 0.32);
      const blue = (ph > 0.5 && ph < 0.62) || (ph > 0.7 && ph < 0.82);
      if (c.groups.strobe_red) c.groups.strobe_red.visible = red;
      if (c.groups.strobe_blue) c.groups.strobe_blue.visible = blue;
      if (fx.flare) {
        fx.flare.material.opacity = red || blue ? 0.95 : 0;
        fx.flare.material.color.setHex(red ? 0xff1010 : 0x2050ff);
      }
      if (fx.pool) (fx.pool.material as MeshBasicMaterial).color.set(red ? 0xff2020 : blue ? 0x2050ff : GLOW.police);
      if (red || blue) {
        flash = red ? 0xff1010 : 0x1040ff;
        at = c.car;
      }
    }
    if (flash !== null && at) {
      this.policeLight.position.copy(at.position);
      this.policeLight.position.y += 1.4;
      this.policeLight.color.setHex(flash);
      this.policeLight.intensity = 40;
    } else this.policeLight.intensity = 0;
    this.cars = this.cars.filter((c) => {
      if (Math.abs(c.car.position.x) <= X_SPAWN + 2) return true;
      this.dispose(c);
      return false;
    });
  }
}
