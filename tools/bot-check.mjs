#!/usr/bin/env node
/**
 * THE BOT LADDER, headless.
 *
 *   npm run dev              # terminal 1
 *   node tools/bot-check.mjs
 *
 * Two stages:
 *
 *   1. THE LADDER (pure, via __ff2.bot): one row per rank, every number that
 *      should sharpen with rank does — monotonically, Bronze → Overlord —
 *      and the blend between rows is continuous (a promotion is a ramp, not
 *      a cliff). The MERCY ease bites below Diamond and never above it.
 *
 *   2. THE BOUT (live): with ONLY BOTS on, drop into a quick match and read
 *      the brain the BotSystem resolved — a fresh save spars the ROOKIE, a
 *      dev-forced skill of 1 spars the OVERLORD, and the bout panel names
 *      the grade. Then forfeit back to the lobby.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-certificate-errors'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log(`[pageerror] ${e.message}`);
});

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Tutorial done, a callsign claimed (or the keyboard pops first), ONLY BOTS
// on — so the quick match drops straight onto a bot.
await page.addInitScript(() => {
  localStorage.setItem('ff-tutorial-done', '1');
  localStorage.setItem('ff-player-name', 'PROBE');
  localStorage.setItem('ff-onlybots', '1');
});
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1000);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
await page.waitForFunction(() => !!window.__ff2?.bot, { timeout: 10000 });

console.log('=== the ladder: one row per rank, sharper every step ===');
const ladder = await page.evaluate(() => {
  const B = window.__ff2.bot;
  const out = { fails: [], rows: B.rows.length, tiers: B.tiers.length, labels: B.rows.map((r) => r.label) };
  const fail = (m) => out.fails.push(m);
  if (B.rows.length !== B.tiers.length) fail(`${B.rows.length} rows for ${B.tiers.length} tiers`);

  // Sharper with rank: these fall (slower → faster, sloppier → truer)…
  const falling = ['throwInterval', 'windup', 'aimError', 'aimLag', 'reactDelay', 'wrongWayChance', 'recallDelay'];
  // …and these rise.
  const rising = ['throwSpeed', 'lead', 'reactDistance', 'defendChance', 'blockChance', 'moveSpeed', 'duckSpeed', 'restless', 'roam', 'preDodge', 'punish', 'feint', 'doubleTap', 'readsHabits'];
  for (let i = 1; i < B.rows.length; i++) {
    const a = B.rows[i - 1];
    const b = B.rows[i];
    for (const k of falling) if (b[k] > a[k]) fail(`${k} rises ${a.label}→${b.label} (${a[k]}→${b[k]})`);
    for (const k of rising) if (b[k] < a[k]) fail(`${k} falls ${a.label}→${b.label} (${a[k]}→${b[k]})`);
  }
  // Every row's odds are odds.
  for (const r of B.rows) {
    for (const k of ['lead', 'defendChance', 'blockChance', 'wrongWayChance', 'roam', 'preDodge', 'punish', 'feint', 'doubleTap', 'readsHabits', 'lowAimChance']) {
      if (r[k] < 0 || r[k] > 1) fail(`${r.label}.${k} = ${r[k]} is not 0..1`);
    }
  }
  // The bot never outguns the player's own hardest throw (config: 8.5 m/s).
  for (const r of B.rows) if (r.throwSpeed >= 8.5) fail(`${r.label} throws faster than a haymaker`);

  // The blend: Bronze floor is the ROOKIE row exactly; the top of Overlord
  // is the OVERLORD row exactly; a promotion boundary is continuous.
  const eq = (x, y) => Math.abs(x - y) < 1e-6;
  const b0 = B.brainForXp(0);
  if (b0.label !== 'ROOKIE' || !eq(b0.throwInterval, B.rows[0].throwInterval)) fail('0 XP is not the ROOKIE row');
  const top = B.brainForXp(1e9);
  if (top.label !== 'OVERLORD' || !eq(top.throwInterval, B.rows.at(-1).throwInterval)) fail('max XP is not the OVERLORD row');
  for (let i = 1; i < B.tiers.length; i++) {
    const at = B.tiers[i].xp;
    const below = B.brainForXp(at - 1);
    const here = B.brainForXp(at);
    if (Math.abs(below.throwInterval - here.throwInterval) > 0.05) fail(`cliff at ${B.tiers[i].name}: ${below.throwInterval}→${here.throwInterval}`);
    if (here.grade !== B.tiers[i].name) fail(`brain at ${at} XP graded ${here.grade}, not ${B.tiers[i].name}`);
  }
  // Strictly sharper across the climb: skill is monotone in XP.
  let last = -1;
  for (let xp = 0; xp <= 10000; xp += 50) {
    const s = B.skillForXp(xp);
    if (s < last) fail(`skill falls at ${xp} XP`);
    last = s;
  }
  // MERCY: trailing on rounds eases a Bronze bot, never a Diamond one.
  if (!(B.mercyFor(0, 0, 2) > 0)) fail('no mercy for a Bronze player two rounds down');
  if (B.mercyFor(0, 2, 2) !== 0) fail('mercy while level on rounds');
  if (B.mercyFor(B.tiers[4].xp, 0, 2) !== 0) fail('mercy at DIAMOND');
  if (B.mercyFor(0, 0, 9) > 0.2 + 1e-9) fail('mercy uncapped');
  return out;
});
check('one brain per rank', ladder.rows === ladder.tiers, ladder.labels.join(' → '));
check('the ladder sharpens monotonically and blends without cliffs', ladder.fails.length === 0, ladder.fails.join('; '));

console.log('\n=== the bout: the brain the bout actually serves ===');
const act = (id) => page.evaluate((a) => window.__ff2.wrap.act(a), id);
await act('quick-match');
await page.waitForTimeout(1500);
let live = await page.evaluate(() => window.__ff2.bot.live());
check('a bot bout resolves a brain', !!live.brain, live.brain ? `${live.brain.label} · ${live.brain.grade} (skill ${live.brain.skill.toFixed(2)})` : 'none');
// A fresh save has no XP to speak of — the sparring partner is the ROOKIE
// (or, with a cloud profile loaded, whatever that XP earns: report it).
check('a fresh save spars the ROOKIE', !live.brain || live.brain.grade === 'BRONZE' || live.base > 0, `base ${live.base.toFixed(2)}`);
const modalStatus = await page.evaluate(() => window.__ff2.modals.status());
check('the bout panel names the grade', /grade$/.test(modalStatus), modalStatus);

await page.evaluate(() => window.__ff2.bot.force(1));
await page.waitForTimeout(300);
live = await page.evaluate(() => window.__ff2.bot.live());
check('forced to 1, the bout spars the OVERLORD', live.brain?.label === 'OVERLORD' && live.mercy === 0, `${live.brain?.label} mercy ${live.mercy}`);
await page.evaluate(() => window.__ff2.bot.force(0));
await page.waitForTimeout(300);
live = await page.evaluate(() => window.__ff2.bot.live());
check('forced to 0, the ROOKIE', live.brain?.label === 'ROOKIE', live.brain?.label);
// Let the OVERLORD fight the empty pad for a few seconds: it must throw
// (its cadence is 1.35 s; the round opens on a 3-2-1).
await page.evaluate(() => window.__ff2.bot.force(1));
const before = (await page.evaluate(() => window.__ff2.bot.live())).throws;
await page.waitForTimeout(8000);
live = await page.evaluate(() => window.__ff2.bot.live());
check('the bot throws', live.throws - before >= 2, `${live.throws - before} throws in 8 s`);
await page.evaluate(() => window.__ff2.bot.force(null));
check('no page errors through the bout', errors.length === 0, errors.join(' | '));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
