#!/usr/bin/env node
/**
 * THE WRAP, headless.
 *
 *   npm run dev              # terminal 1
 *   node tools/wrap-check.mjs [--shots]
 *
 * Boots the game in headless Chromium (the IWSDK dev plugin's IWER
 * emulator provides WebXR), enters the arena, and drives the TABBED wrap
 * (MENUS 2) through its dev hook (window.__ff2.wrap): the center slab's
 * PLAY / PRACTICE / SOCIAL tabs and PLAY's game families, the left wing's
 * ACTIVITY / RANKINGS / NEWS, the right wing's LOCKER / STORE / SETTINGS,
 * and THE PROFILE chip + card above the right
 * wing. --shots saves each face's canvas as a PNG beside this script.
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
// Enough in the wallet that the STORE's BUY is live: a disabled BUY never
// hit-tests, and the walk below has to prove it is the BUY that answers.
await page.addInitScript(() => {
  try {
    if (parseInt(localStorage.getItem('ff-coins') ?? '0', 10) < 200) localStorage.setItem('ff-coins', '500');
  } catch {
    /* no storage — the store check will say so */
  }
});
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log(`[pageerror] ${e.message}`);
});

// THE DOOR IS HELD for the floor now (experience/ClubExperienceManager):
// with no relay on this machine, ENTER CLUB waits out the floor's whole
// patience before it crosses to a room of one. The default minute would
// outlast the wait below; four seconds proves the same door opens.
const enterUrl = `${base}/?floorPatience=4000`;
async function enter() {
  await page.goto(enterUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(enterUrl));
  await page.waitForTimeout(1200);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 20000 });
  await page.waitForTimeout(2200);
}
await enter();

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const save = (name, data) => {
  if (!shots || !data) return;
  const file = join(here, `wrap-${name}.png`);
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`  wrote ${file}`);
};

const hook = await page.evaluate(() => !!window.__ff2?.wrap);
check('the wrap dev hook is up', hook);
if (!hook) {
  await browser.close();
  process.exit(1);
}

const wrap = (expr) => page.evaluate(`window.__ff2.wrap.${expr}`);
const tabsOf = (ids) => ids.filter((b) => b.startsWith('wrap:tab-'));
const notTabs = (ids) => ids.filter((b) => !b.startsWith('wrap:tab-'));
const has = (ids, ...want) => want.every((w) => ids.includes(w));

console.log('\n=== the strips: tabs across the top of every panel ===');
const tutorialDone = await page.evaluate(() => localStorage.getItem('ff-tutorial-done') === '1');
let slab = await wrap(`buttons('train')`);
check('the slab wears PLAY / PRACTICE / SOCIAL', has(slab, 'wrap:tab-fight', 'wrap:tab-practice', 'wrap:tab-club'), tabsOf(slab).join(','));
let town = await wrap(`buttons('duel')`);
check('the left wing wears ACTIVITY / RANKINGS / NEWS', has(town, 'wrap:tab-town', 'wrap:tab-ladder', 'wrap:tab-news'), tabsOf(town).join(','));
let you = await wrap(`buttons('info')`);
check('the right wing wears LOCKER / STORE / SETTINGS', has(you, 'wrap:tab-you', 'wrap:tab-store', 'wrap:tab-settings'), tabsOf(you).join(','));
if (!tutorialDone) {
  check('a fresh save leads with the tutorial', slab.includes('start-tutorial'), slab.join(','));
  const live = notTabs(await wrap(`live('train')`));
  check('and ONLY the tutorial answers on the slab', live.length === 1 && live[0] === 'start-tutorial', live.join(','));
  const liveTabs = tabsOf(await wrap(`live('train')`));
  check('Practice and Social tabs are sealed too', !liveTabs.includes('wrap:tab-practice') && !liveTabs.includes('wrap:tab-club'), liveTabs.join(','));
  const liveTown = tabsOf(await wrap(`live('duel')`));
  check('the LADDER is sealed, the paper is not', !liveTown.includes('wrap:tab-ladder') && liveTown.includes('wrap:tab-news'), liveTown.join(','));
  // Unseal for the rest of the walk.
  await page.evaluate(() => localStorage.setItem('ff-tutorial-done', '1'));
  await enter();
  slab = await wrap(`buttons('train')`);
}

console.log('\n=== the slab: PLAY / PRACTICE / SOCIAL ===');
let nav = await wrap(`nav()`);
check('the slab opens on FIGHT', nav.center === 'fight' && !nav.club, JSON.stringify(nav));
check('the TOWN wing opens on NEWS (the paper first)', nav.town === 'news', nav.town);
check('FIGHT: modes + the demoted ONLY BOTS, no BACK', has(slab, 'quick-match', 'ranked-match', 'private-open', 'arcade-2v2', 'arcade-ffa', 'toggle-onlybots') && !slab.includes('wrap:back'), notTabs(slab).join(','));
save('fight', await wrap(`snap('train')`));
await wrap(`act('wrap:play-titans')`);
slab = await wrap(`buttons('train')`);
nav = await wrap(`nav()`);
check('PLAY / TITANS groups campaign and co-op raid', nav.play === 'titans' && has(slab, 'open-campaign', 'open-raid') && !has(slab, 'start-tutorial'), slab.join(','));
save('titans', await wrap(`snap('train')`));
await wrap(`act('wrap:play-rave')`);
slab = await wrap(`buttons('train')`);
check('PLAY / RAVE has its own entry', slab.includes('open-rave') && !slab.includes('open-raid'), slab.join(','));
save('rave', await wrap(`snap('train')`));
await wrap(`act('wrap:tab-practice')`);
slab = await wrap(`buttons('train')`);
nav = await wrap(`nav()`);
check('PRACTICE groups tutorial and aim, with the scoped shoot-back option', nav.center === 'practice' && has(slab, 'start-tutorial', 'start-training', 'toggle-shootback') && !slab.includes('open-campaign'), slab.join(','));
save('practice', await wrap(`snap('train')`));
await wrap(`act('wrap:tab-fight')`);
check('returning to PLAY remembers the game family', (await wrap(`nav()`)).play === 'rave');
await wrap(`act('wrap:play-duels')`);
// SOCIAL carries the venue door: pressing the tab shows ENTER CLUB, and
// that button crosses to the venue's floor in-session (tools/venue-check.mjs
// walks that place properly — here we only prove the tab shows the door,
// the door opens, and the arena comes back whole).
await page.evaluate(() => localStorage.setItem('gdr-server', 'ws://127.0.0.1:1')); // no relay: the room of one
await wrap(`act('wrap:tab-club')`);
nav = await wrap(`nav()`);
const clubFace = notTabs(await wrap(`buttons('train')`));
check('SOCIAL groups the club with private games for friends', nav.club && has(clubFace, 'open-pub', 'private-open'), JSON.stringify({ nav, face: clubFace }));
save('club', await wrap(`snap('train')`));
await wrap(`act('open-pub')`);
const crossed = await page
  .waitForFunction(() => window.__town && window.__town.place === 'venue' && !window.__town.busy, { timeout: 40000 })
  .then(() => true)
  .catch(() => false);
check('ENTER CLUB: the door onto the venue floor, in-session', crossed && (await page.evaluate(() => document.body.classList.contains('app-entered'))), JSON.stringify(await page.evaluate(() => ({ place: window.__town?.place }))));
await page.evaluate(() => window.__town.leave());
await page.waitForFunction(() => window.__town && window.__town.place === 'arena' && !window.__town.busy, { timeout: 40000 });
await page.waitForTimeout(300);
await wrap(`act('wrap:tab-fight')`);
nav = await wrap(`nav()`);
check('home again, and FIGHT is the slab', nav.center === 'fight' && !nav.club, JSON.stringify(nav));

console.log('\n=== through FIGHT: the flows still drill in and BACK out ===');
await wrap(`act('private-open')`);
let face = await wrap(`buttons('train')`);
check('PRIVATE face on the slab, tabs still up', has(face, 'private-mode-1v1', 'private-create', 'private-enter', 'wrap:tab-fight'), notTabs(face).join(','));
await wrap(`act('private-enter')`);
face = await wrap(`buttons('train')`);
check('keypad face on the slab', has(face, 'kp-5', 'kp-join', 'kp-del'), notTabs(face).join(','));
save('keypad', await wrap(`snap('train')`));
await wrap(`act('private-back')`);
face = await wrap(`buttons('train')`);
check('keypad BACK returns to private-room setup', has(face, 'private-create', 'private-enter'));
await wrap(`act('private-back')`);
face = await wrap(`buttons('train')`);
check('BACK lands on the FIGHT root', face.includes('quick-match') || face.includes('cancel-queue'), notTabs(face).join(','));

// Simulate a pending search without opening a live public room.
await page.evaluate(async () => {
  const { app } = await import('/src/menu/appState.ts');
  app.state = 'queueing';
  window.__ff2.wrap.redraw();
});
const pending = await wrap(`live('train')`);
check('pending search keeps Cancel visible and blocks other activities', pending.includes('cancel-queue') && !pending.includes('wrap:tab-practice') && !pending.includes('wrap:tab-club') && !pending.includes('wrap:play-titans'));
await wrap(`act('wrap:tab-practice')`);
await wrap(`act('wrap:play-rave')`);
check('pending search also guards direct navigation', (await wrap(`nav()`)).center === 'fight' && (await wrap(`nav()`)).play === 'duels');
await wrap(`act('cancel-queue')`);

await wrap(`act('toggle-onlybots')`);
await wrap(`act('wrap:play-titans')`);
check('bots-only explains the raid restriction and offers its toggle', !(await wrap(`live('train')`)).includes('open-raid') && (await wrap(`live('train')`)).includes('toggle-onlybots'));
await wrap(`act('toggle-onlybots')`);
check('online raid becomes available again', (await wrap(`live('train')`)).includes('open-raid'));
await wrap(`act('wrap:play-duels')`);

await wrap(`act('wrap:tab-club')`);
await wrap(`act('private-open')`);
check('Social private-game shortcut selects its owning Play context', (await wrap(`nav()`)).center === 'fight' && (await wrap(`buttons('train')`)).includes('private-create'));
await wrap(`act('private-back')`);

console.log('\n=== the left wing: ACTIVITY / RANKINGS / NEWS ===');
await wrap(`act('wrap:tab-town')`); // the wing opens on NEWS now — walk to TOWN first
town = await wrap(`buttons('duel')`);
check('TOWN: the live chips, nothing pressable', has(town, 'town-queue', 'town-raids', 'town-club') && notTabs(await wrap(`live('duel')`)).length === 0, notTabs(town).join(','));
save('town', await wrap(`snap('duel')`));
await wrap(`act('wrap:tab-ladder')`);
town = await wrap(`buttons('duel')`);
nav = await wrap(`nav()`);
check('LADDER: opens on BATTLE › 1V1 with its sub-boards', nav.town === 'ladder' && has(town, 'lb-battle', 'lb-xp', 'lb-arcade', 'lb-ranked', 'lb-duo', 'lb-ffa'), notTabs(town).join(','));
save('ladder', await wrap(`snap('duel')`));
await wrap(`act('lb-arcade')`);
town = await wrap(`buttons('duel')`);
check('LADDER › ARCADE: aim + the run boards', has(town, 'lb-training', 'lb-gauntlet', 'lb-raid', 'lb-goopliath') && !town.includes('lb-ranked'), notTabs(town).join(','));
await wrap(`act('lb-raid')`);
town = await wrap(`buttons('duel')`);
check('LADDER › RAID: the difficulty strip, with HC ONLY and no FEATS', has(town, 'lb-view-normal', 'lb-view-hard', 'lb-view-blazing', 'lb-view-hc') && !town.includes('lb-view-feats'), notTabs(town).join(','));
save('ladder-raid', await wrap(`snap('duel')`));
await wrap(`act('lb-goopliath')`);
town = await wrap(`buttons('duel')`);
check('LADDER › GOOP RAID: the view strip without HC ONLY (the tide has no hardcore)', has(town, 'lb-view-normal', 'lb-view-blazing') && !town.includes('lb-view-hc'), notTabs(town).join(','));
await wrap(`act('lb-xp')`);
town = await wrap(`buttons('duel')`);
check('LADDER › XP: no sub-row', !town.includes('lb-ranked') && !town.includes('lb-training'), notTabs(town).join(','));
await wrap(`act('wrap:tab-town')`);

// THE GAZETTE (net/gazette.ts + menu.ts): inject an edition with every
// section — BY THE NUMBERS, THE RECORD BOOK, WHAT TO DO TODAY — open the
// paper (the NEWS tab) and snap the wing; it must lay out and render without
// a page error.
{
  const before = errors.length;
  await page.evaluate(() => {
    window.__ff2.gazette.inject({
      headline: "FIRST BLAZING HARDCORE TITAN RAID FALLS TO VOLTAIRE'S SQUAD",
      subhead: 'Four players beat all five titans with no healing between bosses, a feat nobody had managed.',
      body: 'VOLTAIRE, GRINDR, PUMPKIN and REDWOLF9 cleared the titan raid on BLAZING HARDCORE in 18:42.1, the first time anyone has finished it.\n\nOn the ranked ladder, REDWOLF9 climbed six places and now sits third for the season, 40 points behind the leader with eight days to play.\n\nThe NORMAL speedrun record changed hands twice. CRYSTALZACH holds it at 0:46.3.',
      stats: [
        { value: '37', label: 'games played' },
        { value: '3', label: 'new records' },
        { value: '8', label: 'days left in season' },
      ],
      records: [
        { feat: 'TITAN RAID · BLAZING · HARDCORE', time: '18:42.1', who: 'VOLTAIRE · GRINDR · PUMPKIN · REDWOLF9' },
        { feat: 'SPEEDRUN · HARD', time: '2:10.8', who: 'YK1' },
        { feat: 'SPEEDRUN · NORMAL', time: '0:46.3', who: 'CRYSTALZACH' },
      ],
      todo: [
        { title: 'Take the first blazing speedrun', text: 'Nobody has finished the campaign on BLAZING. PLAY › TITANS › CAMPAIGN, set BLAZING, and the record is yours.' },
        { title: 'Chase the season podium', text: 'Eight days left. PLAY › VERSUS › RANKED: a win is 20 points, more against a stronger opponent.' },
      ],
    });
    window.__ff2.gazette.open();
  });
  await page.waitForTimeout(400);
  nav = await wrap(`nav()`);
  const snap = await page.evaluate(() => window.__ff2.gazette.snap());
  const snap2 = await page.evaluate(() => { window.__ff2.gazette.scroll(900); return window.__ff2.gazette.snap(); });
  await page.evaluate(() => window.__ff2.gazette.close());
  const after = await wrap(`nav()`);
  check("GAZETTE: opening the paper lands on the NEWS tab; the edition lays out and renders", nav.town === 'news' && snap.startsWith('data:image/png') && snap.length > 20000 && errors.length === before, `${nav.town} · ${snap.length} bytes`);
  check('GAZETTE: closing the paper returns to TOWN', after.town === 'town', after.town);
  save('news', snap);
  save('news-2', snap2);

  // THE READER: tap the page on the wing and it is held up large, straight
  // ahead, as a modal over the arc; tap it (or CLOSE) and it goes back.
  await page.evaluate(() => window.__ff2.gazette.open());
  const wingPage = await wrap(`buttons('duel')`);
  await wrap(`act('gazette-reader')`);
  await page.waitForTimeout(300);
  const readerUp = await page.evaluate(() => window.__ff2.gazette.readerOpen());
  const readerButtons = await page.evaluate(() => window.__ff2.modals.buttons('reader'));
  const readerSnap = await page.evaluate(() => window.__ff2.modals.snap('reader'));
  const wingHidden = await wrap(`visible('duel')`);
  await wrap(`act('reader-close')`);
  await page.waitForTimeout(200);
  const readerDown = await page.evaluate(() => window.__ff2.gazette.readerOpen());
  check('READER: the page on the wing is a press', wingPage.includes('gazette-reader'), notTabs(wingPage).join(','));
  check('READER: tapping it holds the paper up large, over the arc', readerUp && readerButtons.includes('reader-close') && readerSnap.length > 20000 && wingHidden === false, JSON.stringify({ readerUp, readerButtons, bytes: readerSnap.length, wingHidden }));
  check('READER: CLOSE puts it back', readerDown === false, String(readerDown));
  save('reader', readerSnap);
  await page.evaluate(() => window.__ff2.gazette.close());
}

console.log('\n=== the right wing: LOCKER / STORE / SETTINGS ===');
you = await wrap(`buttons('info')`);
check('LOCKER wing: one CUSTOMIZE door and the career, no currency sales', has(you, 'open-custom', 'profile-toggle') && !you.includes('open-paintbay') && !you.includes('open-bank') && !you.includes('you-coins') && !you.includes('rename') && !you.includes('you-record') && !you.includes('you-tip'), notTabs(you).join(','));
save('you', await wrap(`snap('info')`));
await wrap(`act('wrap:tab-store')`);
you = await wrap(`buttons('info')`);
check('STORE owns shopping and the bank', has(you, 'open-shop', 'open-bank', 'store-balance') && !you.includes('open-paintbay'));
save('store-wing', await wrap(`snap('info')`));
await wrap(`act('open-shop')`);
await page.waitForTimeout(200);
check('STORE catalogue opens directly from the wing', await page.evaluate(() => window.__ff2.modals.up('shop')));
await wrap(`act('custom-close')`);
check('closing the catalogue returns to STORE', (await wrap(`nav()`)).you === 'store');

// THE HUB: one customization plate, three tabs — LOCKER · STORE · PAINT —
// the same plate in the same place, the faces swapping under the tabs.
{
  const up = (id) => page.evaluate((i) => window.__ff2.modals.up(i), id);
  const btns = (id) => page.evaluate((i) => window.__ff2.modals.buttons(i), id);
  const tabs = ['open-locker', 'open-shop', 'open-paintbay'];
  await wrap(`act('open-custom')`);
  await page.waitForTimeout(200);
  check('HUB: CUSTOMIZE opens the LOCKER face, wearing all three tabs', (await up('custom')) && (await btns('custom')).filter((b) => tabs.includes(b)).length === 3);
  await wrap(`act('open-paintbay')`);
  await page.waitForTimeout(200);
  const bayBtns = await btns('paintbay');
  check('HUB: the PAINT tab swaps the face — the bay is up, the locker is not', (await up('paintbay')) && !(await up('custom')) && !(await up('shop')));
  check('HUB: the PAINT face wears the same tabs, the four shapes and the colour grid', tabs.every((t) => bayBtns.includes(t)) && ['stripe', 'dot', 'square', 'triangle'].every((k) => bayBtns.includes(`pb:kind-${k}`)) && !bayBtns.includes('pb:kind-splotch') && bayBtns.includes('pb:take-0') && bayBtns.includes('pb:undo'), bayBtns.filter((b) => b.startsWith('pb:kind')).join(','));
  // One tap on a colour you don't own buys ONE and puts it on the pointer.
  const bought = await page.evaluate(() => {
    const p = window.__ff2.paint;
    const before = p.owned('triangle', 13);
    window.__ff2.bayClick('pb:kind-triangle');
    window.__ff2.bayClick('pb:take-13');
    const held = p.held();
    window.__ff2.bayClick('pb:return');
    return { before, held: held ? `${held.kind}:${held.colour}` : null, after: p.owned('triangle', 13) };
  });
  check('HUB: tapping an unowned colour buys one and puts it on the pointer', bought.held === 'triangle:13' && bought.after === bought.before + 1, JSON.stringify(bought));
  save('paint-tab', await page.evaluate(() => window.__ff2.modals.snap('paintbay')));
  await wrap(`act('open-shop')`);
  await wrap(`act('tab-paint')`);
  await page.waitForTimeout(200);
  const shopBtns = await btns('shop');
  check('HUB: STORE → PAINT sells the racks', (await up('shop')) && !(await up('paintbay')) && shopBtns.includes('pb:buy-0') && shopBtns.includes('pb:kind-dot'), shopBtns.filter((b) => b.startsWith('pb:')).slice(0, 6).join(','));
  save('store-paint', await page.evaluate(() => window.__ff2.modals.snap('shop')));
  await wrap(`act('tab-platforms')`);
  await wrap(`act('custom-close')`);
  await page.waitForTimeout(200);
  check('HUB: CLOSE on any face closes the plate', !(await up('custom')) && !(await up('shop')) && !(await up('paintbay')));
}

await wrap(`act('wrap:tab-settings')`);
you = await wrap(`buttons('info')`);
nav = await wrap(`nav()`);
check('SETTINGS: tracks, breakers, report, credits', nav.you === 'settings' && has(you, 'sfx-vol', 'music-vol', 'toggle-mute', 'toggle-voice', 'toggle-hide-paint', 'settings-report', 'settings-credits'), notTabs(you).join(','));
save('settings', await wrap(`snap('info')`));
await wrap(`act('settings-credits')`);
you = await wrap(`buttons('info')`);
check('CREDITS is a sub-face with BACK', you.includes('credits-back') && !you.includes('sfx-vol'), notTabs(you).join(','));
await wrap(`act('credits-back')`);
await wrap(`act('wrap:tab-you')`);
you = await wrap(`buttons('info')`);
nav = await wrap(`nav()`);
check('YOU tab again', nav.you === 'you' && you.includes('open-custom'), nav.you);

console.log('\n=== WHO HEARS WHOM (net/voiceRules.ts) ===');
{
  const v = await page.evaluate(() => {
    const voice = window.__ff2.voice;
    localStorage.setItem('ff-voice', '1');
    const before = { ctx: voice.context(), allowed: voice.allowed(), hear: voice.hear() };
    voice.ranked(true);
    const ranked = { ctx: voice.context(), allowed: voice.allowed(), hear: voice.hear() };
    voice.ranked(false);
    const table = Object.fromEntries(Object.entries(voice.rules).map(([k, r]) => [k, `${r.speak ? 'mic' : 'no mic'}/${r.hear}`]));
    return { before, ranked, table };
  });
  check('a duel opens mics and ears', v.before.ctx === 'duel' && v.before.allowed && v.before.hear, JSON.stringify(v.before));
  check('RANKED is silence: no mic, no ears', v.ranked.ctx === 'ranked' && !v.ranked.allowed && !v.ranked.hear, JSON.stringify(v.ranked));
  check('the table: club hears the room, the audience hears everyone, ranked nobody', v.table.club === 'mic/room' && v.table.audience === 'mic/everyone' && v.table.ranked === 'no mic/nobody', JSON.stringify(v.table));
}

console.log('\n=== THE MODALS: locker, store, line-up, lobby, loadout ===');
{
  const m = (expr) => page.evaluate(`window.__ff2.modals.${expr}`);
  const shot = async (id, name = id) => save(name, await m(`snap('${id}')`));

  await wrap(`act('open-custom')`);
  await page.waitForTimeout(400);
  let ids = await m(`buttons('custom')`);
  check('the LOCKER wears LOCKER · STORE and its three boards', has(ids, 'open-locker', 'open-shop', 'tab-platforms', 'tab-gear', 'tab-colour') && !ids.includes('tab-arena'), ids.slice(0, 8).join(','));
  check('and the loadout stands beside it', await m(`up('balls')`), String(await m(`up('balls')`)));
  await shot('custom');
  await shot('balls');

  await wrap(`act('tab-colour')`);
  await page.waitForTimeout(300);
  ids = await m(`buttons('custom')`);
  check(
    'COLOUR: the two base tones, and no neon tracks left',
    has(ids, 'base-white', 'base-black') && !has(ids, 'accent-color') && !has(ids, 'accent-light') && !has(ids, 'accent-default'),
    ids.filter((b) => !b.startsWith('tab-')).join(','),
  );
  await shot('custom', 'locker-colour');

  await wrap(`act('tab-platforms')`);
  await wrap(`act('open-shop')`);
  await page.waitForTimeout(400);
  ids = await m(`buttons('shop')`);
  check('the STORE is up, with no COLOUR to sell', (await m(`up('shop')`)) && !ids.includes('tab-colour'), ids.slice(0, 6).join(','));
  await shot('shop', 'store');

  // THE BUY ANSWERS. A tried-on tile grows its BUY INSIDE the tile's own
  // ghost button, so the panel's hit-test has to give the press to the
  // BUY and not to the tile under it — which only re-tries-on what is
  // already tried on, and buys nothing (the report: "I tried to buy a
  // hands equip, it doesn't do anything").
  await wrap(`act('tab-gear')`);
  await wrap(`act('gear-hands')`);
  await page.waitForTimeout(200);
  ids = await m(`buttons('shop')`);
  const cuffs = ids.includes('shop-gr-10'); // CUFFS: hands, $60
  check('HANDS on the store shelf offers CUFFS', cuffs, ids.filter((b) => b.startsWith('shop-')).join(','));
  if (cuffs) {
    await wrap(`act('shop-gr-10')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    const live = await m(`live('shop')`);
    check('tried on, the tile grows a live BUY', has(ids, 'shop-buy-gr-10') && live.includes('shop-buy-gr-10'), ids.filter((b) => b.startsWith('shop-')).join(','));
    const buy = await m(`rect('shop', 'shop-buy-gr-10')`);
    const under = buy ? await m(`at('shop', ${buy.x + buy.w / 2}, ${buy.y + buy.h / 2})`) : null;
    check('and a press on the BUY lands on the BUY, not on the tile beneath it', under === 'shop-buy-gr-10', String(under));
    await shot('shop', 'store-buy');
    await wrap(`act('shop-buy-gr-10')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    check('bought, CUFFS leave the store shelf', !ids.includes('shop-gr-10') && !ids.includes('shop-buy-gr-10'), ids.filter((b) => b.startsWith('shop-')).join(','));
    await wrap(`act('open-locker')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('custom')`);
    check('and turn up in the LOCKER, worn', ids.includes('shop-gr-10'), ids.filter((b) => b.startsWith('shop-')).join(','));
    // Bare again for the GEAR walk further down, which starts from nothing worn.
    await page.evaluate(() => window.__ff2.gear?.clear?.('hands'));
  }
  await wrap(`act('tab-platforms')`);
  await wrap(`act('custom-close')`);

  await wrap(`act('open-campaign')`);
  await page.waitForTimeout(400);
  ids = await m(`buttons('campaign')`);
  check('THE TITAN GAUNTLET: five cards, three runs, a way out', has(ids, 'campaign-0', 'campaign-4', 'campaign-speedrun', 'campaign-hardcore', 'campaign-goopliath', 'campaign-close'), ids.join(','));
  await shot('campaign');
  // A run opens the LAUNCH card, and it owns every click while it is up.
  const wasLive = (await m(`live('campaign')`)).includes('campaign-0');
  await wrap(`act('campaign-speedrun')`);
  await page.waitForTimeout(300);
  ids = await m(`buttons('campaign')`);
  const modalOwns = has(ids, 'diff-normal', 'campaign-launch-start', 'campaign-launch-cancel') && !ids.includes('campaign-0');
  check('a run opens the LAUNCH card, and nothing behind it answers', modalOwns, ids.join(','));
  await shot('campaign', 'campaign-launch');
  await wrap(`act('campaign-launch-cancel')`);
  await page.waitForTimeout(200);
  check('cancelling hands the line-up back', (await m(`buttons('campaign')`)).includes('campaign-0') && wasLive);
  await wrap(`act('campaign-close')`);

  await wrap(`act('open-raid')`);
  await page.waitForTimeout(500);
  ids = await m(`buttons('lobby')`);
  check('THE ARCADE LOBBY: host a raid, and a way out', has(ids, 'lobby-host', 'lobby-close'), ids.join(','));
  await shot('lobby');
  await wrap(`act('lobby-close')`);
  await page.waitForTimeout(300);
}

console.log('\n=== THE AUDIENCE: the terrace, the bodies, the roar ===');
{
  const a = (expr) => page.evaluate(`window.__ff2.audience.${expr}`);
  // A bout puts the desert on the FLATS, whose flanks grew terraces.
  await a(`watch(true, 4)`);
  await page.waitForTimeout(500);
  const stands = await a(`stands()`);
  const where = await a(`where()`);
  const roster = await a(`roster()`);
  const padHidden = !(await a(`pad()`));
  check('the flats offer standing room', stands > 0, String(stands));
  // Out on a flank, standing on a riser rather than on the sand (the front
  // tier's plate sits ~0.5 m over whatever the dune under it is doing).
  check('a watcher is planted on a stand, off the ground', !!where && Math.abs(where.x) > 5 && where.y > 0.25, JSON.stringify(where));
  check('and every fighter is on show (me, then the whole ring)', roster[0] === -1 && roster.length === 3 && roster[1] === 0 && roster[2] === 1, JSON.stringify(roster));
  check("the watcher's own platform is gone", padHidden === true, String(padHidden));

  // Two more watchers on the wire: bodies at the rail, and their hands
  // aggregate into the room's roar.
  await a(`wire(5, ${where?.x ?? 0}, ${where?.y ?? 1}, ${(where?.z ?? 0) + 1}, 1)`);
  await a(`wire(6, ${where?.x ?? 0}, ${where?.y ?? 1}, ${(where?.z ?? 0) + 2}, 0)`);
  await page.waitForTimeout(400);
  const bodies = await a(`bodies()`);
  const roar = await a(`roar()`);
  const inScene = await a(`inScene()`);
  check('watchers on the wire grow bodies at the rail', bodies === 2 && inScene === 2, JSON.stringify({ bodies, inScene }));
  check('half the terrace with its hands up is half a roar', roar.room > 0.2 && roar.room < 0.5, JSON.stringify(roar));

  // The rule that makes the crowd a crowd.
  const ctx = await page.evaluate(() => window.__ff2.voice.context());
  check('a watcher is in the AUDIENCE, hearing everyone', ctx === 'audience', ctx);

  await a(`clear()`);
  await a(`watch(false)`);
  await page.waitForTimeout(400);
  const after = await a(`where()`);
  const padBack = await a(`pad()`);
  check('standing down hands the ground back', after === null && padBack, JSON.stringify({ after, padBack }));
}

console.log('\n=== THE PROFILE: the chip and its card ===');
const chip = await wrap(`buttons('profile')`);
check('the chip is one pressable ghost', chip.length === 1 && chip[0] === 'profile-toggle', chip.join(','));
const cardHidden = await wrap(`visible('profilecard')`);
await wrap(`act('profile-toggle')`);
await page.waitForTimeout(300); // MenuSystem shows the card on the next frame
const cardShown = await wrap(`visible('profilecard')`);
const card = await wrap(`buttons('profilecard')`);
check('tapping the chip drops the card: rename · write note · close', !cardHidden && cardShown && has(card, 'rename', 'edit-note', 'profile-close'), `${cardHidden}→${cardShown} · ${card.join(',')}`);
save('profile', await wrap(`snap('profile')`));
save('profilecard', await wrap(`snap('profilecard')`));
await wrap(`act('profile-close')`);
await page.waitForTimeout(300);
check('CLOSE folds it', !(await wrap(`visible('profilecard')`)));

// GEAR (avatar/gear.ts): a dev equip dresses the podium's blank in the piece
// — head + body slots at once — and the wire form re-validates junk away.
{
  const before = await page.evaluate(() => window.__ff2.podium?.gear?.() ?? null);
  await page.evaluate(() => {
    window.__ff2.gear.equip('crest');
    window.__ff2.gear.equip('pauldrons');
  });
  await page.waitForTimeout(400); // applyOwnSkins dresses on the next frame
  const worn = await page.evaluate(() => window.__ff2.podium.gear());
  const wire = await page.evaluate(() => ({
    packed: window.__ff2.gear.pack(),
    junk: window.__ff2.gear.clean('nonsense,crest,horns,,pauldrons'),
    oversized: window.__ff2.gear.clean('crest,' + 'x'.repeat(200)),
  }));
  await page.evaluate(() => {
    window.__ff2.gear.clear('head');
    window.__ff2.gear.clear('shoulders'); // the pauldrons' slot now
  });
  check('GEAR: the podium wears what you equip (crest + pauldrons)', Array.isArray(worn) && worn.includes('crest') && worn.includes('pauldrons') && (before?.length ?? 0) === 0, JSON.stringify({ before, worn }));
  check('GEAR: the wire packs slot-ordered and drops junk / a second head', wire.packed === 'crest,pauldrons' && wire.junk.join(',') === 'crest,pauldrons', JSON.stringify(wire));
  check('GEAR: an oversized wire string is refused whole (bare)', wire.oversized.length === 0, JSON.stringify(wire.oversized));
  // THE HEADS (avatar/heads.ts): a whole head is its own slot, worn WITH
  // headgear, packed last so an older reader just drops it.
  await page.evaluate(() => {
    window.__ff2.gear.equip('crest');
    window.__ff2.gear.equip('bear');
  });
  await page.waitForTimeout(400);
  const withHead = await page.evaluate(() => ({ worn: window.__ff2.podium.gear(), packed: window.__ff2.gear.pack() }));
  await page.evaluate(() => {
    window.__ff2.gear.clear('face');
    window.__ff2.gear.clear('head');
  });
  check('GEAR: a HEAD is worn with headgear (bear + crest), packed last', withHead.worn.includes('bear') && withHead.worn.includes('crest') && withHead.packed === 'crest,bear', JSON.stringify(withHead));
}

console.log('\n=== the bout: what you wear, on your own hands ===');
// The report: CUFFS bought in the store, and nothing on your hands in the
// match. Your own gloves are built at the bell and renamed 'player-glove-*',
// and the dresser only knew the rig's names.
await page.evaluate(() => window.__ff2.gear.equip('cuffs'));
// THE MAGNET: in the paint bay every small gear piece on the mirror gets a
// catch sphere — a five-centimetre cuff two metres off was "hard to paint
// on". Two cuffs, two magnets.
// THE MAGNET: aimed from the eye a degree off a piece's centre — a miss
// the width of a finger at the mirror — the bay paints the piece anyway,
// whatever its shape: the cuffs' ring, the HORNS' curled tube ("still a
// pain to paint on the horns"), the MOHAWK's spikes.
await page.evaluate(() => window.__ff2.gear.equip('horns'));
await wrap(`act('open-paintbay')`);
await page.waitForTimeout(500);
const aimCuffs = await page.evaluate(() => window.__ff2.bayAim?.('gearHands', 1.0) ?? null);
check('a finger off the cuffs, the bay paints the cuffs', (aimCuffs ?? '').startsWith('gearHands'), String(aimCuffs));
const aimHorns = await page.evaluate(() => window.__ff2.bayAim?.('gearHead', 1.0) ?? null);
check('a finger off the horns, the bay paints the horns', (aimHorns ?? '').startsWith('gearHead'), String(aimHorns));
const aimDead = await page.evaluate(() => window.__ff2.bayAim?.('gearHands', 0) ?? null);
check('dead on, the pointer\'s own hit stands', (aimDead ?? '').startsWith('gearHands'), String(aimDead));
await wrap(`act('paintbay-close')`);
await page.waitForTimeout(300);
await page.evaluate(() => window.__ff2.gear.equip('mohawk'));
await wrap(`act('open-paintbay')`);
await page.waitForTimeout(500);
const aimSpike = await page.evaluate(() => window.__ff2.bayAim?.('gearHead', 1.0) ?? null);
check('a finger off a MOHAWK spike, the bay paints the spike', (aimSpike ?? '').startsWith('gearHead'), String(aimSpike));
await wrap(`act('paintbay-close')`);
await page.waitForTimeout(300);
await page.evaluate(() => window.__ff2.gear.clear('head'));
await wrap(`act('quick-match')`);
await page.waitForTimeout(2500);
const wornL = await page.evaluate(() => window.__ff2.worn?.('player-glove-left') ?? []);
const wornR = await page.evaluate(() => window.__ff2.worn?.('player-glove-right') ?? []);
check('CUFFS worn into a bout are on both of your own hands', wornL.includes('cuffs') && wornR.includes('cuffs'), JSON.stringify({ left: wornL, right: wornR }));
await page.evaluate(() => window.__ff2.gear.clear('hands'));

check('no page errors along the way', errors.length === 0, errors.join(' | '));

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
