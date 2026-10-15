#!/usr/bin/env node
/**
 * THE DELIVERY, headless — the titan throws the hit.
 *
 *   npm run dev              # terminal 1
 *   node tools/delivery-check.mjs [--shots]
 *
 * Two bouts, RUSTHOOK and GOOPLIATH. In each, the boss's own picks are held
 * and each floor attack is FORCED through the real buildAttack path, then
 * watched frame by frame on a frozen, stepped clock:
 *
 *   - no read shows before its turn: a cascade's later steps stay hidden
 *     until their window opens, from the very first frame (THE WAVE used
 *     to flash every beam at once as the move began);
 *   - a bolt is thrown for every kind that has one, and it LEAVES A FIST
 *     (its launch point is a gauntlet — or the gel's fist — not the deck);
 *   - every thrown impact point BURNS under its zone's own law: a throw may
 *     confirm the read, never land on safe ground;
 *   - the body STEPS IN behind the throw (the lunge), sweeps included;
 *   - GOOPLIATH throws NOTHING: his blows are his body heaving at the
 *     deck — the seesaw rocks him one way, then the other, on its beats;
 *   - nothing is left in flight once the attack resolves;
 *   - (--shots) a screenshot mid-flight for each kind.
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

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * One bout: open the page, run `acts` through the menu, and force each kind
 * in `kinds` (kind → does it throw a bolt?) while watching the delivery.
 */
async function bout(browser, label, acts, boss, kinds) {
  console.log(`\n=== ${label} ===`);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log(`[pageerror] ${e.message}`);
  });
  await page.addInitScript(() => {
    localStorage.setItem('ff-tutorial-done', '1');
  });
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
  await page.waitForFunction(() => !!window.__ff2?.wrap, { timeout: 10000 });
  for (const a of acts) await page.evaluate((a) => window.__ff2.wrap.act(a), a);
  const fighting = await page
    .waitForFunction(() => window.__ff2.titan?.phase() === 'fight', { timeout: 60000 })
    .then(() => true, () => false);
  const name = fighting ? await page.evaluate(() => window.__ff2.titan.boss()) : null;
  check(`${boss} takes the pit and fights`, fighting && name === boss, `boss=${name}`);
  if (!fighting) {
    await page.close();
    return;
  }
  // A GPU-less runner renders a frame every few seconds, so the boss's
  // clock is frozen and stepped from inside the page at a fixed 60 Hz:
  // each kind is one deterministic run, watched every frame.
  await page.evaluate(() => {
    window.__ff2.titan.hold(true);
    window.__ff2.titan.freeze(true);
  });

  /** Step until the attack ends (or the first bolt); fold stats as we go. */
  const run = (stopAtFirstBolt) =>
    page.evaluate((stopAtFirstBolt) => {
      const T = window.__ff2.titan;
      const out = { sawBolt: false, firstFromFist: Infinity, maxLunge: 0, impactsBurn: null, done: false, peakBolts: 0, early: 0, minX: 0, maxX: 0 };
      // The fists as they stood going INTO each frame — a throw samples the
      // fist before that frame's swing moves it.
      let fists = T.delivery().fists;
      for (let f = 0; f < 1500; f++) {
        if (!T.kind()) {
          out.done = true;
          break;
        }
        T.step(1 / 60);
        const d = T.delivery();
        if (out.impactsBurn === null && d.impactsBurn.length) out.impactsBurn = d.impactsBurn;
        out.maxLunge = Math.max(out.maxLunge, d.lunge);
        out.peakBolts = Math.max(out.peakBolts, d.bolts.length);
        out.early = Math.max(out.early, d.early);
        out.minX = Math.min(out.minX, d.step[0]);
        out.maxX = Math.max(out.maxX, d.step[0]);
        if (d.origins.length && !out.sawBolt) {
          out.sawBolt = true;
          for (const o of d.origins) {
            for (const fi of fists) {
              out.firstFromFist = Math.min(out.firstFromFist, Math.hypot(o[0] - fi[0], o[1] - fi[1], o[2] - fi[2]));
            }
          }
          if (stopAtFirstBolt) break;
        }
        fists = d.fists;
      }
      return out;
    }, stopAtFirstBolt);

  for (const [kind, throws] of Object.entries(kinds)) {
    await page.evaluate(() => window.__ff2.titan.heal());
    // Let the last move play out before forcing the next.
    await page.evaluate(() => {
      for (let f = 0; f < 1500 && window.__ff2.titan.kind(); f++) window.__ff2.titan.step(1 / 60);
    });
    const forced = await page.evaluate((k) => window.__ff2.titan.force(k, 7), kind);
    if (!forced) {
      check(`${kind}: forced`, false, 'boss not fighting');
      continue;
    }
    // Before a single frame has run — what the headset draws right now.
    const atBuild = await page.evaluate(() => window.__ff2.titan.delivery().early);
    const a = await run(shots);
    if (shots && a.sawBolt) {
      // Let the bolt get a third of the way out, then look.
      await page.evaluate(() => window.__ff2.titan.step(1 / 60, 7));
      await page.waitForTimeout(2500); // one real frame to draw it
      const file = join(here, `delivery-${boss.toLowerCase()}-${kind}.png`);
      writeFileSync(file, await page.screenshot());
      console.log(`  wrote ${file}`);
    }
    const b = a.done ? a : await run(false);
    const sawBolt = a.sawBolt || b.sawBolt;
    const firstFromFist = a.sawBolt ? a.firstFromFist : b.firstFromFist;
    const impactsBurn = a.impactsBurn ?? b.impactsBurn;
    const after = await page.evaluate(() => window.__ff2.titan.delivery());
    check(`${kind}: no read shows before its turn`, atBuild === 0 && a.early === 0 && b.early === 0, `at build ${atBuild}, later ${Math.max(a.early, b.early)}`);
    if (throws) {
      check(`${kind}: a bolt is thrown`, sawBolt, `peak ${Math.max(a.peakBolts, b.peakBolts)} in flight`);
      check(`${kind}: it leaves a fist`, firstFromFist < 0.05, `launched ${firstFromFist.toFixed(3)} m from a fist`);
      check(
        `${kind}: every impact lands in the danger`,
        !!impactsBurn && impactsBurn.length > 0 && impactsBurn.every(Boolean),
        JSON.stringify(impactsBurn),
      );
    } else {
      check(`${kind}: nothing thrown (the blow is the ${boss === 'GOOPLIATH' ? 'body' : 'arm'})`, !sawBolt);
    }
    if (kind === 'seesaw' && boss === 'GOOPLIATH') {
      const minX = Math.min(a.minX, b.minX);
      const maxX = Math.max(a.maxX, b.maxX);
      check('seesaw: he heaves one way, then the other, with the floods', minX < -0.1 && maxX > 0.1, `x from ${minX.toFixed(2)} to ${maxX.toFixed(2)} m`);
    }
    check(`${kind}: the body steps in`, Math.max(a.maxLunge, b.maxLunge) > 0.3, `peak lunge ${Math.max(a.maxLunge, b.maxLunge).toFixed(2)}`);
    check(`${kind}: the attack resolves, nothing left in flight`, (a.done || b.done) && after.bolts.length === 0, `${after.bolts.length} bolts`);
  }
  check(`${boss}: no page errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}

const browser = await launch();
await bout(browser, 'RUSTHOOK, every floor attack thrown', ['campaign-0'], 'RUSTHOOK', {
  seesaw: true,
  surge: true,
  nova: true,
  lanes: true,
  gate: true,
  donut: true,
  cross: true,
  wave: true,
  sweep: false,
});
await bout(browser, 'GOOPLIATH, every blow his body heaving', ['campaign-goopliath', 'campaign-launch-start'], 'GOOPLIATH', {
  seesaw: false,
  nova: false,
  sweep: false,
});
await browser.close();

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
process.exit(bad === 0 ? 0 : 1);
