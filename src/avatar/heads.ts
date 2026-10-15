/**
 * THE HEADS — FIRE FIGHT 1's animal heads, brought back as GEAR for THE
 * BLANK (avatar/gear.ts, the HEADS slot).
 *
 * FF1 wore eight lofted-steel animals; FF2 retired them with the skins
 * roster (see the note in avatar/boxer.ts), and the bare egg that replaced
 * them never had their shapes. These are those skulls — same lofts, same
 * proportions — re-materialled for the mannequin: the shell is the body's
 * own PRIMER (white or onyx, and a paint surface like any gear), the
 * details that must stay dark (nose pads, sockets, inner ears, slits) are
 * TRIM, and the eyes burn in the wearer's ACCENT. A head REPLACES the bare
 * skull while it's worn; the BODY_IK head sphere never moves, so a bear is
 * exactly as hittable as a blank.
 *
 * WHAT CHANGED FROM FF1 (the iteration, head by head in the builders):
 *  - SIZE: carried at ~4/5 (HEAD_SIZE) — FF1 scaled them for its
 *    shoulder-heavy robots, and on the slender blank they were as wide as
 *    the shoulders.
 *  - ONE GLOW: only the eyes (and the knight's sight) burn. FF1's lit
 *    blazes, vanes, rims, whiskers, fangs and masks are primer or trim —
 *    markings are what THE PAINT is for.
 *  - NO CARDS: fur ruffs, manes, crests and brows were flat boxes, which
 *    read as panel lines on mirror steel and as playing cards on porcelain;
 *    they are rounded masses (ellipsoid) and tapered tufts (tuft) now.
 *  - SMOOTHER: denser lofts and spheres, UV'd for the gear atlas; the
 *    knight's cross and sight wrap the barrel instead of standing off it,
 *    and its skirt is primer, the body's colour.
 *  - REDESIGNED: the WOLF, FROG and BUNNY are FF2 builds, not FF1 ports
 *    (see their notes below).
 *
 * Frame (as every head piece): origin at the head centre, front −z, sized
 * off BODY_IK.headRadius.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  Raycaster,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { BODY_IK } from '../config.js';

export type HeadBuilder = (mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial) => Group;

/** A soft stand-in for FF1's flat plates: the ellipsoid that fills the same
 *  box (full extents w × h × d). On mirror steel a box edge read as a
 *  panel line; on primer porcelain it reads as a playing card stuck to the
 *  head, so brows, ridges and ruffs are rounded masses now. */
function ellipsoid(w: number, h: number, d: number): BufferGeometry {
  const geo = new SphereGeometry(0.5, 24, 16);
  geo.scale(w, h, d);
  return geo;
}

/** A TUFT — fur, a feather, a lock of mane: a teardrop the size of the
 *  box it replaces (w × h × d), round at its root (−y) and drawn to a
 *  point at its tip (+y), so a fan of them reads as hair and not boards. */
function tuft(w: number, h: number, d: number): BufferGeometry {
  const geo = new SphereGeometry(0.5, 20, 16);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // −0.5..0.5
    // Full girth at the root third, tapering to nothing at the tip.
    const t = Math.min(1, Math.max(0, (y + 0.2) / 0.7));
    const k = 1 - t * t * (3 - 2 * t) * 0.92;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  geo.scale(w, h, d);
  return geo;
}

/** A curved strip laid round a barrel's FRONT: inner/outer radius, height,
 *  a half-angle of arc, centred `at` radians off dead-ahead (−z). */
function band(r0: number, r1: number, h: number, half: number, at = 0): BufferGeometry {
  const profile = [new Vector2(r0, -h / 2), new Vector2(r1, -h / 2), new Vector2(r1, h / 2), new Vector2(r0, h / 2), new Vector2(r0, -h / 2)];
  // Lathe angle φ puts a point at (sin φ, cos φ)·x — dead-ahead (−z) is φ = π.
  return new LatheGeometry(profile, 24, Math.PI + at - half, half * 2);
}

/** One cross-section of the lofted horse skull: the topline point (forehead /
 *  nasal bridge) and underline point (throat / jaw / chin) in the sagittal
 *  plane as [y, z] (in headRadius units), the half-width at that station, and
 *  a superellipse exponent (2 = ellipse, higher = flatter-sided). */
interface HeadStation {
  top: [number, number];
  bot: [number, number];
  w: number;
  n: number;
}

/** VALKYRIE → EAGLE, lofted for accuracy: a sleek rounded raptor skull with
 *  a heavy supraorbital ledge shading fierce side-set eyes, the huge hooked
 *  beak lofted through its real down-curve (with cere and nostrils), and a
 *  hackle ruff of layered feathers around the nape instead of a fantasy
 *  mohawk. The anatomical lower mandible is deliberately GONE — under the
 *  giant upper beak it read as a small black tab hanging off the face, and
 *  the clean single-wedge profile is the look. */
function buildEagleHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.4); // carried proud — a touch under the bear (1.5 read too big)
  g.position.y = 0.05; // highest carry of the three — the low nape ruff needs the clearance

  // (No neck column: the spanning cylinder read as a strange dark cone under
  // the jaw from most angles — the floating-head gap looks cleaner than the
  // fix ever did.)

  // The head loft, nape → cere. The crown stays high and flat all the way
  // to the brow ledge (the eagle "scowl" is bone, not eyebrow), then steps
  // down sharply onto the beak base.
  const skull = new Mesh(
    loftGeometry(
      [
        { top: [0.48, 0.5], bot: [-0.42, 0.58], w: 0.4, n: 2.05 }, // nape ruff root
        { top: [0.64, 0.28], bot: [-0.48, 0.42], w: 0.45, n: 2.05 }, // back crown
        { top: [0.68, -0.05], bot: [-0.5, 0.18], w: 0.46, n: 2.1 }, // crown (low, flat)
        { top: [0.7, -0.45], bot: [-0.46, -0.15], w: 0.44, n: 2.3 }, // brow shelf (proud, square)
        { top: [0.44, -0.66], bot: [-0.4, -0.46], w: 0.34, n: 2.1 }, // eye line, cut UNDER the shelf
        { top: [0.32, -0.86], bot: [-0.34, -0.68], w: 0.26, n: 2.0 }, // forehead step
        { top: [0.26, -0.96], bot: [-0.3, -0.8], w: 0.2, n: 1.9 }, // cere
      ],
      r,
    ),
    mat,
  );
  g.add(skull);

  // The upper beak: HUGE — the face-dominating hooked wedge, deep from
  // culmen to cutting edge, projecting far forward before the tip plunges
  // past the chin line.
  const beak = new Mesh(
    loftGeometry(
      [
        { top: [0.3, -0.85], bot: [-0.45, -0.7], w: 0.24, n: 1.95 }, // buried in the head
        { top: [0.26, -1.22], bot: [-0.5, -1.08], w: 0.2, n: 1.9 }, // culmen holds HIGH…
        { top: [0.08, -1.5], bot: [-0.55, -1.36], w: 0.15, n: 1.8 }, // …arching forward…
        { top: [-0.28, -1.68], bot: [-0.6, -1.54], w: 0.09, n: 1.75 }, // …then breaking over
        { top: [-0.64, -1.66], bot: [-0.69, -1.56], w: 0.03, n: 1.7 }, // the hook, plunging
      ],
      r,
    ),
    mat,
  );
  g.add(beak);

  // (No lower mandible — see the note above. The upper beak carries the face
  // on its own; the cere below still closes the head/beak seam.)

  // Cere saddle wrapping the beak root, hiding the head/beak seam, with the
  // two nostril slits ahead of it.
  const cere = new Mesh(new SphereGeometry(r * 0.15, 24, 16), trimMat);
  cere.scale.set(1.2, 0.6, 0.9);
  cere.position.set(0, r * 0.24, -r * 0.86);
  cere.rotation.x = 0.5;
  g.add(cere);
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.04, 20, 14), trimMat);
    nostril.scale.set(0.7, 1, 0.6);
    nostril.position.set(side * r * 0.11, r * 0.1, -r * 1.02);
    g.add(nostril);
  }

  // The eyes: BIG — wide expressive ovals under a heavy slanted dark lid
  // (the cartoon-raptor scowl), tucked against the brow shelf.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.17, 28, 19), trimMat);
    socket.scale.set(0.7, 0.95, 0.85);
    socket.position.set(side * r * 0.3, r * 0.36, -r * 0.52);
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.14, 28, 19), glowMat);
    eye.scale.set(0.72, 1.0, 0.85);
    eye.position.set(side * r * 0.33, r * 0.35, -r * 0.55);
    eye.rotation.y = side * -0.5;
    g.add(eye);
    // The lid: a dark bar slanting DOWN toward the beak — the glare.
    const lid = new Mesh(ellipsoid(r * 0.3, r * 0.09, r * 0.14), trimMat);
    lid.position.set(side * r * 0.28, r * 0.52, -r * 0.56);
    lid.rotation.set(0.25, side * -0.3, side * 0.4);
    g.add(lid);
  }

  // The hackle ruff: a second, smaller loft flaring back and DOWN off the
  // nape — the layered feather collar a real eagle carries, read as one
  // smooth swept mass instead of taped-on plates.
  const ruff = new Mesh(
    loftGeometry(
      [
        { top: [0.52, 0.3], bot: [-0.46, 0.4], w: 0.42, n: 2.1 }, // buried in the head
        { top: [0.28, 0.6], bot: [-0.6, 0.66], w: 0.47, n: 2.0 }, // flaring…
        { top: [-0.08, 0.76], bot: [-0.68, 0.78], w: 0.38, n: 1.9 }, // …to the collar tip
      ],
      r,
    ),
    mat,
  );
  g.add(ruff);

  // The SCRUFF: a ring of jagged feather tips around the base of the head,
  // pointing down and out — the smooth ruff mass above ends in zigzag
  // points, the shaggy collar that sells the eagle's neck.
  const _sDir = new Vector3();
  const _sUp = new Vector3(0, 1, 0);
  for (let i = 0; i < 11; i++) {
    const a = ((35 + i * 29) * Math.PI) / 180; // wraps the neck, skips the beak
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const len = r * (0.26 + (i % 2) * 0.09); // alternating long/short = the zigzag
    _sDir.set(sx * 0.6, -1, sz * 0.6).normalize();
    const quill = new Mesh(new ConeGeometry(r * 0.125, len, 6), mat);
    quill.scale.z = 0.55;
    quill.quaternion.setFromUnitVectors(_sUp, _sDir);
    quill.position
      .set(sx * r * 0.36, -r * 0.38, sz * r * 0.34 + r * 0.1)
      .addScaledVector(_sDir, len / 2);
    g.add(quill);
  }

  // The CREST: a fan of long feathers sweeping up and back off the crown —
  // harpy-eagle style — tallest over the poll, laying flatter as it runs
  // down the nape. (FF2: primer tufts; FF1's lit vanes are gone.)
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const len = r * (0.62 + Math.sin(t * Math.PI) * 0.3);
    const tilt = -0.12 + t * 1.02; // near-vertical in front → swept back at the nape
    const baseY = r * (0.6 - t * 0.16);
    const baseZ = r * (-0.12 + t * 0.56);
    const cy = baseY + (Math.cos(tilt) * len) / 2 - r * 0.08;
    const cz = baseZ + (Math.sin(tilt) * len) / 2;
    const feather = new Mesh(tuft(r * 0.13, len, r * 0.16), mat);
    feather.position.set(0, cy, cz);
    feather.rotation.x = tilt;
    g.add(feather);
  }
  // A shorter flanking pair splayed off the crown for crest volume.
  for (const side of [-1, 1]) {
    const feather = new Mesh(tuft(r * 0.1, r * 0.52, r * 0.13), mat);
    feather.position.set(side * r * 0.16, r * 0.84, r * 0.1);
    feather.rotation.set(0.18, 0, side * -0.22);
    g.add(feather);
  }

  // Cheek feather lines sweeping back from the beak under the eyes.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const plate = new Mesh(ellipsoid(r * 0.06, r * 0.3, r * 0.42 - i * r * 0.1), mat);
      plate.position.set(side * (r * 0.42 - i * r * 0.06), -r * 0.1 - i * r * 0.14, -r * 0.35 + i * r * 0.12);
      plate.rotation.set(0, side * 0.5, side * 0.28);
      g.add(plate);
    }
  }
  return g;
}

/** KNIGHT → a CRUSADER great helm: a flat-topped barrel with a raised
 *  Templar cross, a dark sight slit lit in the accent, breathing-hole dots
 *  and a riveted rim. (FF1's lit cross is primer now: paint it gold.) */
function buildKnightHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();

  // Flat-topped barrel helm fully enclosing the head, capped flat with a seam.
  const barrel = new Mesh(new CylinderGeometry(r * 0.98, r * 1.06, r * 1.7, 20), mat);
  barrel.position.y = r * 0.3;
  g.add(barrel);
  const cap = new Mesh(new CylinderGeometry(r * 0.99, r * 0.98, r * 0.16, 20), mat);
  cap.position.y = r * 1.2;
  g.add(cap);
  const ridge = new Mesh(new BoxGeometry(r * 0.12, r * 0.1, r * 2.05), mat);
  ridge.position.set(0, r * 1.27, 0);
  g.add(ridge);

  // The raised TEMPLAR CROSS: a long vertical bar + a crossbar at the sight line.
  const vbar = new Mesh(new BoxGeometry(r * 0.3, r * 1.78, r * 0.08), mat);
  vbar.position.set(0, r * 0.32, -r * 1.06);
  g.add(vbar);
  // The crossbar and the sight WRAP the barrel. FF1 laid them on as flat
  // boards, which on dark mirror steel read fine; in primer, from anywhere
  // off dead-centre, their ends stood clear of the curve like planks.
  const hbar = new Mesh(band(r * 1.0, r * 1.08, r * 0.28, 1.0), mat);
  hbar.position.y = r * 0.5;
  g.add(hbar);

  // The sight: a dark slit either side of the cross, with a faint eye glow so
  // it still reads alive across the gap.
  for (const side of [-1, 1]) {
    const slit = new Mesh(band(r * 0.99, r * 1.05, r * 0.13, 0.35, side * 0.52), trimMat);
    slit.position.y = r * 0.27; // just under the bar, where it shows whole
    g.add(slit);
    const eye = new Mesh(band(r * 1.04, r * 1.062, r * 0.05, 0.29, side * 0.52), glowMat);
    eye.position.y = r * 0.27;
    g.add(eye);
  }

  // Breathing holes — clustered dark studs across the lower face, both sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const hole = new Mesh(new CylinderGeometry(r * 0.05, r * 0.05, r * 0.05, 7), trimMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(side * (r * 0.24 + col * r * 0.14), -r * 0.06 - row * r * 0.17 - col * r * 0.04, -r * 1.05);
      g.add(hole);
    }
  }

  // Riveted lower-front rim.
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI * 0.6 + (i / 12) * Math.PI * 1.2;
    const stud = new Mesh(new SphereGeometry(r * 0.045, 20, 14), mat);
    stud.position.set(Math.sin(a) * r * 1.04, -r * 0.5, -Math.cos(a) * r * 1.06);
    g.add(stud);
  }

  // Gorget neck base flaring under the helm — the SKIRT, in the body's own
  // base colour (it was trim, and read as a dark collar cut off the body).
  const gorget = new Mesh(new CylinderGeometry(r * 0.72, r * 0.9, r * 0.34, 32), mat);
  gorget.position.y = -r * 0.64;
  g.add(gorget);
  return g;
}



/** Loft a smooth, capped skin over a run of head stations. Each station
 *  becomes a ring of `seg` vertices: a superellipse stretched between its
 *  topline and underline points — so the section PLANES tilt with the face
 *  (a horse's face plane leans forward-down) and the width/roundness vary
 *  station to station. Rings are stitched into quads and both ends capped.
 *
 *  FF2: denser (the primer is smooth porcelain, and FF1's 22-sided rings
 *  faceted under it) and UV'd — u around each ring (the seam column
 *  duplicated), v along the stations — so THE GEAR ATLAS lays the paint
 *  over the skull as one continuous island instead of projecting it flat
 *  through front and back at once. */
function loftGeometry(stations: HeadStation[], scale: number, seg = 40): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cols = seg + 1;
  stations.forEach((st, i) => {
    const midY = (st.top[0] + st.bot[0]) / 2;
    const midZ = (st.top[1] + st.bot[1]) / 2;
    const hy = (st.top[0] - st.bot[0]) / 2;
    const hz = (st.top[1] - st.bot[1]) / 2;
    const e = 2 / st.n;
    for (let j = 0; j < cols; j++) {
      const a = ((j % seg) / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const u = Math.sign(c) * Math.abs(c) ** e;
      const v = Math.sign(s) * Math.abs(s) ** e;
      pos.push(st.w * u * scale, (midY + hy * v) * scale, (midZ + hz * v) * scale);
      uv.push(j / seg, i / (stations.length - 1));
    }
  });
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Fan caps over the first (back of skull) and last (nose tip) rings.
  const backCentre = pos.length / 3;
  const s0 = stations[0];
  pos.push(0, ((s0.top[0] + s0.bot[0]) / 2) * scale, ((s0.top[1] + s0.bot[1]) / 2) * scale);
  uv.push(0.5, 0);
  const noseCentre = pos.length / 3;
  const sn = stations[stations.length - 1];
  pos.push(0, ((sn.top[0] + sn.bot[0]) / 2) * scale, ((sn.top[1] + sn.bot[1]) / 2) * scale);
  uv.push(0.5, 1);
  const last = (stations.length - 1) * cols;
  for (let j = 0; j < seg; j++) {
    idx.push(backCentre, j, j + 1);
    idx.push(noseCentre, last + j + 1, last + j);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ── FF2 redesigns: the WOLF, the FROG and the BUNNY ────────────────────
 * These three were carried over from FF1 first and asked for again: the
 * wolf read as a rat (faceted pyramid ears, a lumpy muzzle, ruffs too small
 * to find), the frog had four eyes (its black eardrums) and a mouth of
 * floating bars, and the bunny was a ball with two pipes on it. Rebuilt
 * from the same toolkit — lofts, leaves, tufts — around one strong idea
 * each: the wolf's RUFF, the frog's LIDDED turrets and wrap-round SMILE,
 * the bunny's EARS. */

/** A point ON a loft's surface: station `i`'s ring at angle `a` (0 = the
 *  +x side, π/2 = the topline, −π/2 = the underline), pushed `out` along
 *  the section so a line laid there sits proud of the skin. */
function onLoft(st: HeadStation, a: number, scale: number, out = 1.0): Vector3 {
  const midY = (st.top[0] + st.bot[0]) / 2;
  const midZ = (st.top[1] + st.bot[1]) / 2;
  const hy = (st.top[0] - st.bot[0]) / 2;
  const hz = (st.top[1] - st.bot[1]) / 2;
  const e = 2 / st.n;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const u = Math.sign(c) * Math.abs(c) ** e;
  const v = Math.sign(s) * Math.abs(s) ** e;
  return new Vector3(st.w * u * out * scale, (midY + hy * v * out) * scale, (midZ + hz * v * out) * scale);
}

/** A line drawn along a loft at a fixed ring angle, stations `from`..`to`,
 *  for both sides at once (a → the +x side, π − a → the −x side), joined
 *  across the front: a mouth that follows the head it is cut into. */
function loftSmile(stations: HeadStation[], a: number, from: number, to: number, scale: number, out: number): Vector3[] {
  // Sampled BETWEEN stations too (the loft runs straight from ring to
  // ring, so a curve through the stations alone dips under the skin).
  const right: Vector3[] = [];
  const steps = 5;
  for (let i = from; i <= to; i++) {
    for (let k = 0; k < (i === to ? 1 : steps); k++) {
      const t = k / steps;
      const a0 = stations[i];
      const b0 = stations[Math.min(i + 1, to)];
      const mix = (p: number, q: number): number => p + (q - p) * t;
      right.push(onLoft({
        top: [mix(a0.top[0], b0.top[0]), mix(a0.top[1], b0.top[1])],
        bot: [mix(a0.bot[0], b0.bot[0]), mix(a0.bot[1], b0.bot[1])],
        w: mix(a0.w, b0.w),
        n: mix(a0.n, b0.n),
      }, a, scale, out));
    }
  }
  const left = right.map((p) => new Vector3(-p.x, p.y, p.z)).reverse();
  return [...left, ...right];
}

/** DRAPE a line over a surface: each point is found again by a ray cast
 *  from the head's axis (x = 0, at the point's own height, `axisZ` deep)
 *  out through it to the skin, and lifted `lift` along the skin's normal
 *  there — so the line sits proud of the surface all the way round,
 *  whichever way the surface faces (a push out from the section centre
 *  left it half-buried wherever the snout turned to face forward). */
function drape(surface: Mesh, pts: Vector3[], axisZ: number, lift: number): Vector3[] {
  const probe = new Mesh(surface.geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const ray = new Raycaster();
  const o = new Vector3();
  const d = new Vector3();
  return pts.map((p) => {
    o.set(0, p.y, axisZ);
    d.copy(p).sub(o);
    if (d.lengthSq() < 1e-12) return p.clone();
    d.normalize();
    ray.set(o, d);
    const hit = ray.intersectObject(probe, false).pop(); // the outermost crossing
    if (!hit?.face) return p.clone();
    const n = hit.face.normal.clone();
    if (n.dot(d) < 0) n.negate();
    return hit.point.clone().addScaledVector(n, lift);
  });
}

/** A thin trim line through `pts` — a mouth, a seam. */
function groove(pts: Vector3[], radius: number, trimMat: MeshStandardMaterial): Mesh {
  const curve = new CatmullRomCurve3(pts);
  return new Mesh(new TubeGeometry(curve, pts.length * 8, radius, 8, false), trimMat);
}

/** A LEAF — an ear: an ellipsoid w × h × d drawn to a soft point at the
 *  top (`point` 0..1), its root rounded at −y, the upper half swept back
 *  by `bend` metres (quadratic, so it curls rather than kinks). */
function leaf(w: number, h: number, d: number, point: number, bend: number): BufferGeometry {
  const geo = new SphereGeometry(0.5, 24, 24);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5; // 0 root → 1 tip
    const k = 1 - point * Math.max(0, t - 0.45) * 1.4;
    pos.setX(i, pos.getX(i) * w * k);
    pos.setZ(i, pos.getZ(i) * d * (0.6 + 0.4 * k) + bend * t * t);
    pos.setY(i, pos.getY(i) * h);
  }
  geo.computeVertexNormals();
  return geo;
}

/** FOLD a piece forward (toward −z) about a hinge at height `at`: above
 *  it, the centreline (x = 0, z = 0) runs round an arc of radius `R` for
 *  `angle` radians and then straight on, and every vertex keeps its offset
 *  from the centreline in the turning frame — so a flopped ear bends like
 *  felt, and a leaf laid on its front face folds with it on the inside. */
function fold(geo: BufferGeometry, at: number, R: number, angle: number): void {
  const pos = geo.getAttribute('position');
  const arc = R * angle;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y <= at) continue;
    const s = y - at;
    const dz = pos.getZ(i);
    const phi = Math.min(s, arc) / R;
    let cy = at + R * Math.sin(phi);
    let cz = -R * (1 - Math.cos(phi));
    if (s > arc) {
      cy += (s - arc) * Math.cos(angle);
      cz -= (s - arc) * Math.sin(angle);
    }
    // The frame turns with the arc: the ear's depth axis tips from +z over.
    pos.setY(i, cy + dz * Math.sin(phi));
    pos.setZ(i, cz + dz * Math.cos(phi));
  }
  geo.computeVertexNormals();
}

/** A tuft planted at `root`, growing along `dir` (a teardrop, see tuft). */
function tuftAt(mat: MeshStandardMaterial, root: Vector3, dir: Vector3, w: number, h: number, d: number): Mesh {
  const n = dir.clone().normalize();
  const m = new Mesh(tuft(w, h, d), mat);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), n);
  m.position.copy(root).addScaledVector(n, h * 0.42);
  return m;
}

/** A band laid ROUND a loft at station `i` (a noseband, a browband):
 *  the ring's own section from angle `a0` to `a1`, pushed `out` so it sits
 *  on the skin. */
function loftRing(stations: HeadStation[], i: number, a0: number, a1: number, scale: number, out: number): Vector3[] {
  const pts: Vector3[] = [];
  const n = 24;
  for (let k = 0; k <= n; k++) pts.push(onLoft(stations[i], a0 + ((a1 - a0) * k) / n, scale, out));
  return pts;
}

/** BEAR — FF2 build. FF1's bear was a dome with its face stuck on in
 *  lumps (jowl balls, a jaw ball, a bridge bar, brow bars); this one is
 *  SMOOTH: the dome runs down through a dished stop into a deep muzzle in
 *  one loft, a lower jaw sits under it, and the face is drawn ON that
 *  surface — a big nose pad, the philtrum and a mouth line — with small
 *  deep-set eyes, round cupped ears and soft cheek ruffs. */
function buildBearHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.2);
  g.position.y = 0.015;

  const st: HeadStation[] = [
    { top: [0.5, 0.6], bot: [-0.36, 0.62], w: 0.46, n: 2.0 }, // occiput
    { top: [0.8, 0.3], bot: [-0.5, 0.42], w: 0.6, n: 2.1 }, // crown
    { top: [0.78, 0.0], bot: [-0.58, 0.2], w: 0.66, n: 2.2 }, // cheeks (widest)
    { top: [0.62, -0.3], bot: [-0.58, -0.06], w: 0.6, n: 2.2 }, // brow
    { top: [0.36, -0.52], bot: [-0.5, -0.3], w: 0.42, n: 2.1 }, // the dished stop
    { top: [0.25, -0.72], bot: [-0.4, -0.58], w: 0.31, n: 2.2 }, // muzzle root
    { top: [0.19, -0.92], bot: [-0.32, -0.84], w: 0.27, n: 2.3 }, // deep muzzle
    { top: [0.13, -1.06], bot: [-0.25, -1.02], w: 0.23, n: 2.3 }, // blunt end
    { top: [0.06, -1.13], bot: [-0.16, -1.12], w: 0.14, n: 2.1 }, // tip
  ];
  g.add(new Mesh(loftGeometry(st, r), mat));
  const jaw: HeadStation[] = [
    { top: [-0.3, -0.3], bot: [-0.6, -0.1], w: 0.34, n: 2.0 },
    { top: [-0.34, -0.7], bot: [-0.54, -0.6], w: 0.24, n: 2.1 },
    { top: [-0.33, -0.96], bot: [-0.46, -0.92], w: 0.16, n: 2.1 },
    { top: [-0.32, -1.03], bot: [-0.4, -1.02], w: 0.08, n: 2.0 },
  ];
  g.add(new Mesh(loftGeometry(jaw, r), mat));

  // The nose pad, and the face drawn under it.
  const nose = new Mesh(ellipsoid(r * 0.34, r * 0.2, r * 0.2), trimMat);
  nose.position.set(0, r * 0.07, -r * 1.12);
  nose.rotation.x = 0.3;
  g.add(nose);
  g.add(groove([new Vector3(0, -r * 0.04, -r * 1.15), new Vector3(0, -r * 0.2, -r * 1.1)], r * 0.018, trimMat));
  for (const side of [-1, 1]) {
    g.add(groove([
      new Vector3(0, -r * 0.2, -r * 1.1),
      new Vector3(side * r * 0.12, -r * 0.29, -r * 1.02),
      new Vector3(side * r * 0.24, -r * 0.3, -r * 0.82),
      new Vector3(side * r * 0.3, -r * 0.29, -r * 0.62),
    ], r * 0.018, trimMat));
  }
  // Eyes: small and deep-set — a dark socket with the lit iris in it.
  for (const side of [-1, 1]) {
    const socket = new Mesh(ellipsoid(r * 0.2, r * 0.18, r * 0.1), trimMat);
    socket.position.set(side * r * 0.26, r * 0.28, -r * 0.58);
    socket.rotation.y = side * -0.4;
    g.add(socket);
    const iris = new Mesh(ellipsoid(r * 0.15, r * 0.13, r * 0.08), glowMat);
    iris.position.set(side * r * 0.265, r * 0.28, -r * 0.61);
    iris.rotation.y = side * -0.4;
    g.add(iris);
  }
  // Ears: round cups on the dome's top corners, a dark bowl in each.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.position.set(side * r * 0.5, r * 0.76, r * 0.12);
    ear.rotation.set(-0.1, side * -0.3, side * -0.55);
    g.add(ear);
    ear.add(new Mesh(leaf(r * 0.46, r * 0.43, r * 0.15, 0, 0), mat));
    const bowl = new Mesh(leaf(r * 0.29, r * 0.26, r * 0.05, 0, 0), trimMat);
    bowl.position.set(0, r * 0.01, -r * 0.06);
    ear.add(bowl);
  }
  // Soft cheek ruffs, swept back off the jaw hinge.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const root = new Vector3(side * r * 0.56, -r * (0.06 + i * 0.15), r * (0.05 + i * 0.05));
      const dir = new Vector3(side * 0.7, -0.1 - i * 0.12, 0.8);
      g.add(tuftAt(mat, root, dir, r * 0.26, r * 0.36, r * 0.13));
    }
  }
  return g;
}

/** PANTHER — FF2 build, a CAT first: a round skull with a short, flat
 *  face; the muzzle two whisker pads and a small chin under a triangle
 *  nose, with the W of the mouth drawn beneath; BIG almond eyes, outer
 *  corners lifted, a slit pupil down each; tall triangular ears with dark
 *  inners set wide on the crown; cheek fluff; and whisker wires. */
function buildPantherHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.12);
  g.position.y = 0.01;

  const st: HeadStation[] = [
    { top: [0.5, 0.55], bot: [-0.34, 0.55], w: 0.42, n: 2.0 }, // occiput
    { top: [0.74, 0.25], bot: [-0.48, 0.36], w: 0.56, n: 2.05 }, // crown
    { top: [0.72, -0.05], bot: [-0.52, 0.12], w: 0.61, n: 2.1 }, // temples (widest)
    { top: [0.55, -0.36], bot: [-0.52, -0.14], w: 0.58, n: 2.2 }, // cheeks
    { top: [0.3, -0.54], bot: [-0.46, -0.36], w: 0.44, n: 2.2 }, // the flat face
    { top: [0.06, -0.64], bot: [-0.4, -0.54], w: 0.26, n: 2.0 }, // short muzzle
    { top: [-0.02, -0.7], bot: [-0.34, -0.64], w: 0.14, n: 1.9 }, // tip
  ];
  g.add(new Mesh(loftGeometry(st, r), mat));
  // Whisker pads and the chin.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new SphereGeometry(r * 0.15, 32, 24), mat);
    pad.scale.set(1.05, 0.8, 0.8);
    pad.position.set(side * r * 0.11, -r * 0.2, -r * 0.66);
    g.add(pad);
  }
  const chin = new Mesh(ellipsoid(r * 0.16, r * 0.1, r * 0.13), mat);
  chin.position.set(0, -r * 0.37, -r * 0.62);
  g.add(chin);
  // The nose: a small triangle, point down.
  const noseGeo = new ConeGeometry(r * 0.08, r * 0.08, 3);
  noseGeo.rotateY(Math.PI); // a flat face forward
  noseGeo.rotateX(Math.PI); // point down
  const nose = new Mesh(noseGeo, trimMat);
  nose.scale.z = 0.6;
  nose.position.set(0, -r * 0.07, -r * 0.76);
  g.add(nose);
  // The W of the mouth.
  g.add(groove([new Vector3(0, -r * 0.1, -r * 0.78), new Vector3(0, -r * 0.21, -r * 0.8)], r * 0.012, trimMat));
  for (const side of [-1, 1]) {
    g.add(groove([
      new Vector3(0, -r * 0.21, -r * 0.8),
      new Vector3(side * r * 0.06, -r * 0.27, -r * 0.79),
      new Vector3(side * r * 0.13, -r * 0.23, -r * 0.76),
    ], r * 0.012, trimMat));
  }
  // The eyes: big almonds, outer corners lifted, a slit in each.
  for (const side of [-1, 1]) {
    const rot = new Vector3(0, side * -0.38, side * 0.24);
    const socket = new Mesh(ellipsoid(r * 0.3, r * 0.2, r * 0.1), trimMat);
    socket.position.set(side * r * 0.25, r * 0.16, -r * 0.54);
    socket.rotation.set(rot.x, rot.y, rot.z);
    g.add(socket);
    const eye = new Mesh(ellipsoid(r * 0.26, r * 0.17, r * 0.1), glowMat);
    eye.position.set(side * r * 0.255, r * 0.16, -r * 0.57);
    eye.rotation.set(rot.x, rot.y, rot.z);
    g.add(eye);
    const slit = new Mesh(ellipsoid(r * 0.04, r * 0.16, r * 0.04), trimMat);
    slit.position.set(side * r * 0.235, r * 0.16, -r * 0.615);
    slit.rotation.set(rot.x, rot.y, 0);
    g.add(slit);
  }
  // Ears: tall triangles set wide on the crown, dark inside.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.position.set(side * r * 0.34, r * 0.64, r * 0.04);
    ear.rotation.set(0.05, side * -0.22, side * -0.3);
    g.add(ear);
    const shell = new Mesh(leaf(r * 0.42, r * 0.52, r * 0.13, 1.0, r * 0.03), mat);
    shell.position.y = r * 0.2;
    ear.add(shell);
    const inner = new Mesh(leaf(r * 0.25, r * 0.36, r * 0.05, 1.0, r * 0.02), trimMat);
    inner.position.set(0, r * 0.18, -r * 0.05);
    ear.add(inner);
  }
  // Cheek fluff: the cat's jowl ruff, out and down past the jaw.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const root = new Vector3(side * r * 0.52, -r * (0.08 + i * 0.13), -r * (0.1 - i * 0.06));
      const dir = new Vector3(side * 0.85, -0.45 - i * 0.2, 0.3);
      g.add(tuftAt(mat, root, dir, r * 0.18, r * 0.3, r * 0.08));
    }
  }
  // Whisker wires fanned off the pads.
  const up = new Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const droop = 0.12 - i * 0.16;
      const dir = new Vector3(side * Math.cos(droop) * 0.92, Math.sin(droop), 0.38).normalize();
      const len = r * (0.75 - i * 0.08);
      const w = new Mesh(new CylinderGeometry(r * 0.008, r * 0.003, len, 6), trimMat);
      w.quaternion.setFromUnitVectors(up, dir);
      w.position.set(side * r * 0.18, -r * (0.16 + i * 0.05), -r * 0.7).addScaledVector(dir, len / 2);
      g.add(w);
    }
  }
  return g;
}

/** STALLION — FF1's horse skull (the one that was right), finished for
 *  FF2. FF1's long black nostril slits and the mouth slab through the
 *  muzzle read as black hair through the nose; the nostrils are round
 *  flared openings now and the mouth a lip line laid along the muzzle.
 *  And more of a HORSE: leaf ears, a brow over each eye, the cheek ridge,
 *  a tufted forelock and mane — and a BRIDLE (noseband, cheekpieces and
 *  browband, laid on the skull's own surface) in the trim. */
function buildStallionHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.05);

  const st: HeadStation[] = [
    { top: [0.88, 0.42], bot: [0.1, 0.52], w: 0.26, n: 2.0 }, // occiput
    { top: [1.02, 0.22], bot: [-0.05, 0.4], w: 0.36, n: 2.0 }, // poll
    { top: [0.98, -0.02], bot: [-0.22, 0.26], w: 0.44, n: 2.1 }, // temples
    { top: [0.74, -0.3], bot: [-0.34, 0.1], w: 0.47, n: 2.2 }, // brow (widest)
    { top: [0.52, -0.5], bot: [-0.42, -0.05], w: 0.42, n: 2.2 }, // orbits
    { top: [0.22, -0.76], bot: [-0.52, -0.32], w: 0.33, n: 2.1 }, // cheekbone
    { top: [-0.06, -0.97], bot: [-0.62, -0.62], w: 0.27, n: 2.0 }, // mid face
    { top: [-0.3, -1.15], bot: [-0.72, -0.92], w: 0.225, n: 1.9 }, // upper muzzle
    { top: [-0.45, -1.27], bot: [-0.79, -1.1], w: 0.235, n: 1.85 }, // nostril flare
    { top: [-0.58, -1.37], bot: [-0.85, -1.24], w: 0.185, n: 1.8 }, // nose
    { top: [-0.68, -1.41], bot: [-0.84, -1.33], w: 0.1, n: 1.7 }, // tip
  ];
  g.add(new Mesh(loftGeometry(st, r), mat));

  // Jowls: the round masseter discs at the back of the jaw.
  for (const side of [-1, 1]) {
    const jowl = new Mesh(new SphereGeometry(r * 0.36, 32, 24), mat);
    jowl.scale.set(0.38, 1.0, 0.92);
    jowl.position.set(side * r * 0.27, 0, r * 0.02);
    jowl.rotation.x = 0.35;
    g.add(jowl);
    // The facial crest: the ridge of bone running forward off the jowl
    // under the eye.
    const crest = new Mesh(ellipsoid(r * 0.08, r * 0.1, r * 0.5), mat);
    crest.position.set(side * r * 0.36, r * 0.12, -r * 0.46);
    crest.rotation.set(-0.55, side * -0.12, 0);
    g.add(crest);
  }

  // Eyes: high and wide, under a brow.
  for (const side of [-1, 1]) {
    const socket = new Mesh(ellipsoid(r * 0.15, r * 0.24, r * 0.2), trimMat);
    socket.position.set(side * r * 0.43, r * 0.34, -r * 0.42);
    socket.rotation.y = side * -0.45;
    g.add(socket);
    const eye = new Mesh(ellipsoid(r * 0.12, r * 0.2, r * 0.16), glowMat);
    eye.position.set(side * r * 0.46, r * 0.335, -r * 0.44);
    eye.rotation.y = side * -0.45;
    g.add(eye);
    // The brow bone shading it from above.
    const brow = new Mesh(ellipsoid(r * 0.14, r * 0.08, r * 0.3), mat);
    brow.position.set(side * r * 0.43, r * 0.52, -r * 0.42);
    brow.rotation.set(-0.35, side * -0.45, side * -0.35);
    g.add(brow);
  }

  // Ears: leaves on the poll, alert, dark inside — ROOTED: the poll falls
  // away either side of the midline, so an ear set at the crest's height
  // hung clear of the skull; each now sinks into it and grows out of a
  // soft root.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.position.set(side * r * 0.19, r * 0.9, r * 0.1);
    ear.rotation.set(0.1, side * -0.2, side * -0.12);
    g.add(ear);
    const root = new Mesh(ellipsoid(r * 0.24, r * 0.2, r * 0.2), mat);
    root.position.y = r * 0.02;
    ear.add(root);
    const shell = new Mesh(leaf(r * 0.24, r * 0.6, r * 0.14, 0.95, r * 0.05), mat);
    shell.position.y = r * 0.26;
    ear.add(shell);
    const inner = new Mesh(leaf(r * 0.13, r * 0.42, r * 0.05, 0.95, r * 0.04), trimMat);
    inner.position.set(0, r * 0.24, -r * 0.055);
    ear.add(inner);
  }

  // Nostrils: round flared openings on the front of the muzzle.
  for (const side of [-1, 1]) {
    const flare = new Mesh(ellipsoid(r * 0.13, r * 0.17, r * 0.13), mat);
    flare.position.set(side * r * 0.16, -r * 0.57, -r * 1.27);
    flare.rotation.set(0.6, side * -0.3, 0);
    g.add(flare);
    const hole = new Mesh(ellipsoid(r * 0.07, r * 0.09, r * 0.05), trimMat);
    hole.position.set(side * r * 0.15, -r * 0.6, -r * 1.33);
    hole.rotation.set(0.6, side * -0.3, 0);
    g.add(hole);
  }
  // The lips: a line along the muzzle's lower flank, and the chin.
  g.add(groove(loftSmile(st, -0.95, 7, 10, r, 1.01), r * 0.016, trimMat));
  const chin = new Mesh(ellipsoid(r * 0.24, r * 0.17, r * 0.24), mat);
  chin.position.set(0, -r * 0.86, -r * 1.12);
  g.add(chin);

  // THE BRIDLE: noseband round the upper muzzle, a cheekpiece up each
  // side of the face to the poll, and the browband under the ears.
  g.add(groove(loftRing(st, 7, -Math.PI * 0.5, Math.PI * 1.5, r, 1.04), r * 0.025, trimMat));
  for (const side of [-1, 1]) {
    const a = side === 1 ? 0.05 : Math.PI - 0.05;
    const pts: Vector3[] = [];
    for (let i = 7; i >= 2; i--) pts.push(onLoft(st[i], a, r, 1.06));
    g.add(groove(pts, r * 0.022, trimMat));
  }
  g.add(groove(loftRing(st, 2, 0.1, Math.PI - 0.1, r, 1.04), r * 0.022, trimMat));

  // Forelock and mane: tufts spilling off the poll and down the nape.
  for (const [dx, lean] of [[0, 0], [-0.1, -0.25], [0.1, 0.25]] as const) {
    const root = new Vector3(dx * r, r * 0.98, -r * 0.08);
    g.add(tuftAt(mat, root, new Vector3(lean, -0.55, -1), r * 0.16, r * 0.42, r * 0.08));
  }
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    // Lying DOWN the nape (the first cut stood straight out like a
    // crest), each falling a little to alternate sides.
    const root = new Vector3(0, r * (1.0 - t * 0.85), r * (0.2 + t * 0.3));
    const dir = new Vector3((i % 2 ? 1 : -1) * 0.3, -0.35 - t * 0.5, 0.75);
    g.add(tuftAt(mat, root, dir, r * 0.2, r * (0.5 - t * 0.08), r * 0.11));
  }
  return g;
}

/** WOLF — a timber wolf, alert rather than snarling. A broad crown and a
 *  real STOP dropping onto a long, square-ended muzzle over a separate
 *  lower jaw; tall leaf ears standing up and a touch out; almond eyes
 *  under a heavy brow; and THE RUFF — a mane of long tufts sweeping back
 *  off the cheeks and jaw and round the nape, which is the silhouette
 *  that says wolf from across the arena. */
function buildWolfHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.18);
  g.position.y = 0.02;

  const skullSt: HeadStation[] = [
    { top: [0.45, 0.6], bot: [-0.32, 0.58], w: 0.4, n: 2.0 }, // occiput
    { top: [0.72, 0.3], bot: [-0.46, 0.4], w: 0.52, n: 2.05 }, // crown
    { top: [0.66, -0.02], bot: [-0.5, 0.14], w: 0.57, n: 2.1 }, // cheeks (widest)
    { top: [0.54, -0.3], bot: [-0.46, -0.12], w: 0.5, n: 2.1 }, // brow
    { top: [0.28, -0.5], bot: [-0.4, -0.36], w: 0.33, n: 2.1 }, // THE STOP
    { top: [0.2, -0.72], bot: [-0.3, -0.6], w: 0.26, n: 2.2 }, // muzzle root
    { top: [0.15, -0.98], bot: [-0.26, -0.9], w: 0.215, n: 2.35 }, // mid muzzle
    { top: [0.1, -1.2], bot: [-0.22, -1.14], w: 0.18, n: 2.5 }, // square end
    { top: [0.04, -1.29], bot: [-0.16, -1.27], w: 0.12, n: 2.3 }, // tip
  ];
  g.add(new Mesh(loftGeometry(skullSt, r), mat));
  // The lower jaw, its own lean loft under the muzzle.
  const jawSt: HeadStation[] = [
    { top: [-0.2, -0.3], bot: [-0.48, -0.1], w: 0.3, n: 2.0 },
    { top: [-0.24, -0.66], bot: [-0.44, -0.56], w: 0.21, n: 2.1 },
    { top: [-0.24, -1.0], bot: [-0.37, -0.96], w: 0.15, n: 2.2 },
    { top: [-0.23, -1.12], bot: [-0.31, -1.11], w: 0.09, n: 2.0 },
  ];
  g.add(new Mesh(loftGeometry(jawSt, r), mat));
  // The mouth: a dark line where jaw meets muzzle, running back to the
  // corner under the cheek.
  const mouth: Vector3[] = [];
  for (const [x, y, z] of [
    [0.24, -0.2, -0.46], [0.2, -0.24, -0.72], [0.15, -0.25, -0.98], [0.08, -0.24, -1.14], [0, -0.24, -1.17],
  ] as const) mouth.push(new Vector3(x * r, y * r, z * r));
  g.add(groove([...mouth.map((p) => new Vector3(-p.x, p.y, p.z)), ...mouth.slice(0, -1).reverse()], r * 0.02, trimMat));
  // Fangs, just showing under the lip.
  for (const side of [-1, 1]) {
    const fang = new Mesh(new ConeGeometry(r * 0.03, r * 0.11, 12), mat);
    fang.rotation.x = Math.PI;
    fang.position.set(side * r * 0.1, -r * 0.29, -r * 1.06);
    g.add(fang);
  }
  // The nose: a broad pad capping the square muzzle.
  const nose = new Mesh(ellipsoid(r * 0.26, r * 0.15, r * 0.17), trimMat);
  nose.position.set(0, r * 0.04, -r * 1.29);
  nose.rotation.x = 0.2;
  g.add(nose);

  // Eyes: almond, set forward, outer corners lifted — under a brow that
  // drops toward the stop.
  for (const side of [-1, 1]) {
    const socket = new Mesh(ellipsoid(r * 0.27, r * 0.14, r * 0.12), trimMat);
    socket.position.set(side * r * 0.25, r * 0.3, -r * 0.52);
    socket.rotation.set(0, side * -0.45, side * 0.32);
    g.add(socket);
    const eye = new Mesh(ellipsoid(r * 0.21, r * 0.09, r * 0.1), glowMat);
    eye.position.set(side * r * 0.26, r * 0.3, -r * 0.55);
    eye.rotation.set(0, side * -0.45, side * 0.32);
    g.add(eye);
    const brow = new Mesh(ellipsoid(r * 0.34, r * 0.1, r * 0.16), mat);
    brow.position.set(side * r * 0.23, r * 0.43, -r * 0.47);
    brow.rotation.set(0.2, side * -0.3, side * 0.36);
    g.add(brow);
  }

  // Ears: tall leaves, standing, tipped a little out and back, each with a
  // dark inner leaf set into its front face.
  for (const side of [-1, 1]) {
    const ear = new Group();
    ear.position.set(side * r * 0.3, r * 0.6, r * 0.12);
    ear.rotation.set(0.12, side * -0.25, side * -0.22);
    g.add(ear);
    const shell = new Mesh(leaf(r * 0.36, r * 0.66, r * 0.16, 0.9, r * 0.05), mat);
    shell.position.y = r * 0.28;
    ear.add(shell);
    const inner = new Mesh(leaf(r * 0.2, r * 0.46, r * 0.06, 0.9, r * 0.04), trimMat);
    inner.position.set(0, r * 0.26, -r * 0.06);
    ear.add(inner);
  }

  // THE RUFF. Cheek tufts fanning back and down off the jaw line, a
  // longer rank behind them, and a collar of tufts round the nape.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const root = new Vector3(side * r * (0.5 - t * 0.08), r * (0.12 - t * 0.5), r * (-0.06 + t * 0.06));
      const dir = new Vector3(side * (0.75 - t * 0.2), -0.25 - t * 0.55, 0.62);
      g.add(tuftAt(mat, root, dir, r * 0.2, r * (0.5 + Math.sin(t * Math.PI) * 0.12), r * 0.09));
    }
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const root = new Vector3(side * r * (0.44 - t * 0.1), r * (0.32 - t * 0.6), r * (0.2 + t * 0.06));
      const dir = new Vector3(side * 0.55, -0.1 - t * 0.5, 0.9);
      g.add(tuftAt(mat, root, dir, r * 0.22, r * 0.5, r * 0.1));
    }
  }
  for (let i = 0; i < 5; i++) {
    const a = ((-50 + i * 25) * Math.PI) / 180;
    const root = new Vector3(Math.sin(a) * r * 0.3, -r * 0.2, r * (0.4 + Math.cos(a) * 0.08));
    const dir = new Vector3(Math.sin(a) * 0.5, -0.55, 0.75);
    g.add(tuftAt(mat, root, dir, r * 0.24, r * 0.5, r * 0.1));
  }
  return g;
}

/** FROG — a tree frog, round and pleased with itself. One wide, flat,
 *  smooth skull; two eye TURRETS sunk into the crown, each lens under a
 *  heavy half-closed LID (the look that makes it a character, not a toy);
 *  a SMILE cut round the snout along the skull's own surface, corner to
 *  corner; soft eardrum discs in the body's own colour; two pin nostrils. */
function buildFrogHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.2);

  const st: HeadStation[] = [
    { top: [0.3, 0.62], bot: [-0.34, 0.6], w: 0.6, n: 2.2 }, // back
    { top: [0.44, 0.3], bot: [-0.5, 0.36], w: 0.8, n: 2.3 }, // crown
    { top: [0.42, -0.05], bot: [-0.56, 0.04], w: 0.86, n: 2.4 }, // cheeks (widest)
    { top: [0.32, -0.4], bot: [-0.54, -0.3], w: 0.78, n: 2.35 }, // eye line
    { top: [0.16, -0.7], bot: [-0.46, -0.62], w: 0.6, n: 2.25 }, // snout
    { top: [0.02, -0.9], bot: [-0.36, -0.86], w: 0.4, n: 2.1 }, // lip
    { top: [-0.06, -0.98], bot: [-0.26, -0.97], w: 0.2, n: 2.0 }, // tip
  ];
  const skull = new Mesh(loftGeometry(st, r), mat);
  g.add(skull);

  // THE SMILE: ONE line, corner to corner. It is swept, not stitched: a
  // fan of rays from inside the head at mouth height, round from under
  // one eardrum, across the front of the snout, to the other, each landing
  // on the skin (drape). One ray per point, in order, so the line can never
  // double back over itself — the pieced-together first cuts overlapped
  // where they met. The corners lift a touch: it is a grin.
  const axisZ = -r * 0.1;
  const sweep = 1.75; // radians either side of dead ahead
  const aim: Vector3[] = [];
  for (let k = 0; k <= 64; k++) {
    const th = -sweep + (2 * sweep * k) / 64;
    const y = -r * 0.2 + r * 0.08 * (th / sweep) ** 2;
    aim.push(new Vector3(Math.sin(th) * r * 3, y, axisZ - Math.cos(th) * r * 3));
  }
  const line = drape(skull, aim, axisZ, r * 0.014);
  // Two passes of smoothing take out the facets of the loft underneath.
  for (let pass = 0; pass < 2; pass++) {
    const prev = line.map((p) => p.clone());
    for (let k = 1; k < line.length - 1; k++) line[k].copy(prev[k - 1]).add(prev[k + 1]).multiplyScalar(0.25).addScaledVector(prev[k], 0.5);
  }
  g.add(groove(line, r * 0.024, trimMat));

  // The turrets: domes sunk into the crown, a big lit lens in each — no
  // pupil, the glass is the eye — and a heavy lid over the top.
  for (const side of [-1, 1]) {
    const c = new Vector3(side * r * 0.44, r * 0.42, -r * 0.3);
    const dome = new Mesh(new SphereGeometry(r * 0.3, 32, 24), mat);
    dome.position.copy(c);
    g.add(dome);
    const look = new Vector3(side * 0.35, 0.15, -1).normalize();
    const lens = new Mesh(new SphereGeometry(r * 0.24, 32, 24), glowMat);
    lens.position.copy(c).addScaledVector(look, r * 0.1);
    g.add(lens);
    // The LID: a cap of the dome drawn down over the top of the lens.
    const lid = new Mesh(new SphereGeometry(r * 0.262, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.4), mat);
    lid.position.copy(lens.position);
    lid.rotation.set(0.12, 0, side * -0.12); // half down over the glass
    g.add(lid);
  }

  // Eardrums: soft discs in the shell's own colour, behind the eyes —
  // FF1 made them dark, and the frog had four eyes.
  for (const side of [-1, 1]) {
    const drum = new Mesh(ellipsoid(r * 0.08, r * 0.3, r * 0.3), mat);
    drum.position.set(side * r * 0.82, r * 0.05, r * 0.06);
    drum.rotation.y = side * 0.15;
    g.add(drum);
  }
  // Nostrils, high on the snout.
  for (const side of [-1, 1]) {
    const nostril = new Mesh(new SphereGeometry(r * 0.035, 16, 12), trimMat);
    nostril.position.set(side * r * 0.12, r * 0.07, -r * 0.88);
    g.add(nostril);
  }
  return g;
}

/** BUNNY — a rabbit, not a ball. An egg of a head widest at the cheeks,
 *  whisker pads either side of a small dark nose, the Y of the mouth,
 *  two buck teeth; big bright eyes; and THE EARS — long leaves standing
 *  off the crown with dark inner leaves, one straight and one flopped
 *  over at the tip, which is all the personality a rabbit needs. */
function buildBunnyHead(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group {
  const r = BODY_IK.headRadius;
  const g = new Group();
  g.scale.setScalar(1.12);
  g.position.y = 0.01;

  const st: HeadStation[] = [
    { top: [0.46, 0.62], bot: [-0.42, 0.55], w: 0.44, n: 2.0 }, // back
    { top: [0.76, 0.28], bot: [-0.6, 0.36], w: 0.58, n: 2.05 }, // crown
    { top: [0.7, -0.12], bot: [-0.7, 0.04], w: 0.64, n: 2.1 }, // cheeks (widest)
    { top: [0.46, -0.48], bot: [-0.66, -0.3], w: 0.58, n: 2.05 }, // lower face
    { top: [0.14, -0.72], bot: [-0.54, -0.58], w: 0.4, n: 2.0 }, // muzzle
    { top: [-0.02, -0.82], bot: [-0.42, -0.76], w: 0.22, n: 1.9 }, // nose end
  ];
  g.add(new Mesh(loftGeometry(st, r), mat));

  // Whisker pads — the two soft mounds the mouth hangs between.
  for (const side of [-1, 1]) {
    const pad = new Mesh(new SphereGeometry(r * 0.17, 32, 24), mat);
    pad.scale.set(1.0, 0.82, 0.8);
    pad.position.set(side * r * 0.12, -r * 0.28, -r * 0.76);
    g.add(pad);
  }
  // The nose: a small dark heart-ish pad above the pads.
  const nose = new Mesh(ellipsoid(r * 0.16, r * 0.1, r * 0.1), trimMat);
  nose.position.set(0, -r * 0.13, -r * 0.86);
  g.add(nose);
  // The Y: down from the nose, then out and up either side.
  g.add(groove([new Vector3(0, -r * 0.17, -r * 0.9), new Vector3(0, -r * 0.33, -r * 0.92)], r * 0.014, trimMat));
  for (const side of [-1, 1]) {
    g.add(groove([
      new Vector3(0, -r * 0.33, -r * 0.92),
      new Vector3(side * r * 0.08, -r * 0.39, -r * 0.9),
      new Vector3(side * r * 0.17, -r * 0.36, -r * 0.84),
    ], r * 0.014, trimMat));
  }
  // Buck teeth under the Y.
  for (const side of [-1, 1]) {
    const tooth = new Mesh(new BoxGeometry(r * 0.075, r * 0.13, r * 0.035), mat);
    tooth.position.set(side * r * 0.042, -r * 0.43, -r * 0.88);
    tooth.rotation.x = 0.12;
    g.add(tooth);
  }
  // Eyes: big and bright, set to the sides of the face, a dark pupil in
  // each looking forward.
  for (const side of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(r * 0.205, 32, 24), trimMat);
    socket.scale.set(0.85, 1.12, 0.5);
    socket.position.set(side * r * 0.27, r * 0.17, -r * 0.56);
    socket.rotation.y = side * -0.42;
    g.add(socket);
    const eye = new Mesh(new SphereGeometry(r * 0.178, 32, 24), glowMat);
    eye.scale.set(0.85, 1.12, 0.5);
    eye.position.set(side * r * 0.275, r * 0.17, -r * 0.59);
    eye.rotation.y = side * -0.42;
    g.add(eye);
    const pupil = new Mesh(new SphereGeometry(r * 0.085, 24, 16), trimMat);
    pupil.scale.set(0.85, 1.15, 0.45);
    pupil.position.set(side * r * 0.235, r * 0.15, -r * 0.665);
    pupil.rotation.y = side * -0.42;
    g.add(pupil);
  }
  // THE EARS: long leaves off the crown, tipped out; the left stands, the
  // right FOLDS forward over the brow at the tip (a fold back is invisible
  // from the front, which is where anyone looks at you from).
  for (const side of [-1, 1]) {
    const flop = side === 1;
    const ear = new Group();
    ear.position.set(side * r * 0.22, r * 0.62, r * 0.14);
    ear.rotation.set(0.14, side * -0.2, side * -0.16);
    g.add(ear);
    const shellGeo = leaf(r * 0.34, r * 1.2, r * 0.13, 0.55, r * 0.12);
    shellGeo.translate(0, r * 0.55, 0);
    const innerGeo = leaf(r * 0.19, r * 0.94, r * 0.05, 0.55, r * 0.09);
    innerGeo.translate(0, r * 0.58, -r * 0.055);
    if (flop) {
      // Hinged a little over halfway up, the tip hanging down in front.
      fold(shellGeo, r * 0.5, r * 0.12, 2.25);
      fold(innerGeo, r * 0.5, r * 0.12, 2.25);
    }
    ear.add(new Mesh(shellGeo, mat), new Mesh(innerGeo, trimMat));
  }
  return g;
}

/**
 * Tag what each mesh is made of, off the three materials a builder was
 * handed: TRIM and GLOW are skipped by the paint bake (and glow is lit in
 * the accent); the primer shell is what gets painted.
 */
function tagFinishes(g: Object3D, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): void {
  g.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (m.material === trimMat || m.material === glowMat) m.userData.trim = true;
    if (m.material === glowMat) m.userData.glow = true;
  });
}

const RAW: Record<string, HeadBuilder> = {
  bear: buildBearHead,
  panther: buildPantherHead,
  eagle: buildEagleHead,
  knight: buildKnightHead,
  stallion: buildStallionHead,
  wolf: buildWolfHead,
  frog: buildFrogHead,
  bunny: buildBunnyHead,
};

/**
 * How big each head is carried on THE BLANK, against how FF1 carried it.
 * FF1's heads were sized for its shoulder-heavy robot chassis — a bear's
 * head half again the hitbox — and on the slender mannequin they came out
 * as big as the shoulders. Four-fifths puts them back in proportion; the
 * knight's helm was already only just over the skull, so it barely moves.
 */
const HEAD_SIZE: Record<string, number> = {
  // Four-fifths was a step too far for the round heads: a bear no wider
  // than the bare skull reads as a small head, not an animal's. They are
  // carried about a tenth bigger again; the eagle (narrow, all beak) and
  // the bunny (its size is its ears) a little more than the rest.
  bear: 1.1,
  panther: 1.12,
  eagle: 0.92,
  knight: 0.95,
  stallion: 1.05,
  // (the FF2 builds were made at their final size — and came out small)
  wolf: 1.06,
  frog: 1.08,
  bunny: 1.1,
};

/**
 * THE SEAT: how far (metres) each head is dropped so its underside sits
 * over the neck the way the bare skull does — a centimetre and a bit of
 * air, no more. The heads were each placed on the head's centre, and the
 * space under a jaw, a beak or a ruff differs head to head, so on the
 * blank they hovered 4–8 cm clear of the collar and read as floating.
 * Measured over the neck's own column (the loft's top ring, just behind
 * the head centre) at the sizes above; re-measure if a size changes.
 */
const SEAT: Record<string, number> = {
  bear: 0.037,
  panther: 0.047,
  eagle: 0.058,
  knight: 0.022,
  stallion: 0.062,
  wolf: 0.06,
  frog: 0.027,
  bunny: 0.02,
};

/** Every head, by its gear id (avatar/gear.ts). */
export const HEAD_PIECES: Record<string, HeadBuilder> = Object.fromEntries(
  Object.entries(RAW).map(([id, build]) => [
    id,
    (mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial): Group => {
      const g = build(mat, trimMat, glowMat);
      g.scale.multiplyScalar(HEAD_SIZE[id] ?? 1);
      g.position.y -= SEAT[id] ?? 0;
      tagFinishes(g, trimMat, glowMat);
      return g;
    },
  ]),
);

/**
 * THE FIT of the head GEAR (horns, crests, crowns…) to each head's own
 * skull. Every head piece was modelled on the bare skull; worn over an
 * animal it has to land on THAT animal's cranium — the dome behind the
 * face, not the snout, the ears or the fur. Each head's cranium is
 * measured by casting from inside it (the snout's cone, the ears and the
 * tufts left out): its crown height, its width at the temples, and its
 * depth from the brow to the back of the skull. The fit scales the bare
 * skull onto it per axis (`s`: width, height, depth) and moves it (`y`,
 * `z`, metres) so the tops meet — crowns and halos ride the crown, crests
 * run brow to nape, horns root at the temples. Measured at the HEAD_SIZE
 * and SEAT above; re-measure if either changes.
 */
export const HEAD_FIT: Record<string, { s: [number, number, number]; y: number; z: number }> = {
  bear: { s: [0.928, 0.86, 0.792], y: -0.0016, z: 0.0055 },
  panther: { s: [0.815, 0.743, 0.671], y: -0.0174, z: 0.0052 },
  eagle: { s: [0.636, 0.671, 0.706], y: 0.0177, z: -0.0281 },
  // The helm is a flat-topped barrel, not a dome: raised, so a crown sits
  // ON it instead of sinking into the barrel's side.
  knight: { s: [1.046, 1.085, 1.125], y: -0.0085, z: -0.0134 },
  // A horse's cranium is small against its long face: carried 1.3× the
  // measure (top still pinned), or a crown was a ring between the ears.
  stallion: { s: [0.711, 0.699, 0.688], y: -0.0112, z: 0.0022 },
  wolf: { s: [0.758, 0.713, 0.669], y: -0.021, z: 0.0131 },
  // Wide and FLAT: height eased to 0.75 (top pinned) — squashed to the
  // measure, a crest or a mohawk came out a stub. The pieces that live at
  // the brow are placed one by one (PIECE_FIT).
  frog: { s: [1.1, 0.75, 0.85], y: -0.0549, z: 0.0046 },
  bunny: { s: [0.841, 0.81, 0.779], y: 0.0018, z: 0.0002 },
};

/**
 * Where one head needs one piece placed by hand, over its HEAD_FIT: a
 * whole fit (`s`, `y`, `z`, as above) and a tilt about x (`rx`, radians,
 * negative tips the front down). Ram's horns meant for a skull are too
 * much on a frog's flat head or a horse's small cranium.
 */
export const PIECE_FIT: Record<string, Record<string, Partial<{ s: [number, number, number]; y: number; z: number; rx: number }>>> = {
  // (The frog's VISOR and CROWN, and the horse's VISOR, are not fitted at
  // all: those heads wear their own cut of the piece — goggles, a Frog
  // Prince's crown, blinkers — VARIANTS in avatar/gear.ts.)
  frog: {
    horns: { s: [0.74, 0.58, 0.62], y: -0.038, z: 0.012 },
  },
  stallion: {
    horns: { s: [0.57, 0.56, 0.55], y: 0.004 },
  },
};
