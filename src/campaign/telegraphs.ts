/**
 * Attack telegraphs for the ARCADE titans — the whole "souls-like" readability
 * contract lives here. Every titan strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges: hazard-amber shapes that fill up and shift to
 * danger-red as the strike arrives (the fill IS the countdown). Three shapes:
 *
 *  - CIRCLE  : a fist slam / mortar shell footprint — step out of the disc.
 *  - BEAM    : a strip the eye-beam will rake — sidestep off the line.
 *  - SWEEP   : a horizontal blade slice across the platform at a marked
 *              height — duck under it (a floor band shows it's coming).
 *
 * All shader-driven planes; cheap, additive, no textures.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { CAMPAIGN } from '../config.js';

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress; time: seconds for the pulse. */
  update(fill: number, time: number): void;
  dispose(): void;
}

/** Shared vertex shader — pass UVs through. */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * Shared drawing helpers — no uniforms of their own, so any telegraph shader
 * can pull them in regardless of what it declares.
 */
const AA = /* glsl */ `
  /**
   * These planes blend ADDITIVELY, so the alpha channel is really a brightness
   * multiplier on the warning colour — and the layers below stack by +=. Where
   * two features overlapped (the rim and its ticks, the centre dot and the
   * charge disc) the sum ran past 1 and the amber/red blew out to flat white,
   * which is what made a charging telegraph read as a bright smear instead of
   * a shape. Cap it, and the warning keeps its colour wherever layers meet.
   */
  float ink(float a){ return clamp(a, 0.0, 1.0); }

  /**
   * A soft step whose edge is one pixel wide on screen, whatever the angle.
   * Deck telegraphs are viewed at very grazing angles in VR, where a hard
   * step() on a repeating pattern crawls and moirés badly.
   */
  float aaStep(float edge, float x){
    float w = max(fwidth(x), 1e-5);
    return smoothstep(edge - w, edge + w, x);
  }

  /**
   * A repeating stripe: ~1 where fract(x) is past 'duty', antialiased at both
   * ends of the pulse. Once a whole tile is smaller than a pixel the pattern
   * dissolves to its own average rather than aliasing into noise.
   * (No backticks in here — these blocks are JS template literals.)
   */
  float aaStripe(float x, float duty){
    float w = max(fwidth(x), 1e-5);
    float f = fract(x);
    float sharp = smoothstep(duty - w, duty + w, f) - smoothstep(1.0 - w, 1.0, f);
    return mix(sharp, 1.0 - duty, smoothstep(0.25, 0.5, w));
  }

  /** A ring/band between two soft edges: rises over a→b, falls over c→d. */
  float band(float x, float a, float b, float c, float d){
    return smoothstep(a, b, x) * (1.0 - smoothstep(c, d, x));
  }
`;

/** Hazard amber → danger red as the charge completes, pulsing faster. */
const COMMON = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  ${AA}
  vec3 warnColor(){
    return mix(vec3(1.0, 0.69, 0.0), vec3(0.91, 0.21, 0.16), smoothstep(0.55, 0.95, uFill));
  }
  float pulse(){
    float rate = mix(3.0, 14.0, uFill);
    return 0.82 + 0.18 * sin(uTime * rate);
  }
`;

/**
 * The platform's own silhouette, as a soft mask (RAVE RAID's trick). The
 * donut and THE X are honest circles/diagonals — without this a metre of
 * warning paint hangs off the deck into the void. `q` is platform-local
 * metres; constants are the octagon from config (half-width .86, half-depth
 * .75, chamfer plane 0.375|x|+0.485|z| = 0.5044, normalised by its length).
 */
const OCT_MASK = /* glsl */ `
  float octMask(vec2 q){
    q = abs(q);
    float m = smoothstep(0.0, 0.045, 0.86 - q.x);
    m = min(m, smoothstep(0.0, 0.045, 0.75 - q.y));
    m = min(m, smoothstep(0.0, 0.045, (0.5044 - (0.375 * q.x + 0.485 * q.y)) / 0.613));
    return m;
  }
`;

/** Disc: bold rim ring, hazard ticks, a hot centre dot, and a radial fill
 *  that eats outward — LOUD, because this marks where a fist lands. */
const CIRCLE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    vec3 col = warnColor();
    float a = 0.0;
    // Rim ring.
    a += band(r, 0.84, 0.9, 0.97, 1.0);
    // Rotating hazard ticks just inside the rim. Antialiased: these are
    // ANGULAR stripes, so they crowd together as the disc tilts away and used
    // to break into crawling speckle right where the eye follows the rim.
    float ang = atan(p.y, p.x) + uTime * 1.2;
    a += aaStripe(ang * 3.8195, 0.5) * band(r, 0.72, 0.78, 0.82, 0.84) * 0.6;
    // Hot centre dot — the exact impact point.
    a += (1.0 - smoothstep(0.05, 0.14, r)) * 0.9;
    // Charge disc growing outward from the centre — solid enough to read
    // against a bright passthrough room.
    a += (1.0 - smoothstep(uFill * 0.85, uFill * 0.9 + 0.004, r)) * 0.6;
    a *= pulse();
    // No discard for the square plane's corners: every term above is already
    // zero past r = 1, and discard costs a tile-based mobile GPU its early-Z
    // for the whole draw.
    gl_FragColor = vec4(col, ink(a));
  }
`;

/** Strip: edge rails + a fill front that advances down the line (v: 1 → 0). */
const STRIP_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // Side rails.
    float edge = min(vUv.x, 1.0 - vUv.x);
    a += (1.0 - smoothstep(0.04, 0.1, edge)) * 0.9;
    // Chevron dashes marching toward the player while it charges. A beam
    // strip runs AWAY from you down the deck, so its far end is the most
    // foreshortened thing on screen — exactly where a hard-stepped dash
    // pattern turns to shimmer.
    a += aaStripe(vUv.y * 9.0 + uTime * 2.2, 0.5) * 0.18;
    // The advance front: fills from the far (titan) end toward you.
    a += aaStep(1.0 - uFill, vUv.y) * 0.34;
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two bright rays — the one telegraph that means
 * "stand HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uAngle, uHalf;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    // Softened: this is the boundary of the ONE piece of safe ground on the
    // deck, and a hard step() left it a jagged staircase you had to guess at.
    float inWedge = 1.0 - aaStep(uHalf, d);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything OUTSIDE the wedge fills and pulses.
    a += (1.0 - inWedge) * (0.16 + 0.5 * uFill);
    // Rim ring all the way round, dimmer through the wedge.
    a += band(r, 0.9, 0.95, 0.98, 1.0) * (1.0 - inWedge * 0.7);
    // The wedge's edge rays — the doorposts of the safe ground.
    a += smoothstep(0.06, 0.0, abs(d - uHalf)) * 0.9;
    a *= pulse();
    // Cut the square plane to a disc with a soft edge. The flood term has no
    // r in it, so this replaces the old discard — and antialiases the nova's
    // outline, which used to be a hard jagged circle.
    a *= 1.0 - smoothstep(0.985, 1.0, r);
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * Half-platform flood (GOOPLIATH's seesaw): one side of the deck fills with
 * warning while a hard rail burns along the centreline — the honest border —
 * and chevrons march toward the SAFE half: jump. uDir is the local-x
 * direction of escape (−side), so the arrows always point off the doomed half.
 */
const HALF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: the whole half fills as the wave charges. Only TWO panes
    // ever show at once (the imminent beat and the one after — see
    // advanceAttack), so the ramp is bold: the side about to blow is
    // unmistakably the bright one, its follow-up a faint promise.
    a += 0.05 + 0.55 * uFill;
    // The centreline rail — the honest border you must be across. The mesh is
    // authored with u = 0 on the centreline, u = 1 at the outer rim.
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.25 + 0.75 * uFill);
    // Bands marching toward the centreline — CROSS HERE, the other half lives.
    float lanes = aaStripe(vUv.x * 5.0 + uTime * 2.4, 0.72);
    float rungs = 1.0 - aaStep(0.32, abs(fract(vUv.y * 3.0) - 0.5));
    a += lanes * rungs * (0.1 + 0.25 * uFill);
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * GO zone (the tutorial's footwork cue) — the inverse of the half flood:
 * the called half of the deck GLOWS GREEN ("stand HERE"), bands march INTO
 * it, and the centreline rail is the line to cross. Same fill contract as
 * every warning: 0→1 as the incoming ball flies, so urgency reads exactly
 * like a boss telegraph, just inverted from "flee" to "come".
 */
const GO_FRAG = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  ${AA}
  void main(){
    vec3 col = vec3(0.34, 0.88, 0.54);
    float a = 0.0;
    // Welcoming flood, brightening as the ball closes.
    a += 0.08 + 0.4 * uFill;
    // The centreline rail — the honest border to get across (u = 0 there).
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.3 + 0.7 * uFill);
    // Bands marching INTO the safe half — follow them.
    float lanes = aaStripe(vUv.x * 5.0 - uTime * 2.4, 0.72);
    float rungs = 1.0 - aaStep(0.32, abs(fract(vUv.y * 3.0) - 0.5));
    a += lanes * rungs * (0.12 + 0.25 * uFill);
    // A soft glow at the outer rim, so the zone reads as a destination.
    a += smoothstep(0.92, 1.0, vUv.x) * 0.25;
    a *= 0.85 + 0.15 * sin(uTime * mix(2.5, 10.0, uFill));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

/**
 * Blade: a horizontal slice hanging in the air — bright core line, soft body.
 *
 * uDir is the direction the real blade will TRAVEL along this plane's local x:
 * +1 for left→right, −1 for right→left. It has to be told, because the strike
 * picks its side from the titan's striking arm (see spawnBladeSweep) while
 * this shader used to fill u = 0 → 1 unconditionally — so on every sweep
 * thrown with the other arm the warning wiped across one way and the blade
 * then came through the other, which is exactly the "it comes from the wrong
 * side" report. The leading edge is drawn bright and chevrons march ahead of
 * it, so the side it arrives from is legible well before the fill lands.
 */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uDir;
  void main(){
    vec3 col = warnColor();
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float a = pow(mid, 3.0) * 0.75 + mid * 0.12;
    // Travel coordinate: 0 is where the blade STARTS, 1 is where it ends up.
    float u = uDir < 0.0 ? 1.0 - vUv.x : vUv.x;
    // The swept-through region behind the front. Softened: a hard step drew
    // this as a ragged vertical staircase, and it's the one edge a player is
    // actually tracking.
    a *= 0.35 + 0.65 * (1.0 - aaStep(uFill, u));
    // The leading edge itself — a hot line sitting where the cut has reached.
    a += mid * (1.0 - smoothstep(0.0, 0.06, abs(u - uFill))) * 0.55;
    // Chevrons running the way the blade will come, so the direction reads
    // from the first frame rather than only once the fill is well across.
    a += aaStripe(u * 7.0 - uTime * 2.6, 0.55) * mid * 0.16;
    a *= pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/* ── THE ENCORE's shapes (ported from RAVE RAID's choreo kit) ──────────── */

/**
 * Gate: the WHOLE deck floods EXCEPT one clear column — doorpost rails burn
 * at its edges and chevron streams march INTO it from both sides. The linear
 * cousin of the nova: the one telegraph that says "stand HERE" on a line.
 * uGap = column centre (u), uHalf = half-width (u).
 */
const GATE_FRAG = /* glsl */ `
  ${COMMON}
  ${OCT_MASK}
  uniform float uGap, uHalf, uAlong, uAcross, uSwap;
  void main(){
    vec3 col = warnColor();
    float d = vUv.x - uGap;
    float inGap = 1.0 - aaStep(uHalf, abs(d));
    float a = 0.0;
    // The flood: everything OUTSIDE the column fills with the charge.
    a += (1.0 - inGap) * (0.1 + 0.5 * uFill);
    // Doorpost rails — the honest edges of the safe ground.
    a += smoothstep(0.045, 0.0, abs(abs(d) - uHalf)) * (0.35 + 0.65 * uFill);
    // Chevron streams marching INTO the gap from both sides.
    float band = aaStripe(abs(d) * 9.0 + uTime * 2.3, 0.68);
    float rungs = 1.0 - aaStep(0.34, abs(fract(vUv.y * 4.0) - 0.5));
    a += band * (1.0 - inGap) * rungs * 0.22;
    a *= pulse();
    // The paint never leaves the deck: uv → platform metres (the row gate's
    // in-plane quarter turn swaps the axes), then the octagon's own mask.
    vec2 m = vec2((vUv.x - 0.5) * uAlong, (vUv.y - 0.5) * uAcross);
    if (uSwap > 0.5) m = m.yx;
    a *= octMask(m);
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * Donut: the RIM floods and the middle lives — the nova's opposite number.
 * A bright doorpost CIRCLE burns at the edge of the safe disc with chevrons
 * marching inward, so the shape says "in here". uInner = safe radius as a
 * fraction of the pane; the octagon mask trims the paint to the deck.
 */
const DONUT_FRAG = /* glsl */ `
  ${COMMON}
  ${OCT_MASK}
  uniform float uInner, uPaneR;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float safe = 1.0 - aaStep(uInner, r);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything outside the safe disc fills with the charge.
    a += (1.0 - safe) * (0.12 + 0.5 * uFill);
    // The doorpost ring — the honest edge of the ground that lives.
    a += smoothstep(0.055, 0.0, abs(r - uInner)) * (0.35 + 0.65 * uFill);
    // Chevron rings marching INWARD toward the safe disc.
    float band = aaStripe((r - uInner) * 5.5 + uTime * 1.9, 0.68);
    a += band * (1.0 - safe) * (0.12 + 0.2 * uFill);
    a *= pulse();
    // The deck's edge IS the far edge — nothing paints past it.
    a *= octMask(p * uPaneR);
    a *= 1.0 - smoothstep(0.985, 1.0, r);
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * THE X: both diagonal arms drawn as ONE pane, so the crossing composes
 * instead of double-blending to white — a single scrim, edge hairlines that
 * trace the union's outline, a ringed diamond KNOT where the arms meet, and
 * both arms filling from their far ends toward the crossing.
 */
const X_FRAG = /* glsl */ `
  ${COMMON}
  ${OCT_MASK}
  uniform float uHalfW, uPaneR;
  void main(){
    vec2 q = (vUv * 2.0 - 1.0) * uPaneR;
    float d1 = abs(q.x - q.y) * 0.7071;
    float d2 = abs(q.x + q.y) * 0.7071;
    float t1 = (q.x + q.y) * 0.7071;
    float t2 = (q.x - q.y) * 0.7071;
    vec3 col = warnColor();
    float a = 0.0;
    float in1 = 1.0 - smoothstep(uHalfW - 0.015, uHalfW + 0.015, d1);
    float in2 = 1.0 - smoothstep(uHalfW - 0.015, uHalfW + 0.015, d2);
    // One scrim for the union — the crossing never doubles.
    float arm = max(in1, in2);
    a += arm * (0.1 + 0.15 * uFill);
    // Chevrons drawing INTO the knot along each arm.
    float ch1 = in1 * aaStripe(abs(t1) * 2.6 + uTime * 1.5, 0.55);
    float ch2 = in2 * aaStripe(abs(t2) * 2.6 + uTime * 1.5, 0.55);
    a += max(ch1, ch2) * 0.13;
    // The advance: both arms light from their far ends toward the crossing.
    float front = (1.0 - uFill) * uPaneR;
    a += max(in1 * smoothstep(front - 0.14, front, abs(t1)),
             in2 * smoothstep(front - 0.14, front, abs(t2))) * 0.24;
    // Edge hairlines along the UNION's outline — never through the knot.
    float eu = abs(min(d1, d2) - uHalfW);
    a += (1.0 - smoothstep(0.0, 0.02, eu)) * 0.95;
    a += (1.0 - smoothstep(0.02, 0.09, eu)) * 0.22;
    // THE KNOT: the diamond where the arms cross is the deadliest ground.
    float kd = max(d1, d2);
    a += (1.0 - smoothstep(0.0, 0.025, abs(kd - (uHalfW + 0.03)))) * (0.45 + 0.45 * uFill);
    a += (1.0 - smoothstep(uHalfW * 0.5, uHalfW, kd)) * (0.08 + 0.3 * uFill);
    a *= pulse();
    a *= octMask(q);
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * THE LESSON's mark: one quarter of the deck, ringed and washed while its
 * step is being taught, its STEP NUMBER spelled as a row of dots. A MOVE
 * step wears the titan's TEACH green; a HOLD step the blue of "stay", with
 * a ring in the middle. Never hazard amber: during the lesson nothing is
 * dangerous yet. uLit is how brightly this quarter is lit right now (the
 * factory's update drives it step by step), uHold whether the lit step is
 * a hold, uOrd its number.
 */
const MARK_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uLit, uHold, uOrd, uAspect;
  void main(){
    vec3 col = mix(vec3(0.62, 1.0, 0.70), vec3(0.45, 0.62, 1.0), uHold);
    float a = 0.10;
    // Border around the quarter — this whole square is the ground.
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a += (1.0 - smoothstep(0.022, 0.055, e)) * 0.55;
    // The step number, as dots in a row across the middle…
    for (int i = 0; i < 6; i++) {
      if (float(i) >= uOrd) break;
      float cx = 0.5 + (float(i) - (uOrd - 1.0) * 0.5) * 0.13;
      vec2 p = (vUv - vec2(cx, 0.5)) * vec2(1.0, 1.0 / uAspect);
      a += (1.0 - smoothstep(0.035, 0.05, length(p))) * 0.95;
    }
    // …and, on a hold, the ring that says STAY around them.
    vec2 c = (vUv - 0.5) * vec2(1.0, 1.0 / uAspect);
    float r = length(c);
    a += (smoothstep(0.30, 0.32, r) - smoothstep(0.35, 0.37, r)) * 0.8 * uHold;
    a *= uLit * pulse();
    gl_FragColor = vec4(col, ink(a));
  }
`;

/**
 * THE RECITAL's quarter lines: the cross that splits the deck into four,
 * lit dim and neutral for the whole move — furniture, not danger. It says
 * where the boxes will land, never which quarter is yours.
 */
const QUARTER_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    float a = 0.0;
    // Two chalk lines through the middle, softly feathered.
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.x - 0.5))) * 0.5;
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.y - 0.5))) * 0.5;
    // Ticks at the rim so the split reads even from across the pit.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a *= 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.18, edge));
    a *= 0.75 + 0.25 * sin(uTime * 2.0);
    gl_FragColor = vec4(vec3(0.86, 0.92, 1.0), ink(a));
  }
`;

function warnMat(frag: string, extra: Record<string, { value: number }> = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 }, ...extra },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeTelegraph(meshes: Mesh[], mats: ShaderMaterial[]): Telegraph {
  const group = new Group();
  for (const m of meshes) {
    // Draw after the deck furniture — a warning that loses the depth fight
    // to a rim bolt is a warning nobody saw.
    m.renderOrder = 20;
    group.add(m);
  }
  return {
    group,
    update(fill, time) {
      for (const mat of mats) {
        mat.uniforms.uFill.value = fill;
        mat.uniforms.uTime.value = time;
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const mat of mats) mat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * GOLIATH's nova: a platform-covering disc where everything floods with
 * warning EXCEPT the safe wedge centred on `angle` (world radians, atan2(x,z)
 * around the platform centre), `halfAngle` wide each side. Place the group
 * at the platform centre on the floor.
 */
export function novaTelegraph(radius: number, angle: number, halfAngle: number): Telegraph {
  const mat = warnMat(NOVA_FRAG, { uAngle: { value: angle }, uHalf: { value: halfAngle } });
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
  const mat = warnMat(HALF_FRAG);
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
 * The green "stand HERE" half (see GO_FRAG) — used by the tutorial's
 * footwork drill. `side` is the SAFE half's local-x sign; geometry mirrors
 * halfTelegraph exactly, so it lands on the deck the same way.
 */
export function goTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(GO_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/** A slam / mortar footprint. Place the group at the zone centre, y≈floor. */
export function circleTelegraph(radius: number): Telegraph {
  const mat = warnMat(CIRCLE_FRAG);
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * A beam strip `length` long and `2*halfWidth` wide, flat on the floor,
 * running along the group's local −Z (v=1 is the far end, where the fill
 * front starts). Place the group at the NEAR end centre and yaw it.
 */
export function beamTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2; // plane +v now points down local −Z
  strip.position.z = -length / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * A horizontal sweep slice: a glowing blade plane hanging at the strike
 * height `bladeY` (duck under it!) plus a dimmer band on the floor beneath so
 * the platform itself carries the warning. Place the group at the platform
 * centre on the floor; `width` spans the endangered lane, `depth` the floor
 * band's front-to-back reach.
 *
 * `dir` is which way the blade will actually travel along local x: +1 for
 * left→right, −1 for right→left. It MUST match spawnBladeSweep's `from` for
 * the same attack, or the warning wipes across opposite to the cut.
 */
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
    uAlong: { value: along },
    uAcross: { value: axis ? w : d },
    uSwap: { value: axis },
  });
  const pane = new Mesh(new PlaneGeometry(along, axis ? w : d), mat);
  pane.rotation.set(-Math.PI / 2, 0, axis ? Math.PI / 2 : 0);
  return makeTelegraph([pane], [mat]);
}

/**
 * THE DONUT: the deck's rim floods and one disc in the middle survives.
 * `radius` covers the whole deck (corners included), `innerR` the safe
 * disc. Place the group at the platform centre on the floor.
 */
export function donutTelegraph(radius: number, innerR: number): Telegraph {
  const mat = warnMat(DONUT_FRAG, { uInner: { value: innerR / radius }, uPaneR: { value: radius } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * THE X, whole: one full-deck pane carrying both diagonal arms and the
 * knot. Place the group at the platform centre on the floor — the octagon
 * mask trims it to the deck.
 */
export function xTelegraph(halfW: number): Telegraph {
  const R = 1.2; // spans the deck's diagonal; the mask trims the rest
  const mat = warnMat(X_FRAG, { uHalfW: { value: halfW }, uPaneR: { value: R } });
  const pane = new Mesh(new PlaneGeometry(R * 2, R * 2), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}

/**
 * THE LESSON: the four quarters, lit ONE AT A TIME as the pattern is
 * taught — step i lights quarter pattern[i] for its slot of the charge
 * (`stepSecs` each, the slots running from the start of `chargeSecs`),
 * green for a move, blue with a ring for a hold, its number in dots. When
 * the lesson is over (fill past the slots, and all of the recital) every
 * quarter is dark: from then on the pattern lives in your ear. Place the
 * group at the deck centre on the floor.
 */
export function recitalMarksTelegraph(
  pattern: readonly number[],
  holds: readonly boolean[],
  halfWidth: number,
  halfDepth: number,
  stepSecs: number,
  chargeSecs: number,
): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  const w = halfWidth * 0.92;
  const d = halfDepth * 0.92;
  for (let corner = 0; corner < 4; corner++) {
    const mat = warnMat(MARK_FRAG, {
      uLit: { value: 0 },
      uHold: { value: 0 },
      uOrd: { value: 0 },
      uAspect: { value: w / d },
    });
    const pane = new Mesh(new PlaneGeometry(w, d), mat);
    pane.rotation.x = -Math.PI / 2;
    pane.position.set(((corner & 1 ? 1 : -1) * halfWidth) / 2, 0, ((corner & 2 ? 1 : -1) * halfDepth) / 2);
    meshes.push(pane);
    mats.push(mat);
  }
  const base = makeTelegraph(meshes, mats);
  return {
    group: base.group,
    update(fill, time) {
      base.update(fill, time);
      const t = fill * chargeSecs;
      const i = Math.floor(t / Math.max(0.001, stepSecs));
      const inStep = t - i * stepSecs;
      // In, hold, out within the slot — a beat of dark between steps so
      // two holds on one quarter still read as two.
      const k = inStep / stepSecs;
      const lit = fill < 1 && i < pattern.length ? Math.min(1, k / 0.12) * (1 - smoothstep(0.78, 0.95, k)) : 0;
      for (let corner = 0; corner < 4; corner++) {
        const u = mats[corner].uniforms;
        const on = i < pattern.length && pattern[i] === corner;
        u.uLit.value = on ? lit : 0;
        u.uHold.value = on && holds[i] ? 1 : 0;
        u.uOrd.value = on ? i + 1 : 0;
      }
    },
    dispose: base.dispose,
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** THE RECITAL's quarter lines — the split deck, lit for the whole move. */
export function quarterTelegraph(halfWidth: number, halfDepth: number): Telegraph {
  const mat = warnMat(QUARTER_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth * 2, halfDepth * 2), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}

/**
 * A laser LANE: the beam strip authored target-local — a full-length strip
 * down the deck at a fixed local x, no aiming. Place the group at the deck
 * centre (plus the lane's x) on the floor; yaw for THE X's arms.
 */
export function laneTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * THE CROSSFIRE's rail: the beam strip a quarter-turn round, running across
 * the deck so the dodge is a step toward or away from the titan. `from` is
 * the local-x side the emitter sits on: the fill front advances from there.
 * Place the group at the deck centre, at the strip's z.
 */
export function railTelegraph(halfDepth: number, length: number, from: 1 | -1): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfDepth * 2, length), mat);
  // Flat on the deck, then spun within the floor plane (z spin — innermost
  // in three's default XYZ order). The sign puts v = 1, where the fill
  // front starts, on the emitter side.
  strip.rotation.set(-Math.PI / 2, 0, (from * Math.PI) / 2);
  return makeTelegraph([strip], [mat]);
}

export function sweepTelegraph(
  width: number,
  depth: number,
  bladeY: number,
  thickness: number,
  dir: 1 | -1 = 1,
): Telegraph {
  const mats: ShaderMaterial[] = [];
  const mat = (): ShaderMaterial => {
    const m = warnMat(BLADE_FRAG, { uDir: { value: dir } });
    mats.push(m);
    return m;
  };

  // The FACE: a bar hanging at the strike height across the platform's FRONT
  // edge — the one piece of this warning that lands in the player's forward
  // view, because a player being swept at is looking at the titan.
  //
  // This used to be a single vertical plane at z = 0, i.e. at the player's own
  // depth, which is a plane that CONTAINS the viewer: edge-on, zero pixels,
  // invisible. The floor band was the only other part, and when you're facing
  // a titan the deck at your feet is below your field of view — so the whole
  // sweep telegraph could not be seen at all from where it had to be read, and
  // the blade appeared to arrive out of nowhere behind you.
  const face = new Mesh(new PlaneGeometry(width, thickness * 2), mat());
  face.position.set(0, bladeY, -depth / 2);

  // The SLICE: the horizontal sheet the blade actually cuts through, at head
  // height — spells out the height you have to get under, and stays readable
  // when you turn your head to follow the cut.
  const slice = new Mesh(new PlaneGeometry(width, depth), mat());
  slice.rotation.x = -Math.PI / 2;
  slice.position.y = bladeY;

  // The FOOTPRINT on the deck, unchanged: which ground the cut covers.
  const band = new Mesh(new PlaneGeometry(width, depth), mat());
  band.rotation.x = -Math.PI / 2;
  band.position.y = CAMPAIGN.decalY;

  return makeTelegraph([face, slice, band], mats);
}
