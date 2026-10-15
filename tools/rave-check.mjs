#!/usr/bin/env node
/**
 * RAVE RAID inside FIRE FIGHT 2, headless.
 *
 *   npm run dev              # terminal 1
 *   node tools/rave-check.mjs [--shots]
 *
 * Boots rave.html in headless Chromium (IWER provides WebXR), enters, and
 * drives the rave through its dev hook (window.__gdr): the shared identity
 * (the arena's callsign is the dancer's; the colour is the rave's own
 * pick, the arena having no accent to share), a solo set whose
 * groupies and MC are the house's own RAVE RAID figures (only real people
 * wear THE BLANK) with the MC changing colour and never wearing the
 * telegraphs' red or yellow, the podium paying
 * bolt-dollars into the ONE wallet, and the rail's FIRE FIGHT door hopping
 * back to the arena page. --shots saves the ring beside this script.
 */

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const shots = process.argv.includes('--shots');
const here = dirname(fileURLToPath(import.meta.url));

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log(`[pageerror] ${e.message}`);
});
// The arena's identity, planted before the page loads: the rave must dance as it.
await page.addInitScript(() => {
  localStorage.setItem('ff-player-name', 'PROBE-ONE');
  localStorage.setItem('gdr-hue', '0.5');
  localStorage.setItem('ff-coins', '120');
  localStorage.removeItem('gdr-name');
  localStorage.removeItem('gdr-seats');
});

await page.goto(`${base}/rave.html`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(`${base}/rave.html`));
await page.waitForTimeout(1500);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
await page.waitForTimeout(2500);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const hook = await page.evaluate(() => !!window.__gdr);
check('the rave dev hook is up', hook);
if (!hook) {
  await browser.close();
  process.exit(1);
}

console.log('\n=== one town: the identity is the arena\'s ===');
const who = await page.evaluate(() => ({ name: window.__gdr.net.state.members, screen: window.__gdr.match.screen }));
const name = await page.evaluate(() => localStorage.getItem('ff-player-name'));
const hue = await page.evaluate(() => window.__gdr.match.players[0]?.hue ?? null);
check('the rave opens on its tour map', who.screen === 'tour', who.screen);
check('a fresh profile defaults to four dancers', await page.evaluate(() => window.__gdr.match.seats === 4));
check("the dancer's name is the arena's callsign", name === 'PROBE-ONE', String(name));
const railHasFF = await page.evaluate(() => window.__gdr.menu.boardButtons?.().includes('tab-ff'));
check('the rail offers FIRE FIGHT (the way back)', railHasFF === true, String(railHasFF));

console.log('\n=== a solo set: the house figures, the MC\'s wardrobe, the one wallet ===');
const mcMenu = await page.evaluate(() => ({ ...window.__gdr.mc }));
const coinsBefore = await page.evaluate(() => Number(localStorage.getItem('ff-coins')));
await page.evaluate(() => window.__gdr.startRaid({ seats: 8 }));
const live = await page
  .waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 40000 })
  .then(() => true)
  .catch(() => false);
const screen = await page.evaluate(() => window.__gdr.match.screen);
check('the set goes live (count-in → raid)', live, screen);
await page.waitForTimeout(900); // early in the record — before the first landing's flash
const ring = await page.evaluate(() => {
  const scene = window.__gdr.scene();
  let blanks = 0;
  scene?.traverse((o) => {
    if (o.name === 'blank-dancer') blanks++;
  });
  const mc = scene?.getObjectByName('the-mc');
  return {
    blanks,
    mc: !!mc,
    // The house figure has no mannequin head in it; the blank does.
    mcBlank: !!mc?.getObjectByName('opponent-head'),
    players: window.__gdr.match.players.length,
    bots: window.__gdr.match.players.filter((p) => p.kind === 'bot').length,
    mine: window.__gdr.match.players[0]?.hue,
  };
});
// The groupies and the MC are the house's own RAVE RAID figures; THE BLANK
// is the players' body, so a solo ring (no remote humans) carries none.
check('the groupies and the MC keep the house figure', ring.mc && !ring.mcBlank && ring.blanks === 0 && ring.bots === 7, JSON.stringify(ring));
check('your own colour is the hue you picked', Math.abs((hue ?? -1) - 0.5) < 0.01 || Math.abs((ring.mine ?? -1) - 0.5) < 0.01, String(ring.mine));
{
  // His wardrobe is a function of the screen AND the record, eased toward
  // at MC.changeRate — so a record whose hue happens to sit near the map's
  // is not a failure. Two samples: he has moved off the map's hue, or he
  // is still moving.
  const mcSet = await page.evaluate(() => ({ ...window.__gdr.mc }));
  await page.waitForTimeout(700);
  const mcSet2 = await page.evaluate(() => ({ ...window.__gdr.mc }));
  const band = (h) => h >= 0.279 && h <= 0.921; // never red, never yellow
  // A record whose own hue lands within the tolerance of the map's is the
  // documented coincidence, not a wardrobe that never turned: then it is
  // enough that he is wearing (or easing toward) the record's hue.
  const moved = Math.abs(mcSet2.hue - mcMenu.hue) > 0.01 || Math.abs(mcSet2.hue - mcSet.hue) > 0.002;
  const wearsRecord = Math.abs(mcSet2.want - mcMenu.hue) <= 0.01 && Math.abs(mcSet2.hue - mcSet2.want) < 0.02;
  check('the MC changes colour from the map to the record', (moved || wearsRecord) && mcSet2.screen === 'raid', JSON.stringify({ map: mcMenu.hue, set: mcSet.hue, later: mcSet2.hue, want: mcSet2.want }));
  check('and never wears the telegraphs\' red or yellow', band(mcMenu.hue) && band(mcSet.hue) && band(mcSet2.hue), JSON.stringify([mcMenu.hue, mcSet.hue, mcSet2.hue]));
}
if (shots) {
  const file = join(here, 'rave-ring.png');
  await page.screenshot({ path: file });
  console.log(`  wrote ${file}`);
}
await page.evaluate(() => window.__gdr.endSet());
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({
  screen: window.__gdr.match.screen,
  paid: window.__gdr.match.coinsPaid,
  coins: Number(localStorage.getItem('ff-coins')),
}));
check('the podium pays bolt-dollars into the one wallet', after.screen === 'podium' && after.paid >= 10 && after.coins === coinsBefore + after.paid, JSON.stringify({ coinsBefore, ...after }));
if (shots) {
  const file = join(here, 'rave-podium.png');
  await page.screenshot({ path: file });
  console.log(`  wrote ${file}`);
}

console.log('\n=== the wire dresses a real person ===');
{
  // A remote human dealt onto the ring with a body on the wire: the blank,
  // in onyx, wearing the gear they fight in. (Bots and the MC stay the
  // house's own figures beside them.)
  await page.evaluate(() => {
    const humans = new Map([[1, { name: 'RIVAL', netId: 9, look: '', gear: 'crest,pauldrons', tone: 'onyx' }]]);
    window.__gdr.startRaid({ seats: 4, humans, mySeat: 0 });
  });
  await page.waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const dressed = await page.evaluate(() => {
    const scene = window.__gdr.scene();
    let blanks = 0;
    let geared = 0;
    scene?.traverse((o) => {
      if (o.name !== 'blank-dancer') return;
      blanks++;
      let has = false;
      o.traverse((c) => {
        if (c.name === 'gear') has = true;
      });
      if (has) geared++;
    });
    const d = window.__gdr.match.players.find((p) => p.kind === 'remote');
    return { blanks, geared, wire: d ? { gear: d.gear, tone: d.tone } : null };
  });
  check('a remote human wears THE BLANK, dressed off the wire', dressed.blanks === 1 && dressed.geared === 1 && dressed.wire?.gear === 'crest,pauldrons' && dressed.wire?.tone === 'onyx', JSON.stringify(dressed));
  await page.evaluate(() => window.__gdr.toLobby());
  await page.waitForTimeout(400);
}

console.log('\n=== the door back ===');
await page.evaluate(() => window.__gdr.toLobby());
await page.waitForTimeout(300);
await page.evaluate(() => window.__gdr.menu.act('tab-ff'));
const backHome = await page
  .waitForFunction(() => /index\.html$|\/$/.test(location.pathname), { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('FIRE FIGHT on the rail lands on the arena page', backHome, page.url());

check('no page errors along the way', errors.length === 0, errors.join(' | '));

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
