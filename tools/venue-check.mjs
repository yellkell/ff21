#!/usr/bin/env node
/**
 * THE TOWN, headless: one page, three places, a curtain between them.
 *
 *   npm run dev                 # terminal 1
 *   node tools/venue-check.mjs [--shots]
 *
 * Boots index.html in headless Chromium (IWER provides WebXR), enters the
 * arena, and walks through the doors: CLUB onto the venue's floor (the room
 * of one when no relay answers), THE STEP into the course and back, the
 * rave's FIRE FIGHT door home, then ARCADE → RAVE RAID's foyer and home
 * again — asserting at every stop that the XR session was never ended, the
 * outgoing place is hidden and paused, the incoming one is up, and no page
 * errors fell out. --shots saves each place beside this script.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
await page.addInitScript(() => {
  localStorage.setItem('ff-tutorial-done', '1');
  localStorage.setItem('ff-player-name', 'PROBE-ONE');
  // No relay on this machine: the floor must open as a room of one, fast.
  localStorage.setItem('gdr-server', 'ws://127.0.0.1:1');
});

// THE PATIENCE, turned down. The floor now keeps ASKING while a sleeping
// relay wakes (net/session.ts openPublicFloor) rather than reading the
// first refused socket as "no relay here" — which is what a free-tier host
// looks like for its first two hundred milliseconds, and why players kept
// landing in a room of one. The room of one is still the last resort, and
// this proves it still happens; it just no longer waits a minute to say so.
// Four seconds, not one: at one the check had six attempts to get a second
// headset onto the floor, and lost the race whenever the machine was busy.
const floorUrl = `${base}/?floorPatience=4000`;
await page.goto(floorUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(floorUrl));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
await page.waitForTimeout(2500);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (name) => {
  if (!shots) return;
  const file = join(here, `venue-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  wrote ${file}`);
};
const town = () => page.evaluate(() => ({ place: window.__town?.place, busy: window.__town?.busy }));
const settle = () => page.waitForFunction(() => window.__town && !window.__town.busy, { timeout: 30000 });
const inSession = () => page.evaluate(() => document.body.classList.contains('app-entered'));
const sceneRead = () =>
  page.evaluate(() => {
    const scene = window.__gdr?.scene?.();
    const byName = (n) => {
      const o = scene?.getObjectByName(n);
      if (!o) return null;
      let vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      return vis;
    };
    return {
      club: byName('the-club'),
      arena: byName('arena-root') ?? byName('desert') ?? byName('arena'),
      curtain: byName('town-curtain'),
      course: byName('the-course'),
    };
  });

const hook = await page.evaluate(() => !!window.__ff2?.wrap && !!window.__town);
check('the arena and the town are up', hook, JSON.stringify(await town()));
if (!hook) {
  await browser.close();
  process.exit(1);
}
console.log('\n=== CLUB: the venue\'s floor, in-session ===');
const t0first = Date.now();
await page.evaluate(() => window.__town.enterVenue());
await settle();
const firstMs = Date.now() - t0first;
let t = await town();
check('the curtain lifts on the VENUE', t.place === 'venue' && !t.busy, `${JSON.stringify(t)} in ${firstMs} ms (first visit builds the rave)`);
check('the XR session never ended', await inSession(), 'app-entered still set');
const raveHook = await page.evaluate(() => !!window.__gdr);
check('the rave dev hook is installed by the mount', raveHook);
// The floor: a room of one, since no relay answers here.
const floor = await page.waitForFunction(
  () => window.__gdr?.net?.state && (window.__gdr.net.state.solo || window.__gdr.net.state.phase === 'joined' || window.__gdr.net.state.phase === 'hosting'),
  { timeout: 8000 },
).then(() => true).catch(() => false);
const netState = await page.evaluate(() => ({ solo: window.__gdr.net.state.solo, phase: window.__gdr.net.state.phase, screen: window.__gdr.match.screen, myIdx: window.__gdr.net.state.myIdx }));
// THE DEFAULT PATIENCE, which is the one that shipped broken. Number(null)
// is ZERO, not NaN, so reading a MISSING ?floorPatience straight into
// Number() made the default one tick — a fifth of a second — and the club
// opened a room of one every single time. Every check here passed, because
// every check passes the parameter explicitly: the only configuration that
// was broken was the one nobody tested. So test the absent one.
{
  // Proved at RUNTIME rather than by reading the source: a page with no
  // parameter at all must come up with the full minute of patience.
  const plain = await browser.newPage();
  await plain.goto(base, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  const ticks = await plain.evaluate(async () => {
    const s = await import('/src/rave/net/session.ts');
    return s.__floorPatienceTicks ?? null;
  }).catch(() => null);
  await plain.close();
  check('a missing ?floorPatience gives the full minute, not zero ticks', ticks === 300, ticks === null ? 'could not read it' : ticks + ' ticks');
}

check('the floor falls back to a ROOM OF ONE once the patience is spent', floor && netState.solo && netState.screen === 'lobby' && netState.myIdx === 0, JSON.stringify(netState));
await page.waitForTimeout(800);
let read = await sceneRead();
check('the club is standing and the curtain is clear', read.club === true && read.curtain === false, JSON.stringify(read));
const arenaHidden = await page.evaluate(() => {
  const scene = window.__gdr.scene();
  // Anything the arena built (its wrap panels are the easiest tell) must be hidden.
  const wrap = scene.getObjectByName('title-banner') ?? null;
  const podium = scene.getObjectByName('podium-root') ?? null;
  const vis = (o) => {
    if (!o) return null;
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  return { wrap: vis(wrap), podium: vis(podium) };
});
check("the arena's furniture is put away (the sign, the podium)", arenaHidden.wrap === false && arenaHidden.podium === false, JSON.stringify(arenaHidden));
await page.evaluate(() => window.__gdr.rig(0, 0.5, 0));
await page.waitForTimeout(400);
await shot('club');
// THE VISIT: the MC dresses for each arrival on the floor. Remember what
// he wears tonight; the second visit below must find him changed.
await page.waitForTimeout(1600); // his wardrobe eases at 0.5 hue/s
const mcFirst = await page.evaluate(() => ({ visit: window.__gdr.mc.visit, hue: window.__gdr.mc.hue }));
check('the MC is dressed for this visit, inside his safe band', mcFirst.visit > 0 && mcFirst.hue >= 0.28 && mcFirst.hue <= 0.92, JSON.stringify(mcFirst));

console.log('\n=== THE BALL IN A ROOM OF ONE: it calls, it deals, it comes home ===');
// No relay answered, and the desk still says HOST. It must mean it.
await page.evaluate(() => window.__gdr.club.call([1.6, 1.5, -1.5]));
await page.waitForTimeout(400);
const soloBall = await page.evaluate(() => { const b = window.__gdr.net.state.ball; return b ? { mode: b.mode, caller: b.callerName, hanging: !!window.__gdr.scene().getObjectByName('raid-ball') } : null; });
check('a solo ball drops on the floor of one', !!soloBall && soloBall.mode === 'rave', JSON.stringify(soloBall));
// The caller cannot wait on anyone: START deals them now.
await page.evaluate(() => window.__gdr.club.go());
await page.waitForFunction(() => window.__gdr.match.screen === 'countdown' || window.__gdr.match.screen === 'raid', { timeout: 6000 }).catch(() => {});
const soloDeal = await page.evaluate(() => ({ screen: window.__gdr.match.screen, seats: window.__gdr.match.seats, online: window.__gdr.match.online, ball: window.__gdr.net.state.ball, phase: window.__gdr.net.state.phase }));
check('and deals a ring of one — four seats, groupies in the rest', (soloDeal.screen === 'countdown' || soloDeal.screen === 'raid') && soloDeal.seats === 4 && soloDeal.ball === null && soloDeal.phase === 'live', JSON.stringify(soloDeal));
// Home: the set is abandoned back to the floor, still a room of one.
await page.evaluate(() => window.__gdr.toLobby());
await page.waitForTimeout(600);
const soloHome = await page.evaluate(() => ({ screen: window.__gdr.match.screen, solo: window.__gdr.net.state.solo, phase: window.__gdr.net.state.phase }));
check('the floor of one is still there when the set ends', soloHome.screen === 'lobby' && soloHome.solo && soloHome.phase === 'off', JSON.stringify(soloHome));

console.log('\n=== the dumbwaiter serves without a relay ===');
const served = await page
  .waitForFunction(() => window.__gdr.props?.glasses?.().some((g) => g.mode === 'pedestal'), { timeout: 6000 })
  .then(() => true)
  .catch(() => false);
const glasses = await page.evaluate(() => window.__gdr.props?.glasses?.().map((g) => g.mode) ?? []);
check('a coupe rises on the plate', served, glasses.join(','));
check('the house pours twelve', glasses.length === 12, String(glasses.length));

console.log('\n=== THE GLASSES: thrown, walled, rolled ===');
// A throw across the bar: it must come to rest ON something, never inside it.
await page.evaluate(() => window.__gdr.props.launch(1, [5.6, 1.5, -3.2], [2.2, 1.2, 0.3]));
// (Headless renders slowly and the flight sim caps how much time one frame
// may simulate, so the glasses run in slow motion here — give them room.)
let worst = 0;
for (let i = 0; i < 70; i++) {
  await page.waitForTimeout(140);
  const g = await page.evaluate(() => window.__gdr.props.glasses()[1]);
  worst = Math.min(worst, g.clearance);
  if (g.mode === 'rest') break;
}
let g1 = await page.evaluate(() => window.__gdr.props.glasses()[1]);
check('a thrown coupe lands and rests seated', g1.mode === 'rest' && Math.abs(g1.clearance) < 0.012, JSON.stringify({ mode: g1.mode, clearance: g1.clearance, pos: g1.pos.map((v) => +v.toFixed(2)) }));
check('and was never inside the furniture on the way', worst > -0.03, `worst clearance ${worst.toFixed(3)}`);
// A line drive at the north wall: the BOWL stops at the plaster.
await page.evaluate(() => window.__gdr.props.launch(2, [0, 1.3, -9.8], [0, 0.4, -6]));
let minZ = 0;
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(90);
  const g = await page.evaluate(() => window.__gdr.props.glasses()[2]);
  minZ = Math.min(minZ, g.pos[2]);
}
check('a line drive rings off the wall and never enters it', minZ > -11.5 - 0.02, `deepest z ${minZ.toFixed(3)} vs wall at -11.5`);
// A coupe launched tumbling lands on its rim edge, TIPS onto its side and
// ROLLS — its heading bends. Where it lands in the tumble is a coin toss,
// so it gets a few throws; one roll is the claim.
let roll = { rollingFrames: 0, bend: null };
for (const spin of [7, 11, 5]) {
  await page.evaluate((sp) => window.__gdr.props.launch(3, [-2, 0.35, 0.5], [1.3, 0.3, 0], sp), spin);
  const track = [];
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(120);
    const g = await page.evaluate(() => window.__gdr.props.glasses()[3]);
    track.push(g);
    if (g.mode === 'rest') break;
  }
  if (process.env.TRACE) {
    console.log(track.slice(0, 10).map((g) => `${g.mode}${g.grounded ? 'G' : '-'} up${g.upright.toFixed(2)} s${g.spin.toFixed(1)} ax${g.spinAxis.map((v) => v.toFixed(1)).join(',')} o${g.owner} p${g.pos.map((v) => v.toFixed(2)).join(',')}`).join(' | '));
    console.log('  others:', JSON.stringify(await page.evaluate(() => window.__gdr.props.glasses().filter((g) => g.mode !== 'idle').map((g) => [g.id, g.mode, g.owner]))), 'myIdx', await page.evaluate(() => window.__gdr.net.state.myIdx), 'solo', await page.evaluate(() => window.__gdr.net.state.solo));
  }
  const rolling = track.filter((g) => g.grounded && g.upright < 0.55 && Math.hypot(g.vel[0], g.vel[2]) > 0.15);
  const headings = rolling.map((g) => Math.atan2(g.vel[2], g.vel[0]));
  const bend = headings.length >= 2 ? headings[headings.length - 1] - headings[0] : null;
  roll = { rollingFrames: rolling.length, bend: bend === null ? null : +bend.toFixed(3) };
  if (rolling.length >= 3 && bend !== null && Math.abs(bend) > 0.05) break;
}
check('a coupe on its side rolls, and rolls in an arc', roll.rollingFrames >= 3 && roll.bend !== null && Math.abs(roll.bend) > 0.05, JSON.stringify(roll));
// Two thrown at each other: they clack and part, they don't pass through.
await page.evaluate(() => {
  window.__gdr.props.launch(4, [-1.0, 1.2, -2.0], [1.6, 0.1, 0]);
  window.__gdr.props.launch(5, [1.0, 1.2, -2.0], [-1.6, 0.1, 0]);
});
let closest = Infinity;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(80);
  const [a, b] = await page.evaluate(() => { const g = window.__gdr.props.glasses(); return [g[4], g[5]]; });
  closest = Math.min(closest, Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]));
}
check('two glasses thrown at each other meet and part', closest < 0.3 && closest > 0.06, `closest ${closest.toFixed(3)} m`);

console.log('\n=== THE MIRROR: shadows, not a second rig, and no light ===');
await page.evaluate(() => window.__gdr.rig(6.65, -8.6, 0)); // up to the glass, facing it
await page.waitForTimeout(900);
const mirror = await page.evaluate(() => {
  const scene = window.__gdr.scene();
  const figures = scene.getObjectByName('live-mirror-figures');
  let shadows = 0;
  let twins = 0;
  let lit = 0;
  figures?.traverse((o) => {
    if (o.name === 'mirror-shadow') {
      shadows++;
      twins += o.children.length;
    }
    if (o.isMesh && o.material && !o.material.isMeshBasicMaterial && !o.material.isSpriteMaterial && o.parent?.name === 'mirror-shadow') lit++;
  });
  const light = scene.getObjectByName('live-mirror-light');
  return { awake: figures?.visible ?? null, shadows, twins, lit, light: !!light };
});
check('the glass wakes and casts ME as a shadow of twins', mirror.awake === true && mirror.shadows === 1 && mirror.twins > 8, JSON.stringify(mirror));
check('every twin is unlit, and the recess has no light', mirror.lit === 0 && !mirror.light, JSON.stringify({ lit: mirror.lit, light: mirror.light }));
await shot('mirror');
await page.evaluate(() => window.__gdr.rig(0, 0.5, 0));
await page.waitForTimeout(600);
const asleep = await page.evaluate(() => window.__gdr.scene().getObjectByName('live-mirror-figures')?.visible);
check('walk away and the glass sleeps', asleep === false, String(asleep));

console.log('\n=== THE STEP: into the course and back, still in-session ===');
await page.evaluate(() => window.__gdr.course.enter());
const riding = await page.waitForFunction(() => window.__gdr.course.state().active, { timeout: 8000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1200);
let cs = await page.evaluate(() => window.__gdr.course.state());
check('the ride starts on the home pad', riding && cs.active && cs.tracked === 'home', JSON.stringify({ active: cs.active, tracked: cs.tracked, phase: cs.phase }));
read = await sceneRead();
check('the hall packs away behind the void', read.course === true && read.club === false, JSON.stringify(read));
const gate = await page.evaluate(() => {
  const scene = window.__gdr.scene();
  const g = scene.getObjectByName('the-gate');
  let pane = null;
  g?.traverse((o) => {
    if (o.material?.transparent && o.material.map) pane = o.material.opacity;
  });
  return { built: !!g, pane, homeward: window.__gdr.course.state().homeward, platforms: window.__gdr.course.state().tracked };
});
check('THE GATE stands on the home pad, dark on the way out', gate.built && gate.pane !== null && gate.pane < 0.1 && gate.homeward === 0, JSON.stringify(gate));
await page.evaluate(() => window.__gdr.course.head(0, 0.2, 1.6));
await page.waitForTimeout(300);
await shot('course');
await page.evaluate(() => window.__gdr.course.leave());
await page.waitForTimeout(900);
cs = await page.evaluate(() => window.__gdr.course.state());
read = await sceneRead();
check('and the hall comes back', !cs.active && read.club === true && read.course === false, JSON.stringify({ active: cs.active, club: read.club }));

console.log('\n=== the rave\'s FIRE FIGHT door: home under the curtain ===');
await page.evaluate(() => window.__gdr.menu.press?.('tab-ff') ?? window.__town.leave());
await settle();
t = await town();
check('back in the ARENA', t.place === 'arena' && !t.busy, JSON.stringify(t));
check('the XR session still never ended', await inSession());
read = await sceneRead();
check('the club is put away, the curtain clear', read.club === false && read.curtain === false, JSON.stringify(read));
const arenaBack = await page.evaluate(() => {
  const scene = window.__gdr.scene();
  const wrap = scene.getObjectByName('title-banner') ?? null;
  const vis = (o) => {
    if (!o) return null;
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  return { wrap: vis(wrap), rig: [window.__gdr ? 1 : 0] };
});
check("the arena's furniture is handed back", arenaBack.wrap === true, JSON.stringify(arenaBack));
const wrapLive = await page.evaluate(() => window.__ff2.wrap.buttons('train').length > 0);
check('the wrap answers again', wrapLive);
await shot('arena-back');

console.log('\n=== ARCADE → RAVE RAID\'s foyer, and home ===');
await page.evaluate(() => window.__town.enterRave());
await settle();
t = await town();
const foyer = await page.evaluate(() => ({ screen: window.__gdr.match.screen, phase: window.__gdr.net.state.phase, solo: window.__gdr.net.state.solo }));
check('the curtain lifts on the RAVE foyer', t.place === 'rave' && foyer.screen === 'tour' && !foyer.solo, JSON.stringify({ ...t, ...foyer }));
const rail = await page.evaluate(() => window.__gdr.menu.boardButtons?.() ?? []);
check('the board offers FIRE FIGHT (the way back)', rail.includes('tab-ff'), rail.filter((b) => b.startsWith('tab-')).join(','));
await shot('rave-foyer');
await page.evaluate(() => window.__town.leave());
await settle();
t = await town();
check('and home again, in-session', t.place === 'arena' && (await inSession()), JSON.stringify(t));

console.log('\n=== a second visit is instant (mounted once, kept) ===');
const t0 = Date.now();
await page.evaluate(() => window.__town.enterVenue());
await settle();
const dt = Date.now() - t0;
t = await town();
// Headless Chromium renders this scene slowly and the fade waits on real
// frames, so the bar is relative: a kept mount must beat the first visit.
check('the venue comes back under the same curtain, faster than it was built', t.place === 'venue' && dt < firstMs, `${dt} ms vs ${firstMs} ms first`);
await page.waitForTimeout(1600);
const mcSecond = await page.evaluate(() => ({ visit: window.__gdr.mc.visit, hue: window.__gdr.mc.hue }));
check('the MC changed colour between visits', mcSecond.visit > mcFirst.visit && Math.abs(mcSecond.hue - mcFirst.hue) > 0.05 && mcSecond.hue >= 0.28 && mcSecond.hue <= 0.92, JSON.stringify({ first: mcFirst, second: mcSecond }));
await page.evaluate(() => window.__town.leave());
await settle();

console.log('\n=== the crossing, with its session pulled from under it ===');
// A crossing fades on XR session frames. The report: a player waited out
// the relay, the black came down, and the headset dropped its session
// under the black (the club's first build holds the thread; a doffed
// headset sleeps) — so the frame the fade was waiting on never came, the
// curtain never lifted, and putting the headset back on found the black
// with the music going. End the session the instant the crossing is
// settling under the black; it must unwind to the arena, curtain down,
// and the door must answer again on re-entry.
await page.evaluate(() => {
  window.__endedAt = null;
  const iv = setInterval(() => {
    if (window.__town?.crossing === 'settling') {
      clearInterval(iv);
      window.__endedAt = performance.now();
      window.__town.session()?.end();
    }
  }, 5);
  window.__town.enterVenue();
});
const ended = await page.waitForFunction(() => window.__endedAt !== null, { timeout: 30000 }).then(() => true).catch(() => false);
const unwound = ended && (await page.waitForFunction(() => !window.__town.busy && window.__town.place === 'arena' && !document.body.classList.contains('app-entered'), { timeout: 15000 }).then(() => true).catch(() => false));
const curtainDown = await page.evaluate(() => {
  const c = window.__gdr?.scene?.()?.getObjectByName('town-curtain');
  return !c || (!c.visible && c.material.opacity < 0.01);
});
check('a session ending under the black unwinds the crossing to the arena, curtain down', ended && unwound && curtainDown, JSON.stringify({ ended, unwound, curtainDown, ...(await town()) }));
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
t = await town();
check('back in VR, the player is in the menu, not in the black', t.place === 'arena' && !t.busy && (await inSession()), JSON.stringify(t));
await page.evaluate(() => window.__town.enterVenue());
await settle();
t = await town();
check('and the door answers again', t.place === 'venue' && (await inSession()), JSON.stringify(t));
await page.evaluate(() => window.__town.leave());
await settle();

console.log('\n=== THE BELL: a fight called from the floor, dealt by THE ROOM SERVER ===');
// A room server of our own, on a port nobody else has, with a short clock,
// and two headsets on its floor. Their arena rooms are PAPER (no
// signalling on this machine): the deal and the crossing are what's walked.
const RELAY_PORT = 18797;
const relay = spawn(process.execPath, ['server/room.mjs'], {
  env: { ...process.env, PORT: String(RELAY_PORT), BALL_MS: '12000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relayLog = [];
relay.stdout.on('data', (d) => relayLog.push(String(d).trim()));
relay.stderr.on('data', (d) => relayLog.push(String(d).trim()));
let health = null;
for (let i = 0; i < 50 && !health; i++) {
  health = await fetch(`http://127.0.0.1:${RELAY_PORT}/`).then((r) => r.json()).catch(() => null);
  if (!health) await new Promise((r) => setTimeout(r, 200));
}
const relayPaths = (health?.relays ?? []).map((r) => r.path);
check('THE ROOM SERVER answers for all three relays at one port', ['/rave', '/pub', '/ff'].every((p) => relayPaths.includes(p)), JSON.stringify(health));
const raveHealth = await fetch(`http://127.0.0.1:${RELAY_PORT}/rave`).then((r) => r.json()).catch(() => null);
check("and the rave's relay answers at /rave", raveHealth?.game === 'goopliath-dance-raid', JSON.stringify(raveHealth));

const openHeadset = async (name) => {
  // A small viewport: two of these render side by side on one headless GPU.
  const p = await browser.newPage({ viewport: { width: 480, height: 300 } });
  p.on('pageerror', (e) => {
    errors.push(e.message);
    console.log(`[pageerror:${name}] ${e.message}`);
  });
  await p.addInitScript((who) => {
    localStorage.setItem('ff-tutorial-done', '1');
    localStorage.setItem('ff-player-name', who);
    localStorage.setItem('gdr-server', `ws://127.0.0.1:${18797}/rave`);
    localStorage.setItem('ff-paper-rooms', '1');
  }, name);
  await p.goto(base, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => p.goto(base));
  await p.waitForTimeout(1200);
  await p.click('#enter-vr');
  await p.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__town.enterVenue());
  await p.waitForFunction(() => window.__town && !window.__town.busy, { timeout: 30000 });
  await p.waitForFunction(() => window.__gdr?.net?.state && (window.__gdr.net.state.phase === 'hosting' || window.__gdr.net.state.phase === 'joined'), { timeout: 15000 }).catch(() => {});
  return p;
};
// The first headset has done its walking: it goes, so the two that follow
// don't share headless Chromium's one GPU three ways. (The floor gives a
// relay five seconds of RESPONSIVE time to answer before opening as a room
// of one — counted in poll ticks, so a page busy building the hall doesn't
// burn the grace it hasn't used.)
await page.close();
const caller = await openHeadset('CALLER');
const toucher = await openHeadset('TOUCHER');
const floorOf = (p) => p.evaluate(() => ({ phase: window.__gdr.net.state.phase, solo: window.__gdr.net.state.solo, members: window.__gdr.net.state.members.map((m) => m.name), myIdx: window.__gdr.net.state.myIdx, code: window.__gdr.net.state.code }));
await toucher.waitForFunction(() => window.__gdr.net.state.members.length >= 2, { timeout: 10000 }).catch(() => {});
let fa = await floorOf(caller);
let fb = await floorOf(toucher);
check('two headsets share the public floor through the room server', !fa.solo && !fb.solo && fa.code === fb.code && fa.members.length === 2 && fb.members.length === 2, JSON.stringify({ caller: fa, toucher: fb }));

// The caller opens the desk's FIGHT tab, picks 2V2 and CALLS THE BALL.
await caller.evaluate(() => {
  window.__gdr.menu.press('tab-fight');
  window.__gdr.menu.press('fight-2v2');
  window.__gdr.menu.press('call');
});
const ballUp = await toucher.waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 8000 }).then(() => true).catch(() => false);
const ballOf = (p) => p.evaluate(() => { const b = window.__gdr.net.state.ball; return b ? { mode: b.mode, code: b.code, caller: b.callerName, joins: [...b.joins] } : null; });
let ba = await ballOf(caller);
let bb = await ballOf(toucher);
check('the ball rises carrying the fight and its arena room', ballUp && ba?.mode === '2v2' && /^P\d{4}$/.test(ba.code) && bb?.mode === '2v2' && bb.code === ba.code && ba.caller === 'CALLER', JSON.stringify({ caller: ba, toucher: bb }));
const plate = await toucher.evaluate(() => !!window.__gdr.scene().getObjectByName('raid-ball'));
check("the mirror ball hangs on the toucher's floor too", plate);
// The toucher touches in.
await toucher.evaluate(() => window.__gdr.club.touch(true));
await caller.waitForFunction(() => window.__gdr.net.state.ball?.joins.size === 1, { timeout: 5000 }).catch(() => {});
ba = await ballOf(caller);
check('a touch puts a pip on the ball', ba?.joins.length === 1, JSON.stringify(ba));

// The caller sees everyone is in and presses START rather than riding the
// clock down: the relay deals whoever is on the ball, and both cross.
await caller.evaluate(() => window.__gdr.club.go());
const crossed = await Promise.all([caller, toucher].map((p) => p.waitForFunction(() => window.__town.place === 'arena' && !window.__town.busy, { timeout: 20000 }).then(() => true).catch(() => false)));
const bellOf = (p) => p.evaluate(() => { const b = window.__town.bell(); return { role: b.deal?.role, mine: b.deal?.mine, mode: b.deal?.mode, code: b.deal?.code, fighters: b.deal?.fighters.map((f) => f.name), state: b.state, lobbyMode: b.lobbyMode, privateCode: b.privateCode, phase: window.__gdr.net.state.phase, away: window.__gdr.net.state.dealtAway }; });
let da = await bellOf(caller);
let db = await bellOf(toucher);
check('the bell deals both to the arena under the curtain', crossed[0] && crossed[1] && da.mode === '2v2' && db.mode === '2v2', JSON.stringify({ caller: da, toucher: db }));
check('the caller hosts, the toucher fights, and both stand in the 2V2 lobby', da.mine === true && db.mine === false && da.role === 'fighter' && db.role === 'fighter' && da.lobbyMode === '2v2' && db.lobbyMode === '2v2' && da.privateCode === ba.code && db.privateCode === ba.code && da.state === 'menu', JSON.stringify({ caller: da, toucher: db }));
check('both keep their place in the room while away', da.phase === 'live' && db.phase === 'live' && da.away && db.away, JSON.stringify({ a: da.phase, b: db.phase }));
const inSessionBoth = await Promise.all([caller, toucher].map((p) => p.evaluate(() => document.body.classList.contains('app-entered'))));
check('the XR sessions never ended', inSessionBoth[0] && inSessionBoth[1]);

// The fight is over: everyone folds back to the floor, and the relay
// hears them come home.
await Promise.all([caller, toucher].map((p) => p.evaluate(() => window.__town.foldHome())));
await Promise.all([caller, toucher].map((p) => p.waitForFunction(() => window.__town.place === 'venue' && !window.__town.busy, { timeout: 20000 }).catch(() => {})));
await caller.waitForFunction(() => window.__gdr.net.state.gamePlayers.size === 0, { timeout: 5000 }).catch(() => {});
fa = await floorOf(caller);
fb = await floorOf(toucher);
const homeA = await bellOf(caller);
const homeB = await bellOf(toucher);
check('and fold home to the same floor, in the same room, nobody OUT', fa.phase === 'hosting' && fb.phase === 'joined' && fa.code === fb.code && fa.members.length === 2 && !homeA.away && !homeB.away && homeA.lobbyMode === null, JSON.stringify({ caller: fa, toucher: fb, a: homeA, b: homeB }));
const dealt = relayLog.find((l) => l.includes('the bell'));
check("the relay's log names the deal", !!dealt, dealt);

// A DUEL from the bell rides the mesh like a brawl — the only way its
// watchers get seats — so the caller's 1V1 lands both in a 1V1 LOBBY, not
// on the two-peer duel wire.
await caller.evaluate(() => {
  window.__gdr.menu.press('fight-1v1');
  window.__gdr.menu.press('call');
});
const duelUp = await toucher.waitForFunction(() => window.__gdr.net.state.ball?.mode === '1v1', { timeout: 8000 }).then(() => true).catch(() => false);
await toucher.evaluate(() => window.__gdr.club.touch(true));
await caller.waitForFunction(() => window.__gdr.net.state.ball?.joins.size === 1, { timeout: 5000 }).catch(() => {});
await caller.evaluate(() => window.__gdr.club.go());
await Promise.all([caller, toucher].map((p) => p.waitForFunction(() => window.__town.place === 'arena' && !window.__town.busy, { timeout: 20000 }).catch(() => {})));
const dA = await bellOf(caller);
const dB = await bellOf(toucher);
check('a 1V1 from the bell is dealt into a mesh lobby, watchers welcome', duelUp && dA.mode === '1v1' && dA.lobbyMode === '1v1' && dB.lobbyMode === '1v1' && dA.role === 'fighter' && dB.role === 'fighter', JSON.stringify({ caller: dA, toucher: dB }));
await Promise.all([caller, toucher].map((p) => p.evaluate(() => window.__town.foldHome())));
await Promise.all([caller, toucher].map((p) => p.waitForFunction(() => window.__town.place === 'venue' && !window.__town.busy, { timeout: 20000 }).catch(() => {})));
const paid = await caller.evaluate(() => ({ visit: window.__gdr.mc.visit, lastPay: window.__gdr.bell?.lastPay ?? null }));
check('the house pays on the homecoming', paid.lastPay !== null && paid.lastPay >= 5, JSON.stringify(paid));
await caller.close();
await toucher.close();
relay.kill();

check('no page errors along the way', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
