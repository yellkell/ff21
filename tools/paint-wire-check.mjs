#!/usr/bin/env node
/**
 * THE PAINT P3, headless — the room sees you.
 *
 *   npm run dev          # terminal 1
 *   npm run server:pub   # terminal 2
 *   node tools/paint-wire-check.mjs
 *
 * Two stages:
 *
 *   1. THE WIRE (arena page, __ff2.paint): pack/unpack roundtrip is exact
 *      and idempotent under quantization; malformed / tampered / oversized
 *      wire strings fail soft to the bare base tone, never to an error.
 *
 *   2. THE ROOM (two isolated browser contexts on pub.html against the
 *      local pub relay): a painted punter's packed look rides the hello,
 *      arrives in the other client's roster, and is BAKED onto their rig
 *      on join; a mid-visit repaint (the LOOK event) reaches the room; the
 *      server folds it in so the state is queryable afterwards.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const pubWs = process.env.PUB_WS ?? 'ws://localhost:8788';
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
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── stage 1: the wire ──────────────────────────────────────────────────── */

console.log('=== the wire: pack / unpack ===');
{
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Boot into the lobby (again, for the restart checks below).
  const enter = async () => {
    await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(base));
    await page.evaluate(() => localStorage.setItem('ff-tutorial-done', '1'));
    // THE COVE bakes its sky over the first frames and can hold the main
    // thread for seconds on a slow machine: wait until the page answers
    // before pressing anything, or the click lands in the freeze.
    await page.waitForFunction(() => true, undefined, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.click('#enter-vr', { timeout: 60000 });
    await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 60000 });
    await page.waitForFunction(() => !!window.__ff2?.paint, { timeout: 10000 });
  };
  await enter();

  const wire = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.demo();
    const packed = p.pack();
    const back = p.unpack(packed);
    const again = (() => {
      // pack(unpack(pack)) must be byte-identical: quantization is stable.
      p.set(back);
      return p.pack();
    })();
    const junk = p.unpack('not base64 at all!!').paint.length;
    const empty = p.unpack('').paint.length;
    const long = p.unpack('A'.repeat(5000)).paint.length;
    const numeric = p.unpack(12345).paint.length;
    // Tamper: flip one unit's colour byte to 255 (no such colour) — that
    // unit drops, the rest survive.
    const bin = atob(packed).split('');
    bin[1 + 1] = String.fromCharCode(255); // unit 0, byte 1 = colour
    const tampered = p.unpack(btoa(bin.join(''))).paint.length;
    const res = {
      packedLen: packed.length,
      count: back.paint.length,
      idempotent: again === packed,
      junk, empty, long, numeric, tampered,
      first: back.paint[0],
    };
    p.clear();
    return res;
  });

  check('demo look packs (16 units ≈ 172 b64 chars)', wire.packedLen === Math.ceil((1 + 16 * 8) / 3) * 4, String(wire.packedLen));
  check('roundtrip keeps all 16 units', wire.count === 16, String(wire.count));
  check('pack∘unpack is byte-identical (stable quantization)', wire.idempotent);
  check('junk / empty / numeric wire → bare base tone', wire.junk === 0 && wire.empty === 0 && wire.numeric === 0);
  check('oversized wire string is refused', wire.long === 0);
  check('tampered colour byte drops that unit only', wire.tampered === 15, String(wire.tampered));
  // The new geometry + the gear surface survive the wire as themselves.
  const shapes = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.demo();
    const back = p.unpack(p.pack()).paint;
    p.clear();
    return back.map((u) => `${u.kind}@${u.part}`).slice(-3);
  });
  check('a square, a TRIANGLE and a gear-surface unit roundtrip as themselves', shapes.join(',') === 'square@body,triangle@body,dot@gearHead', shapes.join(','));
  // THE HEADS (avatar/heads.ts): a worn head is its own surface, part 8 on
  // the wire — and a wire-7 reader that predates it drops the unit, never
  // paints it somewhere else.
  const face = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.set({
      paint: [
        { kind: 'dot', part: 'gearFace', colour: 9, variant: 0, u: 0.5, v: 0.5, angle: 0, len: 0.2, wid: 0.2 },
        { kind: 'dot', part: 'gearShoulders', colour: 9, variant: 0, u: 0.5, v: 0.5, angle: 0, len: 0.2, wid: 0.2 },
      ],
    });
    const packed = p.pack();
    const back = p.unpack(packed).paint.map((u) => `${u.kind}@${u.part}`);
    // Part index past the end of the table: what an older client sees.
    const unknown = p.unpack(btoa(String.fromCharCode(7, (31 << 3) | 2, 9, 0, 128, 128, 0, 60, 60))).paint.length;
    p.clear();
    return { back, unknown };
  });
  check('a mark on a HEAD (gearFace) and on the SHOULDERS (gearShoulders) roundtrip as themselves', face.back.join(',') === 'dot@gearFace,dot@gearShoulders', face.back.join(','));
  check('a mark on a part the reader does not know is dropped', face.unknown === 0, String(face.unknown));
  check('fields survive quantization (body stripe at u≈0.72)', wire.first.kind === 'stripe' && wire.first.part === 'body' && Math.abs(wire.first.u - 0.72) < 0.01, JSON.stringify(wire.first));

  // THE MERGE: chest and pelvis became one body surface, so a look packed
  // before it (wire format 1) must still land on the right half of the
  // fighter rather than vanishing.
  const legacy = await page.evaluate(() => {
    const P = window.__ff2.paint;
    // Hand-build a format-1 look: one chest unit and one pelvis unit, both
    // at v = 0.5 — the chest's belongs above the waist, the pelvis's below.
    const unit = (partIdx, v) => [ (partIdx << 1), 9, 0, 191, Math.round(v * 255), 0, 150, 40 ];
    const bytes = [1, ...unit(1, 0.5), ...unit(2, 0.5)];
    const wire = btoa(String.fromCharCode(...bytes));
    return P.unpack(wire).paint;
  });
  const [oldChest, oldPelvis] = legacy;
  check('a pre-merge look still unpacks (2 units)', legacy.length === 2, JSON.stringify(legacy));
  check('its chest unit lands on the body ABOVE the waist', !!oldChest && oldChest.part === 'body' && oldChest.v > 0.5, JSON.stringify(oldChest));
  check('its pelvis unit lands on the body BELOW the waist', !!oldPelvis && oldPelvis.part === 'body' && oldPelvis.v < 0.4, JSON.stringify(oldPelvis));
  // …and a FORMAT-2 look (the merged body, before gear was paintable):
  // kind in bit 0, part in bits 1+, over head/body.
  const v2 = await page.evaluate(() => {
    const P = window.__ff2.paint;
    const unit = (partIdx, kindBit, v) => [(partIdx << 1) | kindBit, 11, 3, 191, Math.round(v * 255), 0, 120, 60];
    const bytes = [2, ...unit(1, 1, 0.3), ...unit(0, 0, 0.6)];
    return P.unpack(btoa(String.fromCharCode(...bytes))).paint.map((u) => `${u.kind}@${u.part}`);
  });
  check('a format-2 look still reads (its splotch now a DOT on the body, stripe on the head)', v2.join(',') === 'dot@body,stripe@head', v2.join(','));
  // …and FORMAT 3 (four kinds in bits 0..1, part in bits 2+), splotch included.
  const v3 = await page.evaluate(() => {
    const P = window.__ff2.paint;
    const unit = (partIdx, kind) => [(partIdx << 2) | kind, 11, 0, 191, 128, 0, 100, 60];
    const bytes = [3, ...unit(1, 1), ...unit(1, 2), ...unit(1, 3), ...unit(5, 0)];
    return P.unpack(btoa(String.fromCharCode(...bytes))).paint.map((u) => `${u.kind}@${u.part}`);
  });
  // (A format-3 hand mark was worn by both palms, so it reads on both.)
  check('a format-3 look reads (splotch→dot, dot, square, hand stripe on both palms)', v3.join(',') === 'dot@body,dot@body,square@body,stripe@hand,stripe@handR', v3.join(','));

  // THE LOCKER survives a restart — every kind (dots and squares used to
  // vanish on the next boot), and an owned splotch comes back as a dot.
  await page.evaluate(() => localStorage.setItem('ff2-paint-inv', JSON.stringify({ 'dot:5': 2, 'square:3': 1, 'triangle:7': 4, 'splotch:9': 3 })));
  await enter();
  const inv = await page.evaluate(() => {
    const p = window.__ff2.paint;
    return [p.owned('dot', 5), p.owned('square', 3), p.owned('triangle', 7), p.owned('dot', 9)];
  });
  check('owned dots, squares and triangles survive a restart; splotches came back as dots', inv.join(',') === '2,1,4,3', inv.join(','));

  // PICKING by outline: a long thin stripe is lifted from its END (the old
  // centre-distance pick missed it), and not from beside it.
  const pick = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.clear();
    p.set({ paint: [{ kind: 'stripe', part: 'body', u: 0.75, v: 0.6, angle: 0.25, len: 0.5, wid: 0.05, colour: 9, variant: 0 }] });
    return [p.at('body', 0.75, 0.84), p.at('body', 0.66, 0.6)];
  });
  check('a stripe is picked at its end, not beside it', pick[0] === 0 && pick[1] === -1, pick.join(','));
  await page.evaluate(() => window.__ff2.paint.clear());

  // THE RECORD (P4): the look as words + as the profile-card banner.
  console.log('\n=== the record: colour words + the banner ===');
  const record = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.demo();
    const packed = p.pack();
    const names = p.names(packed);
    const bannerWhite = p.banner(packed, 'blank');
    const bannerOnyx = p.banner(packed, 'onyx');
    const bare = p.banner('', 'blank');
    p.clear();
    return { names, bannerWhite, bannerOnyx, bare };
  });
  check('the demo look speaks its colours', record.names.length === 3, record.names.join(' · '));
  check('a painted look yields a banner (both tones)', record.bannerWhite.startsWith('data:image/png') && record.bannerOnyx.startsWith('data:image/png'));
  check('an unpainted look yields NO banner (clean card)', record.bare === '');
  for (const [name, url] of [['banner-white', record.bannerWhite], ['banner-onyx', record.bannerOnyx]]) {
    if (url) writeFileSync(join(here, `paint-${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }

  // THE HANDS (P6): the pair you punch with is a paint surface of its own.
  // The bay places onto it, the wire carries it, and the MIRROR — the thing
  // the bay's ray actually paints — bakes it onto the hand it is holding up.
  console.log('\n=== the hands: the surface you look at all match ===');
  await page.evaluate(() => window.__ff2.wrap.act('open-custom'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ff2.wrap.act('open-paintbay'));
  await page.waitForTimeout(500);
  const hands = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.clear();
    p.grant('stripe', 9);
    p.grant('dot', 5);
    const placed = [p.take('stripe', 9) && p.place('hand', 0.5, 0.42), p.take('dot', 5) && p.place('hand', 0.32, 0.62)];
    const back = p.unpack(p.pack()).paint;
    return { placed, back: back.map((u) => `${u.kind}@${u.part}`), u: back[0]?.u ?? -1 };
  });
  check('the bay places onto the HANDS', hands.placed.every(Boolean), JSON.stringify(hands.placed));
  check('a hand stripe + dot roundtrip the wire as themselves', hands.back.join(',') === 'stripe@hand,dot@hand', hands.back.join(','));
  check('the placement survives quantization (u≈0.5)', Math.abs(hands.u - 0.5) < 0.01, String(hands.u));
  await page.waitForTimeout(700); // the repaint key moves, then the bake follows
  const handSnap = await page.evaluate(() => window.__ff2.paintSnap('mirror-avatar', 'hand'));
  check("the MIRROR's hand bakes the paint", handSnap.startsWith('data:image/png'), handSnap.slice(0, 22));
  if (handSnap) writeFileSync(join(here, 'paint-hand.png'), Buffer.from(handSnap.split(',')[1], 'base64'));
  // THE GEAR ATLAS: each piece of gear is laid out so every mesh has its
  // own patch of the canvas — the two PAULDRONS take paint separately —
  // and a gear mark is a decal on the piece, found where it was placed.
  console.log('\n=== the gear atlas: each pad its own ===');
  // Aimed at each pad from above and outside, in the mirror's own frame.
  for (const id of ['pauldrons', 'spikepads']) {
    await page.evaluate((g) => window.__ff2.gear.equip(g), id);
    await page.waitForTimeout(700); // the rig re-dresses, the bay re-collects
    const pads = await page.evaluate(() => {
      const g = window.__ff2.bayGearProbe;
      const p = window.__ff2.paint;
      p.clear();
      const [hx, hy, hz] = g.hips();
      const aimAt = (s) => {
        const to = [hx + s * 0.22, hy + 0.43, hz];
        return g.hit([to[0] + s * 0.15, to[1] + 0.45, to[2] - 0.1], to);
      };
      const a = aimAt(1);
      const b = aimAt(-1);
      p.grant('dot', 9);
      const placed = !!a && p.take('dot', 9) && p.place(a.part, a.u, a.v);
      return { gear: g.count(), a: !!a, b: !!b, placed, onA: aimAt(1)?.at, onB: aimAt(-1)?.at, part: a?.part };
    });
    check(`${id}: a few merged surfaces, not dozens of parts`, pads.gear >= 1 && pads.gear <= 3, JSON.stringify(pads));
    check(`${id}: a dot on one pad is on that pad, not the other`, pads.a && pads.b && pads.placed && pads.onA === 0 && pads.onB === -1, JSON.stringify(pads));
    check(`${id}: the pads are the SHOULDERS' own surface (gearShoulders)`, pads.part === 'gearShoulders', JSON.stringify(pads));
  }
  // THE SHOULDERS are their own slot: pads and a body piece are worn at
  // once, and the pads' pack rides last on the wire.
  const both = await page.evaluate(() => {
    const G = window.__ff2.gear;
    G.equip('cape');
    return { worn: G.worn(), pack: G.pack(), old: G.clean('pauldrons,chestplate') };
  });
  check('SPIKED PADS and a CAPE are worn together', both.worn.join(',') === 'cape,spikepads' && both.pack === 'cape,spikepads', JSON.stringify(both));
  check('an old wire naming PAULDRONS and a CHESTPLATE now wears both', both.old.join(',') === 'chestplate,pauldrons', JSON.stringify(both));
  await page.evaluate(() => {
    window.__ff2.gear.clear('shoulders');
    window.__ff2.gear.clear('body');
  });
  await page.waitForTimeout(700);
  // EACH HAND ITS OWN: the right hand's gear is its own surface
  // ('gearHandsR'), so a mark on the left cuff is not on the right one —
  // and a look from before the split still wears its hand marks on both.
  await page.evaluate(() => window.__ff2.gear.equip('cuffs'));
  await page.waitForTimeout(700);
  const cuffs = await page.evaluate(() => {
    const g = window.__ff2.bayGearProbe;
    const p = window.__ff2.paint;
    p.clear();
    const [L, Rt] = g.gloves();
    const aimAt = ([x, y, z]) => g.hit([x, y + 0.5, z + 0.1], [x, y + 0.02, z + 0.1]);
    const a = aimAt(L);
    const b = aimAt(Rt);
    p.grant('dot', 11);
    const placed = !!a && p.take('dot', 11) && p.place(a.part, a.u, a.v);
    const after = [aimAt(L)?.at, aimAt(Rt)?.at];
    // A wire-5 look with one mark on the (then shared) hand gear.
    const unit = [(4 << 3) | 2, 9, 0, 128, 128, 0, 60, 60];
    const old = p.unpack(btoa(String.fromCharCode(5, ...unit))).paint.map((u) => u.part);
    return { partL: a?.part, partR: b?.part, placed, onL: after[0], onR: after[1], old };
  });
  check('the two hands\' gear are two surfaces (gearHands · gearHandsR)', cuffs.partL === 'gearHands' && cuffs.partR === 'gearHandsR', JSON.stringify(cuffs));
  check('a dot on the LEFT cuff is not on the RIGHT cuff', cuffs.placed && cuffs.onL === 0 && cuffs.onR === -1, JSON.stringify(cuffs));
  check('a hand-gear mark from before the split is worn on both hands', cuffs.old.join(',') === 'gearHands,gearHandsR', cuffs.old.join(','));
  await page.evaluate(() => window.__ff2.gear.clear('hands'));
  await page.waitForTimeout(700);

  // EACH PALM ITS OWN: the hands themselves split too ('hand' · 'handR',
  // wire 7) — a mark on the left palm is not on the right one, and a look
  // from before the split still wears its hand marks on both.
  const palms = await page.evaluate(() => {
    const p = window.__ff2.paint;
    p.clear();
    p.grant('dot', 11);
    const placed = p.take('dot', 11) && p.place('hand', 0.5, 0.5);
    const onL = p.at('hand', 0.5, 0.5);
    const onR = p.at('handR', 0.5, 0.5);
    // A wire-6 look with one mark on the (then shared) hand.
    const unit = [(5 << 3) | 2, 9, 0, 128, 128, 0, 60, 60];
    const old = p.unpack(btoa(String.fromCharCode(6, ...unit))).paint.map((u) => u.part);
    return { placed, onL, onR, old };
  });
  // The mirror re-bakes next frame; then each palm wears its own canvas.
  await page.waitForTimeout(700);
  Object.assign(palms, await page.evaluate(() => {
    const snapL = window.__ff2.paintSnap('mirror-avatar', 'hand');
    const snapR = window.__ff2.paintSnap('mirror-avatar', 'handR');
    window.__ff2.paint.clear();
    return { both: !!snapL && !!snapR, differ: snapL !== snapR };
  }));
  check('the mirror\'s two palms are two surfaces (hand · handR), baked apart', palms.both && palms.differ, JSON.stringify({ both: palms.both, differ: palms.differ }));
  check('a dot on the LEFT palm is not on the RIGHT palm', palms.placed && palms.onL === 0 && palms.onR === -1, JSON.stringify(palms));
  check('a hand mark from before the split is worn on both palms', palms.old.join(',') === 'hand,handR', palms.old.join(','));

  // THE FACING SPLIT: an extruded piece (the CREST's fin) gave its two
  // faces the same UVs, so a mark on one face could never show. A dot on
  // the fin's left face is on the left face, and not through on the right.
  await page.evaluate(() => window.__ff2.gear.equip('crest'));
  await page.waitForTimeout(700);
  const fin = await page.evaluate(() => {
    const g = window.__ff2.bayGearProbe;
    const p = window.__ff2.paint;
    p.clear();
    const to = [0, 1.5 + 0.17, 0.03];
    const left = () => g.hit([0.5, to[1], to[2]], to);
    const right = () => g.hit([-0.5, to[1], to[2]], to);
    const a = left();
    p.grant('dot', 11);
    const placed = !!a && p.take('dot', 11) && p.place(a.part, a.u, a.v);
    return { hitL: !!a, hitR: !!right(), placed, onL: left()?.at, onR: right()?.at };
  });
  check('a dot on one face of the crest fin is on that face, not through on the other', fin.hitL && fin.hitR && fin.placed && fin.onL === 0 && fin.onR === -1, JSON.stringify(fin));
  await page.evaluate(() => window.__ff2.gear.clear('head'));
  await page.evaluate(() => window.__ff2.gear.equip('chestplate'));
  await page.waitForTimeout(700);
  const plate = await page.evaluate(() => {
    const g = window.__ff2.bayGearProbe;
    const p = window.__ff2.paint;
    p.clear();
    const s = g.spot(0);
    p.grant('triangle', 13);
    const placed = !!s && p.take('triangle', 13) && p.place(s.part, s.u, s.v);
    return { spot: !!s, placed, on: g.at(0) };
  });
  check('the CHESTPLATE takes paint (it had no UVs to paint by)', plate.spot && plate.placed && plate.on === 0, JSON.stringify(plate));
  // A gear mark from before the atlas keeps its old look: flagged on read.
  const legacyGear = await page.evaluate(() => {
    const P = window.__ff2.paint;
    const unit = [(3 << 3) | 2, 9, 0, 128, 128, 0, 60, 60]; // format 4: a dot on gearBody
    return P.unpack(btoa(String.fromCharCode(4, ...unit))).paint[0]?.variant ?? -1;
  });
  check('a format-4 gear mark is read as a pre-atlas stamp (kept as it was)', legacyGear >= 128, String(legacyGear));
  await page.evaluate(() => window.__ff2.gear.clear('body'));

  await page.evaluate(() => {
    window.__ff2.paint.clear();
    window.__ff2.wrap.act('paintbay-close');
    window.__ff2.wrap.act('custom-close');
  });

  check('no page errors (stage 1)', errors.length === 0, errors.join(' | '));
  await page.close();
}

/* ── stage 2: the room ──────────────────────────────────────────────────── */

console.log('\n=== the room: hello → roster → bake-on-join ===');
{
  // Isolated contexts: separate localStorage, so PICASSO carries a painted
  // look and RUBE walks in factory-blank.
  const ctxA = await browser.newContext({ viewport: { width: 700, height: 500 } });
  const ctxB = await browser.newContext({ viewport: { width: 700, height: 500 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = [];
  pageA.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  pageB.on('pageerror', (e) => errors.push(`B: ${e.message}`));

  // Seed PICASSO's look BEFORE the page loads (pubConnect fires on boot).
  await ctxA.addInitScript(() => {
    const s = (part, u, v, angle, len, wid, colour) => ({ kind: 'stripe', part, u, v, angle, len, wid, colour, variant: 0 });
    localStorage.setItem('ff2-look', JSON.stringify({ paint: [s('chest', 0.75, 0.5, 0.25, 0.6, 0.15, 9), s('head', 0.75, 0.55, 0, 0.4, 0.12, 11)] }));
    // …and PICASSO's gear (avatar/gear.ts): owned + worn, so it rides the hello.
    localStorage.setItem('ff-owned-gear', JSON.stringify(['horns', 'belt']));
    localStorage.setItem('ff-gear', 'horns,belt');
  });

  const pubUrl = (name) => `${base}/pub.html?name=${name}&server=${encodeURIComponent(pubWs)}`;
  await pageA.goto(pubUrl('PICASSO'), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await pageB.goto(pubUrl('RUBE'), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});

  const online = async (page) =>
    page.waitForFunction(() => window.__ff2?.club?.online(), { timeout: 15000 }).then(() => true, () => false);
  check('PICASSO reaches the room', await online(pageA));
  check('RUBE reaches the room', await online(pageB));

  // RUBE should see PICASSO with a non-empty look, baked onto the rig.
  const seesPainted = await pageB
    .waitForFunction(() => {
      const row = window.__ff2?.club?.punters().find((p) => p.name === 'PICASSO');
      return !!row && row.lk.length > 0 && row.baked;
    }, { timeout: 15000 })
    .then(() => true, () => false);
  const rosterB = await pageB.evaluate(() => window.__ff2.club.punters());
  check('RUBE sees PICASSO painted + baked on join', seesPainted, JSON.stringify(rosterB));
  const picasso = rosterB.find((p) => p.name === 'PICASSO');
  check("RUBE sees PICASSO's GEAR on the hello (horns + belt)", !!picasso && picasso.gr === 'horns,belt', picasso?.gr ?? '(no row)');

  // …and PICASSO sees RUBE bare but still baked (base tone fill).
  const seesBare = await pageA
    .waitForFunction(() => {
      const row = window.__ff2?.club?.punters().find((p) => p.name === 'RUBE');
      return !!row && row.lk.length === 0 && row.baked;
    }, { timeout: 15000 })
    .then(() => true, () => false);
  check('PICASSO sees RUBE bare (baked base tone)', seesBare);

  // Mid-visit repaint: PICASSO's LOOK event reaches RUBE and rebakes.
  // (Needs PICASSO's frame loop ticking — enter the scene first.)
  const before = rosterB.find((p) => p.name === 'PICASSO')?.lk ?? '';
  await pageA.click('#enter-vr').catch(() => {});
  await pageA.waitForTimeout(1500);
  await pageA.evaluate(() => window.__ff2.club.repaint());
  const repaintSeen = await pageB
    .waitForFunction(
      (prev) => {
        const row = window.__ff2?.club?.punters().find((p) => p.name === 'PICASSO');
        return !!row && row.lk.length > 0 && row.lk !== prev && row.baked;
      },
      before,
      { timeout: 20000 },
    )
    .then(() => true, () => false);
  check('a mid-visit repaint reaches the room (LOOK event)', repaintSeen);

  // Restore PICASSO's stored look for whoever runs this next (probe hygiene).
  await pageA.evaluate(() => window.__ff2.club.bare()).catch(() => {});
  const fatal = errors.filter((e) => !/getUserMedia|AudioContext|NotAllowedError/i.test(e));
  check('no page errors (stage 2)', fatal.length === 0, fatal.join(' | '));
  await ctxA.close();
  await ctxB.close();
}

const bad = results.filter((r) => !r).length;
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILURE(S)`}`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
