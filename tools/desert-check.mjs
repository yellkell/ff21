#!/usr/bin/env node
/**
 * THE SITES, headless — the desert's three clearings.
 *
 *   npm run dev              # terminal 1
 *   node tools/desert-check.mjs [--shots]
 *
 * Renders env-preview.html (the dev harness) for each desert site from a
 * few headings, asserting every one builds and draws without a page error,
 * and (--shots) saving the frames beside this script: the trailhead's fire
 * and windmill, the flats' dead tree and ribs, the boneyard's plate ring
 * and drums around the raid arc.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const shots = process.argv.includes('--shots');
const here = dirname(fileURLToPath(import.meta.url));

async function launch() {
  const args = ['--ignore-certificate-errors'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const VIEWS = [
  ['trailhead-front', 'site=trailhead&yaw=0'],
  ['trailhead-left', 'site=trailhead&yaw=1.05&pitch=0.02'],
  ['trailhead-right', 'site=trailhead&yaw=-1.0'],
  ['flats-front', 'site=flats&yaw=0'],
  ['flats-left', 'site=flats&yaw=1.0'],
  ['flats-right', 'site=flats&yaw=-1.0'],
  ['boneyard-front', 'site=boneyard&yaw=0&raid=1'],
  ['boneyard-left', 'site=boneyard&yaw=1.1&raid=1'],
  ['boneyard-right', 'site=boneyard&yaw=-1.1&raid=1'],
  // THE FAR RAIDER'S SPOT: from the origin (where every client stands),
  // the teammate on the far side of the pit is at bearing ±144° around
  // it, (±3.5, −10.9). Nothing may stand up behind that platform.
  ['boneyard-far-left', 'site=boneyard&raid=1&cam=0,1.6,0&look=-3.5,0.8,-10.9'],
  ['boneyard-far-right', 'site=boneyard&raid=1&cam=0,1.6,0&look=3.5,0.8,-10.9'],
  // The close-ups: a cactus, a boulder, a mesa foot.
  ['flats-saguaro', 'site=flats&focus=saguaro&dist=5&h=1.4&lookY=1.8'],
  ['flats-boulder', 'site=flats&focus=boulders&inst=0&dist=5&h=1.5&lookY=0.6'],
  ['flats-mesa', 'site=flats&focus=mesas&inst=0&dist=40&h=1.6&lookY=12'],
];

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('=== the sites: trailhead / flats / boneyard ===');
for (const [name, q] of VIEWS) {
  const errors = [];
  const onErr = (e) => errors.push(e.message);
  page.on('pageerror', onErr);
  await page.goto(`${base}/env-preview.html?env=desert&${q}`, { waitUntil: 'load', timeout: 60000 });
  const ready = await page
    .waitForFunction(() => document.title === 'preview-ready', { timeout: 60000 })
    .then(() => true, () => false);
  page.off('pageerror', onErr);
  check(`${name} renders`, ready && errors.length === 0, errors[0] ?? '');
  if (shots && ready) {
    const file = join(here, `desert-${name}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
}

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
