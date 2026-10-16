/**
 * The club's teleport landing marker: the dancer's octagon, drawn as light on
 * the floor instead of a ghosted steel puck. (GAMBLE FISH's island marker —
 * which grew out of this very system — brought home.)
 *
 *  - PLATE: one shader quad draws the octagon from its edges. A bright rim with a white-hot
 *    core, a fainter inner line, a tinted fill that darkens toward the middle (so the rim still
 *    reads on the LED floor), and a soft glow spilling outside it.
 *  - FACING: two chevrons point the way you'll face, lighting up back to front in a slow wave.
 *  - PING: a ring leaves the rim every so often and fades as it goes, so the marker looks
 *    alive while you aim.
 *  - CURTAIN: a low wall of light stands on the octagon's outline and fades as it rises, with
 *    a band climbing it. It shows where you'll stand on the terrace, a booth table or the bar.
 *  - REFUSED: the plate turns hazard red with diagonal stripes, the chevrons dim, the ping
 *    and the curtain stop. The change eases in over a tenth of a second.
 *  - APPEARING: it pops in with a small overshoot when you start aiming.
 *
 * Two draws in all, both depth-tested but not depth-writing. The octagon is the platform
 * outline (OCTAGON_VERTICES), at the same 0.42× the old puck used.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Vector2Tuple,
} from 'three';

/** How big the marker is on the floor, relative to the platform outline. */
const SCALE = 0.42;
/** The curtain's height, in outline units (× SCALE for metres: about 0.2 m). */
const CURTAIN = 0.5;

/** Each edge of a counter-clockwise outline as (outward normal, distance from the centre). */
function edges(vertices: Vector2Tuple[]): Vector3[] {
  return vertices.map(([ax, ay], i) => {
    const [bx, by] = vertices[(i + 1) % vertices.length];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    return new Vector3(nx, ny, nx * ax + ny * ay);
  });
}

const PLATE_VERT = /* glsl */ `
  varying vec2 vQ;
  void main() {
    // plan coordinates with +y the facing direction (the marker faces -z at yaw 0)
    vQ = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLATE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdges[8];
  uniform float uTime;
  uniform float uRefused;
  uniform float uAppear;
  varying vec2 vQ;

  float octagon(vec2 p) {
    float d = -1e9;
    for (int i = 0; i < 8; i++) d = max(d, dot(p, uEdges[i].xy) - uEdges[i].z);
    return d;
  }

  // a line of half-width w centred on d = 0, anti-aliased by the pixel footprint
  float band(float d, float w) {
    float aa = fwidth(d) * 1.2;
    return 1.0 - smoothstep(w - aa, w + aa, abs(d));
  }

  float chevron(vec2 p, float tip, float w, float h, float t) {
    p.x = abs(p.x);
    vec2 a = vec2(0.0, tip);
    vec2 b = vec2(w, tip - h);
    vec2 pa = p - a;
    vec2 ba = b - a;
    float k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * k) - t;
  }

  void main() {
    float d = octagon(vQ);
    float ok = 1.0 - uRefused;
    float aa = fwidth(d) * 1.2;
    float inside = 1.0 - smoothstep(-aa, aa, d);

    // the rim: a bright line with a white-hot core, and a faint inner line
    float rim = band(d + 0.045, 0.045);
    float core = band(d + 0.045, 0.014);
    float inner = band(d + 0.17, 0.012) * 0.55;

    // the fill: tinted, dimmer toward the middle; hazard stripes when refused
    float depth = clamp(-d / 0.75, 0.0, 1.0);
    float fill = inside * mix(0.42, 0.16, depth);
    float stripe = smoothstep(0.45, 0.55, fract((vQ.x + vQ.y) * 3.2)) * inside * uRefused;

    // a soft glow spilling past the rim
    float glow = d > 0.0 ? exp(-d * 11.0) * 0.45 : 0.0;

    // the ping: a ring that leaves the rim and fades as it widens
    float phase = fract(uTime * 0.7);
    float ping = band(d - phase * 0.42, 0.03 + phase * 0.02) * (1.0 - phase) * (1.0 - phase) * ok;

    // the facing: two chevrons lit back to front in a travelling wave
    float c1 = chevron(vQ, 0.44, 0.3, 0.24, 0.065);
    float c2 = chevron(vQ, 0.14, 0.3, 0.24, 0.065);
    float w1 = 0.55 + 0.45 * smoothstep(0.0, 1.0, sin(uTime * 4.2 - 1.1) * 0.5 + 0.5);
    float w2 = 0.55 + 0.45 * smoothstep(0.0, 1.0, sin(uTime * 4.2) * 0.5 + 0.5);
    float arrow = max(band(c1, 0.0) * w1, band(c2, 0.0) * w2) * mix(1.0, 0.45, uRefused);
    float arrowCore = max(band(c1 + 0.04, 0.012), band(c2 + 0.04, 0.012)) * ok;
    float arrowGlow = exp(-max(min(c1, c2), 0.0) * 18.0) * 0.35 * (1.0 - inside * 0.4);

    float lit = max(max(rim, arrow), ping);
    float white = max(core, arrowCore) * 0.75;
    vec3 tint = uColor * 0.35;
    vec3 col = mix(tint, uColor, clamp(lit + inner + glow + stripe * 0.8 + arrowGlow, 0.0, 1.0));
    col = mix(col, vec3(1.0), white);

    float a = fill + stripe * 0.35 + inner + glow + arrowGlow;
    a = max(a, max(lit, white));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAppear);
    #include <colorspace_fragment>
  }
`;

const CURTAIN_VERT = /* glsl */ `
  attribute float aRun;
  varying float vH;
  varying float vRun;
  void main() {
    vH = uv.y;
    vRun = aRun;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CURTAIN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uRefused;
  uniform float uAppear;
  varying float vH;
  varying float vRun;
  void main() {
    float fade = (1.0 - vH) * (1.0 - vH);
    float streaks = 0.75 + 0.25 * sin(vRun * 38.0 + uTime * 1.5) * sin(vRun * 17.0 - uTime * 0.9);
    float climb = fract(uTime * 0.55);
    float band = exp(-pow((vH - climb) * 9.0, 2.0)) * (1.0 - climb) * 0.8;
    float a = (fade * 0.3 * streaks + band * fade) * (1.0 - uRefused * 0.85) * uAppear;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

/** A wall standing on the outline, `height` tall, with uv.y up it and aRun along it. */
function curtainGeometry(vertices: Vector2Tuple[], height: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const run: number[] = [];
  const idx: number[] = [];
  let travelled = 0;
  vertices.forEach(([ax, ay], i) => {
    const [bx, by] = vertices[(i + 1) % vertices.length];
    const len = Math.hypot(bx - ax, by - ay);
    const base = pos.length / 3;
    // plan (x, y) → floor (x, -z), as the plate
    pos.push(ax, 0, -ay, bx, 0, -by, bx, height, -by, ax, height, -ay);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    run.push(travelled, travelled + len, travelled + len, travelled);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    travelled += len;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aRun', new Float32BufferAttribute(run, 1));
  g.setIndex(idx);
  return g;
}

function easeOutBack(x: number): number {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

export class TeleportMarker {
  /** Position and turn this; its scale is the marker's own (the pop-in). */
  readonly group = new Group();
  private readonly plate: ShaderMaterial;
  private readonly curtain: ShaderMaterial;
  private readonly okColour = new Color();
  private readonly refusedColour = new Color();
  private refused = 0;
  /** where `refused` is easing to: 0 a good landing, 1 refused */
  private target = 0;
  private appear = 0;
  private time = 0;
  private shown = false;

  constructor(vertices: Vector2Tuple[], colours: { ok: number; refused: number }) {
    this.okColour.set(colours.ok);
    this.refusedColour.set(colours.refused);
    const shared = {
      uColor: { value: this.okColour.clone() },
      uTime: { value: 0 },
      uRefused: { value: 0 },
      uAppear: { value: 0 },
    };

    this.plate = new ShaderMaterial({
      uniforms: { ...shared, uEdges: { value: edges(vertices) } },
      vertexShader: PLATE_VERT,
      fragmentShader: PLATE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      // it lies on the floor it lands on: nudge it forward so the floor never cuts it
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // the quad covers the outline plus room for the glow and the ping
    const plate = new Mesh(new PlaneGeometry(2.8, 2.6).rotateX(-Math.PI / 2), this.plate);
    plate.renderOrder = 2;
    plate.frustumCulled = false;

    this.curtain = new ShaderMaterial({
      uniforms: shared,
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const curtain = new Mesh(curtainGeometry(vertices, CURTAIN), this.curtain);
    curtain.renderOrder = 3;
    curtain.frustumCulled = false;

    this.group.add(plate, curtain);
    this.group.scale.setScalar(SCALE);
    this.group.visible = false;
  }

  /** Show it (the pop-in restarts if it was hidden). */
  show(valid: boolean): void {
    if (!this.shown) {
      this.shown = true;
      this.appear = 0;
      this.refused = valid ? 0 : 1; // a fresh marker starts in its state, not easing into it
    }
    this.group.visible = true;
    this.target = valid ? 0 : 1;
  }

  hide(): void {
    this.shown = false;
    this.group.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.group.visible) return;
    this.refused += (this.target - this.refused) * (1 - Math.exp(-dt * 22));
    this.appear = Math.min(1, this.appear + dt / 0.18);
    const u = this.plate.uniforms;
    u.uTime.value = this.time;
    u.uRefused.value = this.refused;
    u.uAppear.value = Math.min(1, this.appear * 1.6);
    (u.uColor.value as Color).lerpColors(this.okColour, this.refusedColour, this.refused);
    this.group.scale.setScalar(SCALE * (0.72 + 0.28 * easeOutBack(this.appear)));
  }
}
