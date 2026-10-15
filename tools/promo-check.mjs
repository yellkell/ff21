#!/usr/bin/env node
/**
 * THE PROMOTION, headless.
 *
 *   npm run dev              # terminal 1
 *   node tools/promo-check.mjs [--from 2] [--to 3]
 *
 * Boots the game in headless Chromium (the IWSDK dev plugin's IWER emulator
 * provides WebXR), sits through the six-second boot intro, then plays the
 * rank-up celebration through its dev hook (window.__ff2.promo) and saves
 * the real rendered frame at four beats: the charge, the burst, the proud
 * hold, and the fade. It shoots the run TWICE — once with the backing plate
 * off, once with it on — so the two sit side by side.
 *
 * A caveat worth knowing when you read the pictures: the emulator hands us a
 * VR session, so the backdrop here is the desert town, not the passthrough
 * feed the headset actually puts behind this FX. The desert is a fair
 * stand-in for luminance (it is bright, warm and busy, which is the problem
 * a lit room poses too) but it is a stand-in, not a camera frame.
 */

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const FROM = Number(arg('from', 2));
const TO = Number(arg('to', 3));

/** The boot intro is two 3s cards and is deliberately not skippable. */
const INTRO_MS = 8500;

// The beats worth a picture, in seconds into the run. CHARGE ends at 0.8 and
// the hold runs to 4.4: mid-charge, just past the burst, deep in the hold,
// and into the fade.
const BEATS = [0.55, 0.95, 2.4, 4.9];

async function launch() {
  const args = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--ignore-certificate-errors',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=d3d11',
  ];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

// The emulator's DOM furniture (pose panel, toolbar, the two controller
// panels) is anchored to the corners and cannot be hidden — hiding it stops
// the emulator rendering — so we shoot the clean middle of the view instead.
const CLIP = { x: 340, y: 90, width: 600, height: 620 };
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
await page.waitForTimeout(INTRO_MS);

if (!(await page.evaluate(() => Boolean(window.__ff2?.promo)))) {
  console.log('no __ff2.promo hook — is this build current?');
  await browser.close();
  process.exit(1);
}

for (const withPlate of [false, true]) {
  const tag = withPlate ? 'promo-plate' : 'promo-noplate';
  await page.evaluate((on) => window.__ff2.promo.plate(on), withPlate);
  await page.evaluate(([f, t]) => window.__ff2.promo.play(f, t), [FROM, TO]);
  for (const beat of BEATS) {
    // The FX runs on the render loop's own clock; wait for it to reach the beat.
    await page
      .waitForFunction((b) => (window.__ff2.promo.at() ?? -1) >= b, beat, { timeout: 15000 })
      .catch(() => {});
    const at = await page.evaluate(() => window.__ff2.promo.at());
    const file = join(here, `${tag}-${beat.toFixed(2).replace('.', '_')}.png`);
    await page.screenshot({ path: file, clip: CLIP });
    console.log(`wrote ${file}  (t=${Number(at).toFixed(2)}s)`);
  }
  // Let the run finish before the next one starts from a clean slate.
  await page.waitForFunction(() => !window.__ff2.promo.playing(), { timeout: 15000 }).catch(() => {});
}
console.log(`done — tier ${FROM} → ${TO}, plate off and on`);
await browser.close();
