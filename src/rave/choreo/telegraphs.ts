/**
 * Attack telegraphs for RAVE RAID — the whole "souls-like" readability
 * contract lives here. Every strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges, and the fill IS the countdown.
 *
 * THE DANGER KIT. Every attack in the set — these floor marks, the strike
 * volumes (strikes.ts) and the trident's blows —
 * speaks ONE visual language, so a night of mixed moves reads as one
 * boss's vocabulary rather than eleven effects from eleven sessions:
 *
 *  - ONE HEAT RAMP (HEAT below): hazard amber while it charges, danger red
 *    as it arrives, WHITE-HOT the instant it lands, burning back out to
 *    red. Nothing in the attack set wears any other colour.
 *  - NEON INK: lines are drawn like the deck rims and the lasers — a
 *    white-hot core inside a coloured halo, constant width in metres —
 *    and fills are a thin scrim, never a poured wash.
 *  - ONE HAZARD TEXTURE: doomed ground carries the same drifting diagonal
 *    hatch on every move, laid in DECK space, so two overlapping marks
 *    line up stripe for stripe instead of moiréing.
 *  - THE DECK IS THE CANVAS: every floor mark is clipped to the octagon
 *    (nothing paints off the deck into the void), and the deck's own rim
 *    burns wherever it crosses doomed ground.
 *  - THE AFTERBURN: on the landing the mark doesn't vanish — it ignites
 *    white-hot and burns out in a few frames (update with fill 1 → 2, see
 *    ChoreoSystem), so warning and hit are visibly the same object.
 *
 * All shader-driven planes; cheap, additive, no textures.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
} from 'three';

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress, then 1..2 the landing's afterburn;
   *  time: seconds for the pulse. */
  update(fill: number, time: number): void;
  /** Independent placement/visibility, shared GPU resources and beat uniforms. */
  fork(): Telegraph;
  dispose(): void;
}

/**
 * THE HEAT RAMP — the only colours an attack may wear (config.ts PALETTE
 * amber / danger / whiteHot; restated here so this module stays leaf-pure).
 * strikes.ts reads these too.
 */
export const HEAT = {
  amber: 0xffb000,
  danger: 0xe8352a,
  hot: 0xfff3cf,
  /** Instruction, not danger (THE TRIDENT's quarter lines). */
  chalk: 0xdbeaff,
};

/** How long the landing's afterburn runs (seconds). */
export const AFTERBURN_SEC = 0.32;

const vec3 = (hex: number): string =>
  `vec3(${(((hex >> 16) & 255) / 255).toFixed(3)}, ${(((hex >> 8) & 255) / 255).toFixed(3)}, ${((hex & 255) / 255).toFixed(3)})`;

/** The ramp as GLSL constants, for every shader in the attack set. */
export const HEAT_GLSL = /* glsl */ `
  const vec3 AMBER = ${vec3(HEAT.amber)};
  const vec3 DANGER = ${vec3(HEAT.danger)};
  const vec3 HOT = ${vec3(HEAT.hot)};
  const vec3 CHALK = ${vec3(HEAT.chalk)};
`;

/** The platform's own silhouette as a soft mask, `q` in deck metres — the
 *  octagon from config (half-width .86, half-depth .75, chamfer plane
 *  0.375|x|+0.485|z| = 0.5044, normalised by its length). Shared with the
 *  strikes, so no wall of light ever pokes past the rim either. */
export const OCT_GLSL = /* glsl */ `
  float octMask(vec2 q){
    q = abs(q);
    float m = smoothstep(0.0, 0.045, 0.86 - q.x);
    m = min(m, smoothstep(0.0, 0.045, 0.75 - q.y));
    m = min(m, smoothstep(0.0, 0.045, (0.5044 - (0.375 * q.x + 0.485 * q.y)) / 0.613));
    return m;
  }
`;

/** Shared vertex shader — UVs through, plus the fragment's position in
 *  DECK space (uPlace = the mesh's transform relative to the platform). */
const VERT = /* glsl */ `
  uniform mat4 uPlace;
  varying vec2 vUv;
  varying vec2 vDeck;
  void main(){ vUv = uv;
    vDeck = (uPlace * vec4(position, 1.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * The kit. F = the charge (0..1), B = the afterburn (0..1, zero until the
 * landing). heat() is the ramp, envelope() the pulse that becomes the
 * ignition flash, ink() composes a scrim (wash) and neon lines (line).
 * octMask (OCT_GLSL) trims every mark to the deck.
 */
const COMMON = /* glsl */ `
  ${HEAT_GLSL}
  uniform float uFill, uTime;
  varying vec2 vUv;
  varying vec2 vDeck;
  float F(){ return clamp(uFill, 0.0, 1.0); }
  float B(){ return clamp(uFill - 1.0, 0.0, 1.0); }
  float landed(){ return step(1.0001, uFill); }
  vec3 heat(){
    vec3 charge = mix(AMBER, DANGER, smoothstep(0.55, 0.95, F()));
    vec3 strike = mix(HOT, DANGER, smoothstep(0.0, 0.6, B()));
    return mix(charge, strike, landed());
  }
  float pulse(){
    float rate = mix(3.0, 14.0, F());
    return 0.82 + 0.18 * sin(uTime * rate);
  }
  // Charging: the quickening pulse. Landed: a white-hot ignition that
  // burns out before the next beat.
  float envelope(){
    float b = 1.0 - B();
    return mix(pulse(), b * b * (1.0 + 1.6 * b), landed());
  }
  ${OCT_GLSL}
  // The deck's own edge, as a band just inside the rim.
  float deckRim(vec2 q){ return octMask(q) - octMask(q * 1.075); }
  // The one hazard texture: diagonal stripes laid in deck space, drifting.
  float hatch(vec2 q){
    float s = fract((q.x - q.y) * 4.2 + uTime * 0.3);
    return smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.3, 0.38, s));
  }
  // Doomed ground: a thin scrim that thickens with the charge, hatched.
  float doom(vec2 q){ return 0.06 + 0.16 * F() + hatch(q) * (0.05 + 0.13 * F()); }
  // Neon lines, constant width in metres: a hard hairline and its halo.
  float hair(float d){ return 1.0 - smoothstep(0.0, 0.016, d); }
  float halo(float d){ return 1.0 - smoothstep(0.016, 0.085, d); }
  float neon(float d){ return hair(d) + halo(d) * 0.32; }
  vec4 ink(float wash, float line){
    vec3 c = heat();
    vec3 rgb = c * wash + mix(c, HOT, 0.55) * line;
    return vec4(rgb * envelope(), 1.0);
  }
`;

/** Strip (beam + crossfire rail): neon side rails, the hatched scrim, and a
 *  fuse that burns from the far end (v = 1) toward you with a hot front. */
const STRIP_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec2 uSize;
  void main(){
    vec2 m = (vUv - 0.5) * uSize;
    float edge = uSize.x * 0.5 - abs(m.x);
    float wash = doom(vDeck);
    // The fuse: lit from the far end toward you as the charge runs down.
    float s = (vUv.y - (1.0 - F())) * uSize.y;
    wash += step(0.0, s) * 0.14;
    float line = neon(edge);
    line += hair(abs(s)) * 0.7 * (1.0 - landed());
    line += deckRim(vDeck) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(vDeck);
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two neon rays — the one telegraph that means "stand
 * HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uAngle, uHalf, uPaneR;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec2 q = vDeck;
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    // The doomed sector, soft-edged at the wedge line.
    float danger = smoothstep(uHalf - 0.015, uHalf + 0.03, d);
    float wash = danger * doom(q);
    // Shock arcs breathing OUTWARD from the core, quicker as the fuse runs
    // down — the countdown, read radially.
    float arc = smoothstep(0.82, 0.98, 0.5 + 0.5 * sin(r * 16.0 - uTime * (2.0 + 9.0 * F())));
    wash += danger * arc * (0.08 + 0.22 * F());
    // The blast's own heart, swelling at the centre as it charges.
    wash += (1.0 - smoothstep(0.08 + 0.08 * F(), 0.2 + 0.12 * F(), r)) * (0.16 + 0.4 * F());
    // The doorposts: one neon ray per wedge edge, CONSTANT-WIDTH in metres
    // — the two rays that mean "between these".
    float er = abs(d - uHalf) * max(r, 0.03) * uPaneR;
    float line = neon(er) + danger * deckRim(q) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(q);
  }
`;

/**
 * THE X: both diagonal arms drawn as ONE pane. As two spun strips the
 * crossing double-blended into a white blob; one shader means the union
 * composes — a single scrim, neon rails that trace the union's outline
 * (never through the middle), a ringed diamond KNOT where the arms meet,
 * and both arms filling from their far ends toward the crossing.
 */
const X_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uHalfW, uPaneR;
  void main(){
    vec2 q = vDeck;
    float d1 = abs(q.x - q.y) * 0.7071;
    float d2 = abs(q.x + q.y) * 0.7071;
    float t1 = (q.x + q.y) * 0.7071;
    float t2 = (q.x - q.y) * 0.7071;
    float in1 = 1.0 - smoothstep(uHalfW - 0.015, uHalfW + 0.015, d1);
    float in2 = 1.0 - smoothstep(uHalfW - 0.015, uHalfW + 0.015, d2);
    // One scrim for the union — the crossing never doubles.
    float arm = max(in1, in2);
    float wash = arm * doom(q);
    // The advance: both arms light from their far ends toward the crossing
    // (edges ascending — reversed-edge smoothstep is undefined in GLSL).
    float front = (1.0 - F()) * uPaneR;
    wash += max(in1 * smoothstep(front - 0.14, front, abs(t1)),
                in2 * smoothstep(front - 0.14, front, abs(t2))) * 0.18;
    // THE KNOT's heart heats up.
    float kd = max(d1, d2);
    wash += (1.0 - smoothstep(uHalfW * 0.5, uHalfW, kd)) * (0.08 + 0.28 * F());
    // Rails along the UNION's outline — |min(d)−w| is zero on the outer
    // rails and never inside the crossing, so no lines cut the knot.
    float line = neon(abs(min(d1, d2) - uHalfW));
    line += hair(abs(kd - (uHalfW + 0.03))) * (0.4 + 0.45 * F());
    line += arm * deckRim(q) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(q);
  }
`;

/**
 * THE TRIDENT's blow: the deck's four quarters, `uHit` a bitmask of the
 * ones that burn (bit = corner: bit 0 local +x, bit 1 local +z). Nothing
 * of the danger shows while it charges — the read is the DJ's weapon, not
 * the floor — and on the landing the doomed quarters ignite, their borders
 * with living ground drawn as neon. `uLines` adds the chalk quarter lines
 * (instruction, not danger) for the whole life of the pane: the floor says
 * where the split is, never which side is coming.
 */
const QUAD_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uHit, uLines;
  float bit(float i){ return mod(floor(uHit / exp2(i) + 0.5 / exp2(i)), 2.0); }
  void main(){
    vec2 q = vDeck;
    float mask = octMask(q);
    // The chalk split: two feathered lines through the middle, brighter at
    // the rim so it reads from across the ring; gone with the last blow.
    float chalk = (1.0 - smoothstep(0.006, 0.02, abs(q.x))) + (1.0 - smoothstep(0.006, 0.02, abs(q.y)));
    chalk += 0.25 * ((1.0 - smoothstep(0.02, 0.07, abs(q.x))) + (1.0 - smoothstep(0.02, 0.07, abs(q.y))));
    chalk *= 0.55 + 0.35 * (1.0 - smoothstep(0.0, 0.25, octMask(q * 1.25)));
    chalk *= (0.8 + 0.2 * sin(uTime * 2.0)) * uLines * (1.0 - B());
    // The blow: the doomed quarters, ignited.
    float idx = (q.x >= 0.0 ? 1.0 : 0.0) + (q.y >= 0.0 ? 2.0 : 0.0);
    float idxX = idx + (q.x >= 0.0 ? -1.0 : 1.0); // the quarter across the x line
    float idxZ = idx + (q.y >= 0.0 ? -2.0 : 2.0); // …and across the z line
    float doomed = bit(idx);
    float wash = doomed * doom(q);
    float line = doomed * (neon(abs(q.x)) * (1.0 - bit(idxX)) + neon(abs(q.y)) * (1.0 - bit(idxZ)));
    line += doomed * deckRim(q) * 0.75;
    vec3 burn = ink(wash, line).rgb * landed();
    gl_FragColor = vec4((burn + CHALK * chalk) * mask, 1.0);
  }
`;

/**
 * Donut: the RIM floods and the middle lives — the nova's opposite number.
 * A neon doorpost CIRCLE burns at the edge of the safe disc with bands
 * marching inward across the doomed ring, so the shape says "in here", not
 * "somewhere over there". uInner = safe radius as a fraction of the pane.
 */
const DONUT_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uInner, uPaneR;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec2 q = vDeck;
    float doomed = 1.0 - step(r, uInner);
    float wash = doomed * (doom(q) + 0.1 * F());
    // Bands marching INWARD toward the safe disc (+uTime pulls the pattern
    // to smaller radii as the clock runs).
    float band = step(0.7, fract((r - uInner) * 5.5 + uTime * 1.9));
    wash += band * doomed * (0.08 + 0.16 * F());
    // The doorpost ring — the honest edge of the ground that lives.
    float line = neon(abs(r - uInner) * uPaneR) * (0.55 + 0.45 * F());
    line += doomed * deckRim(q) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(q);
  }
`;

/**
 * Half-platform flood (the seesaw / surge): one side of the deck fills
 * while a neon rail burns along the centreline — the honest border — and
 * bands march toward the SAFE half: cross. The mesh is authored with
 * u = 0 on the centreline, u = 1 at the outer rim (uSize.x metres away).
 */
const HALF_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec2 uSize;
  void main(){
    // Only TWO panes ever show at once (the imminent beat and the one
    // after — see ChoreoSystem), so the ramp is bold: the side about to
    // blow is unmistakably the bright one, its follow-up a faint promise.
    float wash = doom(vDeck) + 0.2 * F();
    float c = vUv.x * uSize.x;
    // Bands marching toward the centreline — CROSS HERE, the other half lives.
    float lane = fract(vUv.x * 5.0 + uTime * 2.4);
    float band = step(0.74, lane) * step(abs(fract(vUv.y * 3.0) - 0.5), 0.32);
    wash += band * (0.08 + 0.2 * F());
    float line = neon(c) * (0.45 + 0.55 * F()) + deckRim(vDeck) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(vDeck);
  }
`;

/**
 * Gate: the WHOLE deck floods EXCEPT one clear column — neon doorposts at
 * its edges and bands marching INTO it from both sides. The linear cousin
 * of the nova. uGap = column centre (u), uHalf = half-width (u).
 */
const GATE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uGap, uHalf;
  uniform vec2 uSize;
  void main(){
    float d = (vUv.x - uGap) * uSize.x;
    float hw = uHalf * uSize.x;
    float doomed = step(hw, abs(d));
    float wash = doomed * (doom(vDeck) + 0.1 * F());
    float band = step(0.7, fract(abs(d) * 4.4 + uTime * 2.3));
    wash += band * doomed * step(abs(fract(vUv.y * 4.0) - 0.5), 0.34) * 0.16;
    float line = neon(abs(abs(d) - hw)) * (0.55 + 0.45 * F());
    line += doomed * deckRim(vDeck) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(vDeck);
  }
`;

/**
 * Danger roof: a horizontal pane hung at the sweep line — the threat reads
 * as a CEILING over the whole deck, never as a wall about to bisect it.
 * Clipped to the deck's own octagon with a ghost of its rim burning at the
 * edge: the danger layer is the deck, lifted to head height. Drift bands
 * run along +u (mirror the mesh so they run entry → exit).
 */
const ROOF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    float wash = 0.06 + 0.26 * F() + hatch(vDeck) * (0.04 + 0.1 * F());
    wash += step(0.74, fract(vUv.x * 5.0 - uTime * 1.4)) * 0.1;
    float line = deckRim(vDeck) * 0.85;
    gl_FragColor = ink(wash, line) * octMask(vDeck);
  }
`;

/**
 * Duck cascade: rows of downward-pointing chevrons pouring toward the floor
 * beneath a sweep blade — the shape ITSELF says "get under". Drawn on a
 * vertical plane; v = 0 is the floor end.
 */
const DUCK_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    float vee = vUv.y * 5.0 + abs(vUv.x - 0.5) * 2.2 + uTime * 1.8;
    float row = smoothstep(0.44, 0.5, fract(vee)) * (1.0 - smoothstep(0.5, 0.56, fract(vee)));
    float a = row * (0.18 + 0.4 * F());
    // Fade at the plane's side edges so it reads as a stream, not a wall.
    a *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    gl_FragColor = ink(a * 0.4, a * 0.6);
  }
`;

/** Blade: the limbo line hanging in the air — a white-hot core inside a
 *  heat halo, its charge sweeping across from the entry side, its ends
 *  fading out at the deck's edge (it belongs to this deck, not the void). */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec2 uSize;
  void main(){
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float lit = 0.35 + 0.65 * step(vUv.x, F());
    float ends = 1.0 - smoothstep(0.78, 0.98, abs((vUv.x - 0.5) * uSize.x));
    gl_FragColor = ink(pow(mid, 2.0) * 0.3 * lit, pow(mid, 7.0) * 0.95 * lit) * ends;
  }
`;

type Uniforms = Record<string, { value: unknown }>;

function warnMat(frag: string, extra: Uniforms = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 }, uPlace: { value: new Matrix4() }, ...extra },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** A pane's size in metres, for shaders that draw constant-width lines. */
const size = (w: number, h: number): { value: Vector2 } => ({ value: new Vector2(w, h) });

function makeTelegraph(meshes: Mesh[], mats: ShaderMaterial[]): Telegraph {
  const group = new Group();
  for (const m of meshes) {
    // Draw after the deck furniture — a warning that loses the depth fight
    // to a rim bolt is a warning nobody saw.
    m.renderOrder = 20;
    group.add(m);
  }
  let users = 0;
  let lastFill = NaN;
  let lastTime = NaN;
  const handle = (placement: Group): Telegraph => {
    users++;
    let disposed = false;
    return {
      group: placement,
      update(fill, time) {
        if (disposed || (fill === lastFill && time === lastTime)) return;
        lastFill = fill;
        lastTime = time;
        // Deck space for the shaders: every fork shares one placement on
        // its own platform (ChoreoSystem places before it forks), so one
        // matrix per material serves the whole ring.
        placement.updateMatrix();
        for (const m of meshes) {
          m.updateMatrix();
          (m.material as ShaderMaterial).uniforms.uPlace.value.multiplyMatrices(placement.matrix, m.matrix);
        }
        for (const mat of mats) {
          mat.uniforms.uFill.value = fill;
          mat.uniforms.uTime.value = time;
        }
      },
      fork() {
        if (disposed) throw new Error('Cannot fork a disposed telegraph');
        return handle(placement.clone(true));
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        placement.removeFromParent();
        if (--users === 0) {
          for (const m of meshes) m.geometry.dispose();
          for (const mat of mats) mat.dispose();
        }
      },
    };
  };
  return handle(group);
}


/**
 * GOLIATH's nova: a platform-covering disc where everything floods with
 * warning EXCEPT the safe wedge centred on `angle` (world radians, atan2(x,z)
 * around the platform centre), `halfAngle` wide each side. Place the group
 * at the platform centre on the floor.
 */
export function novaTelegraph(radius: number, angle: number, halfAngle: number): Telegraph {
  const mat = warnMat(NOVA_FRAG, {
    uAngle: { value: angle },
    uHalf: { value: halfAngle },
    uPaneR: { value: radius },
  });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * THE X, whole: one full-deck pane carrying both diagonal arms and the
 * knot. Place the group at the platform centre on the floor — the shader
 * owns the geometry, and the octagon mask trims it to the deck.
 */
export function xTelegraph(halfW: number): Telegraph {
  const R = 1.2; // spans the deck's diagonal; the mask trims the rest
  const mat = warnMat(X_FRAG, { uHalfW: { value: halfW }, uPaneR: { value: R } });
  const pane = new Mesh(new PlaneGeometry(R * 2, R * 2), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}

/**
 * THE TRIDENT's blow on one deck: dark until it lands, then the quarters
 * in `hit` burn. `lines` adds the chalk quarter split for the pane's whole
 * life (ChoreoSystem hangs it on the move's last blow, opening with the
 * move). Place the group at the deck centre on the floor.
 */
export function quadTelegraph(halfWidth: number, halfDepth: number, hit: number, lines: boolean): Telegraph {
  const mat = warnMat(QUAD_FRAG, { uHit: { value: hit }, uLines: { value: lines ? 1 : 0 } });
  const pane = new Mesh(new PlaneGeometry(halfWidth * 2, halfDepth * 2), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}

/**
 * THE DONUT: the deck's rim floods and one disc in the middle survives.
 * `radius` covers the whole deck (corners included), `innerR` is the safe
 * disc. Place the group at the platform centre on the floor.
 */
export function donutTelegraph(radius: number, innerR: number): Telegraph {
  const mat = warnMat(DONUT_FRAG, { uInner: { value: innerR / radius }, uPaneR: { value: radius } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * GOOPLIATH's seesaw: ONE HALF of the platform floods with warning — the
 * centreline burns as a hard rail and bands march toward it: get across.
 * `side` is the doomed half's local-x sign; `halfWidth`/`depth` span the
 * platform. Place the group at the platform centre on the floor (the side
 * flip is baked in here — no extra rotation needed beyond the seat yaw).
 */
export function halfTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(HALF_FRAG, { uSize: size(halfWidth, depth) });
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  // Authored for the +x half (u = 0 at the centreline); the −x half is the
  // same pane mirrored in place. The flip lives on the MESH — the group's
  // rotation stays free for the caller's seat yaw.
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/**
 * A beam strip `length` long and `2*halfWidth` wide, flat on the floor,
 * running along the group's local −Z (v=1 is the far end, where the fill
 * front starts). Place the group at the NEAR end centre and yaw it.
 */
export function beamTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG, { uSize: size(halfWidth * 2, length) });
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2; // plane +v now points down local −Z
  strip.position.z = -length / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * The sweep: danger lives IN THE AIR, never on the floor. Three parts, all
 * hung off the limbo line at `bladeY`:
 *  - a DANGER ROOF — a horizontal pane at bladeY covering the deck, so the
 *    doomed volume reads as a ceiling (a wall-like pane here is exactly what
 *    made it look like the deck was about to be cut in half);
 *  - the LINE itself — a thin blazing pane whose charge-fill runs from the
 *    side the blade will enter (`fromSide`), so veterans read the direction;
 *  - a SHORT chevron fringe dripping under the line — "get under HERE".
 * The floor is deliberately unpainted: ground-paint means "move your feet"
 * in every other move, and the sweep's answer is stay put and DROP. Place
 * the group at the platform centre on the floor.
 */
export function sweepTelegraph(
  width: number,
  depth: number,
  bladeY: number,
  thickness: number,
  fromSide: 1 | -1,
  detailed = true,
): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  // The danger volume drawn as a SANDWICH: one roof at the line and one
  // above head height. Standing, the upper layer hangs over your eyes and
  // the lower shimmers at your chest — you are visibly INSIDE the amber;
  // duck and the whole stack is overhead. A single pane at the line is
  // edge-on from standing eye height and carries nothing.
  // Other decks need the silhouette, not the extra first-person overhead layer.
  for (const dy of detailed ? [0, 0.55] : [0]) {
    const roofMat = warnMat(ROOF_FRAG);
    const roof = new Mesh(new PlaneGeometry(width, depth), roofMat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = bladeY + dy;
    // u runs +x unmirrored; flip so fill/bands originate at the entry side.
    roof.scale.x = -fromSide;
    meshes.push(roof);
    mats.push(roofMat);
  }
  // TWO limbo rails, pushed to the deck's front and back thirds — never
  // through the dancer's own head: a pane at deck centre sits edge-on in
  // the owner's eyes and renders as nothing. From your spot you always have
  // one rail ACROSS your view (plus its chevron fringe dripping under it);
  // from across the ring the pair reads as a horizontal danger layer.
  const zOff = depth * 0.28;
  const duckH = 0.42;
  for (const dz of [-zOff, zOff]) {
    const bladeMat = warnMat(BLADE_FRAG, { uSize: size(width, thickness * 2) });
    const blade = new Mesh(new PlaneGeometry(width, thickness * 2), bladeMat);
    blade.position.set(0, bladeY, dz);
    blade.scale.x = -fromSide;
    meshes.push(blade);
    mats.push(bladeMat);
    if (detailed) {
      const duckMat = warnMat(DUCK_FRAG);
      const duck = new Mesh(new PlaneGeometry(width * 0.85, duckH), duckMat);
      duck.position.set(0, bladeY - duckH / 2, dz);
      meshes.push(duck);
      mats.push(duckMat);
    }
  }
  return makeTelegraph(meshes, mats);
}

/**
 * THE CROSSFIRE's rail: the beam strip a quarter-turn round, running left to
 * right across the deck so the dodge is a step toward or away from the
 * stage. `from` is the local-x side the emitter sits on: the strip's fill
 * front advances from there, so the charge already shows which rail is
 * feeding it. Place the group at the deck centre, at the strip's z.
 */
export function railTelegraph(halfDepth: number, length: number, from: 1 | -1): Telegraph {
  const mat = warnMat(STRIP_FRAG, { uSize: size(halfDepth * 2, length) });
  const strip = new Mesh(new PlaneGeometry(halfDepth * 2, length), mat);
  // Flat on the deck (x tip), then spun within the floor plane (z spin —
  // innermost in three's default XYZ order, so it turns the strip in place).
  // The sign puts v = 1, where the fill front starts, on the emitter side.
  strip.rotation.set(-Math.PI / 2, 0, (from * Math.PI) / 2);
  return makeTelegraph([strip], [mat]);
}

/**
 * The gate: a full-deck pane where everything fills EXCEPT one clear band
 * centred at `gapAt` (platform-local), `gapHalfW` wide each side. axis 0 is
 * the doorway COLUMN at local x; axis 1 the horizontal cousin — a clear ROW
 * at local z. Place the group at the platform centre on the floor.
 */
export function gateTelegraph(
  halfWidth: number,
  halfDepth: number,
  gapAt: number,
  gapHalfW: number,
  axis: 0 | 1 = 0,
): Telegraph {
  const w = halfWidth * 2 + 0.4;
  const d = halfDepth * 2 + 0.3;
  // uv.x carries the gap. axis 1 spins the pane in-plane (the rail's trick),
  // which lays geometry +x along world −z — so the gap coordinate mirrors.
  const along = axis ? d : w;
  const gap = axis ? -gapAt : gapAt;
  const mat = warnMat(GATE_FRAG, {
    uGap: { value: (gap + along / 2) / along },
    uHalf: { value: gapHalfW / along },
    uSize: size(along, axis ? w : d),
  });
  const pane = new Mesh(new PlaneGeometry(along, axis ? w : d), mat);
  pane.rotation.set(-Math.PI / 2, 0, axis ? Math.PI / 2 : 0);
  return makeTelegraph([pane], [mat]);
}
