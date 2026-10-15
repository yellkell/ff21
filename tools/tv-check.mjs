#!/usr/bin/env node
/**
 * THE CHANNEL and THE TAPE, headless.
 *
 *   npm run dev              # terminal 1 (the stats page is served from public/)
 *   node tools/tv-check.mjs
 *
 * Stands THE ROOM SERVER up on a spare port, plays a fake caster into its
 * /tv relay (a duel's frames, then a sign-off), watches it back through a
 * viewer socket and the /guide endpoint, and asks the bot's invite path
 * to refuse what it should. Then it opens public/stats.html in headless
 * Chromium pointed at that relay and checks THE CHANNEL draws the match
 * and falls back to the club when the caster leaves; walks the FIRE FIGHT
 * rail onto SPEEDRUN and its difficulty sub-rail, then onto THE LAB, and
 * feeds it fixture tapes to check the tiles, the heatmaps, the filter and
 * the play-by-play. Finally it round-trips the lobby's QR encoder against
 * the module's own shape rules (finder patterns, a square, an odd size).
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const PORT = Number(process.env.TV_PORT || 8799);
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the room server on a spare port ─────────────────────────────────── */
const server = spawn(process.execPath, ['server/room.mjs'], { env: { ...process.env, PORT: String(PORT), BALL_MS: '4000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://localhost:${PORT}/tv/guide`);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(250);
}

console.log('=== the relay: a caster, a viewer, the guide ===');
const guide0 = await fetch(`http://localhost:${PORT}/tv/guide`).then((r) => r.json());
check('the guide answers with no channels and a dark club', Array.isArray(guide0.channels) && guide0.channels.length === 0 && guide0.club.people === 0, JSON.stringify(guide0));

const open = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
const inbox = (ws) => {
  const q = [];
  ws.on('message', (raw) => q.push(JSON.parse(raw.toString())));
  return q;
};

const viewer = await open(`ws://localhost:${PORT}/tv`);
const seen = inbox(viewer);
viewer.send(JSON.stringify({ t: 'watch' }));
await sleep(300);
check('a viewer with nothing on is shown the club', seen.some((m) => m.t === 'guide') && seen.some((m) => m.t === 'club'), seen.map((m) => m.t).join(','));

// THE FLOOR'S PICTURE rides beside the club feed rather than as a channel
// (src/rave/systems/ClubCastSystem.ts), so it reaches whoever is peeping
// at the club and changes nothing about what the guide says is on air.
// It has to be tested with nothing else running: auto-tune prefers a live
// bout over the floor, and a viewer cannot be pinned to the club.
const floorCam = await open(`ws://localhost:${PORT}/tv`);
floorCam.send(JSON.stringify({ t: 'cv', d: 'FLOORPIC' }));
await sleep(250);
const guideC = await fetch(`http://localhost:${PORT}/tv/guide`).then((r) => r.json());
check('the club picture reaches a club viewer without becoming a channel',
  seen.some((m) => m.t === 'cv' && m.d === 'FLOORPIC') && guideC.channels.length === 0,
  `${guideC.channels.length} channel(s), ${seen.filter((m) => m.t === 'cv').length} picture(s)`);

const lateClub = await open(`ws://localhost:${PORT}/tv`);
const lateClubIn = inbox(lateClub);
lateClub.send(JSON.stringify({ t: 'watch' }));
await sleep(250);
check('a viewer arriving at a lit floor is handed its picture', lateClubIn.some((m) => m.t === 'cv' && m.d === 'FLOORPIC'), lateClubIn.map((m) => m.t).join(','));
lateClub.close();

// The camera walking out takes the picture with it: the map comes back.
floorCam.close();
await sleep(300);
const afterCam = await open(`ws://localhost:${PORT}/tv`);
const afterCamIn = inbox(afterCam);
afterCam.send(JSON.stringify({ t: 'watch' }));
await sleep(250);
check('when the floor camera leaves, the picture goes with it', !afterCamIn.some((m) => m.t === 'cv'), afterCamIn.map((m) => m.t).join(','));
afterCam.close();

const caster = await open(`ws://localhost:${PORT}/tv`);
const casterIn = inbox(caster);
caster.send(JSON.stringify({ t: 'cast', kind: '1v1', title: 'PROBE vs ROOK', names: ['PROBE', 'ROOK'] }));
const frame = (t) => ({
  ph: 'playing', rd: 1, tm: 60 - t, sc: [0, 0], msg: t < 1 ? 'FIGHT' : '',
  p: [
    { n: 'PROBE', t: 0, hp: 0.8, h: [0.1 * Math.sin(t), 1.55, 0.1], l: [-0.2, 1.1, -0.3], r: [0.25, 1.2, -0.4], yaw: 0, pl: [0, 0, 0] },
    { n: 'ROOK', t: 1, hp: 0.6, h: [0.05, 1.5, -3.0], l: [-0.2, 1.1, -2.7], r: [0.2, 1.1, -2.7], yaw: 3.14, pl: [0, -3, 3.14] },
  ],
  b: [[0, 0.1, 1.3, -1.2 - t * 0.5, 2, 0.09], [1, -0.1, 1.2, -2.6, 1, 0.09]],
});
for (let i = 0; i < 6; i++) {
  caster.send(JSON.stringify({ t: 'f', f: frame(i * 0.2) }));
  await sleep(120);
}
// …and keep casting while the page looks, or the relay rightly expires the
// channel as "signal lost" before headless Chromium has even launched.
let castT = 1.2;
const casting = setInterval(() => {
  castT += 0.2;
  if (caster.readyState === WebSocket.OPEN) caster.send(JSON.stringify({ t: 'f', f: frame(castT) }));
}, 200);
await sleep(300);
check('the caster is told it is on air', casterIn.some((m) => m.t === 'on-air' && m.id), JSON.stringify(casterIn[0]));
const guide1 = await fetch(`http://localhost:${PORT}/tv/guide`).then((r) => r.json());
check('the guide lists the duel as featured', guide1.channels.length === 1 && guide1.channels[0].title === 'PROBE vs ROOK' && guide1.featured === guide1.channels[0].id, JSON.stringify(guide1.channels));
const frames = seen.filter((m) => m.t === 'f');
check('the viewer auto-tunes to it and receives its frames', frames.length >= 4 && frames.at(-1).f.p.length === 2, `${frames.length} frames`);

// THE PICTURE. The channel carries a render as well as the pose frame
// (src/net/tvVideo.ts); the relay forwards it to whoever is tuned in and
// keeps the latest so a viewer arriving mid-bout sees it at once.
caster.send(JSON.stringify({ t: 'v', d: 'PICTUREONE' }));
await sleep(220);
const pics = seen.filter((m) => m.t === 'v');
check('a picture reaches the viewer tuned to that channel', pics.length >= 1 && pics.at(-1).d === 'PICTUREONE' && pics.at(-1).id, JSON.stringify(pics.at(-1)));

const late = await open(`ws://localhost:${PORT}/tv`);
const lateIn = inbox(late);
late.send(JSON.stringify({ t: 'watch' }));
await sleep(250);
check('a viewer arriving mid-bout is handed the last picture', lateIn.some((m) => m.t === 'v' && m.d === 'PICTUREONE'), lateIn.map((m) => m.t).join(','));
late.close();

// A picture over the cap is dropped without touching the channel: the
// pose frame is what keeps a bout on air, so television degrades to the
// diagram rather than going dark.
caster.send(JSON.stringify({ t: 'v', d: 'X'.repeat(100 * 1024) }));
await sleep(220);
const guideV = await fetch(`http://localhost:${PORT}/tv/guide`).then((r) => r.json());
check('an oversized picture is dropped and the bout stays on air',
  !seen.some((m) => m.t === 'v' && m.d.length > 99000) && guideV.channels.some((c) => c.title === 'PROBE vs ROOK'),
  `${seen.filter((m) => m.t === 'v').length} pictures through`);


// An oversized frame: `ws` hangs up on a socket that exceeds maxPayload,
// so this goes on a throwaway caster — the duel must not even flicker.
const bully = await open(`ws://localhost:${PORT}/tv`);
bully.send(JSON.stringify({ t: 'cast', kind: 'solo', title: 'BULLY', names: ['BULLY'] }));
await sleep(150);
bully.send(JSON.stringify({ t: 'f', f: { pad: 'x'.repeat(20000) } }));
await sleep(400);
const guideB = await fetch(`http://localhost:${PORT}/tv/guide`).then((r) => r.json());
check('an oversized frame drops its caster and leaves the duel on air', !seen.some((m) => m.t === 'f' && m.f.pad) && bully.readyState !== WebSocket.OPEN && guideB.channels.some((c) => c.title === 'PROBE vs ROOK'), `${guideB.channels.map((c) => c.title).join(',')}`);

const invite = await fetch(`http://localhost:${PORT}/tv/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '12345', mode: '2v2', name: 'PROBE', open: 2 }) }).then((r) => r.json());
check('an invite with no bot token is refused as "bot off"', invite.posted === false && invite.reason === 'bot off', JSON.stringify(invite));
const invite2 = await fetch(`http://localhost:${PORT}/tv/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '12', mode: '2v2', name: 'PROBE' }) }).then((r) => r.json());
check('a malformed code is refused', invite2.posted === false && invite2.reason === 'bad code', JSON.stringify(invite2));

/* ── the page ────────────────────────────────────────────────────────── */
console.log('\n=== stats.html: THE CHANNEL ===');
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/stats.html?tv=ws://localhost:${PORT}/tv#tv`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
const tvOpen = await page.evaluate(() => !document.getElementById('face-tv').classList.contains('hidden'));
check('#tv opens FFTV', tvOpen);
const fftv = await page.evaluate(() => ({ tab: document.getElementById('tab-tv').textContent.trim(), mark: document.getElementById('wordmark').textContent.replace(/\s+/g, '') }));
check('the face is called FFTV', fftv.tab === 'FFTV' && fftv.mark === 'FFTV', JSON.stringify(fftv));
const onair = await page.evaluate(() => ({ badge: document.getElementById('tv-onair').textContent, title: document.getElementById('tv-title').textContent, guide: document.getElementById('tv-guide').textContent }));
check('the TV shows the duel on air', /LIVE/.test(onair.badge) && /PROBE vs ROOK/.test(onair.title), JSON.stringify(onair));
check('the guide strip lists the channel', /PROBE vs ROOK/.test(onair.guide), onair.guide.slice(0, 80));
const painted = await page.evaluate(() => {
  const c = document.getElementById('tv-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 200) lit++;
  return lit;
});
check('the broadcast canvas is painted', painted > 200, `${painted} bright samples`);
const tvState = await page.evaluate(() => window.__ffTv?.state());
check('the page keeps two fighters, two balls and a round clock', tvState && tvState.frame?.p?.length === 2 && tvState.frame?.b?.length === 2 && typeof tvState.frame?.tm === 'number', JSON.stringify(tvState?.frame?.sc));

// THE PICTURE, on the page. A real JPEG is made in the browser (node has
// no encoder here), pushed through the relay by the caster, and the canvas
// is read back: the picture's own colours must reach the screen, and the
// moment they stop arriving the diagram must come back.
const jpeg = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 144;
  const g = c.getContext('2d');
  g.fillStyle = '#101a2e';
  g.fillRect(0, 0, 256, 144);
  g.fillStyle = '#12ff6a'; // a green nothing in the diagram ever draws
  g.fillRect(0, 0, 256, 90);
  return c.toDataURL('image/jpeg', 0.6).split(',')[1];
});
for (let i = 0; i < 3; i++) {
  caster.send(JSON.stringify({ t: 'f', f: frame(castT) }));
  caster.send(JSON.stringify({ t: 'v', d: jpeg }));
  await sleep(160);
}
await sleep(500);
const shown = await page.evaluate(() => {
  const c = document.querySelector('#face-tv canvas');
  const g = c.getContext('2d');
  const count = () => {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let green = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] > 200 && d[p] < 120 && d[p + 1] > 170 && d[p + 2] < 150) green++;
    }
    return green;
  };
  drawTv(performance.now());
  const withPic = count();
  const had = tvHasPicture();
  // Age it past VIDEO.staleMs and draw again: the diagram must take over.
  tv.picAt = performance.now() - 9000;
  drawTv(performance.now());
  return { withPic, stale: count(), had };
});
check('the page draws the caster\'s picture, not the diagram', shown.had && shown.withPic > 400, `${shown.withPic} px of the picture`);
check('when the pictures stop the diagram comes back', shown.stale < shown.withPic / 8, `${shown.withPic} → ${shown.stale}`);

clearInterval(casting);
caster.send(JSON.stringify({ t: 'end', result: 'PROBE 3–1' }));
await sleep(900);
const after = await page.evaluate(() => ({ badge: document.getElementById('tv-onair').textContent, title: document.getElementById('tv-title').textContent }));
check('when the caster signs off the TV peeps into the club', !/LIVE/.test(after.badge) && /CLUB/i.test(after.title), JSON.stringify(after));

console.log('\n=== stats.html: the FIRE FIGHT rail ===');
// Back to FIRE FIGHT, and onto SPEEDRUN — which is the board that used to
// be called GAUNTLET, and the only one with a difficulty rail under it.
await page.evaluate(() => document.getElementById('tab-ff').click());
await page.waitForTimeout(400);
const railLabels = await page.evaluate(() =>
  [...document.querySelectorAll('#board-rail .rail-tab')].map((b) => b.textContent.trim()),
);
check('the rail names SPEEDRUN, not GAUNTLET', railLabels.includes('Speedrun') && !railLabels.some((l) => /gauntlet/i.test(l)), railLabels.join(', '));
check('THE LAB is a board of the FIRE FIGHT rail', railLabels.includes('The Lab'), railLabels.join(', '));
// The boards lost their descriptions: the title and the column caps say
// what a board is, and a sentence under each said it a second time.
const noNotes = await page.evaluate(() => ({
  gone: !document.getElementById('ff-note'),
  caps: document.getElementById('ff-caps').textContent,
}));
check('no description sits under a board', noNotes.gone, JSON.stringify(noNotes));
check('the board caps say PLAYER, not BOXER', /Player/.test(noNotes.caps) && !/Boxer/i.test(noNotes.caps), noNotes.caps);

const tiers = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('#board-rail .rail-tab')].find((b) => b.textContent.trim() === 'Speedrun');
  tab.click();
  return {
    shown: !document.getElementById('tier-rail').classList.contains('hidden'),
    labels: [...document.querySelectorAll('#tier-rail .rail-tab')].map((b) => b.textContent.trim()),
  };
});
await page.waitForTimeout(500);
// The run boards race the clock, one tier at a time — the three tiers, then
// each again for hardcore runs. (No FEATS view.)
check('SPEEDRUN opens a difficulty sub-rail, no feats', tiers.shown && tiers.labels.join(',') === 'Normal,Hard,Blazing,Normal HC,Hard HC,Blazing HC', tiers.labels.join(','));
const tierSwitch = await page.evaluate(async () => {
  const tab = [...document.querySelectorAll('#tier-rail .rail-tab')].find((b) => b.textContent.trim() === 'Blazing');
  tab.click();
  await new Promise((r) => setTimeout(r, 400));
  return {
    title: document.getElementById('ff-title').textContent,
    selected: [...document.querySelectorAll('#tier-rail .rail-tab')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent.trim(),
  };
});
check('picking a tier retitles the board', /blazing/i.test(tierSwitch.title) && tierSwitch.selected === 'Blazing', JSON.stringify(tierSwitch));
const otherRail = await page.evaluate(async () => {
  const tab = [...document.querySelectorAll('#board-rail .rail-tab')].find((b) => b.textContent.trim() === 'Ranked');
  tab.click();
  await new Promise((r) => setTimeout(r, 200));
  return document.getElementById('tier-rail').classList.contains('hidden');
});
check('a board with no tiers hides the sub-rail', otherRail === true);

console.log('\n=== stats.html: THE LAB ===');
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('#board-rail .rail-tab')].find((b) => b.textContent.trim() === 'The Lab');
  tab.click();
});
await page.waitForTimeout(400);
const labShown = await page.evaluate(() => ({
  lab: !document.getElementById('lab').classList.contains('hidden'),
  stage: document.getElementById('ff-stage').classList.contains('hidden'),
}));
check('THE LAB replaces the board stage inside FIRE FIGHT', labShown.lab && labShown.stage, JSON.stringify(labShown));
// Opening the tab starts the page's own pull from the live tape room. Let
// it land (or fail) before the fixture goes in: a slow reply arriving
// after the inject replaces the fixture with whatever is live — on CI,
// often nothing.
await page.waitForFunction(
  () => window.__ffLab.state().loaded || /UNREACHABLE/.test(document.getElementById('lab-status').textContent),
  null,
  { timeout: 15000 },
);
const grid = (fill) => Array.from({ length: 16 * 14 }, (_, i) => fill(i));
const fixture = (n, win, names) => ({
  id: `fx${n}`,
  data: {
    v: 1, kind: '1v1', net: true, quick: false, ranked: false, uid: 'u1', name: names[0], names, win,
    score: win ? [3, 1] : [1, 3], dur: 150 + n, at: new Date(Date.now() - n * 3600e3).toISOString(),
    rounds: [{ n: 1, out: 'win', res: 'ko', hp: [40, 0], dur: 30 }, { n: 2, out: 'loss', res: 'time', hp: [20, 45], dur: 60 }],
    thr: { n: 40, l: 15, r: 25, spd: 6.2 }, hits: { dealt: 14, taken: 11, head: 4, ret: 2, dealtL: 5, dealtR: 9, takenHead: 3 }, par: 3,
    grid: { w: 16, h: 14, stand: grid((i) => (i % 16 > 5 && i % 16 < 10 ? 8 : 1)), thrL: grid((i) => (i % 16 < 6 ? 3 : 0)), thrR: grid((i) => (i % 16 > 9 ? 3 : 0)), land: grid((i) => (i >= 160 ? 2 : 0)), hit: grid((i) => (i < 40 ? 2 : 0)) },
    ev: [[0.5, 0, 1, 0.2, -0.3, 6.1, 0.1, 0.1], [2.1, 1, 0, 0.1, 0.1, 20, 1, 0, 0, -1], [2.6, 5, 0, 1, 3], [3.0, 2, 1, 25, 0, 0], [4.2, 3, 0], [12, 5, 1, 0, 1], [30, 4, 1, 0, 0, 40, 0], [90, 4, 2, 1, 1, 20, 45]],
    att: { mine: [0, 0, 0, 1], theirs: [0, 1, 0, 0] },
    dropped: 0,
  },
});
const labState = await page.evaluate((bouts) => {
  window.__ffLab.inject(bouts);
  return {
    tiles: document.getElementById('lab-tiles').textContent,
    players: [...document.getElementById('lab-player').options].map((o) => o.value),
    count: document.getElementById('lab-count').textContent,
    tape: document.getElementById('lab-tape').textContent,
    // A signature per map: how much is painted, and where it sits. Two maps
    // drawing the same grid would match on all three.
    //
    // ALPHA FIRST. getImageData hands back UNMULTIPLIED channels, so the
    // faint white wash the octagon's floor is filled with — 3% alpha —
    // reads as red 255 and counts as blazing hot if you only look at the
    // colour. It fooled an earlier version of this check into passing four
    // identical maps. A cell the heat actually painted is opaque; the wash
    // never is.
    // THE LAB's own maps — the profile's three sit hidden further down.
    heat: [...document.querySelectorAll('#lab canvas.heat')].map((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0, sx = 0, sy = 0;
      for (let p = 0; p < d.length / 4; p++) {
        if (d[p * 4 + 3] < 200 || d[p * 4] <= 120) continue;
        lit++;
        sx += p % c.width;
        sy += Math.floor(p / c.width);
      }
      return { lit, cx: lit ? Math.round(sx / lit) : 0, cy: lit ? Math.round(sy / lit) : 0 };
    }),
  };
}, [fixture(1, true, ['PROBE', 'ROOK']), fixture(2, false, ['PROBE', 'VULT'])]);
check('the LAB tiles read the two tapes', /2/.test(labState.tiles) && /TAPES/i.test(labState.tiles), labState.tiles.replace(/\s+/g, ' ').slice(0, 120));
check('the player picker names whoever kept a tape', labState.players.includes('PROBE'), labState.players.join(','));
check('the count line reads the filter', /2 of 2 tapes/.test(labState.count), labState.count);
// THE SEARCH: type a name and both the list and the picker narrow to it.
const search = await page.evaluate(async () => {
  const box = document.getElementById('lab-search');
  box.value = 'vult';
  box.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 50));
  const hit = { rows: document.querySelectorAll('#lab-tape .tape-row').length, count: document.getElementById('lab-count').textContent, opts: [...document.getElementById('lab-player').options].length };
  box.value = 'zzz';
  box.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 50));
  const miss = document.getElementById('lab-status').querySelector('.line').textContent;
  box.value = '';
  box.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 50));
  return { hit, miss, back: document.querySelectorAll('#lab-tape .tape-row').length };
});
check('searching a name narrows the tapes', search.hit.rows === 1 && /1 of 2 tapes/.test(search.hit.count), JSON.stringify(search.hit));
check('a search with no match says so, and clearing it comes back', /NOTHING MATCHES/.test(search.miss) && search.back === 2, JSON.stringify({ miss: search.miss, back: search.back }));
check('all five heatmaps are painted', labState.heat.length === 5 && labState.heat.every((h) => h.lit > 50), labState.heat.map((h) => h.lit).join(','));
// The fixture puts the left fist's throws left of centre and the right
// fist's right of it, so those two maps must not share a centre of mass.
const sigs = new Set(labState.heat.map((h) => `${h.lit}:${h.cx}:${h.cy}`));
check('each heatmap draws its own grid, not the same one five times', sigs.size === 5, [...sigs].join(' | '));
check('the landing map sits at the back, where the fixture put it', labState.heat[3].cy > labState.heat[4].cy, `land cy ${labState.heat[3].cy} vs hit cy ${labState.heat[4].cy}`);
check('the left fist throws left of the right fist', labState.heat[1].cx < labState.heat[2].cx, `L cx ${labState.heat[1].cx} vs R cx ${labState.heat[2].cx}`);
check('THE TAPE lists both bouts', /ROOK/.test(labState.tape) && /VULT/.test(labState.tape), labState.tape.slice(0, 100));
const play = await page.evaluate(() => {
  const row = document.querySelector('#lab-tape .tape-row');
  row.click();
  return document.querySelector('#lab-tape .tape-open')?.textContent ?? '';
});
// THE LAB speaks of a PLAYER and an OPPONENT: a tape in here may be
// anybody's, so second person has no place in it.
const voice = await page.evaluate(() => ({
  lab: document.getElementById('lab').textContent,
  maps: [...document.querySelectorAll('#lab .maps figcaption')].map((f) => f.textContent).join(' '),
}));
check('THE LAB never says "you"', !/\byou\b|\byour\b|\byours\b/i.test(voice.lab), (/\byou\b|\byour\b|\byours\b/i.exec(voice.lab) || ['—'])[0]);
check('the maps name the player and the opponent', /player/i.test(voice.maps) && /opponent/i.test(voice.maps), voice.maps.slice(0, 120));
check('a bout opens into its play-by-play and rounds', /KO/.test(play) && /throw|threw/i.test(play), play.replace(/\s+/g, ' ').slice(0, 120));
check('the open tape names the attachments each side fired', /SHRINK ×1/.test(play) && /SPLIT ×1/.test(play), play.replace(/\s+/g, ' ').slice(0, 200));
const tl = await page.evaluate(() => {
  const c = document.querySelector('#lab-tape .tape-open canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  // The two pools are drawn in their own colours; the lanes carry the acts.
  let ember = 0, cool = 0, amber = 0;
  for (let p = 0; p < d.length / 4; p++) {
    const r = d[p * 4], g2 = d[p * 4 + 1], b2 = d[p * 4 + 2], a = d[p * 4 + 3];
    if (a < 200) continue;
    if (r > 200 && g2 > 90 && g2 < 160 && b2 < 70) ember++;
    else if (r < 130 && g2 > 150 && b2 > 200) cool++;
    else if (r > 220 && g2 > 150 && g2 < 200 && b2 < 90) amber++;
  }
  return { h: c.height, ember, cool, amber };
});
check('the timeline draws both health lines and the attachment pips', tl.h === 224 && tl.ember > 200 && tl.cool > 200 && tl.amber > 30, JSON.stringify(tl));

// THE MATCH LOG: the lab's second view, and it lists MATCHES — a solo run,
// a raid and a boss are tapes, not matches, and belong to the breakdown.
const logView = await page.evaluate(async () => {
  const pick = (t) => [...document.querySelectorAll('#lab-rail .rail-tab')].find((b) => new RegExp(t, 'i').test(b.textContent));
  const labels = [...document.querySelectorAll('#lab-rail .rail-tab')].map((b) => b.textContent.trim());
  pick('match log').click();
  await new Promise((r) => setTimeout(r, 250));
  const log = {
    kinds: [...document.querySelectorAll('#lab-tape .tape-row .kind')].map((e) => e.textContent.trim()),
    count: document.getElementById('lab-count').textContent,
    breakHidden: document.getElementById('lab-view-break').classList.contains('hidden'),
    maps: [...document.querySelectorAll('#lab-view-break canvas.heat')].length,
  };
  pick('breakdown').click();
  await new Promise((r) => setTimeout(r, 250));
  const back = {
    logHidden: document.getElementById('lab-view-log').classList.contains('hidden'),
    count: document.getElementById('lab-count').textContent,
  };
  return { labels, log, back };
});
check('THE LAB opens on the breakdown with a match log beside it', logView.labels.join(',') === 'Breakdown,Match log', logView.labels.join(','));
check('the match log hides the breakdown and lists only matches',
  logView.log.breakHidden && logView.log.kinds.every((k) => ['1V1', '2V2', 'FFA'].includes(k)),
  `${logView.log.kinds.join(',') || 'no rows'} · ${logView.log.count}`);
check('the breakdown still counts every tape', /tape/.test(logView.back.count) && logView.back.logHidden, logView.back.count);

console.log('\n=== stats.html: THE PROFILE ===');
await page.evaluate(() => document.querySelector('#lab-tape .who-link').click());
await page.waitForFunction(() => /RECORD IS IN|NO PROFILE|UNREACHABLE/.test(document.getElementById('profile-chip-text').textContent), { timeout: 30000 }).catch(() => {});
const prof = await page.evaluate(() => ({
  shown: !document.getElementById('profile').classList.contains('hidden'),
  railHidden: document.getElementById('board-rail').classList.contains('hidden'),
  name: document.getElementById('profile-name').textContent,
  rank: document.getElementById('profile-rank').textContent,
  chip: document.getElementById('profile-chip-text').textContent,
  hash: location.hash,
  // A profile is the service record: it carries the player's own MATCH LOG
  // (their tapes are part of that record) but never the Lab BENCH — the
  // heatmaps and the hand and damage breakdowns are questions about the
  // game rather than about a person, and they stay in the Lab.
  bench: document.querySelectorAll('#profile canvas.heat, #profile .hands').length,
  log: document.querySelectorAll('#profile #profile-tape .tape-row').length,
  logKinds: [...document.querySelectorAll('#profile #profile-tape .tape-row .kind')].map((e) => e.textContent.trim()),
}));
check('tapping a name opens the profile over the rail', prof.shown && prof.railHidden, JSON.stringify({ shown: prof.shown, railHidden: prof.railHidden }));
check('the profile names the player and a rank', prof.name === 'PROBE' && /BRONZE|SILVER|GOLD/.test(prof.rank), `${prof.name} / ${prof.rank}`);
check('the address deep-links the player', /^#player=u1$/.test(prof.hash), prof.hash);
check('the profile carries no lab bench', prof.bench === 0, `${prof.bench} bench elements`);
check("the profile lists the player's own matches", prof.log > 0 && prof.logKinds.every((k) => ['1V1', '2V2', 'FFA'].includes(k)), `${prof.log} row(s): ${prof.logKinds.join(',') || 'none'}`);
const back = await page.evaluate(() => {
  document.getElementById('profile-back').click();
  return { shown: !document.getElementById('profile').classList.contains('hidden'), rail: !document.getElementById('board-rail').classList.contains('hidden'), hash: location.hash };
});
check('BACK returns to the rail', !back.shown && back.rail, JSON.stringify(back));
const banner = await page.evaluate(() => {
  // A painted look renders; a bare one leaves the canvas clear.
  const c = document.createElement('canvas');
  c.width = 400; c.height = 108;
  // Format 3, one unit: kind stripe (0) | part body (1) << 2 = 4; colour 9 (EMBER), u 0.5, v 0.5, angle 0, len 0.6, wid 0.5.
  const bytes = [3, 4, 9, 0, 128, 128, 0, 153, 128];
  const wire = btoa(String.fromCharCode(...bytes));
  const painted = paintBanner(c, wire, 'white');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ember = 0;
  for (let p = 0; p < d.length / 4; p++) if (d[p * 4] > 200 && d[p * 4 + 1] < 140 && d[p * 4 + 2] < 80) ember++;
  return { painted, ember, bare: paintBanner(c, '', 'white') };
});
check('the painting bakes from the packed look', banner.painted && banner.ember > 500 && banner.bare === false, JSON.stringify(banner));

// The page must read the NEW project, and read boards the way the rules
// allow — per board, never as a collection group.
const wiring = await page.evaluate(async () => {
  const src = await fetch('/stats.html').then((r) => r.text());
  return {
    project: /flappy-ff9f6/.test(src),
    old: /arfi-b68f9|raveraid-bc866/.test(src),
    boardParent: /parent: `boards\//.test(src),
    // One board per feat, named from its family and tier (net/boards.ts
    // runBoard): ff2-speedrun-<tier>-time, -hc-time.
    speedrun: /family: 'speedrun'/.test(src) && /`ff2-\$\{family\}-\$\{t\.id\}-time`/.test(src),
  };
});
check('the page reads the ff2.web.app project', wiring.project && !wiring.old, JSON.stringify(wiring));
check('boards are read per board, not as a collection group', wiring.boardParent && wiring.speedrun, JSON.stringify(wiring));

// THE TAPES ARE LEASED. `bouts` is the one collection here that grows a
// document per bout rather than one row per player, and Spark has no TTL —
// so the reader must filter on the lease (an expired tape is invisible at
// once, and the page cannot quietly pull two hundred of them a visit).
const lease = await page.evaluate(async () => {
  const src = await fetch('/stats.html').then((r) => r.text());
  const cfg = await fetch('/src/config.ts').then((r) => r.text());
  const q = /runQuery\('bouts', \{([\s\S]{0,400}?)\}\)/.exec(src);
  return {
    q: q ? q[1].replace(/\s+/g, ' ') : '',
    keepDays: /keepDays: (\d+)/.exec(cfg)?.[1],
    sweeps: /sweepBouts/.test(await fetch('/src/net/leaderboard.ts').then((r) => r.text())),
  };
});
check('the tape query filters on the lease and orders by it', /expiresAt/.test(lease.q) && /GREATER_THAN/.test(lease.q), lease.q.slice(0, 140));
check('the tape query does not pull the whole collection', /limit: (\d\d?),/.test(lease.q), (/limit: \d+/.exec(lease.q) || ['—'])[0]);
check('tapes carry a keep window and the clients sweep', Number(lease.keepDays) > 0 && lease.sweeps, `${lease.keepDays} days, sweep ${lease.sweeps}`);
check('no page errors', errors.length === 0, errors[0]);

/* ── the QR encoder ──────────────────────────────────────────────────── */
console.log('\n=== the faces wear their own colours ===');
const faceInk = await page.evaluate(() => {
  const ink = () => getComputedStyle(document.querySelector('#wordmark .a')).color;
  document.getElementById('tab-ff').click();
  const ff = ink();
  document.getElementById('tab-rr').click();
  const rr = ink();
  document.getElementById('tab-tv').click();
  const tv = ink();
  document.getElementById('tab-ff').click();
  return { ff, rr, tv };
});
check("each game wears its own wordmark, not FIRE FIGHT's everywhere", faceInk.rr !== faceInk.ff && faceInk.tv !== faceInk.ff && faceInk.rr === 'rgb(185, 255, 196)', JSON.stringify(faceInk));

console.log('\n=== the club house camera ===');
{
  // FFTV's club feed is shot by a camera BOLTED TO THE ROOM, not carried by
  // whoever holds it (rave/club/config.ts CLUB.cctv). The first cut rode
  // three metres behind the host and turned with their head, so the shot
  // swung whenever they looked at something and the feed was a portrait of
  // one player rather than a picture of the club. These numbers are what
  // make it a camera in the corner of the ceiling instead.
  const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const club = src('src/rave/club/config.ts');
  const conf = src('src/config.ts');
  const cast = src('src/rave/systems/ClubCastSystem.ts');
  const num = (re, from) => Number(re.exec(from)?.[1]);
  const halfW = num(/halfW: ([\d.]+)/, club);
  const minZ = num(/minZ: (-?[\d.]+)/, club);
  const maxZ = num(/maxZ: (-?[\d.]+)/, club);
  const ceilH = num(/ceilH: ([\d.]+)/, club);
  const [fx, fz, fr] = /floor: \{ x: (-?[\d.]+), z: (-?[\d.]+), r: ([\d.]+) \}/.exec(club).slice(1).map(Number);
  const eye = /eye: \{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}/.exec(club)?.slice(1).map(Number);
  const look = /look: \{ x: (-?[\d.]+), y: (-?[\d.]+), z: (-?[\d.]+) \}/.exec(club)?.slice(1).map(Number);
  check('the club declares a fixed house camera', Array.isArray(eye) && Array.isArray(look), eye ? `eye ${eye.join(',')} → look ${look.join(',')}` : 'no CLUB.cctv');

  check('the shot does not follow whoever is holding the room',
    !/playerHeadEntity|getWorldQuaternion/.test(cast),
    'ClubCastSystem takes its position from CLUB.cctv alone');

  check('it is mounted inside the hall and under the ceiling slab',
    Math.abs(eye[0]) < halfW && eye[2] > minZ && eye[2] < maxZ && eye[1] > 2.2 && eye[1] < ceilH,
    `y ${eye[1]} under ${ceilH}, x ${eye[0]} inside ±${halfW}`);

  const standoff = Math.hypot(eye[0] - fx, eye[2] - fz) - fr;
  check('it stands off the dance floor rather than hanging over it', standoff > 0.8, `${standoff.toFixed(2)} m clear of the circle`);

  // Does the frame actually hold the floor it is pointed at?
  const fov = num(/fov: ([\d.]+)/, conf);
  const vw = num(/^  w: (\d+),$/m, conf);
  const vh = num(/^  h: (\d+),$/m, conf);
  const d = Math.hypot(eye[0] - fx, eye[1] - look[1], eye[2] - fz);
  const hHalf = Math.atan(Math.tan((fov / 2) * (Math.PI / 180)) * (vw / vh));
  const frameW = 2 * d * Math.tan(hHalf);
  check('the whole dance floor is in frame', frameW >= fr * 2, `${frameW.toFixed(1)} m of frame across a ${(fr * 2).toFixed(1)} m floor`);

  // …and are the people in it big enough to be people?
  const pxPerM = vh / (2 * (d + fr) * Math.tan((fov / 2) * (Math.PI / 180)));
  const tall = 1.7 * pxPerM;
  check('a dancer at the far edge still reads as a person', tall > 12, `${tall.toFixed(0)} px tall in a ${vh} px frame`);

  // The camera looks ACROSS the floor toward the stage, which is the north
  // wall — so the stage sits behind the crowd rather than behind the lens.
  check('it looks across the floor toward the stage', look[2] < eye[2] && look[2] <= fz, `aims to z ${look[2]} from z ${eye[2]}`);
}

console.log('\n=== the lobby QR ===');
const qrOk = await page.evaluate(async () => {
  const mod = await import('/src/ui/qr.ts');
  const q = mod.qrEncode('https://ff2.web.app/?join=12345');
  const finder = (x0, y0) => {
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (q.modules[y0 + dy][x0 + dx] !== (d !== 2)) return false;
    }
    return true;
  };
  return { size: q.size, square: q.modules.every((r) => r.length === q.size), finders: finder(0, 0) && finder(q.size - 7, 0) && finder(0, q.size - 7), dark: q.modules[q.size - 8][8] };
});
const oct = await page.evaluate(async () => {
  const src = await fetch('/src/config.ts').then((r) => r.text());
  const n = (k) => Number(new RegExp(`export const ${k} = ([0-9.]+);`).exec(src)[1]);
  return { cfg: [n('OCTAGON_HALF_WIDTH'), n('OCTAGON_HALF_DEPTH'), n('EDGE_HALF'), n('CHAMFER')], page: [HALF_W, HALF_D, EDGE_HALF, CHAMFER] };
});
check('the heatmap octagon is the platform the game stands you on', oct.cfg.join(',') === oct.page.join(','), `config ${oct.cfg.join(',')} vs page ${oct.page.join(',')}`);

check('the QR is a square with three finder patterns and the dark module', qrOk.square && qrOk.finders && qrOk.dark && qrOk.size % 4 === 1, JSON.stringify(qrOk));

await browser.close();
viewer.close();
caster.close();
server.kill();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) console.log(serverLog.slice(-1200));
process.exit(passed === results.length ? 0 : 1);
