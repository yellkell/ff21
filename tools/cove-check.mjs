#!/usr/bin/env node
/**
 * THE COVE, headless — sundown on Tidewater's beach.
 *
 *   npm run dev              # terminal 1
 *   node tools/cove-check.mjs [--shots] [name-prefix]
 *
 * Renders env-preview.html?env=cove from the arena, the shore, the fires
 * and the hills, asserting every view bakes its sky and draws without a
 * page error; --shots saves the frames beside this script. `t=` freezes
 * the surf so shots are repeatable. The sky bake is a raymarch: run it on
 * a real GPU (the flags below ask Chromium for one) — SwiftShader takes
 * minutes.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const shots = process.argv.includes('--shots');
const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const here = dirname(fileURLToPath(import.meta.url));

const VIEWS = [
  ['front', 'yaw=0&pitch=-0.06&t=3'],
  ['sun', 'yaw=-0.49&pitch=-0.03&t=3'],
  ['cliff', 'yaw=-1.25&pitch=0.05&t=3'],
  ['left', 'yaw=0.95&pitch=-0.02&t=3'],
  ['back', 'yaw=3.14&pitch=0.12&t=3'],
  ['raid', 'raid=1&yaw=0&pitch=-0.05&t=3'],
  ['shore', 'cam=6,1.6,-20&look=10,-1.2,-34&t=2'],
  ['fire', 'cam=-60,1.4,-19&look=-66,0.6,-24&t=3'],
  ['party', 'cam=-58,1.7,-10&look=-66,1,-24&t=3.4'],
  ['torches', 'yaw=1.6&pitch=-0.08&t=3'],
  ['torches-back', 'yaw=2.6&pitch=-0.05&t=3'],
  ['drift', 'yaw=0.4&pitch=0.9&t=40'],
  ['hills', 'cam=0,30,-60&look=0,40,300&t=3'],
  ['aerial', 'cam=0,40,60&look=0,0,-120&t=3'],
];

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('=== THE COVE ===');
for (const [name, q] of VIEWS) {
  if (only && !name.startsWith(only)) continue;
  const errors = [];
  const onErr = (e) => errors.push(e.message);
  page.on('pageerror', onErr);
  await page.goto(`${base}/env-preview.html?env=cove&${q}`, { waitUntil: 'load', timeout: 60000 });
  const ready = await page
    .waitForFunction(() => document.title === 'preview-ready', { timeout: 180000 })
    .then(() => true, () => false);
  page.off('pageerror', onErr);
  check(`${name} renders`, ready && errors.length === 0, errors[0] ?? (ready ? '' : 'never ready'));
  if (shots && ready) {
    const file = join(here, `cove-${name}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
}
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
