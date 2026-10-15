/**
 * Attack telegraphs for the ARCADE titans — the whole "souls-like" readability
 * contract lives here. Every titan strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges, and the fill IS the countdown.
 *
 * THE DANGER KIT, shared: the campaign's floor marks are RAVE RAID's
 * (rave/choreo/telegraphs.ts) — one heat ramp (amber charging, danger red
 * arriving, white-hot on the landing), neon ink at constant width in
 * metres, one diagonal hazard hatch laid in deck space, every mark clipped
 * to the octagon with the deck's own rim burning where it crosses doomed
 * ground, and the AFTERBURN: a landed mark ignites and burns out over
 * AFTERBURN_SEC (update with fill 1 → 2) instead of vanishing. The grammar
 * shapes the titans learned from the rave (gate, donut, X, rail, lane,
 * seesaw/surge, nova, sweep, the trident's quarters) ARE the rave's
 * factories; what lives here is only what the rave has no word for — the
 * slam's disc — cut from the same kit.
 *
 * Every group is placed relative to its DECK (CampaignSystem.deckOf: a
 * stand-in on the seat's platform frame), which is what makes the hatch,
 * the clip and the rim line up with the platform under it.
 *
 * The tutorial's green GO zone is the one mark that isn't danger, and it
 * keeps its own look.
 */

import { Mesh, PlaneGeometry } from 'three';
import { COMMON, makeTelegraph, quadTelegraph, warnMat, type Telegraph } from '../rave/choreo/telegraphs.js';

export {
  AFTERBURN_SEC,
  beamTelegraph,
  donutTelegraph,
  gateTelegraph,
  halfTelegraph,
  novaTelegraph,
  quadTelegraph,
  railTelegraph,
  sweepTelegraph,
  xTelegraph,
  type Telegraph,
} from '../rave/choreo/telegraphs.js';

/**
 * The slam: a fist's footprint, LOUD — the doomed disc hatched and scrimmed,
 * its edge a neon ring, the charge eating outward from the impact point
 * behind a hot hairline front (the strip's fuse, read radially), and the
 * impact point itself a heart that swells as the fist comes down. Clipped
 * to the deck: a disc near the rim never paints the void.
 */
const CIRCLE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uR, uPaneR;
  void main(){
    float r = length(vUv * 2.0 - 1.0) * uPaneR;
    float inside = 1.0 - smoothstep(uR - 0.012, uR + 0.012, r);
    float front = F() * uR;
    float wash = inside * (doom(vDeck) + step(r, front) * 0.14);
    wash += (1.0 - smoothstep(0.03 + 0.03 * F(), 0.08 + 0.06 * F(), r)) * (0.2 + 0.4 * F());
    float line = neon(abs(r - uR));
    line += hair(abs(r - front)) * 0.7 * (1.0 - landed()) * inside;
    line += inside * deckRim(vDeck) * 0.75;
    gl_FragColor = ink(wash, line) * octMask(vDeck);
  }
`;

/**
 * The green "stand HERE" half — the tutorial's footwork cue, the inverse
 * of the half flood: the called half GLOWS ("come", not "flee"), bands
 * march INTO it and the centreline rail is the line to cross. Same fill
 * contract as every warning (0→1 as the incoming ball flies). Not an
 * attack, so not the danger kit.
 */
const GO_FRAG = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  // A repeating stripe, antialiased at both ends and dissolving to its own
  // average once a tile is smaller than a pixel (grazing VR angles).
  float aaStripe(float x, float duty){
    float w = max(fwidth(x), 1e-5);
    float f = fract(x);
    float sharp = smoothstep(duty - w, duty + w, f) - smoothstep(1.0 - w, 1.0, f);
    return mix(sharp, 1.0 - duty, smoothstep(0.25, 0.5, w));
  }
  float aaStep(float edge, float x){
    float w = max(fwidth(x), 1e-5);
    return smoothstep(edge - w, edge + w, x);
  }
  void main(){
    vec3 col = vec3(0.34, 0.88, 0.54);
    float a = 0.08 + 0.4 * uFill;
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.3 + 0.7 * uFill);
    float lanes = aaStripe(vUv.x * 5.0 - uTime * 2.4, 0.72);
    float rungs = 1.0 - aaStep(0.32, abs(fract(vUv.y * 3.0) - 0.5));
    a += lanes * rungs * (0.12 + 0.25 * uFill);
    a += smoothstep(0.92, 1.0, vUv.x) * 0.25;
    a *= 0.85 + 0.15 * sin(uTime * mix(2.5, 10.0, uFill));
    gl_FragColor = vec4(col * clamp(a, 0.0, 1.0), 1.0);
  }
`;

/**
 * The green GO half (see GO_FRAG) — used by the tutorial's footwork drill.
 * `side` is the SAFE half's local-x sign; geometry mirrors halfTelegraph
 * exactly, so it lands on the deck the same way.
 */
export function goTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(GO_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/** A slam footprint of radius `radius`. Place the group at the zone centre
 *  on the deck. */
export function circleTelegraph(radius: number): Telegraph {
  // The pane overhangs the ring so its halo isn't cut square at the edge.
  const paneR = radius + 0.1;
  const mat = warnMat(CIRCLE_FRAG, { uR: { value: radius }, uPaneR: { value: paneR } });
  const disc = new Mesh(new PlaneGeometry(paneR * 2, paneR * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * A laser LANE down the deck at a fixed local x — the rave's beam strip,
 * authored from its near end. Place the group at (x, decalY, length / 2)
 * on the deck so the strip runs centred, filling from the titan's end.
 */
export { beamTelegraph as laneTelegraph } from '../rave/choreo/telegraphs.js';

/** THE TRIDENT's quarter lines — the split deck in
 *  chalk, lit for the whole move: where the split is, never which side. */
export function quarterTelegraph(halfWidth: number, halfDepth: number): Telegraph {
  return quadTelegraph(halfWidth, halfDepth, 0, true);
}
