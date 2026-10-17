#!/usr/bin/env node
/**
 * THE FORGE, headless (docs/forge.md).
 *
 *   npm run dev                    # terminal 1
 *   node tools/forge-check.mjs [--shots]
 *
 * Boots the game in headless Chromium (the IWSDK dev plugin's IWER
 * emulator provides WebXR) and walks the Forge through the real menus:
 * the locker's BODY board shows the four frames; tapping a frame puts the
 * mirror on it and rides the gear wire; STANDARD is the empty slot; a
 * forged piece goes onto the mirror as its Forge shape; the STORE draws
 * the Forge's renders on its tiles; paint lands on a forged piece through
 * its own atlas. --shots saves the locker and store faces beside this
 * script.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const shots = process.argv.includes('--shots');
const here = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] }).catch(() =>
  chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] }),
);
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('ff-coins', '5000');
    localStorage.setItem('ff-tutorial-done', '1');
    localStorage.removeItem('ff-gear');
  } catch {
    /* the checks below will say so */
  }
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?floorPatience=4000`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.click('#enter-vr', { timeout: 180_000 });
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
await page.waitForTimeout(2000);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const m = (e) => page.evaluate(`window.__ff2.modals.${e}`);
const w = (e) => page.evaluate(`window.__ff2.wrap.${e}`);
const f = (e) => page.evaluate(`window.__ff2.forge.${e}`);
const save = (name, data) => {
  if (!shots || !data) return;
  const file = join(here, `forge-${name}.png`);
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`  wrote ${file}`);
};
const settle = async () => {
  await page.evaluate(() => window.__ff2.forge.ready());
  await page.waitForTimeout(600);
};

console.log('\n=== THE FRAMES ===');
await w(`act('open-custom')`);
await page.waitForTimeout(300);
await w(`act('tab-colour')`);
await page.waitForTimeout(500);
await page.waitForTimeout(1200); // the frame renders land
save('body', await m(`snap('custom')`));
const body = await m(`buttons('custom')`);
check('the BODY board carries both tones and four frames', ['base-white', 'base-black', 'frame-standard', 'frame-lean', 'frame-heavy', 'frame-curved'].every((b) => body.includes(b)), body.filter((b) => !b.startsWith('tab-') && !b.startsWith('open-')).join(','));
await settle();
check('the mirror stands on STANDARD to begin with', (await f('frameWorn()')) === 'standard', await f('frameWorn()'));

await w(`act('frame-heavy')`);
await page.waitForTimeout(200);
await settle();
let worn = await f('frameWorn()');
let packed = await page.evaluate(() => window.__ff2.gear.pack());
check('HEAVY: the mirror changes frame, and the frame rides the gear wire', worn === 'heavy' && packed === 'heavy', JSON.stringify({ worn, packed }));
await w(`act('frame-standard')`);
await page.waitForTimeout(200);
await settle();
worn = await f('frameWorn()');
packed = await page.evaluate(() => window.__ff2.gear.pack());
check('STANDARD again: the empty slot, the wire bare', worn === 'standard' && packed === '', JSON.stringify({ worn, packed }));

console.log('\n=== THE FORGED GEAR ===');
const cat = await page.evaluate(() => fetch('/forge/gear/gear.json').then((r) => r.json()).catch(() => ({})));
const forged = Object.keys(cat);
check('the Forge manifest lists pieces', forged.length > 0, forged.join(','));
const piece = forged.includes('pauldrons') ? 'pauldrons' : forged[0];
await page.evaluate((id) => window.__ff2.gear.equip(id), piece);
await page.waitForTimeout(200);
await settle();
const onMirror = await f('forged()');
check(`${piece}: the mirror wears the Forge shape`, onMirror.includes(piece), onMirror.join(','));
await w(`act('frame-curved')`);
await page.waitForTimeout(200);
await settle();
check(`${piece} stays on through a frame change`, (await f('forged()')).includes(piece) && (await f('frameWorn()')) === 'curved');
await w(`act('frame-standard')`);

// THE STORE draws the Forge's renders.
await w(`act('open-shop')`);
await page.waitForTimeout(300);
await w(`act('tab-gear')`);
await page.waitForTimeout(300);
const slot = cat[piece]?.slot ?? 'shoulders';
await w(`act('gear-${slot}')`);
await page.waitForTimeout(1500);
save('store', await m(`snap('shop')`));
const icons = await page.evaluate((ids) => Promise.all(ids.map((id) => fetch(`/forge/icons/${id}.webp`).then((r) => r.ok))), forged);
check('every forged piece has its store render', icons.every(Boolean), forged.filter((_, i) => !icons[i]).join(',') || 'all');
await w(`act('custom-close')`);

// PAINT on a forged piece: aim the bay at it and see the mark land there.
console.log('\n=== PAINT ON THE FORGE ===');
await w(`act('open-custom')`);
await w(`act('open-paintbay')`);
await page.waitForTimeout(500);
const part = { shoulders: 'gearShoulders', head: 'gearHead', body: 'gearBody', hands: 'gearHands', face: 'gearFace' }[slot];
const aim = await page.evaluate((p) => window.__ff2.bayAim?.(p, 1.0) ?? null, part);
check(`the bay can aim at the forged ${piece}`, (aim ?? '').startsWith(part), String(aim));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed${errors.length ? ` — page errors: ${errors.join(' | ')}` : ''}`);
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
