#!/usr/bin/env node
/**
 * VOIDSTEP, with company — headless.
 *
 *   npm run dev        # terminal 1
 *   npm run server     # terminal 2 (THE ROOM SERVER, :8787)
 *   node tools/voidstep-check.mjs
 *
 * Two isolated browser contexts share a club room, both walk through the west
 * door onto the course, and the things that make co-op actually co-op are
 * checked from the other headset's point of view:
 *
 *   1. THE CLOCK. Both clients must read the SAME bar. The course has been
 *      turning since the room opened, so a client crossing in later joins the
 *      lap in progress rather than restarting it — if this drifts, riders
 *      stand beside their decks instead of on them, and it is the one failure
 *      that looks like a physics bug and isn't.
 *   2. THE POSES. Each rider's head reaches the other in COURSE space, and
 *      moving one moves it on the other's screen.
 *   3. THE FIGURE. A pose is only half of it — the other headset must
 *      actually have built a body for them.
 *   4. LEAVING. Step back through the door and the rider goes stale, so
 *      nobody is left standing out there as a ghost.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
};

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

/**
 * A headset: its OWN BROWSER, its own storage, its own identity.
 *
 * Two contexts in one browser is the obvious way to do this and it does not
 * work: only one page can be foregrounded, and Chromium throttles the other
 * one's animation frames down to almost nothing. The symptoms are ugly and
 * misleading — a clock that reads a second behind, poses that stop updating —
 * and they look exactly like a desync bug in the code under test. A browser
 * each keeps both pages awake.
 */
async function headset(name) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await ctx.newPage();
  page.browser_ = browser;
  page.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  await page.addInitScript((n) => {
    localStorage.setItem('ff-player-name', n);
    localStorage.setItem('gdr-hue', String(Math.random()));
  }, name);
  await page.goto(`${base}/rave.html`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(`${base}/rave.html`));
  await page.waitForTimeout(1200);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
  await page.waitForTimeout(2000);
  return page;
}

const A = await headset('RIDER-A');
const B = await headset('RIDER-B');

console.log('=== the room ===');

const code = await A.evaluate(async () => {
  window.__gdr.net.host();
  for (let i = 0; i < 60 && !window.__gdr.net.state.code; i++) await new Promise((r) => setTimeout(r, 100));
  return window.__gdr.net.state.code;
});
check('A opens a club room', !!code, code || 'no code');

const joined = await B.evaluate(async (c) => {
  window.__gdr.net.join(c);
  for (let i = 0; i < 60; i++) {
    if (window.__gdr.net.state.members.length >= 2) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return window.__gdr.net.state.members.length >= 2;
}, code);
check('B joins it', joined);

console.log('\n=== through the west door ===');

// A crosses first and rides for a couple of seconds, so B is provably joining
// a lap ALREADY IN PROGRESS — which is the case the shared clock exists for.
await A.evaluate(() => window.__gdr.course.enter());
await A.waitForTimeout(2600);
await B.evaluate(() => window.__gdr.course.enter());
await B.waitForTimeout(1800);

const bars = async (p) => (await p.evaluate(() => window.__gdr.course.state()?.bars ?? null));
const [barsA, barsB] = [await bars(A), await bars(B)];
const drift = Math.abs((barsA ?? 0) - (barsB ?? 0));
check('both are out on the course', barsA !== null && barsB !== null);
// One bar is 1.88 s. A quarter of a bar is well inside the window where a
// deck and a rider still read as the same object.
check(
  'their clocks agree despite crossing 2.6 s apart',
  drift < 0.25,
  `A ${barsA?.toFixed(2)} · B ${barsB?.toFixed(2)} · drift ${drift.toFixed(3)} bar`,
);

console.log('\n=== seeing each other ===');

const seenByB = await B.evaluate(async () => {
  for (let i = 0; i < 60; i++) {
    if (window.__gdr.net.coursePoses.size > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const [idx, pose] = [...window.__gdr.net.coursePoses.entries()][0] ?? [];
  return pose ? { idx, hx: pose.hx, hy: pose.hy, hz: pose.hz } : null;
});
check('B receives A\'s rider pose', !!seenByB, seenByB ? JSON.stringify(seenByB) : 'nothing arrived');

const seenByA = await A.evaluate(() => window.__gdr.net.coursePoses.size);
check('…and A receives B\'s', seenByA > 0, `${seenByA} rider(s)`);

// A body, not just a number: the other headset must have built the figure.
const figureUp = await B.evaluate(() => {
  const crowd = window.__gdr.scene()?.getObjectByName('course-riders');
  if (!crowd) return 'no crowd group';
  const shown = crowd.children.filter((c) => c.visible).length;
  return shown;
});
check('B has actually built a body for A', typeof figureUp === 'number' && figureUp > 0, String(figureUp));

// THE FRAME, checked end to end. Moving the head from outside isn't available
// out here — CourseFrameSystem owns the rig every frame, and that IS the
// locomotion scheme — so instead assert the thing that would actually be
// wrong if the conversion were wrong: where A believes its own head is, in
// course space, is where B is drawing it.
//
// A's head in course-local terms is its play-area origin plus the body offset
// inside that area (course/state.ts: `rig` is the origin, `body` the head
// within it). That is the number the sender converted from, so if the round
// trip is honest it is the number the receiver ends up holding.
const agree = await (async () => {
  const mine = await A.evaluate(() => {
    const st = window.__gdr.course.state();
    return { x: st.rig.x + st.body.x, y: st.rig.y + st.body.y, z: st.rig.z + st.body.z };
  });
  const theirs = await B.evaluate(() => {
    const p = [...window.__gdr.net.coursePoses.values()][0];
    return p ? { x: p.hx, y: p.hy, z: p.hz } : null;
  });
  if (!theirs) return { ok: false, detail: 'no pose held' };
  const d = Math.hypot(mine.x - theirs.x, mine.y - theirs.y, mine.z - theirs.z);
  return {
    ok: d < 0.35,
    detail:
      `A thinks (${mine.x.toFixed(2)}, ${mine.y.toFixed(2)}, ${mine.z.toFixed(2)}) · ` +
      `B holds (${theirs.x.toFixed(2)}, ${theirs.y.toFixed(2)}, ${theirs.z.toFixed(2)}) · ${d.toFixed(3)} m apart`,
  };
})();
check('B draws A where A thinks A is (the frame round-trips)', agree.ok, agree.detail);

console.log('\n=== back through the door ===');

await A.evaluate(() => window.__gdr.course.leave());
const wentStale = await B.evaluate(async () => {
  // STALE_MS is 1.6 s; give it a beat longer than that.
  await new Promise((r) => setTimeout(r, 2400));
  const crowd = window.__gdr.scene()?.getObjectByName('course-riders');
  return crowd ? crowd.children.filter((c) => c.visible).length : -1;
});
check('A\'s rider goes when A leaves — no ghost left standing', wentStale === 0, String(wentStale));

await A.browser_.close();
await B.browser_.close();

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILURE(S)` : `\nALL PASS (${results.length} checks)`);
process.exit(failed ? 1 : 0);
