#!/usr/bin/env node
/**
 * THE MOVE GRAMMAR, headless — RAVE RAID's vocabulary in a titan bout.
 *
 *   npm run dev              # terminal 1
 *   node tools/grammar-check.mjs [--shots]
 *
 * Two stages:
 *
 *   1. THE GRAMMAR (pure, via __ff2.grammar): seeded determinism, deck
 *      bounds, the shapes' own laws (a recital's moves never repeat, its
 *      holds always do, every
 *      wave turns, the trap's jaws oppose, twins alternate), the verb law
 *      (never the same move twice), THE FLOOR MANAGER's evict test, and
 *      the judge (gaps safe, rims deadly, corners must be committed).
 *
 *   2. THE BOUT (live, via __ff2.titan): launch RUSTHOOK — the scrapyard
 *      titan that learned the gate — and FORCE each grammar move through
 *      the real buildAttack path, asserting the zones that land, the
 *      GESTURE the body makes mid-read (each shape a different silhouette,
 *      arms well off their rest pivots) and (--shots) saving a screenshot
 *      of each telegraph + windup on the deck.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const shots = process.argv.includes('--shots');
const here = dirname(fileURLToPath(import.meta.url));

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

// Tutorial done — stage I (RUSTHOOK) is open from a fresh save.
await page.addInitScript(() => {
  localStorage.setItem('ff-tutorial-done', '1');
});
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1000);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
await page.waitForFunction(() => !!window.__ff2?.grammar, { timeout: 10000 });

console.log('=== the grammar: seeded, lawful, judged ===');
const g = await page.evaluate(() => {
  const G = window.__ff2.grammar;
  const out = { fails: [] };
  const fail = (m) => out.fails.push(m);

  // Determinism: the same seed builds the identical move, byte for byte.
  for (const kind of G.kinds) {
    if (JSON.stringify(G.build(kind, 42)) !== JSON.stringify(G.build(kind, 42))) fail(`${kind}: not deterministic`);
  }
  // Deck bounds, thirty seeds a kind, at the hardest act.
  for (const kind of G.kinds) {
    for (let s = 1; s <= 30; s++) {
      const landings = G.build(kind, s, { act: 4, expert: true, swept: true });
      if (!landings.length) fail(`${kind}#${s}: empty move`);
      for (const l of landings) if (!G.onDeck(l.zone)) fail(`${kind}#${s}: zone off deck ${JSON.stringify(l.zone)}`);
    }
  }
  // THE RECITAL: a MOVE never repeats the corner before it, a HOLD always
  // does, holds never run in pairs, the first step is a move, and act 4
  // asks for five steps.
  for (let s = 1; s <= 40; s++) {
    const landings = G.build('recital', s, { act: 4 });
    const quads = landings.filter((l) => l.zone.kind === 'quad').map((l) => l.zone);
    if (quads.length !== 5) fail(`recital#${s}: act 4 wants 5 steps, got ${quads.length}`);
    if (quads[0]?.hold) fail(`recital#${s}: opens on a hold`);
    for (let i = 1; i < quads.length; i++) {
      const same = quads[i].corner === quads[i - 1].corner;
      if (quads[i].hold && !same) fail(`recital#${s}: a hold moved`);
      if (!quads[i].hold && same) fail(`recital#${s}: a move stayed`);
      if (quads[i].hold && quads[i - 1].hold) fail(`recital#${s}: two holds running`);
      if (quads[i].pattern !== quads[0].pattern) fail(`recital#${s}: steps carry different patterns`);
    }
  }
  // EVERY wave turns: at least six strikes, marching in time.
  {
    const landings = G.build('wave', 3, { act: 3 });
    if (landings.length < 6) fail(`wave doesn't turn (${landings.length} strikes)`);
    for (let i = 1; i < landings.length; i++) {
      if (landings[i].delay <= landings[i - 1].delay) fail('wave march out of order');
    }
  }
  // THE TRAP's jaws land together on opposite sides; hunt a seed that rolls it.
  {
    let found = false;
    for (let s = 1; s <= 60 && !found; s++) {
      const rails = G.build('cross', s, { act: 3 }).filter((l) => l.zone.kind === 'rail');
      if (rails.length === 2 && rails[0].delay === rails[1].delay && rails[0].zone.z * rails[1].zone.z < 0) found = true;
    }
    if (!found) fail('no trap in 60 seeds at act 3');
  }
  // The twin BOUNCE alternates sides, a fixed gap apart (act 3 = a promise).
  {
    let checked = false;
    for (let s = 1; s <= 80 && !checked; s++) {
      const lanes = G.build('lanes', s, { act: 3 }).filter((l) => l.zone.kind === 'lane' && !l.zone.yaw);
      const delays = [...new Set(lanes.map((l) => l.delay))].sort((a, b) => a - b);
      if (lanes.length === 6 && delays.length === 3) {
        checked = true;
        const sideAt = (d) => Math.sign(lanes.find((l) => l.delay === d).zone.x);
        if (sideAt(delays[0]) === sideAt(delays[1]) || sideAt(delays[1]) === sideAt(delays[2])) fail('twin bounce fails to alternate');
        if (Math.abs(delays[1] - delays[0] - 2.0) > 1e-6) fail(`twin return gap ${delays[1] - delays[0]} ≠ 2.0s at beat 0.5`);
      }
    }
    if (!checked) fail('no 3-volley twin rally in 80 seeds at act 3');
  }
  // The donut's one-two: the ring closes AFTER the opening laser.
  {
    let found = false;
    for (let s = 1; s <= 40 && !found; s++) {
      const landings = G.build('donut', s, { act: 2 });
      const lane = landings.find((l) => l.zone.kind === 'lane');
      const ring = landings.find((l) => l.zone.kind === 'ring');
      if (lane && ring) {
        found = true;
        if (ring.delay <= lane.delay) fail('donut ring lands before its opening laser');
      }
    }
    if (!found) fail('no opened donut in 40 seeds');
  }
  // The VERB law: three hundred sequential picks, never the same move twice.
  {
    const entries = G.kinds.map((k) => [k, 2]);
    let last = null;
    for (let i = 0; i < 300; i++) {
      const k = G.pick(1000 + i, entries, last);
      if (k === last) fail(`pick repeated ${k} at ${i}`);
      last = k;
    }
  }
  // THE FLOOR MANAGER: a gate whose gap sits ON the park asks for nothing.
  {
    const gate = [{ delay: 0, zone: { kind: 'gate', at: 0.4, half: 0.3, axis: 0 } }];
    if (G.evicts(gate, { x: 0.4, z: 0 })) fail('gate over the park should not evict');
    if (!G.evicts(gate, { x: -0.4, z: 0 })) fail('gate away from the park must evict');
  }
  // The judge: gaps live, rims kill, corners demand commitment.
  {
    const gate = { kind: 'gate', at: 0.4, half: 0.3, axis: 0 };
    if (G.hit(gate, 0.4, 0)) fail('judge: standing in the gate gap must be safe');
    if (!G.hit(gate, -0.5, 0)) fail('judge: outside the gate gap must burn');
    const ring = { kind: 'ring', innerR: 0.42 };
    if (G.hit(ring, 0, 0)) fail('judge: donut centre must be safe');
    if (!G.hit(ring, 0.7, 0)) fail('judge: donut rim must burn');
    const quad = { kind: 'quad', corner: 3, step: 0, hold: false, pattern: [3], holds: [false] };
    if (G.hit(quad, 0.4, 0.4)) fail('judge: the taught corner must be safe');
    if (!G.hit(quad, 0, 0, 0)) fail('judge: loitering at centre must burn');
    const armX = { kind: 'lane', x: 0, halfW: 0.14, yaw: Math.PI / 4 };
    const armY = { kind: 'lane', x: 0, halfW: 0.14, yaw: -Math.PI / 4 };
    if (G.hit(armX, 0.55, 0, 0.1) && G.hit(armY, 0.55, 0, 0.1)) fail('judge: the X pocket must clear one arm');
    if (!G.hit(armX, 0, 0)) fail('judge: the X knot must burn');
    // The park chain: the donut hauls you to centre, the recital to a corner.
    const donutPark = G.park('donut', [{ delay: 0, zone: ring }], { x: 0.5, z: 0.3 });
    if (donutPark.x !== 0 || donutPark.z !== 0) fail('donut must park at centre');
  }
  return out;
});
check('the grammar obeys its laws', g.fails.length === 0, g.fails.slice(0, 4).join(' | '));

console.log('\n=== the bout: RUSTHOOK, forced through the vocabulary ===');
const act = (id) => page.evaluate((a) => window.__ff2.wrap.act(a), id);
await act('campaign-0');
// The titan hook installs at bout start (the wrap owns __ff2 in the lobby).
const fighting = await page
  .waitForFunction(() => window.__ff2.titan?.phase() === 'fight', { timeout: 40000 })
  .then(() => true, () => false);
const bossName = await page.evaluate(() => window.__ff2.titan.boss());
check('stage I launches into a fight', fighting, `phase wait; boss=${bossName}`);
check('RUSTHOOK takes the pit, grammar learned', bossName === 'RUSTHOOK', bossName);
const learned = await page.evaluate(() => window.__ff2.titan.moves());
// The titan's clock is frozen and STEPPED at a fixed 60 Hz from here on: a
// GPU-less runner renders a frame every few seconds, and a wall-clock wait
// let whole moves land (or never start) between two looks.
await page.evaluate(() => {
  window.__ff2.titan.hold(true);
  window.__ff2.titan.freeze(true);
});
const step = (secs) => page.evaluate((n) => window.__ff2.titan.step(1 / 60, n), Math.round(secs * 60));
check('the scrapyard knows the gate', learned.includes('gate') && learned.includes('lanes'), learned.join(','));

const EXPECT = {
  gate: ['gate'],
  lanes: ['lane'],
  donut: ['ring'],
  cross: ['rail'],
  wave: ['lane', 'rail'],
  recital: ['quad'],
  duckdonut: ['sweep', 'ring'],
};
// The gesture each shape should make (campaign/gestures.ts), read off the
// next pending landing — the duckdonut opens with its blade, the wave with
// the march.
const GESTURE = {
  gate: 'press',
  lanes: 'point',
  donut: 'ring',
  cross: 'scissor',
  wave: 'march',
  recital: 'teach',
  duckdonut: 'blade',
};
const silhouettes = {};
for (const [kind, wants] of Object.entries(EXPECT)) {
  await page.evaluate(() => window.__ff2.titan.heal());
  // Let the last move play out before forcing the next.
  await page.evaluate(() => {
    for (let f = 0; f < 900 && window.__ff2.titan.kind(); f++) window.__ff2.titan.step(1 / 60);
  });
  const forced = await page.evaluate((k) => window.__ff2.titan.force(k, 11), kind);
  const zones = await page.evaluate(() => window.__ff2.titan.zones());
  const ok = forced && zones.length > 0 && wants.some((w) => zones.includes(w));
  check(`${kind}: builds and marks the deck`, ok, zones.join(','));
  // Mid-read: the telegraph is lit and the arms are up. Sampled short of
  // the shortest charge (RUSTHOOK reads in ~1.4 s) but past the first third
  // of the read — at 0.7 s the donut's opening point had only lifted 0.33
  // rad, under the 0.35 bar, on a stepped clock that no longer gets the
  // extra slack a slow real frame used to add.
  await step(1.0);
  const pose = await page.evaluate(() => window.__ff2.titan.pose());
  // Some shapes point ONE arm; the donut's opening lane is a point too, so
  // only the shape family is asserted, not the exact zone.
  const shapeOk = !!pose && (pose.shape === GESTURE[kind] || (kind === 'donut' && pose.shape === 'point'));
  const reach = pose ? Math.max(...pose.arms.map(([x, z]) => Math.abs(x) + Math.abs(z))) : 0;
  check(`${kind}: the body makes the ${GESTURE[kind]}`, shapeOk && reach > 0.35, `shape=${pose?.shape} fill=${pose?.fill?.toFixed(2)} reach=${reach.toFixed(2)}`);
  if (pose) silhouettes[kind] = pose.arms.flat();
  if (shots) {
    await page.waitForTimeout(2500); // one real frame to draw the frozen pose
    const file = join(here, `grammar-${kind}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
  await step(0.25);
}
// Every shape a DIFFERENT silhouette: no two windups within 0.4 rad (L1
// over both arms' pitch + yaw) of each other — readable at a glance.
{
  const names = Object.keys(silhouettes);
  let closest = Infinity;
  let pair = '';
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = silhouettes[names[i]];
      const b = silhouettes[names[j]];
      const d = a.reduce((acc, v, k) => acc + Math.abs(v - b[k]), 0);
      if (d < closest) {
        closest = d;
        pair = `${names[i]}~${names[j]}`;
      }
    }
  }
  check('seven shapes, seven silhouettes', names.length === 7 && closest > 0.4, `closest ${pair} at ${closest.toFixed(2)}`);
}

check('no page errors along the way', errors.length === 0, errors.join(' | '));

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
