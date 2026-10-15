/**
 * IRON BALLS CLUB — the pub itself.
 *
 * A low-ceilinged steel boozer in the FIRE FIGHT language: diamond-plate
 * floor, riveted gunmetal walls, hazard-amber trim, I-beams you can almost
 * graze your head on. Around the room: the bar with taps and a shelf of
 * bottles, three booths, stools, the dartboard corner (board, cork surround,
 * oche line, rack, leaderboard) and the IRON SNAKE arcade cabinet.
 *
 * Pure VR scene (not passthrough): we paint every surface ourselves.
 */

import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
} from 'three';
import type { World } from '@iwsdk/core';
import { makePlatform } from '../arena/arena.js';
import { collapseStatic } from '../arena/merge.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, teamColor } from '../config.js';
import { diamondPlateTextures } from '../materials/diamondPlate.js';
import { BOOTH_CENTRES, FIGHT, JUKEBOX, PUB } from './config.js';
import { Panel } from './panel.js';
import { buildGraffiti, buildPoster, buildSign, ironSharpensFallback, IRON_SHARPENS_SIGN } from './signs.js';
import type { PubRefs } from './state.js';
import { corkTexture, dartboardTexture, fabricTexture, steelWallTexture, woodTexture } from './textures.js';

const gunmetal = (rough = 0.35): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: PALETTE.gunmetal, metalness: 0.85, roughness: rough });
const darkSteel = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: PALETTE.gunmetalDark, metalness: 0.8, roughness: 0.5 });
const amberGlow = (intensity = 1.2): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.4,
  });

/** A box with softened edges — for upholstered/wood furniture corners. */
function roundedBox(w: number, h: number, d: number, r = 0.04): RoundedBoxGeometry {
  const rr = Math.min(r, Math.min(w, h, d) * 0.49);
  return new RoundedBoxGeometry(w, h, d, 4, rr);
}

/**
 * A round upholstered puck (stool cushion) with filleted top and bottom
 * rims — a lathe of a rounded-corner profile, origin at the puck centre.
 */
function roundedPuck(radius: number, height: number, fillet = 0.025): LatheGeometry {
  const r = Math.min(fillet, radius * 0.49, height * 0.49);
  const hh = height / 2;
  const pts: Vector2[] = [new Vector2(0, -hh)];
  // Bottom rim fillet: from the flat underside out to the side wall.
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, -hh + r + Math.sin(a) * r));
  }
  // Top rim fillet: up the side wall, then in across the top.
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, hh - r + Math.sin(a) * r));
  }
  pts.push(new Vector2(0, hh));
  return new LatheGeometry(pts, 24);
}

export function buildPub(world: World): PubRefs {
  const root = new Group();
  root.name = 'iron-balls-pub';
  const rootEntity = world.createTransformEntity(root, { persistent: true });

  const W = PUB.halfWidth;
  const D = PUB.halfDepth;
  const H = PUB.ceiling;

  // Warm dim base light: amber from the lamps below, cold steel from above.
  world.scene.background = new Color(0x0c0d11);

  // --- shell: floor, ceiling, walls -----------------------------------------
  const plate = diamondPlateTextures();
  plate.map.repeat.set(9, 6);
  plate.bumpMap.repeat.set(9, 6);
  const floor = new Mesh(
    new PlaneGeometry(W * 2, D * 2),
    new MeshStandardMaterial({
      map: plate.map,
      bumpMap: plate.bumpMap,
      bumpScale: 0.6,
      metalness: 0.75,
      roughness: 0.45,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceiling = new Mesh(
    new PlaneGeometry(W * 2, D * 2),
    new MeshStandardMaterial({ color: 0x1b1d23, metalness: 0.6, roughness: 0.8 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  root.add(ceiling);

  const wallTex = steelWallTexture([4, 1.4]);
  const wallMat = new MeshStandardMaterial({
    map: wallTex,
    metalness: 0.7,
    roughness: 0.55,
  });
  const walls: Mesh[] = [];
  const mkWall = (w: number, x: number, z: number, ry: number): Mesh => {
    const wall = new Mesh(new PlaneGeometry(w, H), wallMat);
    wall.position.set(x, H / 2, z);
    wall.rotation.y = ry;
    root.add(wall);
    walls.push(wall);
    return wall;
  };
  const northWall = mkWall(W * 2, 0, -D, 0); // bar + dartboard wall
  mkWall(W * 2, 0, D, Math.PI); // south (banquette)
  mkWall(D * 2, W, 0, -Math.PI / 2); // east

  // West wall has the doorway through to the fight hall: a wall segment
  // either side of the opening plus a lintel above it.
  const door = FIGHT.door;
  {
    const south = new Mesh(new PlaneGeometry(D - door.z1, H), wallMat);
    south.position.set(-W, H / 2, (door.z1 + D) / 2);
    south.rotation.y = Math.PI / 2;
    root.add(south);
    const north = new Mesh(new PlaneGeometry(door.z0 + D, H), wallMat);
    north.position.set(-W, H / 2, (door.z0 - D) / 2);
    north.rotation.y = Math.PI / 2;
    root.add(north);
    const lintel = new Mesh(new PlaneGeometry(door.z1 - door.z0, H - door.height), wallMat);
    lintel.position.set(-W, (H + door.height) / 2, (door.z0 + door.z1) / 2);
    lintel.rotation.y = Math.PI / 2;
    root.add(lintel);
    // Hazard-striped door frame.
    for (const z of [door.z0, door.z1]) {
      const jamb = new Mesh(new BoxGeometry(0.12, door.height, 0.07), amberGlow(0.3));
      jamb.position.set(-W, door.height / 2, z);
      root.add(jamb);
    }
    const head = new Mesh(new BoxGeometry(0.12, 0.07, door.z1 - door.z0 + 0.07), amberGlow(0.3));
    head.position.set(-W, door.height, (door.z0 + door.z1) / 2);
    root.add(head);
  }

  // Hazard-amber skirting line around the floor edge.
  const skirtMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.25,
    metalness: 0.4,
    roughness: 0.5,
  });
  for (const [w, x, z, ry] of [
    [W * 2, 0, -D + 0.01, 0],
    [W * 2, 0, D - 0.01, Math.PI],
    [D * 2, W - 0.01, 0, -Math.PI / 2],
    // West skirting stops at the doorway.
    [D - door.z1, -W + 0.01, (door.z1 + D) / 2, Math.PI / 2],
    [door.z0 + D, -W + 0.01, (door.z0 - D) / 2, Math.PI / 2],
  ] as const) {
    const skirt = new Mesh(new PlaneGeometry(w, 0.05), skirtMat);
    skirt.position.set(x, 0.09, z);
    skirt.rotation.y = ry;
    root.add(skirt);
  }

  // I-beams under the low ceiling — the head-grazing pub feel.
  const beamMat = darkSteel();
  for (const z of [-1.8, -0.3, 1.2, 2.7]) {
    const beam = new Mesh(new BoxGeometry(W * 2, PUB.beamDrop, 0.14), beamMat);
    beam.position.set(0, H - PUB.beamDrop / 2, z);
    root.add(beam);
    for (const flange of [-1, 1]) {
      const lip = new Mesh(new BoxGeometry(W * 2, 0.025, 0.22), beamMat);
      lip.position.set(0, H - PUB.beamDrop / 2 + flange * (PUB.beamDrop / 2), z);
      root.add(lip);
    }
  }

  // Caged lamps hanging off the beams: warm pools of light. Every lamp keeps
  // its glowing bulb, but only FOUR carry a real PointLight — every light in
  // the scene taxes every shaded fragment on Quest, whatever you're looking
  // at, so the fixtures outnumber the lights and nobody can tell from below.
  for (const [x, z, lit] of [
    [-2.4, -1.8, 1],
    [2.4, -1.8, 0],
    [-2.4, 1.2, 0],
    [2.4, 1.2, 1],
    [0, -0.3, 0],
    [0, 2.7, 1], // over the booths, holds the door end
    [4.2, 0.6, 1], // over the darts corridor
  ] as const) {
    const lamp = new Group();
    lamp.position.set(x, H - PUB.beamDrop, z);
    const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 0.16, 6), beamMat);
    stem.position.y = -0.08;
    lamp.add(stem);
    const bulb = new Mesh(
      new CylinderGeometry(0.045, 0.06, 0.09, 8),
      new MeshStandardMaterial({
        color: 0xffd9a0,
        emissive: 0xffb24d,
        emissiveIntensity: 2.2,
      }),
    );
    bulb.position.y = -0.2;
    lamp.add(bulb);
    const cage = new Mesh(
      new TorusGeometry(0.07, 0.006, 6, 10),
      darkSteel(),
    );
    cage.position.y = -0.2;
    cage.rotation.x = Math.PI / 2;
    lamp.add(cage);
    if (lit) {
      const light = new PointLight(0xffb46a, 8, 8.5, 1.6); // brighter + further: 4 lights cover what 7 did
      light.position.y = -0.24;
      lamp.add(light);
    }
    root.add(lamp);
  }

  // --- the bar ----------------------------------------------------------------
  const bar = PUB.bar;
  const counter = new Group();
  // Diamond-plate front panel — the theming statement piece.
  const frontPlate = diamondPlateTextures();
  frontPlate.map.repeat.set(8, 1.4);
  frontPlate.bumpMap.repeat.set(8, 1.4);
  const front = new Mesh(
    new BoxGeometry(bar.halfLength * 2, bar.top - 0.05, 0.04),
    new MeshStandardMaterial({
      map: frontPlate.map,
      bumpMap: frontPlate.bumpMap,
      bumpScale: 0.5,
      metalness: 0.8,
      roughness: 0.4,
    }),
  );
  front.position.set(0, (bar.top - 0.05) / 2, bar.z);
  counter.add(front);
  // Counter top: brushed steel slab with an amber-striped nose edge.
  const top = new Mesh(new BoxGeometry(bar.halfLength * 2 + 0.1, 0.05, bar.depth + 0.12), gunmetal(0.25));
  top.position.set(0, bar.top - 0.025, bar.z - bar.depth / 2 + 0.02);
  counter.add(top);
  // Narrower than the top slab (which is +0.1) so the strip's ends tuck INSIDE
  // the slab instead of sharing its end planes — coplanar end faces were
  // z-fighting (the flicker at the ends).
  const nose = new Mesh(new BoxGeometry(bar.halfLength * 2 - 0.04, 0.052, 0.03), amberGlow(0.4));
  nose.position.set(0, bar.top - 0.025, bar.z + 0.06);
  counter.add(nose);
  // Foot rail.
  const rail = new Mesh(new CylinderGeometry(0.022, 0.022, bar.halfLength * 2, 8), gunmetal(0.2));
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, 0.18, bar.z + 0.12);
  counter.add(rail);
  root.add(counter);

  // Beer taps along the counter.
  for (const x of PUB.tapXs) {
    const tap = new Group();
    tap.position.set(x, bar.top, bar.z - 0.18);
    const body = new Mesh(new CylinderGeometry(0.025, 0.035, 0.26, 8), gunmetal(0.2));
    body.position.y = 0.13;
    tap.add(body);
    const neck = new Mesh(new CylinderGeometry(0.014, 0.014, 0.1, 6), gunmetal(0.2));
    neck.rotation.x = Math.PI / 2.6;
    neck.position.set(0, 0.27, 0.045);
    tap.add(neck);
    const handle = new Mesh(new BoxGeometry(0.035, 0.1, 0.025), amberGlow(0.5));
    handle.position.set(0, 0.33, 0.02);
    handle.rotation.x = -0.25;
    tap.add(handle);
    root.add(tap);
  }

  // Back bar: shelf of glowing bottles + the pub sign.
  const shelf = new Mesh(new BoxGeometry(bar.halfLength * 2, 0.03, 0.22), darkSteel());
  shelf.position.set(0, 1.45, -D + 0.14);
  root.add(shelf);
  const bottleColors = [0xc97a1e, 0x7a3a10, 0x4fb7ff, 0x7dff5a, 0xe8352a, 0xc97a1e, 0xf2e9d4, 0x9f7bff];
  /** A lathe-turned spirit bottle: a slight foot, straight body, a curved
   *  shoulder easing into a slim neck, and a rolled lip at the mouth —
   *  instead of the plain glowing cylinders the shelf used to carry.
   *  `h` is total height, `r` the body radius; the base sits at y = 0. */
  const bottleProfile = (h: number, r: number, squat: boolean): Vector2[] => {
    // Squat bottles carry their width higher (a rum jug); tall ones taper
    // sooner (a long-necked spirit) — two silhouettes read as a real shelf.
    const bodyTop = h * (squat ? 0.62 : 0.5);
    const neckR = r * 0.32;
    return [
      new Vector2(0, 0),
      new Vector2(r * 0.9, 0), // base edge — the slight undercut reads as a foot
      new Vector2(r, h * 0.05), // out to full body width
      new Vector2(r, bodyTop), // straight body wall (the label section)
      new Vector2(r * 0.68, h * 0.74), // the shoulder easing in
      new Vector2(neckR, h * 0.84), // into the neck
      new Vector2(neckR, h * 0.93), // straight neck
      new Vector2(neckR * 1.5, h * 0.945), // the rolled lip, out...
      new Vector2(neckR * 1.5, h), // ...and up to the mouth
      new Vector2(0, h), // closed top
    ];
  };
  for (let i = 0; i < 14; i++) {
    const c = bottleColors[i % bottleColors.length];
    const h = 0.2 + (i % 3) * 0.03;
    const bottle = new Mesh(
      new LatheGeometry(bottleProfile(h, 0.034, i % 2 === 0), 12),
      new MeshStandardMaterial({
        color: c,
        emissive: c,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.85,
        roughness: 0.2,
      }),
    );
    bottle.position.set(-2.3 + i * 0.36, 1.465, -D + 0.14);
    root.add(bottle);
  }

  // The hand-made IRON BALLS CLUB nixie-tube sign on the back-bar wall (the webp
  // if present, procedural neon fallback otherwise — see signs.ts). buildSign
  // letterbox-fits the art to its true aspect, so the box size just caps it.
  const sign = buildSign('signs/nixiepng.png', 1.5, 1.0);
  sign.position.set(0, 1.9, -D + 0.03);
  root.add(sign);

  // The neon "IRON SHARPENS IRON" motto — on the SOUTH wall, above and behind
  // the booth seating (centred over the tables), hung low over the diners.
  const creed = buildSign(IRON_SHARPENS_SIGN, 1.7, 1.7, ironSharpensFallback);
  creed.position.set(1.75, 1.85, D - 0.04);
  creed.rotation.y = Math.PI; // faces −z, back across the room
  root.add(creed);

  // Flat-screen TV hung over the bar (off to the bar's west end so it clears the
  // central pub sign), facing into the room. TvSystem paints the live Discord
  // chat on its screen. Hung from the ceiling on a short bracket.
  const pubTv = buildPubTv(root, -1.7, 1.78, bar.z - 0.3);

  // Stools at the bar.
  for (const x of [-1.6, -0.8, 0.8, 1.6]) {
    const stool = new Group();
    stool.position.set(x, 0, bar.z + 0.45);
    const leg = new Mesh(new CylinderGeometry(0.03, 0.05, 0.62, 8), gunmetal(0.3));
    leg.position.y = 0.31;
    stool.add(leg);
    const seat = new Mesh(
      roundedPuck(0.17, 0.07, 0.03),
      new MeshStandardMaterial({ color: 0x5a2a20, roughness: 0.85 }),
    );
    seat.position.y = 0.65;
    stool.add(seat);
    const ring = new Mesh(new TorusGeometry(0.12, 0.012, 6, 12), darkSteel());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22;
    stool.add(ring);
    root.add(stool);
  }

  // --- banquette seating along the south wall ---------------------------------
  // A continuous raised plinth with a channel-backed bench, divided into
  // booths, each with a square table and a freestanding bench opposite —
  // the upmarket-bar look from the reference. The door-end booth is gone: the
  // jukebox stands there instead (built below).
  root.add(buildBanquette(BOOTH_CENTRES));

  // --- the JUKEBOX where the door-end booth used to be ------------------------
  const { group: jukebox, panel: jukeboxPanel } = buildJukebox();
  root.add(jukebox);

  // --- the EXIT — the door you came in through (south wall, west end).
  // Teleport onto its hazard mat and you're back at the main menu.
  {
    const ex = PUB.exit;
    const cx = (ex.x0 + ex.x1) / 2;
    // Dark doorway inset.
    const void_ = new Mesh(
      new PlaneGeometry(ex.x1 - ex.x0, ex.height),
      new MeshBasicMaterial({ color: 0x05060a }),
    );
    void_.position.set(cx, ex.height / 2, D - 0.015);
    void_.rotation.y = Math.PI;
    root.add(void_);
    for (const x of [ex.x0, ex.x1]) {
      const jamb = new Mesh(new BoxGeometry(0.12, ex.height, 0.07), amberGlow(0.3));
      jamb.position.set(x, ex.height / 2, D - 0.04);
      root.add(jamb);
    }
    const head = new Mesh(new BoxGeometry(ex.x1 - ex.x0 + 0.12, 0.07, 0.07), amberGlow(0.3));
    head.position.set(cx, ex.height, D - 0.04);
    root.add(head);
    const exitSign = new Panel(0.7, 0.16, 384);
    // Centre the label on the plate (setLines baselined it low / clipped).
    exitSign.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = "900 34px 'Arial Black', system-ui, sans-serif";
      ctx.fillStyle = '#ffb000';
      ctx.fillText('EXIT → ARENA', w / 2, h / 2);
    });
    exitSign.mesh.position.set(cx, ex.height + 0.18, D - 0.05);
    exitSign.mesh.rotation.y = Math.PI;
    root.add(exitSign.mesh);
    // The hazard mat — land a teleport here to leave.
    const mat = new Mesh(
      new PlaneGeometry(ex.x1 - ex.x0, 0.45),
      new MeshStandardMaterial({
        color: PALETTE.amber,
        emissive: PALETTE.amber,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.5,
      }),
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(cx, 0.012, D - 0.3);
    root.add(mat);
  }

  // --- darts: on the NORTH wall, east end, beside the bar ---------------------
  const darts = PUB.darts;
  // Cork blast circle, set just BEHIND the board (toward the wall).
  const corkSurround = new Mesh(
    new CircleGeometry(darts.surroundRadius, 24),
    new MeshStandardMaterial({ map: corkTexture(), roughness: 0.95 }),
  );
  corkSurround.name = 'cork-surround';
  corkSurround.position.set(darts.boardX, darts.boardY, darts.boardZ - 0.02);
  root.add(corkSurround);
  // Steel cabinet ring around the cork.
  const cabinetRing = new Mesh(new TorusGeometry(darts.surroundRadius, 0.025, 8, 28), gunmetal(0.3));
  cabinetRing.position.copy(corkSurround.position);
  root.add(cabinetRing);
  // The board itself, facing out into the room (+z).
  const dartboard = new Mesh(
    new CircleGeometry(darts.boardRadius, 40),
    new MeshStandardMaterial({ map: dartboardTexture(), roughness: 0.9, side: DoubleSide }),
  );
  dartboard.name = 'dartboard';
  dartboard.position.set(darts.boardX, darts.boardY, darts.boardZ);
  root.add(dartboard);
  // Spot lamp out in front of the board.
  const boardLight = new PointLight(0xfff0d8, 4, 3.5, 1.5);
  boardLight.position.set(darts.boardX, darts.boardY + 0.7, darts.boardZ + 0.6);
  root.add(boardLight);

  // Oche (throw line): hazard tape across the lane, out in the room.
  const oche = new Mesh(
    new PlaneGeometry(1.2, 0.08),
    new MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amber, emissiveIntensity: 0.35 }),
  );
  oche.rotation.x = -Math.PI / 2;
  oche.position.set(darts.boardX, 0.012, darts.ocheZ);
  root.add(oche);

  // The house dart BOX: an always-stocked open crate on a tall table beside
  // the oche (darts fly back here, so it never runs dry).
  const rackSlots: [number, number, number][] = [];
  const boxX = darts.boardX - 0.85; // toward the bar side, clear of the wall
  const boxZ = darts.ocheZ;
  // Station metrics: the crate shrank to 65% (the old box read oversized in
  // the corner) and the stand dropped from bar height to a low side table.
  const S = 0.65; // crate scale
  const TOP = 0.92; // table surface height (was 1.15)
  const CZ = boxZ - 0.04; // crate centre on the tabletop
  // Reach-in volume — deliberately BIGGER than the shrunken crate and biased
  // upward (hands arrive from above): pulling a dart should be forgiving,
  // the crate's look is the only thing that shrank.
  const dartBox = {
    center: [boxX, TOP + 0.1, CZ] as [number, number, number],
    half: [0.24, 0.18, 0.21] as [number, number, number],
  };
  const crateWood = new MeshStandardMaterial({ map: woodTexture('#7a4a24', [2, 1]), roughness: 0.86, metalness: 0.03 });
  // Shared by all four crate walls — PropSystem lifts its emissive to make the
  // whole box glow amber when a hand can take a dart from it.
  crateWood.emissive.setHex(0xff9024);
  crateWood.emissiveIntensity = 0;
  const crateDarkWood = new MeshStandardMaterial({ map: woodTexture('#3b2414', [1.5, 1]), roughness: 0.9, metalness: 0.02 });
  const tallLeg = new Mesh(new CylinderGeometry(0.04, 0.11, TOP - 0.02, 8), gunmetal(0.3));
  tallLeg.position.set(boxX, (TOP - 0.02) / 2, boxZ);
  root.add(tallLeg);
  const tallTop = new Mesh(new BoxGeometry(0.44, 0.05, 0.42), crateDarkWood);
  tallTop.position.set(boxX, TOP - 0.025, boxZ);
  root.add(tallTop);
  // Open wooden crate walls with a small amber rim (crate metrics ride S).
  const crateBase = new Mesh(new BoxGeometry(0.48 * S, 0.035, 0.38 * S), crateDarkWood);
  crateBase.position.set(boxX, TOP + 0.0175, CZ);
  root.add(crateBase);
  for (const [bw, bd, ox, oz] of [
    [0.5 * S, 0.03, 0, -0.185 * S],
    [0.5 * S, 0.03, 0, 0.185 * S],
    [0.03, 0.38 * S, -0.245 * S, 0],
    [0.03, 0.38 * S, 0.245 * S, 0],
  ] as const) {
    const wall = new Mesh(new BoxGeometry(bw, 0.13 * S, bd), crateWood);
    wall.position.set(boxX + ox, TOP + 0.078, CZ + oz);
    root.add(wall);
  }
  for (const [ox, oz] of [
    [-0.245 * S, -0.185 * S],
    [0.245 * S, -0.185 * S],
    [-0.245 * S, 0.185 * S],
    [0.245 * S, 0.185 * S],
  ] as const) {
    const post = new Mesh(new BoxGeometry(0.04, 0.17 * S, 0.04), crateDarkWood);
    post.position.set(boxX + ox, TOP + 0.09, CZ + oz);
    root.add(post);
  }
  const lip = new Mesh(new BoxGeometry(0.54 * S, 0.015, 0.42 * S), amberGlow(0.18));
  lip.position.set(boxX, TOP + 0.115, CZ);
  root.add(lip);
  // "GRAB DARTS" painted across the crate floor, lit amber so it reads in the
  // gloom. The box no longer shows darts poking out — PropSystem keeps any dart
  // resting here hidden, so the label IS the prompt: reach in to pull one.
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 256;
  const lctx = labelCanvas.getContext('2d')!;
  lctx.textAlign = 'center';
  lctx.textBaseline = 'middle';
  lctx.lineWidth = 13;
  lctx.strokeStyle = 'rgba(6,5,4,0.92)';
  lctx.fillStyle = '#ffb000';
  lctx.shadowColor = '#ff7a18';
  lctx.shadowBlur = 24;
  for (const [text, y, size] of [
    ['GRAB', 74, 100],
    ['DARTS', 182, 100],
  ] as const) {
    lctx.font = `900 ${size}px 'Arial Black', 'Arial Narrow', system-ui, sans-serif`;
    lctx.strokeText(text, 256, y);
    lctx.fillText(text, 256, y);
  }
  const labelTex = new CanvasTexture(labelCanvas);
  labelTex.colorSpace = SRGBColorSpace;
  labelTex.minFilter = LinearFilter;
  const dartBoxLabel = new Mesh(
    new PlaneGeometry(0.34 * S, 0.26 * S),
    new MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false }),
  );
  dartBoxLabel.name = 'dart-box-label';
  dartBoxLabel.rotation.x = -Math.PI / 2; // lie flat in the crate, facing up
  dartBoxLabel.position.set(boxX, TOP + 0.038, CZ); // just proud of the crate floor
  root.add(dartBoxLabel);
  // "DARTS" stencilled on the crate's outer faces so the box reads as the dart
  // supply from across the room (the GRAB DARTS prompt inside only shows when
  // you're already looking down into it).
  const sideCanvas = document.createElement('canvas');
  sideCanvas.width = 256;
  sideCanvas.height = 96;
  const sctx = sideCanvas.getContext('2d')!;
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.font = "900 62px 'Arial Black', 'Arial Narrow', system-ui, sans-serif";
  sctx.lineWidth = 9;
  sctx.strokeStyle = 'rgba(6,5,4,0.92)';
  sctx.fillStyle = '#ffb000';
  sctx.shadowColor = '#ff7a18';
  sctx.shadowBlur = 16;
  sctx.strokeText('DARTS', 128, 52);
  sctx.fillText('DARTS', 128, 52);
  const sideTex = new CanvasTexture(sideCanvas);
  sideTex.colorSpace = SRGBColorSpace;
  sideTex.minFilter = LinearFilter;
  const sideMat = new MeshBasicMaterial({ map: sideTex, transparent: true, depthWrite: false });
  const dartLabelDecal = (w: number, x: number, z: number, ry: number): void => {
    const m = new Mesh(new PlaneGeometry(w, w * (96 / 256)), sideMat);
    m.position.set(x, TOP + 0.078, z);
    m.rotation.y = ry;
    root.add(m);
  };
  dartLabelDecal(0.21, boxX, CZ + 0.135, 0); // room-facing front (+z)
  dartLabelDecal(0.21, boxX, CZ - 0.135, Math.PI); // back (−z)
  dartLabelDecal(0.17, boxX + 0.175, CZ, Math.PI / 2); // right side (+x)
  dartLabelDecal(0.17, boxX - 0.175, CZ, -Math.PI / 2); // left side (−x)
  // Dart home slots: the six house darts rest here OUT OF SIGHT (PropSystem
  // hides any dart resting in the box) until you reach in and pull one.
  for (let i = 0; i < darts.rackSlots; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    rackSlots.push([boxX + (col - 1) * 0.12 * S, TOP + 0.09, CZ + (row - 0.5) * 0.16 * S]);
  }

  // Leaderboard panel on the wall, between the board and the bar.
  const dartsBoardPanel = new Panel(0.85, 0.7);
  dartsBoardPanel.mesh.position.set(darts.boardX - 1.15, 1.7, darts.wallZ + 0.02);
  root.add(dartsBoardPanel.mesh);
  // RESET button just beneath it — a physical red push-button that wipes the
  // chalkboard for the whole room. A gunmetal bezel ring with a glowing red
  // cap; DartsSystem brightens the cap on the aim cone and drives the press.
  const resetBtnX = darts.boardX - 1.15;
  const resetBtnY = 1.28;
  const resetBezel = new Mesh(new CylinderGeometry(0.05, 0.055, 0.03, 24), gunmetal(0.4));
  resetBezel.rotation.x = Math.PI / 2; // lay the disc flat against the wall (faces +z)
  resetBezel.position.set(resetBtnX, resetBtnY, darts.wallZ + 0.03);
  root.add(resetBezel);
  const dartsResetButton = new Mesh(
    new CylinderGeometry(0.038, 0.038, 0.05, 24),
    new MeshStandardMaterial({ color: 0xd31919, emissive: 0xff2a2a, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.1 }),
  );
  dartsResetButton.name = 'darts-reset';
  dartsResetButton.rotation.x = Math.PI / 2;
  dartsResetButton.position.set(resetBtnX, resetBtnY, darts.wallZ + 0.05); // proud of the bezel
  // Off IWSDK's pointer entirely: this is a PHYSICAL button you push with a
  // hand, so the grab cursor must not light it (or let it be poked) from
  // across the room. The proximity glow in DartsSystem is its only highlight.
  dartsResetButton.pointerEvents = 'none';
  resetBezel.pointerEvents = 'none';
  root.add(dartsResetButton);

  // --- IRON SNAKE arcade cabinet (north-west corner) -----------------------------
  const arcadePos: [number, number, number] = [-4.45, 0, -2.85];
  const { cabinet, screen, stick } = buildArcadeCabinet();
  cabinet.position.set(arcadePos[0], 0, arcadePos[2]);
  // Face SOUTH-EAST into the room (it used to face into the bar corner).
  cabinet.rotation.y = Math.PI / 4;
  root.add(cabinet);

  // OCTA HUNT all-time high-score poster — on the north wall (z = -D) in the
  // clear stretch just EAST of the cabinet, west of the bar's bottle shelf. A
  // canvas Panel so DroneHuntSystem can repaint it live as the board updates.
  const octaBoard = new Panel(0.82, 1.18);
  octaBoard.mesh.position.set(-3.55, 1.55, -D + 0.04); // proud of the wall, facing +z
  root.add(octaBoard.mesh);

  // --- pint glass home slots on the bar -------------------------------------------
  const glassSlots: [number, number, number][] = [];
  // One row along the counter front — all 8 start under the bar and the
  // barkeep sets them here one at a time.
  for (let i = 0; i < PUB.glassMax; i++) {
    glassSlots.push([-2.1 + i * 0.6, bar.top + 0.002, bar.z - 0.24]);
  }

  // --- wall art --------------------------------------------------------------
  // Only the genuinely BARE walls carry art: the whole east wall, and the two
  // west-wall segments flanking the fight-hall doorway. North (bar/bottles/
  // dartboard) and south (booths/jukebox/door) are full, so they're left
  // alone. Each hangs in a Group so the wonky roll stays in-plane while the
  // group turns it to face the room.
  const placePoster = (url: string, x: number, y: number, z: number, ry: number, tilt: number, w: number, h: number): void => {
    const holder = new Group();
    holder.position.set(x, y, z);
    holder.rotation.y = ry;
    holder.add(buildPoster(url, w, h, tilt));
    root.add(holder);
  };
  const placeGraffiti = (url: string, x: number, y: number, z: number, ry: number, tilt: number, w: number, h: number): void => {
    const holder = new Group();
    holder.position.set(x, y, z);
    holder.rotation.y = ry;
    holder.add(buildGraffiti(url, w, h, tilt));
    root.add(holder);
  };
  const EAST = W - 0.04; // proud of the east wall, facing −x into the room
  const WEST = -W + 0.04; // …and the west wall, facing +x
  const RY_E = -Math.PI / 2;
  const RY_W = Math.PI / 2;
  // East wall (long + clear) — a gallery run of real night-city photos, a
  // couple hung wonky. The only graffiti in the venue is at the fight-hall
  // doorway (west) and in the hall itself.
  placePoster('posters/city-deli.jpg', EAST, 1.5, -2.3, RY_E, 0.06, 0.94, 0.75);
  placePoster('posters/city-london.jpg', EAST, 1.55, -0.6, RY_E, 0.02, 0.62, 0.93);
  placePoster('posters/city-vegas.jpg', EAST, 1.5, 1.1, RY_E, -0.07, 0.62, 0.93);
  placePoster('posters/city-soho.jpg', EAST, 1.55, 2.6, RY_E, -0.03, 0.94, 0.63);
  // West wall, either side of the doorway — GRAFFITI sprayed straight onto
  // the plaster: GOOPLIATH's dripping tag one side, the PLAY BLASTON piece
  // the other. Transparent decals, so the wall shows through the overspray.
  placeGraffiti('posters/goop-graffiti.png', WEST, 1.55, -1.5, RY_W, 0.03, 1.15, 0.77);
  placeGraffiti('posters/blaston-graffiti.png', WEST, 1.5, 2.7, RY_W, -0.02, 1.15, 0.77);

  // --- the fight hall through the west door ---------------------------------
  const { consolePanels, fightDisplay, fightDisplay2, fightPlatforms, discoball } = buildFightHall(root);

  const refs: PubRefs = {
    root,
    rootEntity,
    dartboard,
    corkSurround,
    dartCatchers: [northWall],
    dartRackSlots: rackSlots,
    dartBox,
    dartBoxMat: crateWood,
    glassSlots,
    dartsBoardPanel,
    dartsResetButton,
    arcadeScreen: screen,
    arcadePos,
    arcadeCabinet: cabinet,
    snakeStick: stick,
    octaBoard,
    consolePanels,
    fightDisplay,
    fightDisplay2,
    fightPlatforms,
    jukebox,
    jukeboxPanel,
    discoball,
    pubTv,
  };

  // --- bake the static shell down --------------------------------------------
  // The pub is built from hundreds of individual meshes (walls, beams, booths,
  // stools, bottles…) — each its own draw call — and none of it ever moves.
  // Collapse everything INERT to one mesh per material look, exempting all the
  // LIVE objects: every Object3D the refs hand to the systems (raycast targets,
  // retint meshes, canvas panels), every NAMED subtree (nodes are named exactly
  // because something animates or looks them up), and the dart-crate mesh
  // whose material glows when a hand can pull a dart.
  const keep = new Set<Object3D>();
  const keepTree = (o: Object3D | null | undefined): void => o?.traverse((c) => keep.add(c));
  root.traverse((o) => {
    if (o !== root && o.name) keepTree(o);
    const m = o as Mesh;
    if (m.isMesh && m.material === crateWood) keepTree(o);
  });
  for (const r of Object.values(refs)) {
    for (const item of Array.isArray(r) ? r : [r]) {
      if (item instanceof Object3D) {
        keepTree(item);
      } else if (item && typeof item === 'object' && 'mesh' in item && (item as { mesh: unknown }).mesh instanceof Object3D) {
        keepTree((item as { mesh: Object3D }).mesh); // a Panel — keep its plane
      }
    }
  }
  collapseStatic(root, (o) => keep.has(o));

  return refs;
}

/**
 * The JUKEBOX — a retro arched cabinet against the south wall where the
 * door-end booth used to be. A wood body with a glowing amber crown, a speaker
 * grille, and a marquee `Panel` that the MusicSystem updates with the current
 * web-radio station. Origin at the floor centre (= JUKEBOX.pos), front facing
 * −z into the room. Returns the group and its marquee panel.
 */
function buildJukebox(): { group: Group; panel: Panel } {
  const g = new Group();
  g.name = 'jukebox';
  g.position.set(...JUKEBOX.pos); // faces −z (room) by default

  const wood = new MeshStandardMaterial({ map: woodTexture('#5a2f17', [2, 2]), roughness: 0.6, metalness: 0.05 });
  const trim = new MeshStandardMaterial({ map: woodTexture('#2c1810', [1, 2]), roughness: 0.7 });
  // Coloured neon tubing. Each material tags its base glow so MusicSystem can
  // flare the WHOLE cabinet brighter when a hand is close enough to use it.
  const neon = (c: number, i = 1.6): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, metalness: 0.2, roughness: 0.3 });
    m.userData.baseGlow = i;
    return m;
  };
  const chrome = (): MeshStandardMaterial =>
    new MeshStandardMaterial({ color: 0xd7dee7, metalness: 1, roughness: 0.16 });
  const N = { amber: 0xffb000, yellow: 0xffd24a, orange: 0xff5a1f, green: 0x3be870, red: 0xff2f3b };

  const W = 0.8;
  const D = 0.46;
  const BODY_H = 1.12;
  const F = -D / 2 + 0.008; // room-facing front face — proud neon mounts here

  // Body + heavy plinth.
  const body = new Mesh(roundedBox(W, BODY_H, D, 0.12), wood);
  body.position.set(0, BODY_H / 2, 0);
  g.add(body);
  const base = new Mesh(new BoxGeometry(W + 0.08, 0.14, D + 0.06), trim);
  base.position.set(0, 0.07, 0);
  g.add(base);

  // --- Domed crown + concentric neon arches (the signature Wurlitzer top) ------
  const crown = new Mesh(roundedBox(W, 0.42, D, 0.19), wood);
  crown.position.set(0, BODY_H + 0.12, 0);
  g.add(crown);
  const archY = BODY_H + 0.08;
  for (const [r, c, tube] of [
    [W / 2 - 0.03, N.amber, 0.028],
    [W / 2 - 0.105, N.yellow, 0.024],
    [W / 2 - 0.175, N.orange, 0.022],
  ] as const) {
    const a = new Mesh(new TorusGeometry(r, tube, 10, 30, Math.PI), neon(c, 1.7));
    a.position.set(0, archY, F);
    g.add(a);
  }
  // A bright chrome rim hugging the outer arch.
  const rim = new Mesh(new TorusGeometry(W / 2 - 0.002, 0.011, 8, 30, Math.PI), chrome());
  rim.position.set(0, archY, F - 0.006);
  g.add(rim);

  // --- Vertical bubble tubes: GREEN left, RED right, chrome-capped -------------
  for (const [sx, c] of [[-1, N.green], [1, N.red]] as const) {
    const tube = new Mesh(new CylinderGeometry(0.03, 0.03, BODY_H - 0.08, 12), neon(c, 1.6));
    tube.position.set(sx * (W / 2 - 0.045), BODY_H / 2 + 0.02, F);
    g.add(tube);
    for (const cy of [BODY_H - 0.02, 0.1]) {
      const cap = new Mesh(new CylinderGeometry(0.04, 0.04, 0.03, 12), chrome());
      cap.position.set(sx * (W / 2 - 0.045), cy, F);
      g.add(cap);
    }
  }

  // --- Speaker grille: a dark recess, chrome bars, a hot orange centre knob ----
  const grille = new Mesh(new BoxGeometry(W - 0.2, 0.36, 0.03), trim);
  grille.position.set(0, 0.42, F - 0.004);
  g.add(grille);
  for (let i = 0; i < 6; i++) {
    const bar = new Mesh(new BoxGeometry(W - 0.26, 0.015, 0.02), chrome());
    bar.position.set(0, 0.28 + i * 0.058, F - 0.018);
    g.add(bar);
  }
  const knob = new Mesh(new CylinderGeometry(0.05, 0.05, 0.03, 18), neon(N.orange, 2.4));
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0, 0.42, F - 0.03);
  g.add(knob);

  // --- Marquee: the current-track readout, up under the arch -------------------
  // A proper LED-screen marquee (drawn by MusicSystem) — bigger + higher-res
  // than before so the track name actually fits (and scrolls if it's long).
  const panel = new Panel(0.6, 0.26, 512);
  panel.mesh.position.set(0, 0.86, F - 0.02);
  panel.mesh.rotation.y = Math.PI; // plane faces +z by default; turn it to −z
  g.add(panel.mesh);

  return { group: g, panel };
}

/**
 * The FIGHT HALL: a tall annexe west of the pub with the full FIRE FIGHT
 * setup on display — the two octagonal platforms from the arena (ember vs
 * blue corners), claim consoles, a big match display, and a hazard line on
 * the floor marking the (5-yard) ball cage so the crowd knows where the
 * fire stops.
 */
function buildFightHall(root: Group): {
  consolePanels: [Panel, Panel];
  fightDisplay: Panel;
  fightDisplay2: Panel;
  fightPlatforms: [Group, Group];
  discoball: Group;
} {
  const hall = FIGHT.hall;
  const cx = (hall.minX + hall.maxX) / 2;
  const w = hall.maxX - hall.minX;
  const d = hall.maxZ - hall.minZ;
  const h = hall.height;

  // Floors: a stands ring at base level around the SUNKEN PIT (the cage
  // rect dug FIGHT.pitDepth into the ground), pit walls between the levels.
  const plate = diamondPlateTextures();
  plate.map.repeat.set(w, d);
  plate.bumpMap.repeat.set(w, d);
  const floorMat = new MeshStandardMaterial({
    map: plate.map,
    bumpMap: plate.bumpMap,
    bumpScale: 0.6,
    metalness: 0.75,
    roughness: 0.45,
  });
  const cage = FIGHT.cage;
  const pit = FIGHT.pitDepth;
  // The pit floor is dug a little below the platform tops so the octagons stand
  // proud of it (fighters still stand at -pit; only the surrounding floor drops).
  const floorY = pit + FIGHT.standProud;
  const strip = (sw: number, sd: number, x: number, z: number, y: number): void => {
    const f = new Mesh(new PlaneGeometry(sw, sd), floorMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, z);
    root.add(f);
  };
  // Stands ring (y = 0): west / east / north / south strips around the pit.
  strip(cage.minX - hall.minX, d, (hall.minX + cage.minX) / 2, 0, 0);
  strip(hall.maxX - cage.maxX, d, (cage.maxX + hall.maxX) / 2, 0, 0);
  strip(cage.maxX - cage.minX, cage.minZ - hall.minZ, (cage.minX + cage.maxX) / 2, (hall.minZ + cage.minZ) / 2, 0);
  strip(cage.maxX - cage.minX, hall.maxZ - cage.maxZ, (cage.minX + cage.maxX) / 2, (cage.maxZ + hall.maxZ) / 2, 0);
  // The pit floor (dug to floorY so the platforms stand proud of it).
  strip(cage.maxX - cage.minX, cage.maxZ - cage.minZ, (cage.minX + cage.maxX) / 2, 0, -floorY);
  // Pit walls, facing inward, with a hazard lip along the rim.
  const pitWallMat = new MeshStandardMaterial({ map: steelWallTexture([6, 0.6]), metalness: 0.7, roughness: 0.55 });
  const pitWall = (pw: number, x: number, z: number, ry: number): void => {
    const wall = new Mesh(new PlaneGeometry(pw, floorY), pitWallMat);
    wall.position.set(x, -floorY / 2, z);
    wall.rotation.y = ry;
    root.add(wall);
  };
  pitWall(cage.maxX - cage.minX, (cage.minX + cage.maxX) / 2, cage.minZ, 0);
  pitWall(cage.maxX - cage.minX, (cage.minX + cage.maxX) / 2, cage.maxZ, Math.PI);
  pitWall(cage.maxZ - cage.minZ, cage.minX, 0, Math.PI / 2);
  pitWall(cage.maxZ - cage.minZ, cage.maxX, 0, -Math.PI / 2);

  // Bench stands: TWO TIERS around three sides (consoles own the east side).
  // The front row sits low at the pit rim; the back row is raised on a riser
  // so the crowd behind sees over the heads in front — a little stadium rake.
  const benchSteel = darkSteel();
  const riserMat = new MeshStandardMaterial({ map: steelWallTexture([6, 1]), metalness: 0.7, roughness: 0.6 });
  const benchPad = new MeshStandardMaterial({ map: fabricTexture('#5a2a20', [6, 1]), roughness: 0.85 });
  const bench = (len: number, x: number, z: number, ry: number, lift: number): void => {
    const seat = new Mesh(new BoxGeometry(len, 0.42, 0.38), benchSteel);
    seat.position.set(x, 0.21 + lift, z);
    seat.rotation.y = ry;
    root.add(seat);
    const cushion = new Mesh(new BoxGeometry(len, 0.06, 0.34), benchPad);
    cushion.position.set(x, 0.45 + lift, z);
    cushion.rotation.y = ry;
    root.add(cushion);
  };
  // A step deck from the floor up to the back-row seat foot.
  const riser = (len: number, x: number, z: number, ry: number, height: number, depth: number): void => {
    const step = new Mesh(new BoxGeometry(len, height, depth), riserMat);
    step.position.set(x, height / 2, z);
    step.rotation.y = ry;
    root.add(step);
  };
  const FRONT = 0.7; // offset of the low front row from the rim
  const BACK = 1.65; // offset of the raised back row
  const LIFT = 0.45; // how high the back tier rides
  const sideLen = cage.maxX - cage.minX - 1.2;
  const westLen = cage.maxZ - cage.minZ - 1.2;
  const midX = (cage.minX + cage.maxX) / 2;
  // Risers under the back tier (one long step per side).
  riser(sideLen + 0.4, midX, cage.minZ - BACK + 0.05, 0, LIFT, 0.95);
  riser(sideLen + 0.4, midX, cage.maxZ + BACK - 0.05, 0, LIFT, 0.95);
  riser(westLen + 0.4, cage.minX - BACK + 0.05, 0, Math.PI / 2, LIFT, 0.95);
  // Front (low) tier.
  bench(sideLen, midX, cage.minZ - FRONT, 0, 0);
  bench(sideLen, midX, cage.maxZ + FRONT, 0, 0);
  bench(westLen, cage.minX - FRONT, 0, Math.PI / 2, 0);
  // Back (raised) tier.
  bench(sideLen, midX, cage.minZ - BACK, 0, LIFT);
  bench(sideLen, midX, cage.maxZ + BACK, 0, LIFT);
  bench(westLen, cage.minX - BACK, 0, Math.PI / 2, LIFT);

  const ceiling = new Mesh(
    new PlaneGeometry(w, d),
    new MeshStandardMaterial({ color: 0x16181d, metalness: 0.6, roughness: 0.8 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, h, 0);
  root.add(ceiling);

  const wallTex = steelWallTexture([5, 2]);
  const wallMat = new MeshStandardMaterial({ map: wallTex, metalness: 0.7, roughness: 0.55 });
  const mk = (pw: number, ph: number, x: number, y: number, z: number, ry: number): void => {
    const wall = new Mesh(new PlaneGeometry(pw, ph), wallMat);
    wall.position.set(x, y, z);
    wall.rotation.y = ry;
    root.add(wall);
  };
  mk(w, h, cx, h / 2, hall.minZ, 0); // north
  mk(w, h, cx, h / 2, hall.maxZ, Math.PI); // south
  mk(d, h, hall.minX, h / 2, 0, Math.PI / 2); // far west
  // East wall (shared with the pub) with the matching door opening.
  const door = FIGHT.door;
  mk(hall.maxZ - door.z1, h, hall.maxX, h / 2, (door.z1 + hall.maxZ) / 2, -Math.PI / 2);
  mk(door.z0 - hall.minZ, h, hall.maxX, h / 2, (door.z0 + hall.minZ) / 2, -Math.PI / 2);
  mk(door.z1 - door.z0, h - door.height, hall.maxX, (h + door.height) / 2, (door.z0 + door.z1) / 2, -Math.PI / 2);

  // High beams + lamps: cooler, brighter — a venue, not a snug.
  const beamMat = darkSteel();
  for (const z of [-4.5, 0, 4.5]) {
    const beam = new Mesh(new BoxGeometry(w, 0.22, 0.16), beamMat);
    beam.position.set(cx, h - 0.11, z);
    root.add(beam);
  }
  // Two platform keys + two ambers on the diagonal — four lights, not six:
  // every scene light costs every shaded fragment on Quest, so the corner
  // ambers double up on reach instead of count.
  for (const [x, z, colour, intensity] of [
    [cx, FIGHT.platformZ, 0xfff0d8, 14],
    [cx, -FIGHT.platformZ, 0xfff0d8, 14],
    [hall.minX + 2, 5, 0xffb46a, 11],
    [hall.maxX - 2, -5, 0xffb46a, 11],
  ] as const) {
    const light = new PointLight(colour, intensity, 12, 1.7);
    light.position.set(x, h - 0.6, z);
    root.add(light);
  }

  // The two octagonal platforms are the arena's REAL platform objects, not a
  // fight-hall approximation. FightSystem applies each claimant's complete
  // platform skin to these groups, including geometry/decal ornaments.
  const consolePanels: Panel[] = [];
  const fightPlatforms: Group[] = [];
  for (const side of [0, 1] as const) {
    const z = side === 0 ? FIGHT.platformZ : -FIGHT.platformZ;
    const accent = teamColor(side);
    // The platform group's local floor line is its deck top, just as it is in
    // the main arena. Drop that line to the sunken fight level and face each
    // claimant toward the opposing pad.
    const platform = makePlatform(accent);
    platform.name = `pub-fight-platform-${side}`;
    platform.position.set(FIGHT.centerX, -FIGHT.pitDepth, z);
    platform.rotation.y = side === 0 ? 0 : Math.PI;
    root.add(platform);
    fightPlatforms.push(platform);

    // Claim + betting tablet: a steel kiosk between the platform and the door —
    // claim your corner here, then it takes the crowd's round-one bets on the
    // fighter who took it. A tapered pedestal under a slightly reclined plate,
    // aimed with lookAt so the 90° yaw never rolls the panel (the old build set
    // rotation.y AND rotation.x raw, which skewed it — the "wonky" tablet).
    const [px, , pz] = FIGHT.consoles[side];
    const pedestal = new Mesh(new CylinderGeometry(0.08, 0.15, 1.16, 8), gunmetal(0.3));
    pedestal.position.set(px, 0.58, pz);
    root.add(pedestal);
    // A collar bridging the post to the plate — reads as one unit. Sits a touch
    // higher so the plate rides ABOVE it: the console's bottom text line used to
    // fall into the band the collar/post occlude for a standing reader.
    const collar = new Mesh(new BoxGeometry(0.34, 0.14, 0.22), darkSteel());
    collar.position.set(px, 1.21, pz);
    root.add(collar);
    const panel = new Panel(0.76, 0.52);
    // Lifted vs. the base (was 1.34) so the reclined plate's bottom edge — and
    // its final line of text — clears the collar/pedestal in the sightline.
    panel.mesh.position.set(px, 1.48, pz);
    // Face the approach from the door (east), reclined gently back toward a
    // standing reader — lookAt keeps the plate square (no roll). Same recline
    // (+0.32 rise over 2.4 reach) as before, just raised with the plate.
    panel.mesh.lookAt(px + 2.4, 1.8, pz);
    root.add(panel.mesh);
    // Give the screen real depth: a chunky steel slab behind it, matching the
    // panel's recline, so the tablet reads as a thick unit instead of a flat
    // plane. Slightly oversized so it frames the screen with a steel bezel.
    const tabletBack = new Mesh(new BoxGeometry(0.88, 0.64, 0.1), gunmetal(0.35));
    tabletBack.position.copy(panel.mesh.position);
    tabletBack.quaternion.copy(panel.mesh.quaternion);
    tabletBack.translateZ(-0.055); // sit just behind the screen face (panel faces +local z)
    root.add(tabletBack);
    consolePanels.push(panel);
  }

  // Hazard line along the pit rim (the cage edge — where the fire stops).
  const lineMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.3,
  });
  for (const [lw, ld, x, z] of [
    [cage.maxX - cage.minX, 0.06, (cage.minX + cage.maxX) / 2, cage.minZ],
    [cage.maxX - cage.minX, 0.06, (cage.minX + cage.maxX) / 2, cage.maxZ],
    [0.06, cage.maxZ - cage.minZ, cage.minX, 0],
    [0.06, cage.maxZ - cage.minZ, cage.maxX, 0],
  ] as const) {
    const line = new Mesh(new PlaneGeometry(lw, ld), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.011, z);
    root.add(line);
  }

  // TWO match scoreboards facing opposite ways across the pit, so a
  // spectator on either side reads the health. Each is the IRON BALLS sign
  // (PNG, neon fallback) above a health/status panel — no "FIRE FIGHT" text.
  // West: high on the far wall, facing back toward the door (+x).
  // buildSign letterbox-fits the art, so these boxes just cap the size.
  const fightSign1 = buildSign('signs/nixiepng.png', 2.85, 1.9);
  fightSign1.position.set(hall.minX + 0.04, 3.55, 0);
  fightSign1.rotation.y = Math.PI / 2;
  root.add(fightSign1);
  const fightDisplay = new Panel(3.2, 1.1);
  // Panel pushed 0.1 m PROUD of the sign (toward the viewer) so the two
  // coplanar planes stop z-fighting where they overlapped.
  fightDisplay.mesh.position.set(hall.minX + 0.14, 1.95, 0);
  fightDisplay.mesh.rotation.y = Math.PI / 2;
  root.add(fightDisplay.mesh);

  // The same "IRON SHARPENS IRON" creed watches the pit too — high on the
  // NORTH wall of the fight hall, centred over the cage, facing the crowd.
  const hallCx = (hall.minX + hall.maxX) / 2;
  const hallCreed = buildSign(IRON_SHARPENS_SIGN, 5.4, 3.7, ironSharpensFallback);
  hallCreed.position.set(hallCx, 2.55, hall.minZ + 0.05);
  hallCreed.rotation.y = 0; // north wall faces +z, into the hall
  root.add(hallCreed);

  // East: above the door you came in by, facing into the hall (−x).
  const doorMidZ = (FIGHT.door.z0 + FIGHT.door.z1) / 2;
  const fightSign2 = buildSign('signs/nixiepng.png', 1.8, 1.2);
  fightSign2.position.set(hall.maxX - 0.04, 3.9, doorMidZ);
  fightSign2.rotation.y = -Math.PI / 2;
  root.add(fightSign2);
  const fightDisplay2 = new Panel(3.0, 1.0);
  // Proud of the sign, and lifted clear of the door opening above it.
  fightDisplay2.mesh.position.set(hall.maxX - 0.14, 2.75, doorMidZ);
  fightDisplay2.mesh.rotation.y = -Math.PI / 2;
  root.add(fightDisplay2.mesh);

  // A huge mirror-tiled DISCO BALL hung dead-centre over the pit (between the
  // two platforms at z = 0), spun by MusicSystem. The faceted metal catches the
  // pit's two main spotlights and the RoomEnvironment, so it glints as it turns.
  const ballY = 3.0; // centre height — bottom sits ~2.0 m up, well over the action
  const disco = buildDiscoball();
  disco.position.set(cx, ballY, 0);
  root.add(disco);
  // Static hanging gear (does NOT spin): a cable up to a ceiling mount.
  const cableMat = new MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.6, roughness: 0.6 });
  const cableBot = ballY + DISCO_R + 0.16; // just above the ball's top cap
  const cableLen = Math.max(0.1, h - cableBot);
  const cable = new Mesh(new CylinderGeometry(0.025, 0.025, cableLen, 8), cableMat);
  cable.position.set(cx, cableBot + cableLen / 2, 0);
  root.add(cable);
  const mount = new Mesh(new CylinderGeometry(0.2, 0.2, 0.08, 12), cableMat);
  mount.position.set(cx, h - 0.04, 0);
  root.add(mount);

  // Wall art on the hall's bare OUTER walls — north, south and far-west. The
  // east wall carries the scoreboards + doorway, and the benches are low, so
  // eye-height pieces read cleanly above the crowd. All city night shots hung
  // as big prints (the only graffiti in the venue is the pair by the club's
  // fight-hall doorway) — bigger than the pub-room ones to suit the tall walls.
  const hallPoster = (url: string, x: number, y: number, z: number, ry: number, tilt: number, w: number, h: number): void => {
    const holder = new Group();
    holder.position.set(x, y, z);
    holder.rotation.y = ry;
    holder.add(buildPoster(url, w, h, tilt));
    root.add(holder);
  };
  const hallGraffiti = (url: string, x: number, y: number, z: number, ry: number, tilt: number): void => {
    const holder = new Group();
    holder.position.set(x, y, z);
    holder.rotation.y = ry;
    holder.add(buildGraffiti(url, 1.6, 1.07, tilt));
    root.add(holder);
  };
  // North-wall art sits a touch FURTHER off the wall than the creed sign
  // (minZ + 0.05) and clear of its 5.4 m span — the blaston graffiti used to
  // overlap the creed's edge on the SAME plane, and two coplanar transparent
  // planes z-fight (that was the left-side flicker).
  const NZ = hall.minZ + 0.075; // north wall (faces +z), proud of the creed
  const SZ = hall.maxZ - 0.05; // south wall (faces −z)
  const WX = hall.minX + 0.05; // far-west wall (faces +x)
  // Each city photo hangs exactly once across the whole venue. The hall's one
  // graffiti piece (the venue's second and last PLAY BLASTON) faces the crowd
  // from the north wall; the far-west wall carries a single tall print.
  hallGraffiti('posters/blaston-graffiti.png', cx + 3.6, 2.2, NZ, 0, 0.02); // north-right, clear of the creed
  hallPoster('posters/city-tokyo.jpg', cx - 3.7, 2.3, NZ, 0, -0.04, 1.35, 0.76); // north-left, clear of the creed
  hallPoster('posters/city-mountain.jpg', cx - 2.6, 2.2, SZ, Math.PI, -0.03, 1.7, 0.71); // south-left
  hallPoster('posters/city-trails.jpg', cx + 3.4, 2.2, SZ, Math.PI, -0.03, 0.8, 1.2); // south-right
  hallPoster('posters/city-alley.jpg', WX, 2.25, -3.4, Math.PI / 2, 0.04, 0.8, 1.2); // west-north
  hallGraffiti('posters/blaston-graffiti.png', WX, 2.2, 3.8, Math.PI / 2, -0.02); // west-south — the far wall opposite the club door

  return {
    consolePanels: [consolePanels[0], consolePanels[1]],
    fightDisplay,
    fightDisplay2,
    fightPlatforms: [fightPlatforms[0], fightPlatforms[1]],
    discoball: disco,
  };
}

/**
 * The bar TV: a dark-bezel flat screen on a short ceiling bracket, hung over
 * the bar and facing into the room. The screen is a Panel that TvSystem paints
 * with the live Discord chat. Returns the screen panel for the refs.
 */
function buildPubTv(root: Group, x: number, y: number, z: number): Panel {
  const g = new Group();
  g.name = 'pub-tv';
  g.position.set(x, y, z); // screen faces +z (into the room)

  const SCREEN_W = 0.78;
  const SCREEN_H = 0.44; // ~16:9
  const bezelMat = new MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.25, roughness: 0.55 });
  const bezel = new Mesh(new BoxGeometry(SCREEN_W + 0.12, SCREEN_H + 0.12, 0.06), bezelMat);
  bezel.position.set(0, 0, -0.035);
  g.add(bezel);

  const panel = new Panel(SCREEN_W, SCREEN_H, 900); // higher dpi so the small screen stays crisp
  panel.mesh.position.set(0, 0, 0.002); // proud of the bezel face
  g.add(panel.mesh);

  // Hang it: a short post up to a ceiling plate (PUB.ceiling above the screen).
  const mountMat = darkSteel();
  const topLocal = SCREEN_H / 2 + 0.06;
  const ceilLocal = PUB.ceiling - y;
  const post = new Mesh(new BoxGeometry(0.05, Math.max(0.08, ceilLocal - topLocal), 0.05), mountMat);
  post.position.set(0, (topLocal + ceilLocal) / 2, -0.05);
  g.add(post);
  const plate = new Mesh(new BoxGeometry(0.22, 0.03, 0.18), mountMat);
  plate.position.set(0, ceilLocal - 0.015, -0.05);
  g.add(plate);

  root.add(g);
  return panel;
}

/** Radius of the fight-hall disco ball (metres) — big, it's a centrepiece. */
const DISCO_R = 0.8;

/** Mirror-tile texture for the disco ball: a grid of bright facets with dark
 *  grout between them, so the sphere reads as tiled glass even before it
 *  catches a light. Brightness is varied per tile by a cheap hash. */
function discoTileTexture(): CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#08090c'; // grout
  ctx.fillRect(0, 0, S, S);
  const n = 16;
  const gap = 1.5;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const b = 190 + ((x * 7 + y * 13) % 11) * 6; // 190..250, bright varied tiles
      ctx.fillStyle = `rgb(${b},${b},${Math.min(255, b + 18)})`;
      ctx.fillRect(x * cell + gap, y * cell + gap, cell - gap * 2, cell - gap * 2);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Build the disco ball: a flat-shaded mirror sphere (faceted, so it sparkles)
 *  under a small steel cap. Origin at the ball's centre; spun by MusicSystem. */
function buildDiscoball(): Group {
  const g = new Group();
  g.name = 'discoball';
  const ballMat = new MeshStandardMaterial({
    map: discoTileTexture(),
    metalness: 0.9, // a touch less mirror so the bright tiles read in the dim hall
    roughness: 0.26,
    emissive: 0x5566aa,
    emissiveIntensity: 0.6, // self-lit so it never goes murky between glints
    flatShading: true, // facets give the mirror-tile sparkle as it turns
  });
  const ball = new Mesh(new SphereGeometry(DISCO_R, 32, 24), ballMat);
  g.add(ball);
  // Top cap where the cable meets the ball (small — fine to spin with it).
  const cap = new Mesh(
    new CylinderGeometry(0.1, 0.15, 0.14, 12),
    new MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.5 }),
  );
  cap.position.set(0, DISCO_R + 0.04, 0);
  g.add(cap);
  return g;
}

/**
 * The banquette run along the south wall: a raised wooden plinth, a
 * continuous channel-backed burgundy bench divided into booths by fins, and
 * for each booth a square table with a freestanding bench opposite — the
 * upmarket-bar layout from the reference. `centres` are the booth x's; the
 * tables match the SURFACES entries in config.ts.
 */
function buildBanquette(centres: number[]): Group {
  const D = PUB.halfDepth;
  const g = new Group();
  g.name = 'banquette';
  const wood = new MeshStandardMaterial({ map: woodTexture('#6b4526', [3, 1]), roughness: 0.7, metalness: 0.05 });
  const woodDark = new MeshStandardMaterial({ map: woodTexture('#4a2f1a', [2, 1]), roughness: 0.75 });
  const pad = new MeshStandardMaterial({ map: fabricTexture('#4e1f2d', [4, 1]), roughness: 0.9 });
  const tableMat = new MeshStandardMaterial({ map: woodTexture('#2a1d16', [1, 1]), roughness: 0.5, metalness: 0.25 });

  const x0 = centres[0] - 1.0;
  const x1 = centres[centres.length - 1] + 1.0;
  const span = x1 - x0;
  const midX = (x0 + x1) / 2;
  const PZ = D - 0.55; // bench/back centre line, against the wall
  const STEP = 0.12; // plinth height

  // Raised plinth the whole bench sits on (a step up off the floor).
  const plinth = new Mesh(new BoxGeometry(span + 0.1, STEP, 1.0), wood);
  plinth.position.set(midX, STEP / 2, D - 0.5);
  g.add(plinth);
  const plinthLip = new Mesh(new BoxGeometry(span + 0.1, 0.03, 0.05), woodDark);
  plinthLip.position.set(midX, STEP, D - 1.0);
  g.add(plinthLip);

  // Continuous bench: base box + burgundy cushion, sitting on the plinth.
  const base = new Mesh(roundedBox(span, 0.32, 0.55, 0.05), woodDark);
  base.position.set(midX, STEP + 0.16, PZ);
  g.add(base);
  const cushion = new Mesh(roundedBox(span - 0.04, 0.1, 0.5, 0.05), pad);
  cushion.position.set(midX, STEP + 0.37, PZ);
  g.add(cushion);

  // Tall channel-tufted back against the wall, built from vertical panels.
  const backZ = D - 0.16;
  const backTop = 1.35;
  const panelW = 0.26;
  const nPanels = Math.max(1, Math.round(span / panelW));
  for (let i = 0; i < nPanels; i++) {
    const px = x0 + (i + 0.5) * (span / nPanels);
    const panel = new Mesh(roundedBox((span / nPanels) - 0.03, backTop - (STEP + 0.42), 0.08, 0.04), pad);
    panel.position.set(px, (STEP + 0.42 + backTop) / 2, backZ);
    g.add(panel);
  }
  // Capping rail along the top of the back.
  const rail = new Mesh(roundedBox(span, 0.06, 0.12, 0.03), wood);
  rail.position.set(midX, backTop, backZ);
  g.add(rail);

  // Divider fins between booths + a table and opposite bench per booth.
  const bounds = [x0, ...centres.slice(0, -1).map((_, i) => (centres[i] + centres[i + 1]) / 2), x1];
  for (const bx of bounds) {
    const fin = new Mesh(new BoxGeometry(0.06, backTop - STEP, 0.95), wood);
    fin.position.set(bx, STEP + (backTop - STEP) / 2, D - 0.5);
    g.add(fin);
  }
  for (const cx of centres) {
    // Square table jutting toward the aisle.
    const tz = D - 1.45;
    const pedestal = new Mesh(new CylinderGeometry(0.05, 0.14, 0.72, 8), tableMat);
    pedestal.position.set(cx, 0.36, tz);
    g.add(pedestal);
    const top = new Mesh(roundedBox(0.7, 0.05, 0.7, 0.06), tableMat);
    top.position.set(cx, 0.74, tz);
    g.add(top);
    const edge = new Mesh(roundedBox(0.72, 0.02, 0.72, 0.06), woodDark);
    edge.position.set(cx, 0.765, tz);
    g.add(edge);
    // Freestanding bench across the table, facing the wall.
    const benchBase = new Mesh(roundedBox(0.9, 0.3, 0.4, 0.05), woodDark);
    benchBase.position.set(cx, 0.15, D - 1.95);
    g.add(benchBase);
    const benchPad = new Mesh(roundedBox(0.86, 0.09, 0.36, 0.045), pad);
    benchPad.position.set(cx, 0.35, D - 1.95);
    g.add(benchPad);
    const benchBack = new Mesh(roundedBox(0.9, 0.5, 0.08, 0.04), woodDark);
    benchBack.position.set(cx, 0.6, D - 2.13);
    g.add(benchBack);
  }
  return g;
}

/** Classic upright cabinet: marquee, angled screen, control deck, side art. */
function buildArcadeCabinet(): { cabinet: Group; screen: Mesh; stick: Group } {
  const cabinet = new Group();
  cabinet.name = 'arcade-cabinet';

  const body = new Mesh(new BoxGeometry(0.62, 1.75, 0.6), gunmetal(0.45));
  body.position.y = 0.875;
  cabinet.add(body);

  // Hazard-striped side art.
  const stripeMat = new MeshStandardMaterial({
    color: PALETTE.amber,
    emissive: PALETTE.amber,
    emissiveIntensity: 0.2,
    roughness: 0.5,
  });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const stripe = new Mesh(new PlaneGeometry(0.5, 0.06), stripeMat);
      stripe.position.set(side * 0.311, 0.5 + i * 0.18, -0.05 + i * 0.05);
      stripe.rotation.y = side * Math.PI / 2;
      stripe.rotation.z = side * -0.5;
      cabinet.add(stripe);
    }
  }

  // Marquee.
  const marquee = new Mesh(
    new BoxGeometry(0.62, 0.22, 0.18),
    new MeshStandardMaterial({
      color: 0x2a160a,
      emissive: 0xff8c1a,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    }),
  );
  marquee.position.set(0, 1.86, 0.26); // proud of the body face (0.30) so the
  cabinet.add(marquee);                //  marquee/body fronts don't z-fight
  const marqueeText = new Panel(0.6, 0.2);
  marqueeText.setLines([{ text: 'OCTA HUNT', size: 56, colour: '#ff8c1a', bold: true }]);
  // Sit the text clearly PROUD of the marquee face (front now at z 0.35).
  marqueeText.mesh.position.set(0, 1.86, 0.36);
  cabinet.add(marqueeText.mesh);

  // Screen: angled back CRT face, pushed PROUD of the body — the tilt used
  // to sink the top half of the screen inside the cabinet box.
  const bezel = new Mesh(new BoxGeometry(0.56, 0.46, 0.06), darkSteel());
  bezel.position.set(0, 1.42, 0.34);
  bezel.rotation.x = -0.18;
  cabinet.add(bezel);
  const screen = new Mesh(
    new PlaneGeometry(0.46, 0.36),
    new MeshBasicMaterial({ color: 0x0a0c12 }),
  );
  screen.name = 'arcade-screen';
  screen.position.set(0, 1.42, 0.372);
  screen.rotation.x = -0.18;
  cabinet.add(screen);

  // Control deck JUTS OUT below the screen so the joystick isn't tucked
  // under the screen's overhang (the screen's bottom edge sits near z 0.4).
  const deck = new Mesh(new BoxGeometry(0.6, 0.08, 0.34), gunmetal(0.3));
  deck.position.set(0, 1.0, 0.5);
  deck.rotation.x = 0.18;
  cabinet.add(deck);
  // Bracket linking the jutting deck back to the body.
  const bracket = new Mesh(new BoxGeometry(0.5, 0.1, 0.22), darkSteel());
  bracket.position.set(0, 0.92, 0.4);
  cabinet.add(bracket);
  // Legacy joystick group. OCTA HUNT is a light-gun game (you aim the
  // controller at the screen), so DroneHuntSystem hides this at runtime — it's
  // kept only so the cabinet still builds a plausible control deck.
  const stick = new Group();
  stick.name = 'arcade-joystick';
  stick.position.set(-0.12, 1.04, 0.5);
  const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 6), darkSteel());
  shaft.position.y = 0.05;
  stick.add(shaft);
  const ball = new Mesh(
    new CylinderGeometry(0.028, 0.028, 0.03, 10),
    new MeshStandardMaterial({ color: 0xe8352a, roughness: 0.4 }),
  );
  ball.position.y = 0.105;
  stick.add(ball);
  cabinet.add(stick);
  for (const [bx, c] of [
    [0.08, 0x39ff14],
    [0.18, 0xe8352a],
  ] as const) {
    const button = new Mesh(
      new CylinderGeometry(0.022, 0.026, 0.018, 10),
      new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, roughness: 0.4 }),
    );
    button.position.set(bx, 1.04, 0.52);
    button.rotation.x = 0.18;
    cabinet.add(button);
  }

  // Glow under the marquee so the corner reads from across the room.
  const glow = new PointLight(0xff8c1a, 1.6, 2.2, 1.8);
  glow.position.set(0, 1.6, 0.45);
  cabinet.add(glow);

  return { cabinet, screen, stick };
}
