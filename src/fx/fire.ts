/**
 * The fire. An IRON fireball: a cast-iron shot split by molten cracks,
 * wrapped in REAL fire — a Mantaflow fire sim rendered in Blender into a
 * looping flipbook (tools/blender/fireball_fire.py + fireball_pack.py) —
 * plus shared GPU particle pools for embers and comet trails, whose trail
 * puffs are frames of the same fire.
 *
 *   THE IRON   tools/blender/fireball_iron.py bakes the shot's maps: a
 *              blackened, oxide-scaled, pitted surface and the cracks'
 *              glow. The cracks open and brighten with the ball's heat and
 *              the heat crawls along them; its own flames light its rim.
 *   THE FLAMES one camera-facing card drawn just in front of the iron. The
 *              flipbook's 'front' pass held the iron as a holdout, so inside
 *              the iron's disc only the fire IN FRONT of it survives —
 *              drawn over the shot it composites exactly, flames wrapping
 *              round the iron. The card stands its fire up the screen at
 *              rest and streams it back along the flight at speed.
 *
 * Until the textures land (and if they never do) the ball is the original
 * all-procedural molten core and rippling corona, so a slow network never
 * means an invisible fireball.
 *
 * Each ball is tintable per team: your fire burns orange, theirs burns blue
 * (`uCool` mixes the two colour ramps in-shader). The flipbook is grey —
 * flame intensity — and gradient-mapped here, so both teams burn from one
 * bake.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  TextureLoader,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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

/**
 * The fire's colour, by intensity: a blackbody-ish ramp from a dull red lick
 * to a white-hot core — warm for your team, a blue torch for theirs.
 */
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

// ---------------------------------------------------------------------------
// The fallback ball — the original molten core and corona
// ---------------------------------------------------------------------------

/** Molten core: noise-driven heat with a 4-stop ramp, orange↔blue by uCool. */
const CORE_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool;
  varying vec3 vPos;
  ${NOISE_GLSL}
  void main(){
    vec3 q = vPos * 5.0 / ${FIREBALL.radius.toFixed(3)} * 0.1;
    q.y -= uTime * 1.6;                 // flames lick upward
    float heat = clamp((fbm(q) * 0.5 + 0.65) * uHeat, 0.0, 1.7);
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
    gl_FragColor = vec4(col * 1.95 * mix(0.12, 1.0, expo), 1.0);
  }
`;

const CORE_VERT = /* glsl */ `
  varying vec3 vPos;
  void main(){ vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * Additive corona: rippled rim + white-hot kiss at the centre, flickering.
 * Once the real fire is in, `uGlow` drops it to a soft heat halo under the
 * flames (no ripple, no kiss) — the light a fire throws, not a fire.
 */
const CORONA_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uCool, uGlow;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    p.y -= 0.08;                        // reaches a touch higher than it hangs
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    float ripple = mix(fbm(vec3(cos(ang), sin(ang), uTime * 0.7) * 1.4), 0.0, uGlow);
    float maxR = 0.62 + ripple * 0.22;
    float fall = pow(clamp(1.0 - r / maxR, 0.0, 1.0), mix(1.6, 2.6, uGlow));
    float glow = fall * uHeat;
    glow += pow(max(1.0 - r * 2.4, 0.0), 2.0) * 0.9 * (1.0 - uGlow); // white-hot centre kiss
    vec3 warm = mix(vec3(1.0, 0.36, 0.04), vec3(1.0, 0.82, 0.40), pow(fall, 2.0));
    vec3 cool = mix(vec3(0.10, 0.45, 1.0), vec3(0.55, 0.85, 1.0), pow(fall, 2.0));
    vec3 col = mix(warm, cool, uCool);
    float flick = 0.9 + 0.1 * sin(uTime * 16.0);
    float k = mix(1.0, 0.32, uGlow);
    gl_FragColor = vec4(col * glow * flick * k, min(glow, 1.2) * k);
  }
`;

const CORONA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// ---------------------------------------------------------------------------
// The real fire — the flipbook card
// ---------------------------------------------------------------------------

/** The flipbook: 8x8 cells, 64 looping frames (fireball_pack.py). */
const FLIP_GRID = 8;
const FLIP_FRAMES = 64;
const FLIP_FPS = 30;
/** The sim's framing in iron radii (fireball_fire.py HALF / BOTTOM): the
 *  card is 2*HALF radii square, the iron's centre BOTTOM below its middle… */
const FIRE_HALF = 2.9;
const FIRE_BOTTOM = -1.9;
/** …so the card's centre sits this far up its own 'up' from the iron. */
const FIRE_LIFT = (FIRE_HALF + FIRE_BOTTOM) / (2 * FIRE_HALF);

const FLAME_VERT = /* glsl */ `
  uniform float uSize, uRadius;
  uniform vec3 uVel;
  varying vec2 vUv;
  varying float vStretch;
  void main(){
    vUv = uv;
    // The iron's centre and world scale (a swollen split ball burns bigger).
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float scale = length(modelMatrix[0].xyz);
    float s = scale * uSize;
    // The fire's 'up' on screen: world up, swinging round to trail the
    // flight once the ball is really moving across the view.
    vec2 up2 = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
    up2 = length(up2) > 1e-3 ? normalize(up2) : vec2(0.0, 1.0);
    vec2 back2 = -(viewMatrix * vec4(uVel, 0.0)).xy;
    float bl = length(back2);
    float spd = length(uVel);
    float k = smoothstep(1.2, 6.0, spd) * smoothstep(0.15, 0.45, bl / max(spd, 1e-3));
    vec2 dir = normalize(mix(up2, back2 / max(bl, 1e-4), k));
    vec2 side = vec2(dir.y, -dir.x);
    // Streams longer and a touch narrower at speed, like a real torch.
    float stretch = 1.0 + 0.55 * k;
    vStretch = k;
    vec2 q = vec2(position.x * (1.0 - 0.12 * k), (position.y + ${FIRE_LIFT.toFixed(4)}) * stretch);
    vec2 off = (side * q.x + dir * q.y) * s;
    // Stand the card in front of the iron (it carries only the fire in front
    // of it), rescaled so its size on screen doesn't change.
    float z1 = c.z + scale * uRadius * 1.05;
    z1 = min(z1, -0.02);
    float f = z1 / c.z;
    gl_Position = projectionMatrix * vec4((c.xy + off) * f, z1, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uFrame, uHeat, uCool, uGain;
  varying vec2 vUv;
  varying float vStretch;
  ${RAMP_GLSL}
  vec2 cell(float i, vec2 uv){
    float col = mod(i, ${FLIP_GRID.toFixed(1)});
    float row = floor(i / ${FLIP_GRID.toFixed(1)});
    return vec2((col + uv.x) / ${FLIP_GRID.toFixed(1)}, 1.0 - (row + 1.0 - uv.y) / ${FLIP_GRID.toFixed(1)});
  }
  void main(){
    // Inset a hair so a cell's neighbour never bleeds in at the edge.
    vec2 uv = clamp(vUv, 0.004, 0.996);
    float i0 = mod(floor(uFrame), ${FLIP_FRAMES.toFixed(1)});
    float i1 = mod(i0 + 1.0, ${FLIP_FRAMES.toFixed(1)});
    float a = texture2D(uAtlas, cell(i0, uv)).r;
    float b = texture2D(uAtlas, cell(i1, uv)).r;
    float v = mix(a * a, b * b, fract(uFrame));        // stored as sqrt
    // Heat: a dead shot's fire is out; a roaring orbit burns white at heart.
    float lit = smoothstep(0.2, 0.85, uHeat);
    float hot = clamp(v * (0.7 + 0.35 * uHeat), 0.0, 1.0);
    vec3 col = fireRamp(hot, uCool);
    float e = v * lit * uGain * (1.0 - 0.25 * vStretch);
    gl_FragColor = vec4(col * e, e);
  }
`;

// ---------------------------------------------------------------------------
// The kit — the iron and the flipbook, loaded once
// ---------------------------------------------------------------------------

interface FireKit {
  ironGeo: BufferGeometry;
  albedo: Texture;
  orm: Texture;
  nrm: Texture;
  heat: Texture;
  atlas: Texture;
}

const FIRE_BASE = 'arena/fire/';
let fireKit: FireKit | null = null;
let fireKitLoading = false;
/** Live visuals waiting on the kit (and every live one, to upgrade later). */
const liveVisuals = new Set<{ upgrade(k: FireKit): void }>();

function loadFireKit(): void {
  if (fireKitLoading) return;
  fireKitLoading = true;
  const tex = new TextureLoader().setPath(FIRE_BASE);
  Promise.all([
    new GLTFLoader().loadAsync(FIRE_BASE + 'iron.glb'),
    tex.loadAsync('iron_albedo.jpg'),
    tex.loadAsync('iron_orm.jpg'),
    tex.loadAsync('iron_nrm.webp'),
    tex.loadAsync('iron_heat.jpg'),
    tex.loadAsync('flames.webp'),
  ])
    .then(([gltf, albedo, orm, nrm, heat, atlas]) => {
      let ironGeo: BufferGeometry | null = null;
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && !ironGeo) {
          // Baked at radius 1; the game's iron is FIREBALL.radius.
          ironGeo = m.geometry.clone().scale(FIREBALL.radius, FIREBALL.radius, FIREBALL.radius);
          (m.material as MeshStandardMaterial).dispose();
        }
      });
      if (!ironGeo) throw new Error('iron.glb has no mesh');
      albedo.colorSpace = SRGBColorSpace;
      for (const t of [albedo, orm, nrm, heat]) {
        t.flipY = false; // the iron's own glTF UVs: v runs down the image
        t.anisotropy = 4;
      }
      fireKit = { ironGeo, albedo, orm, nrm, heat, atlas };
      for (const v of liveVisuals) v.upgrade(fireKit);
      trailPool?.useAtlas(atlas);
    })
    .catch((err) => {
      console.warn('[fire] kit failed to load; keeping the procedural fireball', err);
    });
}

/** The iron's material: baked PBR maps, the cracks' heat drawn in-shader. */
function ironMaterial(k: FireKit, uniforms: { uTime: { value: number }; uHeat: { value: number }; uCool: { value: number } }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: k.albedo,
    aoMap: k.orm,
    roughnessMap: k.orm,
    metalnessMap: k.orm,
    normalMap: k.nrm,
    emissiveMap: k.heat,
    emissive: 0xffffff,
    roughness: 1,
    metalness: 1,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHeat = uniforms.uHeat;
    shader.uniforms.uCool = uniforms.uCool;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uTime, uHeat, uCool;\n${RAMP_GLSL}\nvoid main() {`)
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        {
          vec4 h = texture2D( emissiveMap, vEmissiveMapUv );
          // The cracks OPEN as the iron heats: the glow's falloff (R) is
          // thresholded lower and lower, so the molten line widens.
          float open = clamp(uHeat / 1.45, 0.0, 1.0);
          // (The baked falloff peaks ~0.8 on a seam's centre line; ~1% of the
          // shot is above 0.5, ~5% above 0.1.)
          float crack = smoothstep(0.6 - 0.4 * open, 0.78, h.r);
          // Heat crawls along them (B is a slow noise to pan through).
          float crawl = 0.62 + 0.38 * sin(uTime * 3.1 + h.b * 14.0);
          float glow = crack * crawl + h.g * 0.5 * open;
          vec3 molten = fireRamp(clamp(0.25 + glow * 0.7 * (0.4 + 0.6 * open), 0.0, 1.0), uCool);
          float level = mix(0.35, 3.2, smoothstep(0.1, 1.45, uHeat));
          totalEmissiveRadiance = molten * glow * level;
          // At full roar the whole shot goes a dull red-hot — faint, so the
          // iron still reads as iron.
          totalEmissiveRadiance += fireRamp(0.06, uCool) * 0.035 * smoothstep(1.2, 1.5, uHeat);
          // Its own flames light the iron: a hot rim where the surface turns
          // away from you, into the fire wrapped round it.
          float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * fireRamp(0.45, uCool) * rim * 0.8 * smoothstep(0.2, 0.9, uHeat);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'ff2-iron';
  return m;
}

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
/**
 * The card, trimmed to where the flipbook actually burns: a margin round the
 * widest licks, nothing under the iron. Under half the full frame — and on
 * Quest, additive overdraw is what a fireball costs. (Card units: the full
 * frame is -0.5..0.5; the iron's centre sits FIRE_LIFT below its middle.)
 */
const FLAME_GEO = (() => {
  const g = new PlaneGeometry(0.62, 0.8).translate(0, 0.02, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) + 0.5);
  return g;
})();

// ---------------------------------------------------------------------------
// The tail — one flame ribbon per ball
// ---------------------------------------------------------------------------

/** Points along a tail, and how long one lives (s) — the tail's length. */
const RIBBON_POINTS = 28;
const RIBBON_LIFE = 0.3;
/** Below this speed (m/s) the ball lays no new tail; what's there burns off. */
const RIBBON_MIN_SPEED = 1.2;
/** A new point every this far (m) the ball travels. */
const RIBBON_SPACING = 0.014;

const RIBBON_VERT = /* glsl */ `
  attribute vec3 aOther;
  attribute float aSide, aT;
  uniform float uWidth;
  varying vec2 vUv;
  void main(){
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    vec4 o = modelViewMatrix * vec4(aOther, 1.0);
    // Across the tail on screen: perpendicular to its run in perspective.
    vec2 d = p.xy / -p.z - o.xy / -o.z;
    d = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    // Swells just behind the iron, then tapers to a point.
    float w = uWidth * pow(1.0 - aT, 0.75) * (0.6 + 0.4 * smoothstep(0.0, 0.15, aT));
    p.xy += n * aSide * w;
    vUv = vec2(aSide * 0.5 + 0.5, aT);
    gl_Position = projectionMatrix * p;
  }
`;

const RIBBON_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uFrame, uHeat, uCool, uGain;
  varying vec2 vUv;
  ${RAMP_GLSL}
  vec2 cell(float i, vec2 uv){
    float col = mod(i, ${FLIP_GRID.toFixed(1)});
    float row = floor(i / ${FLIP_GRID.toFixed(1)});
    return vec2((col + uv.x) / ${FLIP_GRID.toFixed(1)}, 1.0 - (row + 1.0 - uv.y) / ${FLIP_GRID.toFixed(1)});
  }
  void main(){
    // The sim's fire laid along the flight: its 'up' runs down the tail
    // (from just over the iron to the tips), its width across it. The
    // 'full' pass (G) — there is no iron inside a tail.
    vec2 uv = vec2(mix(0.28, 0.72, vUv.x), mix(0.34, 0.82, vUv.y));
    // Each stretch of the tail burns its own moment of the loop, so the
    // rope churns rather than pulsing in step.
    float f = uFrame + vUv.y * 14.0;
    float i0 = mod(floor(f), ${FLIP_FRAMES.toFixed(1)});
    float i1 = mod(i0 + 1.0, ${FLIP_FRAMES.toFixed(1)});
    float a = texture2D(uAtlas, cell(i0, uv)).g;
    float b = texture2D(uAtlas, cell(i1, uv)).g;
    float v = mix(a * a, b * b, fract(f));
    // A hot core down the middle keeps the rope whole where a frame's
    // licks thin out.
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    v = max(v, 0.55 * smoothstep(0.35, 1.0, across) * (1.0 - vUv.y));
    float lit = smoothstep(0.2, 0.85, uHeat);
    float cool = 1.0 - 0.55 * vUv.y;                 // the tail burns down as it trails
    vec3 col = fireRamp(clamp(v * (0.75 + 0.3 * uHeat) * cool, 0.0, 1.0), uCool);
    float e = v * lit * uGain * cool * smoothstep(0.0, 0.25, across);
    gl_FragColor = vec4(col * e, e);
  }
`;

/** The scene the tails burn in (world space — a tail must not ride its ball). */
let fireScene: Scene | null = null;

class FlameRibbon {
  readonly mesh: Mesh;
  private readonly pts = new Float32Array(RIBBON_POINTS * 3);
  private readonly ages = new Float32Array(RIBBON_POINTS);
  private n = 0;
  private readonly pos: Float32Array;
  private readonly other: Float32Array;
  private readonly t: Float32Array;
  private readonly geo = new BufferGeometry();

  constructor(material: ShaderMaterial) {
    const verts = RIBBON_POINTS * 2;
    this.pos = new Float32Array(verts * 3);
    this.other = new Float32Array(verts * 3);
    this.t = new Float32Array(verts);
    const side = new Float32Array(verts);
    for (let i = 0; i < verts; i++) side[i] = i % 2 === 0 ? -1 : 1;
    const index: number[] = [];
    for (let i = 0; i < RIBBON_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(index);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aOther', new BufferAttribute(this.other, 3));
    this.geo.setAttribute('aT', new BufferAttribute(this.t, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setDrawRange(0, 0);
    this.mesh = new Mesh(this.geo, material);
    this.mesh.frustumCulled = false; // world-space points; the culler can't know
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Drop the whole tail (a teleport: respawn, recall snap). */
  clear(): void {
    this.n = 0;
    this.mesh.visible = false;
  }

  update(head: Vector3, dt: number, laying: boolean): void {
    const P = this.pts;
    for (let i = 0; i < this.n; i++) this.ages[i] += dt;
    while (this.n > 0 && this.ages[this.n - 1] > RIBBON_LIFE) this.n--;
    if (laying) {
      const d = this.n > 1 ? Math.hypot(head.x - P[3], head.y - P[4], head.z - P[5]) : Infinity;
      if (this.n === 0 || d > RIBBON_SPACING) {
        // A new head point: shift the tail down one.
        const keep = Math.min(this.n, RIBBON_POINTS - 1);
        P.copyWithin(3, 0, keep * 3);
        this.ages.copyWithin(1, 0, keep);
        this.n = keep + 1;
      }
    }
    if (this.n > 0) {
      // The head always rides the ball.
      P[0] = head.x;
      P[1] = head.y;
      P[2] = head.z;
      this.ages[0] = 0;
    }
    if (this.n < 2) {
      this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < this.n; i++) {
      // 'other' is the point toward the head (mirrored past the head itself),
      // so (p - other) always runs tail-ward.
      const ox = i > 0 ? P[(i - 1) * 3] : 2 * P[0] - P[3];
      const oy = i > 0 ? P[(i - 1) * 3 + 1] : 2 * P[1] - P[4];
      const oz = i > 0 ? P[(i - 1) * 3 + 2] : 2 * P[2] - P[5];
      const t = i === this.n - 1 ? 1 : Math.min(1, this.ages[i] / RIBBON_LIFE);
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        this.pos[v * 3] = P[i * 3];
        this.pos[v * 3 + 1] = P[i * 3 + 1];
        this.pos[v * 3 + 2] = P[i * 3 + 2];
        this.other[v * 3] = ox;
        this.other[v * 3 + 1] = oy;
        this.other[v * 3 + 2] = oz;
        this.t[v] = t;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aOther.needsUpdate = true;
    this.geo.attributes.aT.needsUpdate = true;
    this.geo.setDrawRange(0, (this.n - 1) * 6);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
  }
}

const _wp = new Vector3();
/** Faster than any throw (8.5) or recall (9.5) — a jump beyond it is a teleport. */
const MAX_BALL_SPEED = 14;

/** Build a fireball: iron core + real fire (or the procedural one until
 *  the kit lands). team 1 burns blue. */
export function createFireVisual(team: 0 | 1): FireVisual {
  const cool = team === 1 ? 1 : 0;
  // Shared by the core, the iron, the corona and the flames.
  const uTime = { value: 0 };
  const uHeat = { value: 0.8 };
  const uCool = { value: cool };

  const coreMat = new ShaderMaterial({
    uniforms: { uTime, uHeat, uCool },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    transparent: true,
    depthWrite: true,
  });
  // Typed loosely: the procedural core is swapped for the iron when the kit lands.
  const core = new Mesh<BufferGeometry, ShaderMaterial | MeshStandardMaterial>(CORE_GEO, coreMat);
  core.renderOrder = 1;

  const uGlow = { value: 0 };
  const coronaMat = new ShaderMaterial({
    uniforms: { uTime, uHeat, uCool, uGlow },
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

  let ironMat: MeshStandardMaterial | null = null;
  let flameMat: ShaderMaterial | null = null;
  let ribbonMat: ShaderMaterial | null = null;
  let ribbon: FlameRibbon | null = null;
  // Velocity from the group's own motion — the card trails the flight.
  const uVel = { value: new Vector3() };
  const lastPos = new Vector3();
  let lastTime = -1;
  let tracked = false;
  // Each ball burns its own phase of the loop, so a pair never flicker in step.
  const phase = Math.random() * FLIP_FRAMES;
  const uFrame = { value: phase };

  const handle = {
    upgrade(k: FireKit) {
      if (ironMat) return;
      ironMat = ironMaterial(k, { uTime, uHeat, uCool });
      core.geometry = k.ironGeo;
      core.material = ironMat;
      core.renderOrder = 0;
      coreMat.dispose();
      // The real fire needs no halo: one fewer big additive quad per ball.
      corona.visible = false;
      flameMat = new ShaderMaterial({
        uniforms: {
          uAtlas: { value: k.atlas },
          uFrame,
          uHeat,
          uCool,
          uGain: { value: 2.4 },
          uSize: { value: FIREBALL.radius * 2 * FIRE_HALF },
          uRadius: { value: FIREBALL.radius },
          uVel,
        },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const flames = new Mesh(FLAME_GEO, flameMat);
      // The card is placed in the vertex shader; its geometry bounds mean
      // nothing to the culler.
      flames.frustumCulled = false;
      flames.renderOrder = 3;
      group.add(flames);
      ribbonMat = new ShaderMaterial({
        uniforms: {
          uAtlas: { value: k.atlas },
          uFrame,
          uHeat,
          uCool,
          uGain: { value: 2.2 },
          uWidth: { value: FIREBALL.radius * 1.8 },
        },
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      ribbon = new FlameRibbon(ribbonMat);
      fireScene?.add(ribbon.mesh);
    },
  };
  if (fireKit) handle.upgrade(fireKit);
  liveVisuals.add(handle);

  return {
    group,
    update(time, heat, cameraQuat) {
      const dt = lastTime < 0 ? 0 : time - lastTime;
      lastTime = time;
      uTime.value = time;
      uHeat.value = heat;
      uFrame.value = phase + time * FLIP_FPS * (0.85 + 0.25 * Math.min(heat, 1.5));
      if (corona.visible) corona.quaternion.copy(group.quaternion).invert().multiply(cameraQuat);
      // Tracked from the first frame (the flames may arrive later, and must
      // not read the trip from the origin as speed). Smoothed, and anything
      // faster than a ball can fly — a respawn, a recall snap — is a
      // teleport, not a velocity.
      group.getWorldPosition(_wp);
      if (tracked && dt > 1e-4 && dt < 0.25) {
        const v = uVel.value;
        const vx = (_wp.x - lastPos.x) / dt;
        const vy = (_wp.y - lastPos.y) / dt;
        const vz = (_wp.z - lastPos.z) / dt;
        if (vx * vx + vy * vy + vz * vz < MAX_BALL_SPEED * MAX_BALL_SPEED) {
          const a = Math.min(1, dt * 14);
          v.set(v.x + (vx - v.x) * a, v.y + (vy - v.y) * a, v.z + (vz - v.z) * a);
        } else {
          ribbon?.clear(); // a teleport: no tail across the gap
        }
      }
      tracked = true;
      lastPos.copy(_wp);
      if (ribbon) {
        // The tail burns only off a visible, lit, moving ball.
        const laying = group.visible && heat > 0.3 && uVel.value.length() > RIBBON_MIN_SPEED;
        if (group.visible) ribbon.update(_wp, Math.max(0, Math.min(dt, 0.1)), laying);
        else ribbon.clear();
      }
    },
    setCool(c) {
      uCool.value = c;
    },
    dispose() {
      liveVisuals.delete(handle);
      coreMat.dispose();
      coronaMat.dispose();
      ironMat?.dispose();
      flameMat?.dispose();
      ribbonMat?.dispose();
      ribbon?.dispose();
      group.removeFromParent();
    },
  };
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
  private readonly mat: ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly seed: Float32Array;
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
    this.seed = new Float32Array(max);

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('aSeed', new BufferAttribute(this.seed, 1));

    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 480 }, uAtlas: { value: null }, uFire: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uScale, uFire;
        attribute vec3 aColor; attribute float aLife; attribute float aSize; attribute float aSeed;
        varying vec3 vColor; varying float vLife; varying float vSeed;
        void main(){ vColor=aColor; vLife=aLife; vSeed=aSeed;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          // A fire puff's flame fills only the middle of its frame: draw it bigger.
          float k = mix(1.0, 1.5, uFire);
          gl_PointSize = clamp(aSize * k * (uScale / -mv.z), 1.0, ${(opts.maxPx ?? 60).toFixed(1)});
          gl_Position = projectionMatrix * mv; }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uFire;
        varying vec3 vColor; varying float vLife; varying float vSeed;
        void main(){ if(vLife<=0.0) discard;
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if(r>0.5) discard;
          float a = smoothstep(0.5,0.0,r) * pow(vLife, ${(opts.lifeExp ?? 1).toFixed(1)});
          vec3 col = vColor * (0.7 + vLife*0.6);
          if (uFire > 0.5) {
            // A frame of the real fire ('full' pass, G): its own random frame,
            // running on as it ages, mirrored half the time.
            vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
            if (fract(vSeed * 7.31) > 0.5) uv.x = 1.0 - uv.x;
            uv = clamp(uv, 0.004, 0.996);
            float f = mod(floor(vSeed * ${FLIP_FRAMES.toFixed(1)} + (1.0 - vLife) * 18.0), ${FLIP_FRAMES.toFixed(1)});
            vec2 cuv = vec2((mod(f, ${FLIP_GRID.toFixed(1)}) + uv.x) / ${FLIP_GRID.toFixed(1)},
                            1.0 - (floor(f / ${FLIP_GRID.toFixed(1)}) + 1.0 - uv.y) / ${FLIP_GRID.toFixed(1)});
            float v = texture2D(uAtlas, cuv).g;
            v *= v;
            // Hot licks whiten; the tint is the stamp's team colour.
            col = mix(vColor, vec3(1.0, 0.95, 0.82), v * v * 0.7) * v * 2.2 * (0.55 + vLife * 0.6);
            a = pow(vLife, ${(opts.lifeExp ?? 1).toFixed(1)});
          }
          gl_FragColor = vec4(col, a); }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  /** Draw every particle as a frame of the real fire from now on. */
  useAtlas(atlas: Texture): void {
    this.mat.uniforms.uAtlas.value = atlas;
    this.mat.uniforms.uFire.value = 1;
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
    this.seed[i] = Math.random();
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
      this.geo.attributes.aSeed.needsUpdate = true;
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
let trailPool: ParticlePool | undefined;
const _c = new Color();

/** Create the shared pools and add them to the scene. Call once at boot. */
export function initFirePools(scene: Scene): void {
  if (emberPool) return;
  emberPool = new ParticlePool(1024);
  // maxPx caps the worst case: a trail slug right against your face would
  // otherwise become a near-fullscreen additive sprite × dozens overlapping
  // — pure fill-rate murder in stereo. 320 px only bites inside ~0.25 m.
  trailPool = new ParticlePool(2048, { maxPx: 320, lifeExp: 2.2 });
  scene.add(emberPool.points, trailPool.points);
  fireScene = scene;
  // The iron and the real fire: in the background, the procedural ball
  // stands in until they land.
  if (fireKit) trailPool.useAtlas(fireKit.atlas);
  else loadFireKit();
}

/** Integrate all live particles. Call once per frame (FXSystem does). */
export function updateFirePools(dt: number): void {
  emberPool?.update(dt);
  trailPool?.update(dt);
}

/** Remove particles when crossing between spatially unrelated experiences. */
export function clearFirePools(): void {
  emberPool?.clear();
  trailPool?.clear();
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
 * A comet-tail stamp behind a flying ball — the THICK FlamethrowerXR trail:
 * a fat, hot core slug plus a lingering wisp that drifts up off the path.
 * Once the fire kit is in, each stamp draws as a frame of the real fire.
 * Call as the ball moves.
 */
export function stampTrail(pos: Vector3, cool = false): void {
  if (!trailPool) return;
  const hue = cool ? 0.56 + Math.random() * 0.05 : 0.05 + Math.random() * 0.05;
  // With the real fire in, each ball's FlameRibbon IS the rope: the stamps
  // only shed its wisps, half as often — a few small sprites where there
  // were dozens of big overlapping ones (fill rate, on Quest, is the bill).
  const ribbons = fireKit !== null;
  if (ribbons && Math.random() < 0.5) return;

  // The body of the trail: big, bright, short-lived — overlapping stamps
  // fuse into one continuous molten rope.
  if (!ribbons) {
    _c.setHSL(hue, 1.0, 0.62);
    trailPool.spawn(
      pos,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.15,
      _c.r, _c.g, _c.b,
      0.3 + Math.random() * 0.14,
      0.17 + Math.random() * 0.09,
      0.15,
    );
  }

  // The afterglow: smaller, slower, rises and lingers like flame shed off
  // the comet — gives the rope a licking, smoky edge.
  _c.setHSL(hue, 1.0, 0.5);
  trailPool.spawn(
    pos,
    (Math.random() - 0.5) * 0.4,
    (Math.random() - 0.5) * 0.3 + 0.35,
    (Math.random() - 0.5) * 0.4,
    _c.r, _c.g, _c.b,
    0.55 + Math.random() * 0.3,
    0.07 + Math.random() * 0.05,
    0.5,
  );
}
