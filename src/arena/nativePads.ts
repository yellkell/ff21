/**
 * THE STREET PADS — the Quest build's whole modelled platform skins, brought
 * home (ff2meta FF2Quest Arena/NativePads.cs, Shaders FF2PadLit.shader and
 * FF2EyeGlow.shader, PlatformFxSystem.cs's Pad* roles). The models and maps
 * are the native ones, converted by tools/native-pads.mjs into
 * public/store/pads.glb + public/store/pads/*.webp:
 *
 *   HELIPAD     a wet rooftop pad: the H in its yellow circle, eight landing
 *               lights a green chase runs round, a galvanised kerb with a lit
 *               cable an amber pulse runs along, red obstruction lights flashing
 *   AFTERGLOW   black glazed hex tile under a neon sign's glass tubes (pink
 *               outside, cyan inside, one run failing), a bolt buzzing in the floor
 *   MAINFRAME   gunmetal deck plates, etched circuit traces, a black-glass core
 *               a scan sweeps out of, a chamfered steel rim with a chase strip
 *   DEAD SMILEY black dry-brush X eyes and a wide grin on weathered white, a
 *               black rolled rim, a thin white neon breathing in its groove
 *
 * A pad wearing one keeps its slab, kit and furniture: the standard deck, the
 * frame (the machined bezel + socket bolts, or the street's iron frame) and
 * the neon tube are hidden and the model is laid in their place — the same
 * footprint, the same seat (the deck surface at +0.016; the kit deck's top is
 * +0.015), nothing below −0.06 (the skirt / the street's plinth and its line of
 * light stay). Gameplay reads none of it.
 *
 * Pads are born procedural and nothing waits on the network: the first time a
 * native skin is worn the GLB and that skin's maps load, and the pad keeps the
 * standard look until they are in; then each pad wearing it gets its set
 * (built once per pad and kept, hidden, after). Materials and textures are
 * shared by every pad wearing the same skin.
 *
 * Every surface is a MeshStandardMaterial with FF2/PadLit's glow map on the GPU
 * (onBeforeCompile): R static × em1, G animated × pulse colour × a band running
 * phase 0 → 1 (phase in B, or the tube's uv.x), A static × em2, and a neon buzz
 * — all off ONE shared time uniform, so the only per-frame CPU work is that
 * uniform. The GLOW_* markers seat world-locked glow sprites (FF2/EyeGlow's
 * maths: facing the eye's POSITION, pulled to their sphere's near face so a
 * glow seated in a lens draws over it, capped above) whose blink / buzz /
 * pulse / breathe is ALSO computed in their vertex shader off that clock, with
 * the same integer hash as the surfaces — so a glow buzzes with its tube.
 * The clock is advanced by any set's mesh as it draws (onBeforeRender), so
 * the arena, the pub and the previews all animate without a system hook.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  ImageBitmapLoader,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  RGBAFormat,
  SRGBColorSpace,
  ShaderChunk,
  ShaderMaterial,
  Sphere,
  Texture,
  TextureLoader,
  Vector2,
  type ColorSpace,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PadParts } from './padKit.js';

/** Skin id → its root node in pads.glb. */
const ROOTS: Record<string, string> = {
  helipad: 'PAD_HELIPAD',
  afterglow: 'PAD_AFTERGLOW',
  mainframe: 'PAD_MAINFRAME',
  smiley: 'PAD_SMILEY',
};

const BASE = 'store/';

/** Is this skin id one of the modelled pads. */
export function isNativePadId(id: string | null | undefined): boolean {
  return !!id && id in ROOTS;
}

// ── the clock (FF2/PadLit's _Time.y, NativePads.Clock) ─────────────────────

const T0 = typeof performance !== 'undefined' ? performance.now() : 0;
/** ONE uniform shared by every pad surface and glow. */
const TIME = { value: 0 };
let frozenAt: number | null = null;
/** Advance the shared clock (idempotent within a frame; any caller may). */
export function tickNativePads(): void {
  TIME.value = frozenAt ?? (performance.now() - T0) / 1000;
}
/** Pin the clock at `t` seconds (screenshots: pad-preview.html ?t=), or let it run. */
export function freezeNativePadClock(t: number | null): void {
  frozenAt = t;
  tickNativePads();
}

// ── loading ────────────────────────────────────────────────────────────────

interface PadRecord {
  base: number[];
  metallic: number;
  roughness: number;
  baseTex: string;
  glowTex: string;
  ormTex: string;
  /** make_pads.py's extras: normal, em1/em1x, em2/em2x, pulse/pulsex, pulse*, flick*, phaseUv, glowAll, env. */
  pad: Record<string, number | number[] | string>;
}

let model: Object3D | null = null;
let modelLoading: Promise<Object3D | null> | null = null;
const texCache = new Map<string, Promise<Texture | null>>();
const ready = new Set<string>();
const loadingSkin = new Map<string, Promise<boolean>>();
const pads = new Set<PadParts>();

function loadModel(): Promise<Object3D | null> {
  modelLoading ??= new Promise((done) => {
    new GLTFLoader().load(
      BASE + 'pads.glb',
      (gltf) => {
        model = gltf.scene;
        done(model);
      },
      undefined,
      () => done(null), // no pads.glb — every pad stays standard
    );
  });
  return modelLoading;
}

/** createImageBitmap with premultiplyAlpha 'none' (the glow map's alpha is a
 *  data channel: colour under clear alpha must survive) — as GLTFLoader picks. */
function bitmapsOk(): boolean {
  if (typeof createImageBitmap === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  const sv = safari ? Number(ua.match(/Version\/(\d+)/)?.[1] ?? -1) : -1;
  const ff = ua.indexOf('Firefox') > -1;
  const fv = ff ? Number(ua.match(/Firefox\/([0-9]+)\./)?.[1] ?? -1) : -1;
  return !(safari && sv < 17) && !(ff && fv < 98);
}

let bitmapLoader: ImageBitmapLoader | null = null;
let imageLoader: TextureLoader | null = null;

function loadTex(name: string, colorSpace: ColorSpace): Promise<Texture | null> {
  let p = texCache.get(name);
  if (p) return p;
  const url = `${BASE}pads/${name}.webp`;
  p = new Promise<Texture | null>((done) => {
    const finish = (t: Texture): void => {
      t.name = name;
      t.flipY = false; // glTF UVs: v = 0 is the image's top row
      t.colorSpace = colorSpace;
      t.anisotropy = 4; // decks are seen steeply from the fight floor
      t.needsUpdate = true;
      done(t);
    };
    if (bitmapsOk()) {
      bitmapLoader ??= new ImageBitmapLoader().setOptions({
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      bitmapLoader.load(url, (bmp) => finish(new Texture(bmp as unknown as HTMLImageElement)), undefined, () => done(null));
    } else {
      imageLoader ??= new TextureLoader();
      imageLoader.load(url, (t) => {
        t.premultiplyAlpha = false;
        finish(t);
      }, undefined, () => done(null));
    }
  });
  texCache.set(name, p);
  return p;
}

function recordsUnder(root: Object3D): PadRecord[] {
  const out: PadRecord[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const rec = (mesh.material as Material).userData as PadRecord;
    if (rec?.pad) out.push(rec);
  });
  return out;
}

/** The GLB and every map this skin's surfaces use; true when all are in. */
function loadSkin(id: string): Promise<boolean> {
  let p = loadingSkin.get(id);
  if (p) return p;
  p = loadModel().then(async (m) => {
    const root = m?.getObjectByName(ROOTS[id]);
    if (!root) return false;
    const jobs: Promise<Texture | null>[] = [];
    for (const r of recordsUnder(root)) {
      if (r.baseTex) jobs.push(loadTex(r.baseTex, SRGBColorSpace));
      if (r.ormTex) jobs.push(loadTex(r.ormTex, NoColorSpace));
      if (r.glowTex) jobs.push(loadTex(r.glowTex, NoColorSpace));
      if (typeof r.pad.normal === 'string') jobs.push(loadTex(r.pad.normal, NoColorSpace));
    }
    await Promise.all(jobs);
    ready.add(id);
    return true;
  });
  loadingSkin.set(id, p);
  return p;
}

// ── FF2/PadLit, as a MeshStandardMaterial ──────────────────────────────────

/** The integer hash and the neon buzz, shared by the surfaces and the glows
 *  (NativePads.Hash / Buzz: the same bits on every pad). */
const HASH_GLSL = /* glsl */ `
float ff2Hash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x & 0xffffffu) / 16777216.0;
}
float ff2Buzz(float amount, float rate, float seed, float t) {
  if (amount <= 0.0) return 1.0;
  uint step = uint(max(0.0, floor(t * rate))) + uint(seed * 977.0);
  float h = ff2Hash(step);
  float dip = h < 0.11 ? 0.25 + 0.6 * ff2Hash(step * 3u + 7u) : 1.0;
  float hum = 0.96 + 0.04 * sin(t * 377.0);
  return mix(1.0, dip * hum, amount);
}
`;

function solid(r: number, g: number, b: number, a: number): Texture {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat);
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}
let whiteTex: Texture | null = null;
let blackTex: Texture | null = null;

const num = (ex: PadRecord['pad'], k: string, d: number): number => (typeof ex[k] === 'number' ? (ex[k] as number) : d);
const vec = (ex: PadRecord['pad'], k: string, scale: string): [number, number, number] => {
  const v = Array.isArray(ex[k]) ? (ex[k] as number[]) : [0, 0, 0];
  const s = num(ex, scale, 1);
  return [v[0] * s, v[1] * s, v[2] * s];
};

/** How much of the scene's environment the pads take. The native pads are lit
 *  by the plaza's night panorama; the web lights every pad with a white
 *  studio light-box (arena/environment.ts RoomEnvironment), which on these
 *  glossy black glazes and dark steels reads as grey haze — so each record's
 *  `env` is scaled by this shared factor. NB three (r184) ignores a
 *  material's envMapIntensity when it lights from scene.environment (the
 *  uniform is set to scene.environmentIntensity), so the scale is applied in
 *  the shader: uPadEnv (the record's env) × uPadEnvScale (this). */
const ENV_SCALE = { value: 0.45 };
/** Retune the pads' share of the environment (pad-preview.html's knob). */
export function setNativePadEnvScale(k: number): void {
  ENV_SCALE.value = k;
}
export function nativePadEnvScale(): number {
  return ENV_SCALE.value;
}

const ENV_CHUNK = ShaderChunk.envmap_physical_pars_fragment.replaceAll(
  '* envMapIntensity',
  '* envMapIntensity * uPadEnv * uPadEnvScale',
);

function padLitCompile(shader: WebGLProgramParametersWithUniforms, u: Record<string, { value: unknown }>, glow: boolean): void {
  Object.assign(shader.uniforms, u);
  let frag = shader.fragmentShader
    .replace('#include <envmap_physical_pars_fragment>', ENV_CHUNK)
    .replace('#include <common>', '#include <common>\nuniform float uPadEnv, uPadEnvScale;');
  if (glow) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPadUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPadUv = uv;');
    frag = frag
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vPadUv;
uniform float uPadTime;
uniform sampler2D uGlow;
uniform vec3 uEm1, uEm2, uPulseCol;
uniform vec4 uPulse, uFlicker;
uniform float uPhaseUv;
${HASH_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // FF2/PadLit's glow map (FF2PadLit.shader frag)
  vec4 g = texture2D(uGlow, vPadUv);
  float t = uPadTime;
  float phase = mix(g.b, fract(vPadUv.x), uPhaseUv);
  float p = fract(t * uPulse.x - phase * max(uPulse.w, 1.0));
  float d = min(p, 1.0 - p);
  float band = exp(-d * d / max(uPulse.y * uPulse.y, 1e-5));
  float pulse = mix(uPulse.z, 1.0, band);
  totalEmissiveRadiance += uEm1 * g.r * ff2Buzz(uFlicker.x, uFlicker.z, uFlicker.w, t)
    + uPulseCol * g.g * pulse * ff2Buzz(uFlicker.y, uFlicker.z, uFlicker.w, t)
    + uEm2 * g.a;
}`,
      );
  }
  shader.fragmentShader = frag;
}

const mats = new Map<string, MeshStandardMaterial>();

/** One pad surface from its FFM1 record (shared by every pad). */
async function padMaterial(name: string, r: PadRecord): Promise<MeshStandardMaterial> {
  const hit = mats.get(name);
  if (hit) return hit;
  const ex = r.pad;
  const m = new MeshStandardMaterial({ name });
  m.color.setRGB(r.base[0], r.base[1], r.base[2], LinearSRGBColorSpace); // glTF: linear
  m.metalness = r.metallic;
  m.roughness = r.roughness;
  if (r.baseTex) m.map = await loadTex(r.baseTex, SRGBColorSpace);
  if (r.ormTex) {
    // ORM: R occlusion (indirect), G roughness ×, B metalness × — three's own channels.
    const orm = await loadTex(r.ormTex, NoColorSpace);
    m.aoMap = orm;
    m.roughnessMap = orm;
    m.metalnessMap = orm;
  }
  if (typeof ex.normal === 'string') {
    m.normalMap = await loadTex(ex.normal, NoColorSpace);
    // The maps are authored with +v up (Blender / Unity); three's derivative
    // frame runs B along glTF's v, which points down the image.
    m.normalScale = new Vector2(1, -1);
  }
  const em1 = vec(ex, 'em1', 'em1x');
  const em2 = vec(ex, 'em2', 'em2x');
  const pulse = vec(ex, 'pulse', 'pulsex');
  const lit = [...em1, ...em2, ...pulse].some((v) => v > 0);
  const u: Record<string, { value: unknown }> = {
    uPadEnv: { value: num(ex, 'env', 1) },
    uPadEnvScale: ENV_SCALE,
  };
  if (lit) {
    const glow = r.glowTex ? await loadTex(r.glowTex, NoColorSpace) : null;
    const glowAll = num(ex, 'glowAll', 0) > 0.5;
    whiteTex ??= solid(255, 255, 255, 255);
    blackTex ??= solid(0, 0, 0, 0);
    Object.assign(u, {
      uPadTime: TIME,
      uGlow: { value: glow ?? (glowAll ? whiteTex : blackTex) },
      uEm1: { value: new Color(...em1) },
      uEm2: { value: new Color(...em2) },
      uPulseCol: { value: new Color(...pulse) },
      uPulse: { value: [num(ex, 'pulseSpeed', 0), num(ex, 'pulseWidth', 0.1), num(ex, 'pulseFloor', 1), num(ex, 'pulseCount', 1)] },
      uFlicker: { value: [num(ex, 'flickR', 0), num(ex, 'flickG', 0), num(ex, 'flickRate', 9), num(ex, 'flickSeed', 0)] },
      uPhaseUv: { value: num(ex, 'phaseUv', 0) },
    });
  }
  m.onBeforeCompile = (shader) => padLitCompile(shader, u, lit);
  m.customProgramCacheKey = () => (lit ? 'ff2-padlit-glow' : 'ff2-padlit');
  mats.set(name, m);
  return m;
}

// ── the glows (FF2/EyeGlow, world-locked; PlatformFxSystem's Pad* roles) ───

const GLOW_VERT = /* glsl */ `
uniform float uPadTime, uSize, uPull, uCapY, uOpacity, uRole, uRate, uPhase, uAmount, uSeed;
varying vec2 vUv;
varying float vRise;
varying float vAlpha;
${HASH_GLSL}
void main() {
  vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float radius = 0.5 * uSize * length(modelMatrix[0].xyz);
  vec3 toEye = cameraPosition - centre;
  float dist = max(length(toEye), 1e-4);
  vec3 f = toEye / dist;
  vec3 r = cross(f, vec3(0.0, 1.0, 0.0));
  float rl = length(r);
  r = rl > 1e-3 ? r / rl : normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up = cross(r, f);
  // the sphere's near face, never past the eye; the same angular size
  float pull = min(uPull * radius, dist * 0.85);
  float k = (dist - pull) / dist;
  vec2 c = uv * 2.0 - 1.0;
  vec3 p = centre + f * pull + (r * c.x + up * c.y) * radius * k;
  vRise = p.y - centre.y;
  vUv = uv;
  // the motion, on the surfaces' clock (PlatformFxSystem.cs Pad*)
  float t = uPadTime;
  float o = 1.0;
  if (uRole > 0.5 && uRole < 1.5) {          // blink
    float cyc = fract(t * uRate + uPhase);
    o = 0.06 + 0.94 * clamp(1.0 - abs(cyc - 0.08) / 0.08, 0.0, 1.0);
  } else if (uRole < 2.5 && uRole > 1.5) {   // flicker (a neon buzz)
    o = ff2Buzz(uAmount, uRate, uSeed, t);
  } else if (uRole < 3.5 && uRole > 2.5) {   // pulse (the core's scan)
    float q = fract(t * uRate);
    float d = min(q, 1.0 - q);
    o = 0.35 + 0.65 * exp(-d * d / (0.06 * 0.06));
  } else if (uRole > 3.5) {                  // breathe
    o = 0.7 + 0.3 * sin((t * uRate + uPhase) * 6.28318530718);
  }
  vAlpha = uOpacity * o;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uCapY, uCapSoft;
varying vec2 vUv;
varying float vRise;
varying float vAlpha;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d = length(c);
  float s = clamp(1.0 - d * d, 0.0, 1.0);
  float a = 0.3 * exp(-d * d * 20.0) * s + 0.7 * s * s;
  a *= clamp((uCapY - vRise) / max(uCapSoft, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(uColor * a * vAlpha, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let glowQuad: BufferGeometry | null = null;
function quad(): BufferGeometry {
  if (glowQuad) return glowQuad;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3)); // every corner at the centre
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new Sphere(undefined, 1);
  glowQuad = g;
  return g;
}

const glowMats = new Map<string, ShaderMaterial>();

/** A GLOW_ marker's sprite material (shared by every pad wearing the skin). */
function glowMaterial(key: string, ex: Record<string, unknown>): ShaderMaterial {
  const hit = glowMats.get(key);
  if (hit) return hit;
  const n = (k: string, d: number): number => (typeof ex[k] === 'number' ? (ex[k] as number) : d);
  const c = Array.isArray(ex.glow) ? (ex.glow as number[]) : [1, 1, 1];
  let role = 0;
  let rate = 0;
  let amount = 0;
  if (n('blink', 0) > 0) {
    role = 1;
    rate = n('blink', 1);
  } else if (n('flick', 0) > 0) {
    role = 2;
    rate = n('flickRate', 9);
    amount = n('flick', 0);
  } else if (n('pulse', 0) !== 0) {
    role = 3;
    rate = n('pulse', 0.4);
  } else if (n('breathe', 0) > 0) {
    role = 4;
    rate = n('breathe', 0.3);
  }
  const cap = n('cap', -1);
  const m = new ShaderMaterial({
    name: 'pad-glow',
    uniforms: {
      uPadTime: TIME,
      // EyeGlow's colour is an sRGB colour (Unity converts it to linear)
      uColor: { value: new Color().setRGB(c[0], c[1], c[2], SRGBColorSpace) },
      uSize: { value: n('size', 0.1) },
      uOpacity: { value: n('opacity', 0.5) },
      uPull: { value: n('pull', 0) },
      uCapY: { value: cap >= 0 ? cap : 1e5 },
      uCapSoft: { value: cap >= 0 ? cap : 0.2 },
      uRole: { value: role },
      uRate: { value: rate },
      uPhase: { value: n('phase', 0) },
      uAmount: { value: amount },
      uSeed: { value: n('flickSeed', 0) },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  glowMats.set(key, m);
  return m;
}

// ── a pad's set ────────────────────────────────────────────────────────────

/** Build one skin's set under a pad (hidden until shown). Needs the skin loaded. */
async function build(p: PadParts, id: string): Promise<Object3D | null> {
  const src = model?.getObjectByName(ROOTS[id]);
  if (!src) return null;
  const set = src.clone(true);
  set.name = 'native-pad-' + id;
  set.position.set(0, 0, 0);
  const meshes: Mesh[] = [];
  const glows: Object3D[] = [];
  set.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    else if (o.name.startsWith('GLOW_')) glows.push(o);
  });
  for (const mesh of meshes) {
    const rec = (mesh.material as Material).userData as PadRecord;
    mesh.material = await padMaterial((mesh.material as Material).name, rec);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.onBeforeRender = tickNativePads;
  }
  for (const g of glows) {
    const s = new Mesh(quad(), glowMaterial(id + '/' + g.name, g.userData));
    s.name = g.name + '-glow';
    s.scale.setScalar(1); // the size is the material's (EyeGlow: _Size × the object's scale)
    s.frustumCulled = false; // the quad is spread in the vertex shader
    s.renderOrder = 2;
    s.onBeforeRender = tickNativePads;
    g.add(s);
  }
  set.visible = false;
  p.group.add(set);
  return set;
}

/** Wear this skin's model (or none) on a pad — NativePads.Show. A skin not
 *  loaded yet loads now; the pad stays standard until it lands. */
export function showNativePad(p: PadParts, skinId: string | null): void {
  const want = isNativePadId(skinId) ? skinId! : null;
  p.nativeId = want;
  pads.add(p);
  if (want && !ready.has(want)) {
    void loadSkin(want).then((ok) => {
      if (ok) for (const q of pads) if (q.nativeId === want) showNativePad(q, want);
    });
  } else if (want && !p.nativeSets?.has(want) && !p.nativeBuilding?.has(want)) {
    (p.nativeBuilding ??= new Set()).add(want);
    void build(p, want).then((set) => {
      p.nativeBuilding!.delete(want);
      if (set) (p.nativeSets ??= new Map()).set(want, set);
      showNativePad(p, p.nativeId ?? null);
    });
  }
  if (p.nativeSets) for (const [id, set] of p.nativeSets) set.visible = id === p.nativeId;
  applyNativeHides(p);
}

/** Hide (or restore) the standard deck, frame and tube under a shown set —
 *  NativePads.ApplyHides. Re-run after anything that re-dresses the pad (the
 *  kit landing, the street: padKit.ts wearStreet). */
export function applyNativeHides(p: PadParts): void {
  const on = !!p.nativeId && !!p.nativeSets?.get(p.nativeId);
  if (!on && !p.nativeHid) return; // never touched: leave the pad as it is
  p.nativeHid = on;
  p.slab.visible = !on;
  if (!p.machined) p.bolts.visible = !on; // the procedural studs (the kit hides them for good)
  const toggle = (set: Object3D | undefined, node: string): void => {
    const o = set?.getObjectByName(node);
    if (o) o.visible = !on;
  };
  toggle(p.machined, 'PAD_BEZEL');
  toggle(p.machined, 'PAD_BOLTS');
  toggle(p.street, 'STREET_FRAME');
  p.rim.visible = on ? false : !(p.street && p.street.visible);
}
