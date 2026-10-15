#!/usr/bin/env node
/**
 * THE REFLECTION, and where it is allowed to be.
 *
 *   npm run dev        # terminal 1 (the browser stage needs it)
 *   node tools/mirror-check.mjs
 *
 * VOIDSTEP's decks hang a two-step KEEL under their face, and the circuit
 * draws its reflection by flipping the live instance buffers about the
 * floor (course/banks.ts mirrorBank). A flip is only honest for geometry
 * that stands ENTIRELY ABOVE the mirror plane — and a deck resting at
 * ground level does not: its keel is below the floor, so the flip folded
 * that keel back UP through the deck and every grounded platform wore a
 * stack of blocks on its face, covering the etch and the scan line.
 *
 * The fix is a world-space clipping plane on each mirror material. The
 * FIRST attempt at it did nothing at all, and did nothing silently: the
 * plane was written in the course's own coordinates, and the course is
 * parked three hundred metres under the club (COURSE_ORIGIN). "Keep
 * everything below −0.06" is true of every fragment at −300, so the plane
 * clipped nothing and the blocks stayed exactly where they were.
 *
 * So this checks two different things, and the second one is the one that
 * caught the mistake:
 *
 *   STAGE 1, arithmetic from the source — the keel really does reach below
 *   the floor on a grounded deck, every mirror carries a plane, and the
 *   renderer is told to respect object-level clipping (off by default,
 *   which is its own way of making the planes do nothing).
 *
 *   STAGE 2, a real render — mirrorBank is imported into a browser, hung
 *   under a group at COURSE_ORIGIN, and drawn by an actual WebGLRenderer.
 *   The plane's constant must come back as the floor's WORLD height, not
 *   its height in the circuit's private coordinates.
 */

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const platform = read('src/rave/systems/CoursePlatformSystem.ts');
const banks = read('src/rave/course/banks.ts');
const voidSys = read('src/rave/systems/CourseVoidSystem.ts');
const courseCfg = read('src/rave/course/config.ts');

console.log('=== the floor, and what hangs under it ===');

const floorY = Number(/export const FLOOR_Y = (-?[\d.]+)/.exec(voidSys)?.[1]);
const originY = Number(/COURSE_ORIGIN = \{ x: -?[\d.]+, y: (-?[\d.]+)/.exec(courseCfg)?.[1]);
const keelUpper = Number(/const KEEL_UPPER = \{[^}]*y: (-?[\d.]+)/.exec(platform)?.[1]);
const keelLower = Number(/const KEEL_LOWER = \{[^}]*y: (-?[\d.]+)/.exec(platform)?.[1]);
check('the floor, the origin and both keel steps are readable', [floorY, originY, keelUpper, keelLower].every(Number.isFinite), `floor ${floorY}, origin y ${originY}, keel ${keelUpper} / ${keelLower}`);
check('the keel hangs BELOW the deck it belongs to', keelUpper < 0 && keelLower < keelUpper, `${keelUpper} then ${keelLower}`);

/* A deck resting on the ground sits at y = 0 in course space; one in flight
   is up at 1.5. The mirror maps y to 2*floorY − y. */
const mirror = (y) => 2 * floorY - y;
const groundedKeel = mirror(0 + keelLower);
const flyingKeel = mirror(1.5 + keelLower);
check('a GROUNDED deck reflects its keel above the floor — the bug', groundedKeel > floorY, `keel at ${(0 + keelLower).toFixed(3)} reflects to ${groundedKeel.toFixed(3)}, floor ${floorY}`);
check('a FLYING deck reflects its keel below the floor — always was fine', flyingKeel < floorY, `reflects to ${flyingKeel.toFixed(3)}`);

console.log('\n=== the plane that fixes it ===');

check('the mirrored banks carry a clipping plane', /clippingPlanes = \[plane\]/.test(banks), 'course/banks.ts mirrorBank');
check("the venue's mirror carries one too", /clippingPlanes = \[plane\]/.test(read('src/rave/arena/voidkit.ts')), 'arena/voidkit.ts mirrorOf');
check('the circuit turns local clipping ON (off by default, or the planes do nothing)', /this\.renderer\.localClippingEnabled = true/.test(platform), 'CoursePlatformSystem.init');
// The plane must be RE-AIMED as the scene moves, not fixed at build time.
check('the plane is re-aimed at the floor every frame, not set once', /plane\.constant = _floor\.y/.test(banks) && /onBeforeRender/.test(banks), 'from the parent world matrix');

/* three keeps a fragment where normal·p + constant > 0. With a normal of
   −Y and a constant equal to the floor's world height that reads
   −y + worldFloor > 0, i.e. y < worldFloor. */
const worldFloor = originY + floorY;
const kept = (y) => -y + worldFloor > 0;
check("the plane REJECTS the grounded deck's folded-up keel", !kept(originY + groundedKeel), `keel at world ${(originY + groundedKeel).toFixed(2)} vs floor ${worldFloor.toFixed(2)}`);
check("the plane KEEPS a flying deck's reflection", kept(originY + flyingKeel), `world ${(originY + flyingKeel).toFixed(2)}`);
check('the plane keeps the grounded deck FACE reflection itself', kept(originY + mirror(0) - 0.001), `face at world ${(originY + mirror(0)).toFixed(2)}`);

console.log('\n=== a real render, three hundred metres down ===');

const browser = await chromium.launch();
const page = await browser.newPage();
let pageErr = '';
page.on('pageerror', (e) => (pageErr += e.message));
await page.goto(`${base}/rave.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });

const live = await page.evaluate(async ({ originY, floorY }) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { mirrorBank, Bank } = await import('/src/rave/course/banks.ts');

  // A bank of one box, and its reflection, hung under a root parked where
  // the circuit really lives.
  const bank = new Bank(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 4);
  bank.add(0, 0, 0, 1, 1, 1, 0xffffff);
  const root = new THREE.Group();
  root.position.set(0, originY, 0);
  const mirrored = mirrorBank(bank, floorY);
  root.add(bank.mesh, mirrored);

  const scene = new THREE.Scene();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, originY + 3, 6);
  camera.lookAt(0, originY, 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.localClippingEnabled = true;

  const planeOf = () => {
    let c = null;
    mirrored.traverse((o) => {
      if (c !== null || !o.isInstancedMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.clippingPlanes?.[0]) c = m.clippingPlanes[0].constant;
    });
    return c;
  };

  const before = planeOf();
  renderer.render(scene, camera);
  const after = planeOf();

  // And it must FOLLOW the root if the circuit is ever moved.
  root.position.y = originY - 25;
  renderer.render(scene, camera);
  const moved = planeOf();

  renderer.dispose();
  return { before, after, moved, localClipping: renderer.localClippingEnabled };
}, { originY, floorY });

check('the plane starts at the circuit\'s own floor height', Math.abs(live.before - floorY) < 1e-6, `${live.before}`);
check('one render re-aims it at the floor\'s WORLD height', Math.abs(live.after - worldFloor) < 1e-6, `${live.after} (expected ${worldFloor})`);
check('it is not left in course coordinates — the bug that shipped', Math.abs(live.after - floorY) > 1, `${live.after} vs the useless ${floorY}`);
check('it follows the circuit if the circuit moves', Math.abs(live.moved - (worldFloor - 25)) < 1e-6, `${live.moved} after dropping the root 25 m`);
check('no page errors', !pageErr, pageErr.slice(0, 160));

await browser.close();

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
