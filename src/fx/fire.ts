/**
 * The fire. Ported from the FlamethrowerXR demo and reshaped into a reusable
 * fireball: a molten shader core (simplex-noise flames), an additive corona
 * that ripples and flickers, and shared GPU particle pools. Everything is
 * procedural — no baked assets, no lights — so four roaring fireballs stay
 * cheap in stereo on a headset.
 *
 * THE FIRE REACTS. A fireball is fire shedding into the air, not a picture
 * stuck to a ball, so every ball EMITS: flame puffs leave its surface into
 * the world each frame, carrying a little of its motion, then drag, rise,
 * swell and burn out. Nothing is scripted per state — the motion does it:
 *
 *   at rest   puffs lick up off the iron and lift away
 *   orbit     the ball whirls through its own fire: a ring of flame
 *   thrown    the launch FLARES (a burst, the core blazing) and the fire
 *             pours off the back into a thick, turbulent, rising wake —
 *             the trail is simply the fire it leaves behind
 *   dead      nothing left to burn
 *
 * The core's flames and the corona stream back along the flight too. The
 * puffs are drawn from a small flame atlas generated here at boot (domain-
 * warped value noise in a teardrop): each puff erodes into tongues as it
 * dies and cools white → yellow → orange → red, and a thin dark smoke rises
 * behind the hottest fire. Texture lookups, not per-pixel noise, keep the
 * fill cheap on Quest.
 *
 * Each ball is tintable per team: your fire burns orange, theirs burns blue
 * (`uCool` mixes the two colour ramps in-shader).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  Quaternion,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Scene,
} from 'three';
import { FIREBALL } from '../config.js';

/** 3D simplex noise (Ken Perlin's optimised variant) + 3-octave fbm. */
const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){ float a=0.0,w=0.5; for(int i=0;i<3;i++){ a+=w*snoise(p); p*=2.02; w*=0.5;} return a; }
`;

/** Molten core: noise-driven heat with a 4-stop ramp, orange↔blue by uCool. */
const CORE_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool;
  uniform vec3 uFlow;
  varying vec3 vPos;
  varying float vFacing;
  ${NOISE_GLSL}
  void main(){
    vec3 q = vPos * 5.0 / ${FIREBALL.radius.toFixed(3)} * 0.1;
    q -= uFlow;                         // flames lick up — and stream back in flight
    // Churning, not flat: a second, finer octave turns the surface into
    // cells of white-hot fire split by darker, cooler lanes.
    float n = fbm(q) * 0.75 + snoise(q * 3.1 + uFlow * 1.7) * 0.25;
    float heat = clamp((n * 0.85 + 0.62) * uHeat, 0.0, 1.7);
    // Orange ramp: glowing floor → white-hot peaks.
    vec3 warm = vec3(1.0, 0.32, 0.03);
    warm = mix(warm, vec3(1.0, 0.55, 0.08), smoothstep(0.45, 0.85, heat));
    warm = mix(warm, vec3(1.0, 0.80, 0.28), smoothstep(0.85, 1.25, heat));
    warm = mix(warm, vec3(1.0, 0.95, 0.65), smoothstep(1.25, 1.65, heat));
    // Blue ramp for the opponent's fire.
    vec3 cool = vec3(0.05, 0.35, 1.0);
    cool = mix(cool, vec3(0.16, 0.55, 1.0), smoothstep(0.45, 0.85, heat));
    cool = mix(cool, vec3(0.38, 0.78, 1.0), smoothstep(0.85, 1.25, heat));
    cool = mix(cool, vec3(0.75, 0.95, 1.0), smoothstep(1.25, 1.65, heat));
    vec3 col = mix(warm, cool, uCool);
    // Exposure: dark smouldering iron before ignition, full blaze once lit.
    float expo = smoothstep(0.15, 0.7, uHeat);
    // A hot sphere, not a disc: its limb dims and reddens where you look
    // through the cooler outer fire edge-on.
    float limb = mix(0.45, 1.0, smoothstep(0.0, 0.75, vFacing));
    col = mix(col * vec3(1.0, 0.55, 0.4), col, smoothstep(0.1, 0.6, vFacing));
    gl_FragColor = vec4(col * 1.95 * mix(0.12, 1.0, expo) * limb, 1.0);
  }
`;

const CORE_VERT = /* glsl */ `
  varying vec3 vPos;
  varying float vFacing;
  void main(){ vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFacing = abs(dot(normalize(normalMatrix * normalize(position)), normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv; }
`;

/** Additive corona: rippled rim + white-hot kiss at the centre, flickering. */
const CORONA_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    p.y -= 0.08;                        // reaches a touch higher than it hangs
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    float ripple = fbm(vec3(cos(ang), sin(ang), uTime * 0.7) * 1.4);
    float maxR = 0.62 + ripple * 0.22;
    float fall = pow(clamp(1.0 - r / maxR, 0.0, 1.0), 1.6);
    float glow = fall * uHeat;
    glow += pow(max(1.0 - r * 2.4, 0.0), 2.0) * 0.9; // white-hot centre kiss
    vec3 warm = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.82, 0.40), pow(fall, 2.0));
    vec3 cool = mix(vec3(0.10, 0.45, 1.0), vec3(0.55, 0.85, 1.0), pow(fall, 2.0));
    vec3 col = mix(warm, cool, uCool);
    float flick = 0.9 + 0.1 * sin(uTime * 16.0);
    gl_FragColor = vec4(col * glow * flick, min(glow, 1.2));
  }
`;

const CORONA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** A live fireball visual: position the group, call update() every frame. */
export interface FireVisual {
  group: Group;
  /** time = seconds, heat = 0..1.7, cameraQuat billboards the corona. */
  update(time: number, heat: number, cameraQuat: Quaternion): void;
  /** Recolour warm (0, orange) ↔ cool (1, blue) — a ball's team can change
   *  between bouts (a 2v2 ally is on YOUR team, the 1v1 rival is not). */
  setCool(cool: number): void;
  dispose(): void;
}

const CORE_GEO = new IcosahedronGeometry(FIREBALL.radius, 3);
const CORONA_GEO = new PlaneGeometry(FIREBALL.radius * 6, FIREBALL.radius * 6);

/** Faster than any throw (8.5) or recall (9.5) — a jump beyond it is a teleport. */
const MAX_BALL_SPEED = 14;
/** A jump in speed this big (m/s) within a frame is a launch: it flares. */
const FLARE_KICK = 2.5;

const _wp = new Vector3();
const _wq = new Quaternion();
const _ws = new Vector3();
const _iq = new Quaternion();
const _v = new Vector3();
const _p = new Vector3();
const _u = new Vector3();
const _back = new Vector3();
const _up = new Vector3(0, 1, 0);
const _rollQ = new Quaternion();
const _zAxis = new Vector3(0, 0, 1);
const _viewport = new Vector4();

function randomUnit(out: Vector3): Vector3 {
  do out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  while (out.lengthSq() > 1 || out.lengthSq() < 1e-4);
  return out.normalize();
}

/** Build a fireball: molten core + billboarded corona + the fire it sheds.
 *  team 1 burns blue. */
export function createFireVisual(team: 0 | 1): FireVisual {
  let cool = team === 1 ? 1 : 0;

  const uFlow = { value: new Vector3() };
  const coreMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.8 }, uCool: { value: cool }, uFlow },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    transparent: true,
    // No depth write: the fire it sheds is born ON its surface, and a
    // point sprite tests at its centre — written depth hid every flame
    // across the ball's face. The world still occludes it.
    depthWrite: false,
  });
  const core = new Mesh(CORE_GEO, coreMat);
  core.renderOrder = 1;

  const coronaMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.8 }, uCool: { value: cool } },
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const corona = new Mesh(CORONA_GEO, coronaMat);
  corona.renderOrder = 2;

  const group = new Group();
  group.add(core, corona);

  // Motion, measured from the group itself: smoothed velocity for the look,
  // the raw step for the launch flare.
  const vel = new Vector3();
  const lastPos = new Vector3();
  let tracked = false;
  let lastTime = -1;
  let lastRawSpeed = 0;
  let flare = 0;
  let flareCooldown = 0;
  let emitAcc = Math.random();
  let smokeAcc = Math.random();
  const flow = uFlow.value;

  return {
    group,
    update(time, heat, cameraQuat) {
      const dt = lastTime < 0 ? 0 : Math.min(Math.max(time - lastTime, 0), 0.1);
      lastTime = time;

      // --- motion ----------------------------------------------------------
      group.getWorldPosition(_wp);
      let rawSpeed = 0;
      let teleport = !tracked;
      if (tracked && dt > 1e-4) {
        _v.subVectors(_wp, lastPos).divideScalar(dt);
        rawSpeed = _v.length();
        if (rawSpeed < MAX_BALL_SPEED) {
          vel.lerp(_v, Math.min(1, dt * 14));
        } else {
          teleport = true;
          rawSpeed = 0;
        }
      }
      const speed = vel.length();
      const r = FIREBALL.radius * group.getWorldScale(_ws).x;
      const lit = group.visible && heat > 0.3;

      // THE LAUNCH: a sudden jump in speed — a throw, a recall igniting —
      // flares the ball and blows a burst of fire off it.
      flareCooldown = Math.max(0, flareCooldown - dt);
      if (lit && !teleport && rawSpeed > 3 && rawSpeed - lastRawSpeed > FLARE_KICK && flareCooldown === 0) {
        flare = 1;
        flareCooldown = 0.4;
        if (fireFx) {
          _back.copy(vel).normalize().negate();
          for (let k = 0; k < 18; k++) {
            randomUnit(_u);
            _p.copy(_wp).addScaledVector(_u, r * 0.6);
            _u.multiplyScalar(0.9 + Math.random() * 0.9).addScaledVector(_back, 0.6);
            fireFx.spawnFire(_p, _u.x + vel.x * 0.35, _u.y + vel.y * 0.35 + 0.3, _u.z + vel.z * 0.35,
              0.3 + Math.random() * 0.25, r * (3.0 + Math.random() * 1.6), Math.min(1.6, heat * 1.15), cool);
          }
        }
      }
      if (!teleport) lastRawSpeed = rawSpeed;
      flare = Math.max(0, flare - dt * 2.8);
      const shown = heat + flare * 0.45;

      coreMat.uniforms.uTime.value = time;
      coreMat.uniforms.uHeat.value = shown;
      coronaMat.uniforms.uTime.value = time;
      coronaMat.uniforms.uHeat.value = shown;

      // --- the core's flames flow up, and back along the flight ------------
      group.getWorldQuaternion(_wq);
      _iq.copy(_wq).invert();
      _back.copy(vel).negate().applyQuaternion(_iq);
      const streamK = Math.min(1, speed / 6);
      flow.x += _back.x * streamK * 0.5 * dt;
      flow.y += (1.6 * (1 - streamK * 0.6) + _back.y * streamK * 0.5) * dt;
      flow.z += _back.z * streamK * 0.5 * dt;

      // --- the corona: faces you, leans its flame up the screen at rest and
      //     streams it back behind the flight, stretched with the speed -----
      _u.copy(_up).applyQuaternion(_iq.copy(cameraQuat).invert());
      _v.copy(vel).applyQuaternion(_iq);
      let dx = _u.x;
      let dy = _u.y;
      const ul = Math.hypot(dx, dy) || 1;
      dx /= ul;
      dy /= ul;
      const bx = -_v.x;
      const by = -_v.y;
      const bl = Math.hypot(bx, by);
      const k = Math.min(1, Math.max(0, (speed - 1.2) / 4.8)) * Math.min(1, Math.max(0, (bl / Math.max(speed, 1e-3) - 0.15) / 0.3));
      if (bl > 1e-4) {
        dx += (bx / bl - dx) * k;
        dy += (by / bl - dy) * k;
      }
      const angle = Math.atan2(-dx, dy);
      corona.quaternion.copy(_wq).invert().multiply(cameraQuat).multiply(_rollQ.setFromAxisAngle(_zAxis, angle));
      corona.scale.set(1 - 0.12 * k, 1 + 1.3 * k, 1);
      // Hang the stretched corona behind the ball, not centred on it.
      _p.copy(vel).normalize().multiplyScalar(-FIREBALL.radius * 1.2 * k).applyQuaternion(_iq.copy(_wq).invert());
      corona.position.copy(_p);

      // --- THE FIRE IT SHEDS ------------------------------------------------
      if (fireFx && lit && dt > 0) {
        _back.copy(vel).normalize().negate();
        // A dribble at rest, a torrent in flight.
        const rate = 16 + 28 * heat + speed * 26;
        emitAcc += rate * dt;
        let n = Math.floor(emitAcc);
        emitAcc -= n;
        n = Math.min(n, 40);
        for (let e = 0; e < n; e++) {
          // Spread along this frame's path, so a fast ball pours a wake, not beads.
          const f = teleport ? 1 : (e + Math.random()) / n;
          _p.copy(lastPos).lerp(_wp, f);
          // Off the surface, mostly the trailing side.
          randomUnit(_u).addScaledVector(_back, 0.7 * streamK).normalize();
          _p.addScaledVector(_u, r * 0.8);
          // A little of the ball's motion (so it lags into a wake), a little
          // outward, and fire rises.
          const carry = 0.06 + Math.random() * 0.24;
          fireFx.spawnFire(
            _p,
            vel.x * carry + _u.x * 0.32,
            vel.y * carry + _u.y * 0.32 + 0.28,
            vel.z * carry + _u.z * 0.32,
            0.26 + Math.random() * 0.3 + streamK * 0.12,
            r * (2.4 + Math.random() * 1.2) * (1 + streamK * 0.3),
            shown * (0.85 + Math.random() * 0.3),
            cool,
          );
        }
        // Smoke off the hottest fire, a thin dark veil rising behind it.
        if (smokeFx && heat > 0.9) {
          smokeAcc += (3 + speed * 2.4) * dt;
          while (smokeAcc >= 1) {
            smokeAcc -= 1;
            randomUnit(_u);
            _p.copy(_wp).addScaledVector(_u, r * 0.5).addScaledVector(_back, r * 1.6 * streamK);
            smokeFx.spawnSmoke(_p, vel.x * 0.08 + _u.x * 0.1, vel.y * 0.08 + 0.42, vel.z * 0.08 + _u.z * 0.1, 0.9 + Math.random() * 0.6, r * (2.6 + Math.random() * 1.4));
          }
        }
      }
      tracked = true;
      lastPos.copy(_wp);
    },
    setCool(c) {
      cool = c;
      coreMat.uniforms.uCool.value = c;
      coronaMat.uniforms.uCool.value = c;
    },
    dispose() {
      coreMat.dispose();
      coronaMat.dispose();
      group.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------
// The flame atlas — generated here, once
// ---------------------------------------------------------------------------

const PUFF_GRID = 4; // 4 x 4 puff shapes
const PUFF_SIZE = 512;

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function vfbm(x: number, y: number): number {
  let a = 0;
  let w = 0.5;
  for (let o = 0; o < 4; o++) {
    a += w * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 3.7;
    w *= 0.5;
  }
  return a / 0.9375;
}

/**
 * Sixteen flame puffs in a 4x4 atlas: a teardrop (round below, drawn up into
 * tongues above), domain-warped by fbm so no two burn alike. R = flame
 * density, soft to zero at every cell edge. Built once at boot (~30 ms).
 */
function makePuffAtlas(): DataTexture {
  const N = PUFF_SIZE;
  const cell = N / PUFF_GRID;
  const data = new Uint8Array(N * N * 4);
  for (let cy = 0; cy < PUFF_GRID; cy++) {
    for (let cx = 0; cx < PUFF_GRID; cx++) {
      const seed = cy * PUFF_GRID + cx + 1;
      for (let y = 0; y < cell; y++) {
        // Row 0 is the BOTTOM of the texture (DataTexture, flipY false).
        const py = ((y + 0.5) / cell) * 2 - 1;
        for (let x = 0; x < cell; x++) {
          const px = ((x + 0.5) / cell) * 2 - 1;
          const wx = vfbm(px * 2.2 + seed * 7.31, py * 2.2 - seed * 3.17);
          const wy = vfbm(px * 2.2 - seed * 5.73, py * 2.2 + seed * 11.9);
          const qx = px + (wx - 0.5) * 0.6;
          const qy = py + (wy - 0.5) * 0.6;
          // Teardrop: narrower and longer above its heart.
          const ex = qx * (1 + 0.45 * Math.max(qy, 0));
          const ey = (qy > 0 ? qy * 0.7 : qy * 1.15) + 0.15;
          const body = Math.max(0, 1 - Math.hypot(ex, ey) * 1.12) ** 1.3;
          // Tongues: noise stretched up the flame.
          const t = vfbm(qx * 3.4 + seed * 9.1, qy * 1.25 - seed * 2.3);
          let v = body * (0.55 + 0.7 * t);
          const edge = Math.max(Math.abs(px), Math.abs(py));
          v *= Math.min(1, Math.max(0, (1 - edge) / 0.18));
          const b = Math.round(Math.min(1, v * 1.15) * 255);
          const o = ((cy * cell + y) * N + cx * cell + x) * 4;
          data[o] = b;
          data[o + 1] = b;
          data[o + 2] = b;
          data[o + 3] = 255;
        }
      }
    }
  }
  const tex = new DataTexture(data, N, N, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** The fire's colour, by temperature: dull red lick → white-hot heart;
 *  warm for your team, a blue torch for theirs. */
const RAMP_GLSL = /* glsl */ `
  vec3 fireRamp(float v, float cool){
    vec3 w = vec3(0.45, 0.04, 0.0);
    w = mix(w, vec3(1.0, 0.30, 0.02), smoothstep(0.05, 0.30, v));
    w = mix(w, vec3(1.0, 0.58, 0.10), smoothstep(0.30, 0.55, v));
    w = mix(w, vec3(1.0, 0.82, 0.42), smoothstep(0.55, 0.80, v));
    w = mix(w, vec3(1.0, 0.97, 0.86), smoothstep(0.80, 1.00, v));
    vec3 c = vec3(0.02, 0.06, 0.45);
    c = mix(c, vec3(0.08, 0.32, 1.0), smoothstep(0.05, 0.30, v));
    c = mix(c, vec3(0.22, 0.58, 1.0), smoothstep(0.30, 0.55, v));
    c = mix(c, vec3(0.55, 0.84, 1.0), smoothstep(0.55, 0.80, v));
    c = mix(c, vec3(0.90, 0.97, 1.0), smoothstep(0.80, 1.00, v));
    return mix(w, c, cool);
  }
`;

const PUFF_CELL_GLSL = /* glsl */ `
  vec2 puffCell(float seed, vec2 c){
    float i = floor(fract(seed * 13.17) * ${(PUFF_GRID * PUFF_GRID).toFixed(1)});
    float col = mod(i, ${PUFF_GRID.toFixed(1)});
    float row = floor(i / ${PUFF_GRID.toFixed(1)});
    return (vec2(col, row) + clamp(c, 0.02, 0.98)) / ${PUFF_GRID.toFixed(1)};
  }
`;

/**
 * World-space flame puffs (or smoke): one Points draw for every ball's fire.
 * Each puff remembers its own start heat, team and seed; it swells, erodes
 * into tongues and cools as it ages.
 */
class FlamePool {
  readonly points: Points;
  private readonly geo = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly heat: Float32Array;
  private readonly cool: Float32Array;
  private readonly seed: Float32Array;
  private cursor = 0;
  private alive = 0;
  private staticDirty = false;

  constructor(
    private readonly max: number,
    private readonly smoke: boolean,
    atlas: DataTexture,
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.heat = new Float32Array(max);
    this.cool = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aHeat', new BufferAttribute(this.heat, 1));
    this.geo.setAttribute('aCool', new BufferAttribute(this.cool, 1));
    this.geo.setAttribute('aSeed', new BufferAttribute(this.seed, 1));
    const mat = new ShaderMaterial({
      uniforms: { uViewH: { value: 1000 }, uPuff: { value: atlas } },
      vertexShader: /* glsl */ `
        uniform float uViewH;
        attribute float aLife, aSize, aHeat, aCool, aSeed;
        varying float vLife, vHeat, vCool, vSeed, vNear;
        void main(){
          vLife = aLife; vHeat = aHeat; vCool = aCool; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float age = 1.0 - aLife;
          // Fire swells as it burns; smoke billows wider still.
          float grow = ${smoke ? 'mix(0.7, 2.2, age)' : 'mix(0.55, 1.45, sqrt(age))'};
          // TRUE size: metres through the projection to this viewport's
          // pixels — a fixed pixel scale drew every sprite 3-4x too small
          // on a Quest eye (~1700 px tall). Capped at a fifth of the view,
          // and faded out right against your face: an orbit by your head
          // must not flood the GPU.
          float px = aSize * grow * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.05);
          gl_PointSize = clamp(px, 1.0, uViewH * 0.2);
          vNear = smoothstep(0.18, 0.45, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPuff;
        varying float vLife, vHeat, vCool, vSeed, vNear;
        ${RAMP_GLSL}
        ${PUFF_CELL_GLSL}
        void main(){
          if (vLife <= 0.0) discard;
          float age = 1.0 - vLife;
          // Flames point UP: only a small lean, and half are mirrored.
          vec2 c = gl_PointCoord - 0.5;
          c.y = -c.y;
          float a = (fract(vSeed * 7.31) - 0.5) * 0.7 + (fract(vSeed * 3.7) - 0.5) * age * 1.2;
          c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
          if (fract(vSeed * 5.13) > 0.5) c.x = -c.x;
          float v = texture2D(uPuff, puffCell(vSeed, c + 0.5)).r;
          ${smoke ? `
          // Smoke: soft, dark, in then out.
          float d = smoothstep(0.05 + age * 0.3, 0.55 + age * 0.3, v);
          float al = d * 0.26 * sin(3.14159 * clamp(age * 1.3, 0.0, 1.0)) * vNear;
          gl_FragColor = vec4(vec3(0.05, 0.045, 0.042), al);
          ` : `
          // Fire ERODES as it dies: the threshold climbs, so a puff breaks
          // into tongues and wisps before it goes.
          float er = age * age * 0.6;
          float d = smoothstep(er, er + 0.55, v);
          // …and cools: yellow at birth, red at the end. One puff is faint;
          // white only where many burn on top of each other.
          float T = clamp(v * (0.3 + 0.62 * vHeat) * (0.3 + 0.62 * vLife), 0.0, 1.0);
          vec3 col = fireRamp(T, vCool);
          float e = d * mix(0.35, 1.0, v) * (0.25 + T * 1.0) * sqrt(vLife) * vNear * 1.2;
          gl_FragColor = vec4(col * e, e);
          `}
        }
      `,
      transparent: true,
      blending: smoke ? NormalBlending : AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    // The viewport this draw lands in (each eye's, in XR), for true size.
    this.points.onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(_viewport);
      if (_viewport.w > 0) mat.uniforms.uViewH.value = _viewport.w;
    };
    // Smoke under the fire, both after the solid world.
    this.points.renderOrder = smoke ? 1 : 3;
  }

  private slot(): number {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    this.staticDirty = true;
    return i;
  }

  spawnFire(p: Vector3, vx: number, vy: number, vz: number, life: number, size: number, heat: number, cool: number): void {
    const i = this.slot();
    this.set(i, p, vx, vy, vz, life, size);
    this.heat[i] = heat;
    this.cool[i] = cool;
  }

  spawnSmoke(p: Vector3, vx: number, vy: number, vz: number, life: number, size: number): void {
    this.set(this.slot(), p, vx, vy, vz, life, size);
  }

  private set(i: number, p: Vector3, vx: number, vy: number, vz: number, life: number, size: number): void {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.seed[i] = Math.random();
  }

  update(dt: number, time: number): void {
    if (this.alive === 0) return;
    // Air: fire is dragged hard (it stops dead off a thrown ball and lifts),
    // rises on its own heat, and is shoved about by a cheap swirl.
    const drag = Math.exp(-(this.smoke ? 1.6 : 3.2) * dt);
    const lift = (this.smoke ? 0.35 : 1.5) * dt;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      const s = this.seed[i] * 40;
      const t = time * 2.2;
      this.vel[o] = this.vel[o] * drag + Math.sin(t + s + this.pos[o + 1] * 9) * 0.9 * dt;
      this.vel[o + 1] = this.vel[o + 1] * drag + lift;
      this.vel[o + 2] = this.vel[o + 2] * drag + Math.cos(t * 1.3 + s + this.pos[o] * 9) * 0.9 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
      if (this.life[i] > 0) alive++;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    if (this.staticDirty) {
      for (const a of ['aSize', 'aHeat', 'aCool', 'aSeed']) this.geo.attributes[a].needsUpdate = true;
      this.staticDirty = false;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Particle pools — embers and trails, shared by every fireball in the scene.
// ---------------------------------------------------------------------------

interface PoolOpts {
  maxPx?: number;
  lifeExp?: number;
}

/** Ring-buffer GPU point pool: spawn() writes a slot, update() integrates. */
class ParticlePool {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private cursor = 0;
  /** Live-particle count: when 0 the whole pool skips CPU + GPU work. */
  private alive = 0;
  /** Colour/size only change at spawn — upload them only when they did. */
  private staticDirty = false;

  constructor(private readonly max: number, opts: PoolOpts = {}) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));

    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 480 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor; attribute float aLife; attribute float aSize;
        varying vec3 vColor; varying float vLife;
        void main(){ vColor=aColor; vLife=aLife;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * (uScale / -mv.z), 1.0, ${(opts.maxPx ?? 60).toFixed(1)});
          gl_Position = projectionMatrix * mv; }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vLife;
        void main(){ if(vLife<=0.0) discard;
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if(r>0.5) discard;
          float a = smoothstep(0.5,0.0,r) * pow(vLife, ${(opts.lifeExp ?? 1).toFixed(1)});
          gl_FragColor = vec4(vColor * (0.7 + vLife*0.6), a); }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(
    p: Vector3,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size: number, grav: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.staticDirty = true;
  }

  update(dt: number): void {
    if (this.alive === 0) return; // idle pool: no integration, no uploads
    const drag = Math.max(0, 1 - 0.5 * dt);
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
      if (this.life[i] > 0) alive++;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    if (this.staticDirty) {
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.staticDirty = false;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}

let emberPool: ParticlePool | undefined;
/** Every ball's shed fire, and the smoke off it: one draw each. */
let fireFx: FlamePool | undefined;
let smokeFx: FlamePool | undefined;
let poolTime = 0;
const _c = new Color();

/** Create the shared pools and add them to the scene. Call once at boot. */
export function initFirePools(scene: Scene): void {
  if (emberPool) return;
  emberPool = new ParticlePool(1024);
  const atlas = makePuffAtlas();
  // Sized for four balls in full flight (~110 live puffs each) with room
  // for launch flares; the point size caps (260 px) keep a puff against
  // your face from going full-screen in stereo.
  fireFx = new FlamePool(1536, false, atlas);
  smokeFx = new FlamePool(256, true, atlas);
  scene.add(emberPool.points, smokeFx.points, fireFx.points);
}

/** Integrate all live particles. Call once per frame (FXSystem does). */
export function updateFirePools(dt: number): void {
  poolTime += dt;
  emberPool?.update(dt);
  fireFx?.update(dt, poolTime);
  smokeFx?.update(dt, poolTime);
}

/** Remove particles when crossing between spatially unrelated experiences. */
export function clearFirePools(): void {
  emberPool?.clear();
  fireFx?.clear();
  smokeFx?.clear();
}

/**
 * Lift (or drop back) the ember pool's place in the transparent draw order.
 *
 * The pool sits at 0, which is right for a bout: fire belongs in the world,
 * sorted with it. It is wrong in the LOBBY, where the kit's menu panels ride
 * renderOrder 30 with depthWrite off specifically to beat transparent
 * scenery — so a fountain of sparks in front of a panel gets painted out by
 * the panel behind it. The promotion celebration borrows this to put its
 * fire back on top for the five seconds it owns the view, and puts it down
 * again on the way out. Pass 0 to restore.
 */
export function setEmberDrawOrder(order: number): void {
  if (emberPool) emberPool.points.renderOrder = order;
}

/** A drifting spark. cool=true gives the opponent's blue fire. */
export function spawnEmber(pos: Vector3, up = 0.4, cool = false): void {
  if (!emberPool) return;
  const hue = cool ? 0.55 + Math.random() * 0.07 : 0.04 + Math.random() * 0.06;
  _c.setHSL(hue, 1.0, 0.5 + Math.random() * 0.08);
  emberPool.spawn(
    pos,
    (Math.random() - 0.5) * 0.7,
    up + Math.random() * 0.7,
    (Math.random() - 0.5) * 0.7,
    _c.r, _c.g, _c.b,
    0.9 + Math.random() * 1.3,
    0.018 + Math.random() * 0.03,
    2.2,
  );
}

/** A shower of sparks (impacts, parries, knockouts). */
export function emberBurst(pos: Vector3, count: number, cool = false): void {
  for (let i = 0; i < count; i++) spawnEmber(pos, 0.8 + Math.random() * 1.4, cool);
}

/**
 * A trail stamp at `pos`. The wake itself is the fire each ball sheds as it
 * moves (createFireVisual), so a stamp only adds a hot fleck to it — which
 * is what a curveball's corkscrew stamps want: a spiral of brighter fire
 * wound round the wake, so the bend reads as SPIN.
 */
export function stampTrail(pos: Vector3, cool = false): void {
  if (!fireFx || Math.random() < 0.5) return;
  fireFx.spawnFire(
    pos,
    (Math.random() - 0.5) * 0.2,
    0.2 + Math.random() * 0.2,
    (Math.random() - 0.5) * 0.2,
    0.18 + Math.random() * 0.12,
    FIREBALL.radius * (1.4 + Math.random() * 0.8),
    1.4,
    cool ? 1 : 0,
  );
}
