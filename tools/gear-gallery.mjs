#!/usr/bin/env node
/**
 * THE GEAR GALLERY — every piece in the shop, worn, on one contact sheet.
 *
 *   npm run dev                                  # terminal 1
 *   node tools/gear-gallery.mjs [out.png] [ids] [accent]
 *     ids: comma list (default all) · accent: hex the glow is lit in
 *
 * Each piece is dressed on a white blank (buildBoxer + applyGear, the
 * same path the mirror uses) and shot twice — three-quarter front and
 * three-quarter back — so a piece that floats, clips into the body or
 * reads as nothing shows up at a glance. Uses the real GPU path in a
 * headless Chromium (swiftshader), no game boot.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'gear-gallery.png');
const only = process.argv[3] ? process.argv[3].split(',') : null;
// The accent the rig is lit in (hex, e.g. 4fb7ff) — the gear's GLOW takes it.
const accent = parseInt(process.argv[4] ?? process.env.GEAR_ACCENT ?? 'ff7a18', 16);

async function launch() {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/env-preview.html`, { waitUntil: 'load' }).catch(() => {});
// Warm the modules once: a cold dev server optimizes three.js on first
// import and reloads the page, which would kill the render below.
await page.evaluate(() => Promise.all([import('/src/avatar/gear.ts'), import('/src/avatar/boxer.ts')])).catch(() => {});
await page.waitForLoadState('load');
await page.waitForTimeout(1500);

const sheet = await page.evaluate(async ([only, accent]) => {
  document.body.innerHTML = '';
  const T = await import('/node_modules/.vite/deps/three.js');
  const B = await import('/src/avatar/boxer.ts');
  const G = await import('/src/avatar/gear.ts');
  const S = await import('/src/avatar/skins.ts');
  const CELL = 300;
  const ids = only ?? G.GEAR.map((g) => g.id);
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(CELL, CELL);
  const scene = new T.Scene();
  scene.background = new T.Color(0x2a2a32);
  scene.add(new T.HemisphereLight(0xffffff, 0x3a3a44, 2.0));
  const key = new T.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2.5, -2);
  scene.add(key);
  const rim = new T.DirectionalLight(0xbfd4ff, 0.8);
  rim.position.set(-2, 1.5, 2);
  scene.add(rim);
  const cam = new T.PerspectiveCamera(28, 1, 0.05, 10);
  const cols = 4;
  const rows = Math.ceil((ids.length * 2) / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const g2 = canvas.getContext('2d');
  let n = 0;
  for (const id of ids) {
    const def = G.gearDef(id);
    const rig = B.buildBoxer(0);
    const fig = new T.Group();
    for (const piece of rig.all) {
      piece.visible = true;
      fig.add(piece);
    }
    B.solveTorso(rig, new T.Vector3(0, 1.5, 0), new T.Quaternion(), 0, 0, new T.Vector3(), new T.Vector3(), undefined, true);
    rig.gloves[0].position.set(-0.2, 1.1, -0.26);
    rig.gloves[1].position.set(0.2, 1.1, -0.26);
    S.applyAvatarSkin(fig, S.resolveAvatarSkin('blank', 0));
    B.setAvatarAccent(fig, accent);
    G.applyGear(fig, [id], 'white');
    scene.add(fig);
    // Frame the slot: head pieces close on the head, hand pieces on the hands.
    // [x, y, z] to orbit, distance, the two yaws (0 = from the front).
    const focus =
      def?.slot === 'head' || def?.slot === 'face' ? [[0, 1.55, 0], 0.95, [0.6, Math.PI - 0.7]]
        : def?.slot === 'hands' ? [[0.2, 1.1, -0.26], 0.42, [0.9, 2.3]]
          : [[0, 1.25, 0], 1.7, [0.6, Math.PI - 0.7]];
    for (const yaw of focus[2]) {
      const [[fx, fy, fz], dist] = focus;
      cam.position.set(fx + Math.sin(yaw) * dist, fy + 0.12, fz - Math.cos(yaw) * dist);
      cam.lookAt(fx, fy, fz);
      renderer.render(scene, cam);
      const x = (n % cols) * CELL;
      const y = Math.floor(n / cols) * CELL;
      g2.drawImage(renderer.domElement, x, y);
      g2.fillStyle = 'rgba(0,0,0,0.55)';
      g2.fillRect(x, y, CELL, 26);
      g2.fillStyle = '#fff';
      g2.font = 'bold 15px sans-serif';
      g2.fillText(`${def?.name ?? id} · ${yaw === focus[2][0] ? 'front' : 'back'}`, x + 8, y + 18);
      n++;
    }
    scene.remove(fig);
  }
  return canvas.toDataURL('image/png');
}, [only, accent]);

writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
console.log(`wrote ${out}${errors.length ? ` — page errors: ${errors.join(' | ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
