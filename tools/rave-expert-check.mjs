/**
 * RAVE RAID IS EXPERT ONLY (off the tour), headless.
 *
 *   npm run dev              # terminal 1
 *   node tools/rave-expert-check.mjs [--shots]
 *
 * Boots rave.html, enters, and checks through the dev hook (window.__gdr):
 * a fresh headset starts on EXPERT even with an old picker choice saved; the
 * solo board offers one EXPERT plate and none of the four difficulty
 * buttons; a solo set runs EXPERT; a tour night still runs its own floor
 * (EASY / NORMAL / HARD by set) and leaving it hands EXPERT back. --shots
 * saves the solo board beside this script. (The club desk only draws inside
 * a club room, which needs the pub relay — not covered here; it carries the
 * same single EXPERT plate.)
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const here = dirname(fileURLToPath(import.meta.url));
const shots = process.argv.includes('--shots');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('ff-player-name', 'PROBE-ONE');
  // An old picker choice, from before EXPERT-only: it must not stick.
  localStorage.setItem('gdr-diff', '1');
});
await page.goto(`${base}/rave.html`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(`${base}/rave.html`));
await page.waitForTimeout(1500);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
await page.waitForFunction(() => !!window.__gdr, { timeout: 30000 });
await page.waitForTimeout(2000);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
};
const diff = () => page.evaluate(() => window.__gdr.match.difficulty);

console.log('\n=== the solo board ===');
check('a fresh headset is on EXPERT (an old saved NORMAL ignored)', (await diff()) === 3, await diff());
await page.evaluate(() => window.__gdr.menu.act('tab-play')); // the SOLO shelf (the board opens on the tour)
await page.waitForFunction(() => window.__gdr.match.screen === 'lobby', { timeout: 10000 }).catch(() => {});
// The board repaints on its own (slow, software-rendered) frames: wait for the solo shelf's own buttons.
await page.waitForFunction(() => window.__gdr.menu.boardButtons().some((b) => b.startsWith('song:')), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(500);
console.log('  (screen:', await page.evaluate(() => window.__gdr.match.screen) + ')');
const buttons = await page.evaluate(() => window.__gdr.menu.boardButtons());
check('the board offers the EXPERT plate', buttons.includes('expert'));
check('…and none of the four difficulty buttons', !buttons.some((b) => /^diff\d$/.test(b)), buttons.filter((b) => /^diff/.test(b)).join(',') || 'none');
await page.evaluate(() => window.__gdr.menu.act('expert'));
check('tapping the plate changes nothing', (await diff()) === 3);
if (shots) {
  const png = await page.evaluate(() => window.__gdr.menu.snapBoard());
  writeFileSync(join(here, 'rave-expert-board.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('  shot: tools/rave-expert-board.png');
}

console.log('\n=== a solo set ===');
await page.evaluate(() => window.__gdr.startRaid({ seats: 4 }));
await page.waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 40000 }).catch(() => {});
check('a solo set runs EXPERT', (await diff()) === 3, await diff());
await page.evaluate(() => window.__gdr.toLobby());
await page.waitForTimeout(500);

console.log('\n=== the tour keeps its ramp ===');
for (const set of [0, 1, 2]) {
  await page.evaluate((s) => window.__gdr.startRaid({ seats: 4, tour: { set: s, song: 0 } }), set);
  await page.waitForTimeout(400);
  check(`tour set ${set + 1} runs ${['EASY', 'NORMAL', 'HARD'][set]}`, (await diff()) === set, await diff());
  await page.evaluate(() => window.__gdr.toLobby());
  await page.waitForTimeout(400);
  check(`…and leaving it hands EXPERT back`, (await diff()) === 3, await diff());
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `${failed} FAILURE(S)` : 'ALL PASS'}`);
process.exit(failed ? 1 : 0);
