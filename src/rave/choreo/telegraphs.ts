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

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress; time: seconds for the pulse. */
  update(fill: number, time: number): void;
  /** Independent placement/visibility, shared GPU resources and beat uniforms. */
  fork(): Telegraph;
  dispose(): void;
}

/** Shared vertex shader — pass UVs through. */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Hazard amber → danger red as the charge completes, pulsing faster. */
const COMMON = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  vec3 warnColor(){
    return mix(vec3(1.0, 0.69, 0.0), vec3(0.91, 0.21, 0.16), smoothstep(0.55, 0.95, uFill));
  }
  float pulse(){
    float rate = mix(3.0, 14.0, uFill);
    return 0.82 + 0.18 * sin(uTime * rate);
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
    // Chevron dashes marching toward the player while it charges.
    float dash = step(0.5, fract(vUv.y * 9.0 + uTime * 2.2));
    a += dash * 0.18;
    // The advance front: fills from the far (titan) end toward you.
    a += step(1.0 - uFill, vUv.y) * 0.34;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two bright rays — the one telegraph that means
 * "stand HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
/**
 * The platform's own silhouette, as a soft mask. The pie and the donut
 * used to be honest circles — which meant a metre of warning paint
 * hanging off the deck into the void. The danger never left the platform;
 * now the picture doesn't either. `q` is platform-local metres; constants
 * are the octagon from config (half-width .86, half-depth .75, chamfer
 * plane 0.375|x|+0.485|z| = 0.5044, normalised by its length).
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

const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  ${OCT_MASK}
  uniform float uAngle, uHalf, uPaneR;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec2 q = p * uPaneR;
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    // The doomed sector, soft-edged at the wedge line.
    float danger = smoothstep(uHalf - 0.015, uHalf + 0.03, d);
    vec3 col = warnColor();
    float a = 0.0;
    // A quiet scrim over the doomed ground — the flat flood read as a
    // cheap wash, so the danger is textured now, not poured:
    a += danger * (0.06 + 0.18 * uFill);
    // …fine radial spokes drifting through it (compass, not paint)…
    float spokes = smoothstep(0.62, 0.95, 0.5 + 0.5 * sin(ang * 24.0 - uTime * 1.3));
    a += danger * spokes * smoothstep(0.05, 0.2, r) * (0.05 + 0.12 * uFill);
    // …and shock arcs breathing OUTWARD from the core, quicker as the
    // fuse runs down — the countdown, read radially.
    float arc = smoothstep(0.82, 0.98, 0.5 + 0.5 * sin(r * 16.0 - uTime * (2.0 + 9.0 * uFill)));
    a += danger * arc * (0.10 + 0.28 * uFill);
    // The blast's own heart, swelling at the centre as it charges.
    float core = 1.0 - smoothstep(0.08 + 0.08 * uFill, 0.2 + 0.12 * uFill, r);
    a += core * (0.22 + 0.5 * uFill);
    // The deck's own edge burns through the doomed sector — the rim the
    // octagon actually has, not a circle the deck hasn't.
    float m = octMask(q);
    float rim = m - octMask(q * 1.1);
    a += danger * rim * 0.6;
    // The doorposts: one hard hairline per wedge edge with a soft halo,
    // CONSTANT-WIDTH in metres (angular width fattened into a blob near
    // the centre before) — the two rays that mean "between these".
    float er = abs(d - uHalf) * max(r, 0.03) * uPaneR;
    a += (1.0 - smoothstep(0.0, 0.02, er)) * 1.0;
    a += (1.0 - smoothstep(0.02, 0.1, er)) * 0.28;
    a *= pulse();
    a *= m;
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE X: both diagonal arms drawn as ONE pane. As two spun strips the
 * crossing double-blended into a white blob and the loose ends glowed off
 * past the rim; one shader means the union composes — a single scrim, edge
 * hairlines that trace the union's outline (never through the middle), a
 * ringed diamond KNOT where the arms meet, and both arms filling from
 * their far ends toward the crossing as the fuse runs down.
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
    float ch1 = in1 * step(0.55, fract(abs(t1) * 2.6 + uTime * 1.5));
    float ch2 = in2 * step(0.55, fract(abs(t2) * 2.6 + uTime * 1.5));
    a += max(ch1, ch2) * 0.13;
    // The advance: both arms light from their far ends toward the crossing
    // (lit where |t| > front, and the front walks in as the fuse runs down;
    // edges ascending — reversed-edge smoothstep is undefined in GLSL).
    float front = (1.0 - uFill) * uPaneR;
    a += max(in1 * smoothstep(front - 0.14, front, abs(t1)),
             in2 * smoothstep(front - 0.14, front, abs(t2))) * 0.24;
    // Edge hairlines along the UNION's outline — |min(d)−w| is zero on the
    // outer rails and never inside the crossing, so no lines cut the knot.
    float eu = abs(min(d1, d2) - uHalfW);
    a += (1.0 - smoothstep(0.0, 0.02, eu)) * 0.95;
    a += (1.0 - smoothstep(0.02, 0.09, eu)) * 0.22;
    // THE KNOT: the diamond where the arms cross is the deadliest ground —
    // a ringed frame just proud of the rails, and a heart that heats up.
    float kd = max(d1, d2);
    a += (1.0 - smoothstep(0.0, 0.025, abs(kd - (uHalfW + 0.03)))) * (0.45 + 0.45 * uFill);
    a += (1.0 - smoothstep(uHalfW * 0.5, uHalfW, kd)) * (0.08 + 0.3 * uFill);
    a *= pulse();
    a *= octMask(q);
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE ROUTINE's step mark: one quarter of the deck, ringed and washed, with
 * its STEP NUMBER spelled out as a row of dots in the middle — one dot for
 * step one, two for step two. Drawn in goo green, not hazard amber: during
 * the preview nothing is dangerous yet, and the marks are a lesson rather
 * than a warning. They fade out near the end of the charge, and from then
 * on the routine lives only in your head. uOrd = the step number.
 */
const MARK_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uOrd, uAspect;
  void main(){
    // Goo green — the boss's own colour, and never confusable with the
    // amber that means "don't be here".
    vec3 col = vec3(0.62, 1.0, 0.70);
    // The lesson is over before the first step lands.
    float fade = 1.0 - smoothstep(0.70, 0.92, uFill);
    float a = 0.10;
    // Border around the quarter — this whole square is the ground.
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a += (1.0 - smoothstep(0.022, 0.055, e)) * 0.55;
    // The step number, as dots in a row across the middle.
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uOrd) break;
      float cx = 0.5 + (float(i) - (uOrd - 1.0) * 0.5) * 0.15;
      vec2 p = (vUv - vec2(cx, 0.5)) * vec2(1.0, 1.0 / uAspect);
      a += (1.0 - smoothstep(0.04, 0.055, length(p))) * 0.95;
    }
    a *= fade * pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE ROUTINE's quarter lines: the cross that splits the deck into four,
 * lit dim and neutral for the whole move. It is furniture, not danger —
 * it says where the boxes will land, never which quarter is yours — so it
 * stays a cool chalk white and never fills.
 */
const QUARTER_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    float a = 0.0;
    // Two chalk lines through the middle, softly feathered.
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.x - 0.5))) * 0.5;
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.y - 0.5))) * 0.5;
    // Ticks at the rim so the split reads even from across the ring.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a *= 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.18, edge));
    a *= 0.75 + 0.25 * sin(uTime * 2.0);
    gl_FragColor = vec4(vec3(0.86, 0.92, 1.0), a);
  }
`;

/**
 * Donut: the RIM floods and the middle lives — the nova's opposite number.
 * A bright doorpost CIRCLE burns at the edge of the safe disc with chevrons
 * marching inward across the doomed ring, so the shape says "in here", not
 * "somewhere over there". uInner = safe radius as a fraction of the pane.
 */
const DONUT_FRAG = /* glsl */ `
  ${COMMON}
  ${OCT_MASK}
  uniform float uInner, uPaneR;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float safe = step(r, uInner);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything outside the safe disc fills with the charge.
    a += (1.0 - safe) * (0.12 + 0.5 * uFill);
    // The doorpost ring — the honest edge of the ground that lives.
    a += smoothstep(0.055, 0.0, abs(r - uInner)) * (0.35 + 0.65 * uFill);
    // Chevron rings marching INWARD toward the safe disc (+uTime pulls the
    // pattern to smaller radii as the clock runs).
    float band = step(0.68, fract((r - uInner) * 5.5 + uTime * 1.9));
    a += band * (1.0 - safe) * (0.12 + 0.2 * uFill);
    a *= pulse();
    // The deck's edge IS the far edge now — nothing paints past it.
    a *= octMask(p * uPaneR);
    gl_FragColor = vec4(col, a);
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
    float lane = fract(vUv.x * 5.0 + uTime * 2.4);
    float band = step(0.72, lane) * step(abs(fract(vUv.y * 3.0) - 0.5), 0.32);
    a += band * (0.1 + 0.25 * uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Gate: the WHOLE deck floods EXCEPT one clear column — the doorpost rails
 * burn at its edges and chevron streams march INTO it from both sides. The
 * linear cousin of the nova: the one telegraph that says "stand HERE", on a
 * line instead of a compass. uGap = column centre (u), uHalf = half-width (u).
 */
const GATE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uGap, uHalf;
  void main(){
    vec3 col = warnColor();
    float d = vUv.x - uGap;
    float inGap = step(abs(d), uHalf);
    float a = 0.0;
    // The flood: everything OUTSIDE the column fills with the charge.
    a += (1.0 - inGap) * (0.1 + 0.5 * uFill);
    // Doorpost rails — the honest edges of the safe ground.
    a += smoothstep(0.045, 0.0, abs(abs(d) - uHalf)) * (0.35 + 0.65 * uFill);
    // Chevron streams marching INTO the gap from both sides.
    float band = step(0.68, fract(abs(d) * 9.0 + uTime * 2.3));
    a += band * (1.0 - inGap) * step(abs(fract(vUv.y * 4.0) - 0.5), 0.34) * 0.22;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Danger roof: a horizontal pane hung at the sweep line — the threat reads
 * as a CEILING over the whole deck, never as a wall about to bisect it.
 * Faint bands drift along +u (mirror the mesh so they run entry → exit).
 */
const ROOF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.10 + 0.40 * uFill;
    // Drift bands carry the swing's travel direction across the roof.
    float band = step(0.72, fract(vUv.x * 5.0 - uTime * 1.4));
    a += band * 0.13;
    a *= smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
    a *= smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
    a *= pulse();
    gl_FragColor = vec4(col, a);
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
    vec3 col = warnColor();
    // A V-shape per row: the row line dips at the centre (chevron pointing
    // down), and the whole pattern marches DOWNWARD with time.
    float vee = vUv.y * 5.0 + abs(vUv.x - 0.5) * 2.2 + uTime * 1.8;
    float row = smoothstep(0.42, 0.5, fract(vee)) * (1.0 - smoothstep(0.5, 0.58, fract(vee)));
    float a = row * (0.16 + 0.38 * uFill);
    // Fade at the plane's side edges so it reads as a stream, not a wall.
    a *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/** Blade: a horizontal slice hanging in the air — bright core line, soft body. */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float a = pow(mid, 3.0) * 0.75 + mid * 0.12;
    // Fill sweeps across the width as the swing charges.
    a *= 0.35 + 0.65 * step(vUv.x, uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
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
 * THE ROUTINE, taught: one marked quarter per step, each carrying its step
 * number in dots. `corners` are (sx, sz) signs in platform-local space.
 * Place the group at the deck centre on the floor; the marks fade
 * themselves out as the charge runs down.
 */
export function routineMarksTelegraph(
  routine: readonly number[],
  halfWidth: number,
  halfDepth: number,
): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  const w = halfWidth * 0.92;
  const d = halfDepth * 0.92;
  routine.forEach((corner, step) => {
    const mat = warnMat(MARK_FRAG, { uOrd: { value: step + 1 }, uAspect: { value: w / d } });
    const pane = new Mesh(new PlaneGeometry(w, d), mat);
    pane.rotation.x = -Math.PI / 2;
    pane.position.set(((corner & 1 ? 1 : -1) * halfWidth) / 2, 0, ((corner & 2 ? 1 : -1) * halfDepth) / 2);
    meshes.push(pane);
    mats.push(mat);
  });
  return makeTelegraph(meshes, mats);
}

/** THE ROUTINE's quarter lines — the split deck, lit for the whole move. */
export function quarterTelegraph(halfWidth: number, halfDepth: number): Telegraph {
  const mat = warnMat(QUARTER_FRAG);
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
    const bladeMat = warnMat(BLADE_FRAG);
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
  const mat = warnMat(STRIP_FRAG);
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
  });
  const pane = new Mesh(new PlaneGeometry(along, axis ? w : d), mat);
  pane.rotation.set(-Math.PI / 2, 0, axis ? Math.PI / 2 : 0);
  return makeTelegraph([pane], [mat]);
}
