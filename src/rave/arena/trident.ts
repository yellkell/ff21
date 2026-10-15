/**
 * THE CYBER TRIDENT — the DJ's weapon for THE TRIDENT move.
 *
 * Its COLOUR is the read (config TRIDENT.forms): he conjures it, the room
 * sees cyan / magenta / lime, and knows the pattern before the first blow.
 * So it is built to be read from the back of the ring: a tall neon spear
 * with a white-hot core inside a coloured halo (the lasers' and the deck
 * rims' own anatomy), a three-pronged head with barbs, and the ringed
 * "eye" below the head — a silhouette that says TRIDENT at thirty metres.
 *
 * It MATERIALISES rather than appears: a hot scan front climbs from the
 * grip to the prong tips (`reveal`), holo bands drift up the shaft while
 * it's held, every blow flashes it white-hot (`flash`), and when the move
 * is done it dissolves back down into his fist.
 *
 * All geometry is baked into trident space (y up the shaft, the grip at
 * the origin) so the shader can read the reveal straight off position.y.
 * Two draws (core + halo) and two sprites — Quest-cheap.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  TorusGeometry,
  type Sprite,
  type SpriteMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEAT, HEAT_GLSL } from '../choreo/telegraphs.js';
import { glowSprite } from '../materials/glow.js';

/** Trident-space extents (rig metres): butt spike to the centre prong's tip. */
const BOTTOM = -0.62;
const TOP = 1.36;

const VERT = /* glsl */ `
  varying float vY;
  varying vec3 vN;
  varying vec3 vV;
  void main(){
    vY = position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  ${HEAT_GLSL}
  uniform vec3 uColor;
  uniform float uReveal, uFlash, uFade, uTime, uCore;
  varying float vY;
  varying vec3 vN;
  varying vec3 vV;
  void main(){
    float front = uReveal - vY;
    if (front < 0.0) discard;
    // The materialising edge burns hot as it climbs.
    float scan = 1.0 - smoothstep(0.0, 0.07, front);
    // Halo: brightest at the silhouette, so the tube reads round.
    float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float a = mix(0.18 + 0.7 * rim * rim, 1.0, uCore);
    // Holo bands drifting up the shaft while he holds it.
    a *= 0.82 + 0.18 * sin(vY * 70.0 - uTime * 9.0);
    vec3 col = mix(uColor, vec3(1.0), uCore * 0.7);
    col = mix(col, HOT, uFlash);
    a *= 1.0 + uFlash * 1.2;
    gl_FragColor = vec4((col * a + HOT * scan * 1.4) * uFade, 1.0);
  }
`;

/** One spar of the weapon: a cylinder from a to b (trident space, x/y plane). */
function spar(r: number, ax: number, ay: number, bx: number, by: number, sides = 6): BufferGeometry {
  const len = Math.hypot(bx - ax, by - ay);
  const g = new CylinderGeometry(r, r, len, sides, 1, false);
  g.rotateZ(-Math.atan2(bx - ax, by - ay));
  g.translate((ax + bx) / 2, (ay + by) / 2, 0);
  return g;
}

/** A crystal tip: a four-sided point rising from (x, y), leaning by `lean`. */
function tip(r: number, h: number, x: number, y: number, lean = 0): BufferGeometry {
  const g = new ConeGeometry(r, h, 4, 1);
  g.translate(0, h / 2, 0);
  g.rotateZ(-lean);
  g.translate(x, y, 0);
  return g;
}

/** The weapon's shape at a given thickness: the core is the same drawing
 *  as the halo, thinner — so the white line always sits inside the glow. */
function shape(t: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // The shaft, butt to collar.
  parts.push(spar(0.011 * t, 0, BOTTOM + 0.1, 0, 1.0));
  // The butt spike.
  const butt = new ConeGeometry(0.02 * t, 0.12, 4, 1);
  butt.rotateZ(Math.PI);
  butt.translate(0, BOTTOM + 0.06, 0);
  parts.push(butt);
  // The grip wraps — three rings just under and over the fist.
  for (const y of [-0.09, 0.0, 0.09]) {
    const ring = new TorusGeometry(0.02 * t, 0.004 * t, 4, 10);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  // THE EYE: the ringed circle the shaft runs through, below the head.
  const eye = new TorusGeometry(0.065, 0.008 * t, 5, 24);
  eye.translate(0, 0.84, 0);
  parts.push(eye);
  // The crossguard: a shallow V that throws the outer prongs wide.
  parts.push(spar(0.01 * t, -0.15, 1.08, 0, 1.0));
  parts.push(spar(0.01 * t, 0.15, 1.08, 0, 1.0));
  // The prongs: the centre one tallest, the outer two flaring out.
  parts.push(spar(0.01 * t, 0, 1.0, 0, 1.2));
  parts.push(tip(0.03 * t, 0.16, 0, 1.2));
  for (const s of [-1, 1]) {
    parts.push(spar(0.009 * t, s * 0.15, 1.08, s * 0.17, 1.17));
    parts.push(tip(0.026 * t, 0.13, s * 0.17, 1.17, s * 0.16));
    // A barb hooking back off each outer prong.
    parts.push(spar(0.006 * t, s * 0.165, 1.12, s * 0.215, 1.08));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  return merged ?? new BufferGeometry();
}

const HOT = new Color(HEAT.hot);
let coreGeo: BufferGeometry | null = null;
let haloGeo: BufferGeometry | null = null;

export class CyberTrident {
  readonly root = new Group();
  private mats: ShaderMaterial[] = [];
  private headGlow: Sprite;
  private scanGlow: Sprite;
  private color = new Color();
  private time = 0;

  /** `drawing`: a core + halo pair in trident space to wear instead of the
   *  procedural one (the titans' Blender-built weapon, campaign/titanKit). */
  constructor(drawing?: { core: BufferGeometry; halo: BufferGeometry }) {
    this.root.name = 'cyber-trident';
    // Drawn at a spear's proportions; held, it stands a head over him.
    this.root.scale.setScalar(0.78);
    coreGeo ??= shape(1);
    haloGeo ??= shape(2.6);
    const halo = drawing?.halo ?? haloGeo;
    const line = drawing?.core ?? coreGeo;
    for (const [geo, core] of [[halo, 0], [line, 1]] as const) {
      const mat = new ShaderMaterial({
        uniforms: {
          uColor: { value: this.color },
          uReveal: { value: BOTTOM },
          uFlash: { value: 0 },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uCore: { value: core },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, mat);
      mesh.renderOrder = 12 + core;
      // The shader discards above the reveal; the bounds never change.
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.mats.push(mat);
    }
    this.headGlow = glowSprite(0xffffff, 0.55, 0.8);
    this.headGlow.position.set(0, 1.12, 0);
    this.root.add(this.headGlow);
    this.scanGlow = glowSprite(HEAT.hot, 0.22, 0.9);
    this.root.add(this.scanGlow);
    this.root.visible = false;
  }

  /** The form's colour — the read. */
  setColor(hex: number): void {
    this.color.setHex(hex);
    (this.headGlow.material as SpriteMaterial).color.setHex(hex);
  }

  /**
   * `reveal` 0..1 climbs the scan front from butt to tip (and runs it back
   * down to dissolve); `flash` 0..1 is a blow's white-hot flare; `fade`
   * dims the whole weapon.
   */
  update(dt: number, reveal: number, flash: number, fade = 1): void {
    this.time += dt;
    const on = reveal > 0.001 && fade > 0.001;
    this.root.visible = on;
    if (!on) return;
    const y = BOTTOM + (TOP - BOTTOM + 0.02) * Math.min(1, reveal);
    for (const m of this.mats) {
      m.uniforms.uReveal.value = y;
      m.uniforms.uFlash.value = flash;
      m.uniforms.uFade.value = fade;
      m.uniforms.uTime.value = this.time;
    }
    // The head's glow wakes once the head exists, and swells on a blow.
    const head = Math.max(0, Math.min(1, (y - 1.0) / 0.3));
    this.headGlow.material.opacity = (0.55 + flash * 0.45) * head * fade;
    this.headGlow.scale.setScalar(0.5 + flash * 0.5);
    if (flash > 0.01) (this.headGlow.material as SpriteMaterial).color.copy(this.color).lerp(HOT, flash);
    else (this.headGlow.material as SpriteMaterial).color.copy(this.color);
    // A spark riding the scan front while it climbs.
    const climbing = reveal < 1;
    this.scanGlow.visible = climbing;
    this.scanGlow.position.y = y;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.headGlow.material.dispose();
    this.scanGlow.material.dispose();
  }
}
