#!/usr/bin/env node
/**
 * THE BANK, headless — the whole loop with no money in it.
 *
 *   node tools/bank-check.mjs                 # the server alone
 *   npm run dev                               # terminal 1
 *   node tools/bank-check.mjs --headset [--shots]   # + the STORE's BANK board
 *
 * PART 1 starts THE ROOM SERVER in dev mode on a spare port (no Stripe
 * key, no service account: the fake checkout page and the memory ledger)
 * and walks the API as the headset would: the catalogue, a refused
 * checkout with no identity, a checkout for the 500 pack, the short
 * link's redirect, the dev PAY, a replayed PAY that credits nothing
 * twice, a claim that hands over the coins once and then nothing.
 *
 * PART 2 (--headset) boots index.html against that server, opens the
 * STORE's BANK board, taps a pack, asserts the QR checkout is up, pays it
 * from outside (as the phone would), and watches the coins land in the
 * wallet — then checks the PLATFORMS board's new shelves and the gear
 * board's new pieces. --shots saves the boards beside this script.
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.env.BANK_PORT ?? 8791);
const vite = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const headset = process.argv.includes('--headset');
const shots = process.argv.includes('--shots');

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const has = (ids, ...want) => want.every((w) => ids.includes(w));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the server ──────────────────────────────────────────────────────── */

const server = spawn(process.execPath, [join(root, 'server', 'room.mjs')], {
  env: { ...process.env, PORT: String(PORT), BANK_DEV: '1', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FIREBASE_SERVICE_ACCOUNT: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${PORT}/bank`;

async function up() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/`);
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  return false;
}

async function api(path, init = {}) {
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}

let bad = 0;
try {
  console.log('=== THE BANK: the server alone, dev mode ===');
  check('the room server answers with the bank mounted', await up(), log.trim().split('\n').pop());
  const cat = await api('/');
  check('the catalogue: dev mode, four packs, a currency', cat.body?.mode === 'dev' && cat.body?.packs?.length === 4 && !!cat.body?.currency, JSON.stringify(cat.body?.packs?.map((p) => p.id)));

  const jsonH = { 'content-type': 'application/json' };
  const who = { ...jsonH, 'x-dev-uid': 'probe-one' };
  const noId = await api('/checkout', { method: 'POST', headers: jsonH, body: JSON.stringify({ pack: 'pocket' }) });
  check('no identity, no checkout', noId.status === 401, String(noId.status));
  const noPack = await api('/checkout', { method: 'POST', headers: who, body: JSON.stringify({ pack: 'moon' }) });
  check('no such pack', noPack.status === 400, String(noPack.status));

  const co = await api('/checkout', { method: 'POST', headers: who, body: JSON.stringify({ pack: 'pocket' }) });
  const opened = co.status === 200 && typeof co.body?.url === 'string' && co.body.url.includes('/dev-pay?s=') && /\/bank\/go\/[A-Za-z0-9]{8}$/.test(co.body?.short ?? '');
  check('a checkout opens: the dev page, and a short link the QR can hold', opened, JSON.stringify(co.body));
  if (opened) {
    check('the short link is short enough for the panel QR', co.body.short.length < 200, String(co.body.short.length));
    const go = await fetch(co.body.short, { redirect: 'manual' });
    check('the short link redirects to the checkout', go.status === 302 && go.headers.get('location') === co.body.url, `${go.status} ${go.headers.get('location')}`);
    const page = await fetch(co.body.url);
    check('the dev checkout page shows the pack', page.status === 200 && (await page.text()).includes('500 iron-dollars'), String(page.status));

    const c0 = await api('/claim', { method: 'POST', headers: who, body: '{}' });
    check('nothing owed before paying', c0.body?.coins === 0, JSON.stringify(c0.body));
    const pay = await api('/dev-pay', { method: 'POST', headers: jsonH, body: JSON.stringify({ s: co.body.id }) });
    check('PAY credits the ledger', pay.body?.paid === true && !pay.body?.duplicate && pay.body?.credit === 500, JSON.stringify(pay.body));
    const again = await api('/dev-pay', { method: 'POST', headers: jsonH, body: JSON.stringify({ s: co.body.id }) });
    check('a replayed PAY credits nothing twice', again.body?.duplicate === true && again.body?.credit === 500, JSON.stringify(again.body));
    const c1 = await api('/claim', { method: 'POST', headers: who, body: '{}' });
    check('the claim hands over the 500', c1.body?.coins === 500 && c1.body?.claimed === 500, JSON.stringify(c1.body));
    const c2 = await api('/claim', { method: 'POST', headers: who, body: '{}' });
    check('claimed once, owed nothing', c2.body?.coins === 0 && c2.body?.credit === 500, JSON.stringify(c2.body));
    const other = await api('/claim', { method: 'POST', headers: { ...jsonH, 'x-dev-uid': 'probe-two' }, body: '{}' });
    check("another uid is owed nothing of probe-one's", other.body?.coins === 0, JSON.stringify(other.body));
  }
  const wh = await api('/webhook', { method: 'POST', headers: jsonH, body: '{}' });
  check('the webhook has no Stripe to answer to in dev mode', wh.status === 503, String(wh.status));
  const dead = await fetch(`${base}/go/zzzzzzzz`);
  check('a dead short link says so', dead.status === 404, String(dead.status));

  // THE ACCOUNT: protect, and the handoff a new headset redeems.
  console.log('\n=== THE ACCOUNT: protect, handoff, redeem ===');
  const bare = await api('/whoami', { headers: who });
  check('a fresh uid is bare', bare.status === 200 && bare.body?.protected === false && bare.body?.uid === 'probe-one', JSON.stringify(bare.body));
  const notMail = await api('/protect', { method: 'POST', headers: who, body: JSON.stringify({ email: 'not an email' }) });
  check('PROTECT refuses a non-address', notMail.status === 400, String(notMail.status));
  const prot = await api('/protect', { method: 'POST', headers: who, body: JSON.stringify({ email: 'One@Example.com' }) });
  check('PROTECT attaches the email, lower-cased and masked back', prot.status === 200 && prot.body?.protected === true && prot.body?.email === 'o***@example.com', JSON.stringify(prot.body));
  const known = await api('/whoami', { headers: who });
  check('and whoami says so', known.body?.protected === true && known.body?.email === 'o***@example.com', JSON.stringify(known.body));
  const again = await api('/protect', { method: 'POST', headers: who, body: JSON.stringify({ email: 'one@example.com' }) });
  check('protecting again with the same email is fine', again.status === 200, String(again.status));
  const who2 = { ...jsonH, 'x-dev-uid': 'probe-two' };
  const taken = await api('/protect', { method: 'POST', headers: who2, body: JSON.stringify({ email: 'one@example.com' }) });
  check("another uid may not take probe-one's email", taken.status === 409 && taken.body?.taken === true, JSON.stringify(taken.body));
  const noHand = await api('/handoff', { method: 'POST', headers: jsonH, body: '{}' });
  check('no identity, no handoff', noHand.status === 401, String(noHand.status));
  const hand = await api('/handoff', { method: 'POST', headers: who, body: '{}' });
  check('a signed handoff mints a six-digit code', hand.status === 200 && /^\d{6}$/.test(String(hand.body?.code)), JSON.stringify(hand.body));
  const wrong = await api('/redeem', { method: 'POST', headers: jsonH, body: JSON.stringify({ code: '000000' }) });
  check('a code nobody minted is refused', wrong.status === 404, String(wrong.status));
  const red = await api('/redeem', { method: 'POST', headers: jsonH, body: JSON.stringify({ code: hand.body?.code }) });
  check('the code redeems for a token naming the protected uid', red.status === 200 && red.body?.uid === 'probe-one' && String(red.body?.token).startsWith('dev:'), JSON.stringify(red.body));
  const twice = await api('/redeem', { method: 'POST', headers: jsonH, body: JSON.stringify({ code: hand.body?.code }) });
  check('and only once', twice.status === 404, String(twice.status));

  // A claim whose reply is lost on the way back: the headset asks again
  // with the same id and must get the same coins, not nothing.
  console.log('\n=== THE CLAIM: a lost reply, asked again ===');
  const who3 = { ...jsonH, 'x-dev-uid': 'probe-three' };
  const payFor = async (h) => {
    const c = await api('/checkout', { method: 'POST', headers: h, body: JSON.stringify({ pack: 'pocket' }) });
    return api('/dev-pay', { method: 'POST', headers: jsonH, body: JSON.stringify({ s: c.body?.id }) });
  };
  await payFor(who3);
  const cl = (claim) => api('/claim', { method: 'POST', headers: who3, body: JSON.stringify({ claim }) });
  const first = await cl('claim-aaaaaaaa');
  check('a claim with an id hands over the 500', first.body?.coins === 500, JSON.stringify(first.body));
  const lost = await cl('claim-aaaaaaaa');
  check('the same id again (the reply was lost) hands over the same 500', lost.body?.coins === 500, JSON.stringify(lost.body));
  const fresh = await cl('claim-bbbbbbbb');
  check('a fresh id is owed nothing', fresh.body?.coins === 0, JSON.stringify(fresh.body));
  await payFor(who3);
  const next = await cl('claim-cccccccc');
  check('a new purchase is claimed by the next fresh id', next.body?.coins === 500 && next.body?.credit === 1000, JSON.stringify(next.body));
  let spent = null;
  for (let i = 0; i < 4; i++) spent = await cl('claim-cccccccc');
  check('redelivery runs out — an id is not a tap', spent.body?.coins === 0, JSON.stringify(spent.body));

  const { planReverse } = await import('../server/bank.mjs');
  const r1 = planReverse({ credit: 1000, claimed: 500 }, 500);
  check('a refund cancels coins still unclaimed', r1.credit === 500 && r1.cancelled === 500 && r1.lost === 0, JSON.stringify(r1));
  const r2 = planReverse({ credit: 1000, claimed: 800 }, 500);
  check('what was already collected is recorded, not taken from later purchases', r2.credit === 800 && r2.cancelled === 200 && r2.lost === 300 && r2.unrecovered === 300, JSON.stringify(r2));

  // THE RELAYS: a message that parses to no object used to throw inside the
  // socket handler and end the process — every relay and the bank with it.
  console.log('\n=== THE ROOM SERVER: bad messages ===');
  const { WebSocket } = await import('ws');
  for (const path of ['/ff', '/pub', '/rave', '/tv']) {
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
      ws.on('open', () => {
        for (const junk of ['null', '42', '"x"', 'true', '[]']) ws.send(junk);
        setTimeout(() => {
          ws.close();
          resolve();
        }, 150);
      });
      ws.on('error', resolve);
    });
  }
  await sleep(300);
  const still = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.ok).catch(() => false);
  check('null, numbers and bare strings on every relay leave the server standing', still && server.exitCode === null, still ? 'up' : log.trim().split('\n').slice(-3).join(' | '));

  // THE REDEEM CEILING: wrong guesses are counted across everyone. Last in
  // part 1, because it leaves /redeem refusing for the window.
  console.log('\n=== THE ACCOUNT: guessing codes ===');
  let last = null;
  for (let i = 0; i < 40; i++) last = await api('/redeem', { method: 'POST', headers: jsonH, body: JSON.stringify({ code: String(100000 + i) }) });
  check('a run of wrong codes is refused with 429', last.status === 429, String(last.status));

  /* ── the headset ───────────────────────────────────────────────────── */

  if (headset) {
    console.log('\n=== THE BANK: the STORE\'s board, in the headset ===');
    const { chromium } = await import('playwright');
    const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'];
    const browser = await chromium.launch({ args }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args }));
    const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.log(`[pageerror] ${e.message}`);
    });
    await page.addInitScript(() => {
      localStorage.setItem('ff-tutorial-done', '1');
      localStorage.setItem('ff-player-name', 'PROBE-ONE');
      localStorage.setItem('gdr-server', 'ws://127.0.0.1:1');
      localStorage.setItem('ff-coins', '0');
      localStorage.removeItem('ff-owned-platforms');
      localStorage.removeItem('ff-owned-gear');
    });
    const url = `${vite}/?floorPatience=1000&server=ws://127.0.0.1:${PORT}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(url));
    await page.waitForTimeout(1200);
    await page.click('#enter-vr');
    await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 30000 });
    await page.waitForTimeout(2500);

    const wrap = (expr) => page.evaluate(`window.__ff2.wrap.${expr}`);
    const m = (expr) => page.evaluate(`window.__ff2.modals.${expr}`);
    const bankState = () => page.evaluate(() => window.__ff2.bank.state());
    const save = (name, dataUrl) => {
      if (!shots || !dataUrl) return;
      const file = join(here, `bank-${name}.png`);
      writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  wrote ${file}`);
    };
    const shot = async (name) => save(name, await m(`snap('shop')`));
    const until = async (fn, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await fn()) return true;
        await sleep(300);
      }
      return fn();
    };

    // A modal paints on the frame after it is shown, and a headless frame
    // can be a while coming — so the button reads poll, like the state reads.
    const buttonsSoon = async (...want) => {
      let ids = [];
      await until(async () => {
        ids = await m(`buttons('shop')`);
        return has(ids, ...want);
      }, 4000);
      return ids;
    };

    await wrap(`act('open-custom')`);
    await wrap(`act('open-shop')`);
    let ids = await buttonsSoon('tab-platforms', 'tab-gear', 'tab-bank');
    check('the STORE wears PLATFORMS · GEAR · BANK, and the purse is a door to the bank', has(ids, 'tab-platforms', 'tab-gear', 'tab-bank') && ids.includes('tab-bank'), ids.filter((b) => b.startsWith('tab-')).join(','));

    await wrap(`act('tab-bank')`);
    check('the board read the server: dev mode, four packs', await until(async () => (await bankState()).status === 'ready', 8000), JSON.stringify(await bankState()));
    ids = await buttonsSoon('bank-pack-pocket', 'store-wallet');
    check('the BANK board: four packs and the purse', has(ids, 'bank-pack-pocket', 'bank-pack-purse', 'bank-pack-strongbox', 'bank-pack-vault', 'store-wallet'), ids.filter((b) => b.startsWith('bank-') || b === 'store-wallet').join(','));
    check('and THE ACCOUNT strip for a bare headset: PROTECT WITH EMAIL, RECOVER', has(ids, 'bank-protect', 'bank-recover'), ids.filter((b) => b.startsWith('bank-')).join(','));
    await shot('packs');

    // THE MERGE, run in the page (no world needed): inventory a union,
    // coins to the last writer, a fresh browser adopting, a recovery adding.
    const merge = await page.evaluate(async () => {
      const m = await import('/src/net/walletMerge.ts');
      const L = { coins: 30, at: 10, platforms: ['walnut'], gear: [], avatars: [] };
      const C = { coins: 5000, at: 5, platforms: ['jade'], gear: ['crown'], avatars: [] };
      return {
        lastWriter: m.mergeWallet(L, C, false),
        cloudNewer: m.mergeWallet(L, { ...C, at: 20 }, false),
        fresh: m.mergeWallet({ ...L, at: 0, coins: 0, platforms: [] }, C, true),
        adopt: m.mergeWallet(L, C, false, true),
        noCloud: m.mergeWallet(L, null, true),
        same: m.mergeWallet({ ...L, platforms: ['jade', 'walnut'], gear: ['crown'] }, { ...C, coins: 30, at: 10, platforms: ['jade', 'walnut'] }, false),
      };
    });
    check('merge: the newer local wallet wins, and the lockers union', merge.lastWriter.coins === 30 && merge.lastWriter.platforms.join() === 'jade,walnut' && merge.lastWriter.gear.join() === 'crown' && merge.lastWriter.push && merge.lastWriter.hydrate, JSON.stringify(merge.lastWriter));
    check('merge: a newer cloud wallet wins', merge.cloudNewer.coins === 5000 && merge.cloudNewer.hydrate, JSON.stringify(merge.cloudNewer));
    check('merge: a fresh browser adopts the cloud', merge.fresh.coins === 5000 && merge.fresh.platforms.join() === 'jade', JSON.stringify(merge.fresh));
    check("merge: a recovery adds the stranger's coins to the account's", merge.adopt.coins === 5030 && merge.adopt.push, JSON.stringify(merge.adopt));
    check('merge: no cloud yet → push the local wallet up', merge.noCloud.coins === 30 && merge.noCloud.push && !merge.noCloud.hydrate, JSON.stringify(merge.noCloud));
    check('merge: identical copies move nothing', !merge.same.hydrate && !merge.same.push, JSON.stringify(merge.same));

    await wrap(`act('bank-pack-pocket')`);
    const waiting = await until(async () => (await bankState()).checkout?.state === 'waiting', 8000);
    let st = await bankState();
    check('a tap opens a checkout: waiting, with a short link', waiting && /\/bank\/go\//.test(st.checkout?.short ?? ''), JSON.stringify(st.checkout));
    await page.waitForTimeout(700);
    ids = await m(`buttons('shop')`);
    check('the checkout face: OPEN ON THIS DEVICE and CANCEL', has(ids, 'bank-open', 'bank-cancel'), ids.filter((b) => b.startsWith('bank-')).join(','));
    await shot('checkout');

    // The phone pays.
    if (st.checkout?.id) {
      const pay = await api('/dev-pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s: st.checkout.id }) });
      check('paid from outside, as the phone would', pay.body?.paid === true, JSON.stringify(pay.body));
      const landed = await until(async () => (await bankState()).checkout?.state === 'paid', 12000);
      st = await bankState();
      check('the coins land in the wallet within a poll', landed && st.coins === 500 && st.checkout?.paid === 500, JSON.stringify({ coins: st.coins, checkout: st.checkout }));
      await page.waitForTimeout(700);
      ids = await m(`buttons('shop')`);
      check('and the face says PAID with a DONE', ids.includes('bank-done') && !ids.includes('bank-open'), ids.filter((b) => b.startsWith('bank-')).join(','));
      await shot('paid');
      await wrap(`act('bank-done')`);
      await page.waitForTimeout(300);
      ids = await m(`buttons('shop')`);
      check('DONE returns to the packs', ids.includes('bank-pack-pocket') && !ids.includes('bank-done'), ids.filter((b) => b.startsWith('bank-')).join(','));
    }

    // THE SHELVES and the second wave.
    await wrap(`act('tab-platforms')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    check('the PLATFORMS board is shelved: TIMBER · STONE · FORGE · HONOURS', has(ids, 'shelf-timber', 'shelf-stone', 'shelf-forge', 'shelf-honours'), ids.filter((b) => b.startsWith('shelf-')).join(','));
    await wrap(`act('shelf-forge')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    check('FORGE: BULLION, COPPER, MAGMA, METEORITE', has(ids, 'shop-pf-9', 'shop-pf-11', 'shop-pf-12', 'shop-pf-13') && !ids.includes('shop-pf-4'), ids.filter((b) => b.startsWith('shop-pf-')).join(','));
    await shot('store-forge');
    await wrap(`act('shelf-honours')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    check('HONOURS: the three earned pads, nothing for sale', has(ids, 'shop-pf-14', 'shop-pf-15', 'shop-pf-16') && !ids.includes('shop-pf-9'), ids.filter((b) => b.startsWith('shop-pf-')).join(','));
    await wrap(`act('tab-gear')`);
    await wrap(`act('gear-head')`);
    await page.waitForTimeout(300);
    ids = await m(`buttons('shop')`);
    check('HEAD offers the CROWN and the ANTLERS beside the old six', has(ids, 'shop-gr-0', 'shop-gr-13', 'shop-gr-14'), ids.filter((b) => b.startsWith('shop-gr-')).join(','));
    await shot('store-head');
    await wrap(`act('gear-body')`);
    await page.waitForTimeout(200);
    ids = await m(`buttons('shop')`);
    check('BODY offers the WINGS, the CAPE and the TABARD — and no pads', has(ids, 'shop-gr-15', 'shop-gr-33', 'shop-gr-34') && !ids.includes('shop-gr-6') && !ids.includes('shop-gr-17'), ids.filter((b) => b.startsWith('shop-gr-')).join(','));
    // THE SHOULDERS shelf: the two old pads (catalogue 6 and 17, where they
    // always were) and the fifth wave's three (30..32).
    await wrap(`act('gear-shoulders')`);
    await page.waitForTimeout(200);
    ids = await m(`buttons('shop')`);
    check('SHOULDERS offers PAULDRONS, SPIKED PADS, WARLORD, EPAULETS, GLADIATOR, BASTION', [6, 17, 30, 31, 32, 35].every((i) => ids.includes(`shop-gr-${i}`)) && !ids.includes('shop-gr-7'), ids.filter((b) => b.startsWith('shop-gr-')).join(','));
    await shot('store-shoulders');
    await wrap(`act('gear-hands')`);
    await page.waitForTimeout(200);
    ids = await m(`buttons('shop')`);
    check('HANDS offers the CLAWS', ids.includes('shop-gr-16'), ids.filter((b) => b.startsWith('shop-gr-')).join(','));
    await wrap(`act('gear-face')`);
    await page.waitForTimeout(200);
    ids = await m(`buttons('shop')`);
    // THE HEADS are catalogue 22..29 (appended after WRIST BLADES).
    check('HEADS offers all eight heads, BEAR to BUNNY', [22, 23, 24, 25, 26, 27, 28, 29].every((i) => ids.includes(`shop-gr-${i}`)), ids.filter((b) => b.startsWith('shop-gr-')).join(','));
    await shot('store-heads');
    await wrap(`act('custom-close')`);
    check('no page errors fell out', errors.length === 0, errors[0]);
    await browser.close();
  }
} catch (err) {
  console.log(`  FAIL  the check itself fell over — ${err?.stack ?? err}`);
  results.push(false);
} finally {
  server.kill();
}

bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
process.exit(bad === 0 ? 0 : 1);
