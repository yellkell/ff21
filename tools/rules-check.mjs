#!/usr/bin/env node
/**
 * THE RULES, PROVED — firestore.rules against the emulator.
 *
 *   npm run check:rules
 *
 * The rules are the only thing standing between the boards and anyone with a
 * browser console. The client-side guards in net/boards.ts are courtesy — they
 * save a round trip — and a reviewer reading them can talk themselves into
 * believing the rules say the same thing. This file is what actually asks.
 *
 * It runs the real rules file inside the Firestore emulator and checks the
 * things that would matter if they were wrong:
 *
 *   - anonymous or not, you cannot write a row that isn't yours;
 *   - a score may only ever improve, and which direction "improve" means
 *     comes from the board's own name (`-time` boards rank low-to-high);
 *   - a room must carry the lease that lets it be swept, so a crashed host
 *     cannot leak one for ever;
 *   - both halves of a 1v1 handshake can trade ICE candidates at the exact
 *     path net/webrtcTransport.ts uses — without them no duel connects;
 *   - what a handshake leaves behind really is swept away, by the REAL
 *     net/rooms.ts helpers run against the emulator, not a copy of them;
 *   - a report can be filed and then never read back, by anyone;
 *   - the front page is read-only to every client;
 *   - a collection nobody wrote a rule for is closed.
 *
 * Everything is asserted from the CLIENT's side, under a uid, exactly as the
 * game meets it. Nothing here uses admin credentials except the fixture setup,
 * which is explicitly marked.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';

const results = [];
const check = async (name, run) => {
  try {
    await run();
    results.push(true);
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  FAIL  ${name} — ${err.message?.split('\n')[0] ?? err}`);
  }
};

const env = await initializeTestEnvironment({
  projectId: 'ff2-rules-check',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

const ME = 'uid-me';
const THEM = 'uid-them';
const me = env.authenticatedContext(ME).firestore();
const them = env.authenticatedContext(THEM).firestore();
const nobody = env.unauthenticatedContext().firestore();

const now = () => Date.now();

/* ── players ────────────────────────────────────────────────────────────── */

console.log('\n=== players: your profile is yours ===');

await check('I can create my own profile', () =>
  assertSucceeds(setDoc(doc(me, 'players', ME), { name: 'IRON', xp: 0, score: 0, at: now() })),
);

await check('I cannot write someone else\'s profile', () =>
  assertFails(setDoc(doc(them, 'players', ME), { name: 'IMPOSTOR', xp: 999, at: now() })),
);

await check('a signed-out visitor cannot write a profile', () =>
  assertFails(setDoc(doc(nobody, 'players', ME), { name: 'GHOST', at: now() })),
);

await check('anyone may READ a profile (boards show names)', () =>
  assertSucceeds(getDoc(doc(them, 'players', ME))),
);

await check('a partial update is allowed (writes are merges)', () =>
  assertSucceeds(updateDoc(doc(me, 'players', ME), { xp: 120, at: now() })),
);

await check('an out-of-range xp is refused', () =>
  assertFails(setDoc(doc(me, 'players', ME), { name: 'IRON', xp: -5, at: now() })),
);

await check('a profile cannot be deleted, even by its owner', () =>
  assertFails(deleteDoc(doc(me, 'players', ME))),
);

/* ── boards: the ratchet ────────────────────────────────────────────────── */

console.log('\n=== boards: one row each, and it may only improve ===');

const SCORE = 'boards/ff2-aim/rows';
const TIME = 'boards/ff2-raid-time/rows';

await check('I can post my own row on a score board', () =>
  assertSucceeds(setDoc(doc(me, SCORE, ME), { name: 'IRON', value: 1000, meta: {}, at: now() })),
);

await check('I cannot post a row under someone else\'s uid', () =>
  assertFails(setDoc(doc(them, SCORE, ME), { name: 'IMPOSTOR', value: 9_999_999, meta: {}, at: now() })),
);

await check('a HIGHER score replaces my row (score board)', () =>
  assertSucceeds(setDoc(doc(me, SCORE, ME), { name: 'IRON', value: 2000, meta: {}, at: now() })),
);

await check('a LOWER score is refused (score board)', () =>
  assertFails(setDoc(doc(me, SCORE, ME), { name: 'IRON', value: 500, meta: {}, at: now() })),
);

await check('an equal score is refused — it must actually beat it', () =>
  assertFails(setDoc(doc(me, SCORE, ME), { name: 'IRON', value: 2000, meta: {}, at: now() })),
);

await check('a score over the cap is refused', () =>
  assertFails(setDoc(doc(me, SCORE, ME), { name: 'IRON', value: 9_000_000, meta: {}, at: now() })),
);

await check('I can post my own row on a -time board', () =>
  assertSucceeds(setDoc(doc(me, TIME, ME), { name: 'IRON', value: 300, meta: {}, at: now() })),
);

await check('a FASTER time replaces my row (-time board ranks the other way)', () =>
  assertSucceeds(setDoc(doc(me, TIME, ME), { name: 'IRON', value: 240, meta: {}, at: now() })),
);

await check('a SLOWER time is refused (-time board)', () =>
  assertFails(setDoc(doc(me, TIME, ME), { name: 'IRON', value: 600, meta: {}, at: now() })),
);

await check('nobody can delete a board row, mine included', () =>
  assertFails(deleteDoc(doc(me, SCORE, ME))),
);

await check('anyone may READ a board', () => assertSucceeds(getDocs(collection(nobody, SCORE))));

/* ── rooms ──────────────────────────────────────────────────────────────── */

console.log('\n=== rooms: signed in, shaped right, and leased ===');

const room = (over = {}) => ({
  mode: 'duel',
  visibility: 'public',
  host: ME,
  open: true,
  at: now(),
  expiresAt: new Date(now() + 90_000),
  ...over,
});

await check('a signed-in player can open a room', () =>
  assertSucceeds(setDoc(doc(me, 'rooms', 'r1'), room())),
);

await check('a room WITHOUT expiresAt is refused — a leaked room is the outage', () =>
  assertFails(setDoc(doc(me, 'rooms', 'r2'), { mode: 'duel', visibility: 'public', host: ME, at: now() })),
);

// The type is the feature: a TTL policy ignores a numeric field entirely, so a
// room whose lease is a number is a room that can never be swept.
await check('a NUMERIC expiresAt is refused — a TTL policy would ignore it', () =>
  assertFails(setDoc(doc(me, 'rooms', 'r2b'), room({ expiresAt: Date.now() + 90_000 }))),
);

await check('an unknown mode is refused', () =>
  assertFails(setDoc(doc(me, 'rooms', 'r3'), room({ mode: 'chess' }))),
);

await check('someone else may join my room (seats are mutual writes)', () =>
  assertSucceeds(setDoc(doc(them, 'rooms', 'r1'), room({ open: false }))),
);

await check('a signed-out visitor cannot open a room', () =>
  assertFails(setDoc(doc(nobody, 'rooms', 'r4'), room())),
);

await check('a signed-out visitor cannot even read the room list', () =>
  assertFails(getDocs(collection(nobody, 'rooms'))),
);

await check('both peers can write the signalling handshake', () =>
  assertSucceeds(setDoc(doc(them, 'rooms/r1/sig', 'duel'), { offer: { sdp: 'x' } })),
);

// THE 1v1 TRICKLE. The duel publishes its SDP before ICE gathering finishes,
// so these candidates are the only way the two peers learn each other's
// addresses. The paths are the ones net/rooms.ts candidatesCol() builds for
// pair 'duel' — if the transport moves, move these with it.
const cand = { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };

await check('the duel HOST can post an ICE candidate (sig/duel/caller)', () =>
  assertSucceeds(addDoc(collection(me, 'rooms/r1/sig/duel/caller'), cand)),
);

await check('the duel GUEST can post an ICE candidate (sig/duel/callee)', () =>
  assertSucceeds(addDoc(collection(them, 'rooms/r1/sig/duel/callee'), cand)),
);

await check('each side can read the other\'s candidates back', async () => {
  await assertSucceeds(getDocs(collection(them, 'rooms/r1/sig/duel/caller')));
  await assertSucceeds(getDocs(collection(me, 'rooms/r1/sig/duel/callee')));
});

await check('a signed-out visitor cannot post a candidate', () =>
  assertFails(addDoc(collection(nobody, 'rooms/r1/sig/duel/caller'), cand)),
);

await check('a signed-out visitor cannot read the candidates', () =>
  assertFails(getDocs(collection(nobody, 'rooms/r1/sig/duel/caller'))),
);

// Where the duel used to put them — the Firestore codelab shape, straight
// under the room. No rule ever opened it, every write was denied, and the
// transport's `.catch(() => {})` hid it. It stays closed; this just pins that
// the old path was never a working one.
await check('the old codelab path (rooms/{id}/callerCandidates) is closed', () =>
  assertFails(addDoc(collection(me, 'rooms/r1/callerCandidates'), cand)),
);

/* ── signalling housekeeping ────────────────────────────────────────────── */

console.log('\n=== signalling: nothing a handshake writes outlives it ===');

// net/rooms.ts itself, transpiled — so these checks exercise the code the game
// ships. Its one runtime import opens the game's own connection; the checks
// hand it an emulator connection instead, so that import is stubbed out.
const rooms = await (async () => {
  const firebaseImport = /^import \{ cloud \} from '\.\/firebase\.js';\r?$/m;
  const src = readFileSync('src/net/rooms.ts', 'utf8');
  if (!firebaseImport.test(src)) throw new Error("rooms.ts no longer imports { cloud } from './firebase.js' — update the stub");
  const js = ts.transpileModule(src.replace(firebaseImport, 'const cloud = async () => null;'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(mkdtempSync(join(tmpdir(), 'ff2-rooms-')), 'rooms.mjs');
  writeFileSync(file, js);
  return import(pathToFileURL(file).href);
})();

/** A Cloud (net/firebase.ts) as a given player — what rooms.ts is handed. */
const as = (db, uid) => ({ fs: firestore, db, uid });

/** How many docs are left across these collections — read as admin, so a
 *  rule can't make an unswept doc look swept. */
const left = async (...paths) => {
  let n = 0; // withSecurityRulesDisabled resolves with nothing — count out here
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const p of paths) n += (await getDocs(collection(ctx.firestore(), p))).size;
  });
  return n;
};

/** The sweeps are fire-and-forget, as in the game: wait for them to land. */
const settle = async (paths, want = 0) => {
  for (let i = 0; i < 50; i++) {
    const n = await left(...paths);
    if (n === want) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${await left(...paths)} docs left under ${paths.join(', ')}, wanted ${want}`);
};

await check('a side can delete its own candidate', async () => {
  const ref = await addDoc(collection(me, 'rooms/r1/sig/duel/caller'), cand);
  await assertSucceeds(deleteDoc(ref));
});

await check('a signed-out visitor cannot delete one', async () => {
  const ref = await addDoc(collection(me, 'rooms/r1/sig/duel/caller'), cand);
  await assertFails(deleteDoc(doc(nobody, ref.path)));
});

await check('CandidateLitter deletes what it wrote — and a write that lands AFTER the sweep', async () => {
  const col = 'rooms/r5/sig/duel/caller';
  const litter = new rooms.CandidateLitter(as(me, ME));
  litter.add(await addDoc(collection(me, col), cand));
  litter.add(await addDoc(collection(me, col), cand));
  litter.sweep();
  if (!litter.swept) throw new Error('not marked swept');
  litter.add(await addDoc(collection(me, col), cand)); // in flight when the handshake finished
  await settle([col]);
});

// A stranger reaping a dead room, after the room doc has already gone — the
// exact position the lobby browsers and the duel scan are in.
await check('sweepSignals clears a dead room\'s duel AND mesh signalling', async () => {
  await setDoc(doc(me, 'rooms', 'r6'), room());
  await addDoc(collection(me, 'rooms/r6/sig/duel/caller'), cand);
  await addDoc(collection(them, 'rooms/r6/sig/duel/callee'), cand);
  await setDoc(doc(me, 'rooms/r6/sig', '0_1'), { offer: { sdp: 'x' }, answer: { sdp: 'y' } });
  await addDoc(collection(me, 'rooms/r6/sig/0_1/c0'), cand);
  await addDoc(collection(them, 'rooms/r6/sig/0_1/c1'), cand);
  await addDoc(collection(me, 'rooms/r7/sig/duel/caller'), cand); // a neighbour, still live
  await deleteDoc(doc(me, 'rooms', 'r6'));

  await rooms.sweepSignals(as(them, THEM), 'r6');

  const n = await left('rooms/r6/sig', 'rooms/r6/sig/duel/caller', 'rooms/r6/sig/duel/callee', 'rooms/r6/sig/0_1/c0', 'rooms/r6/sig/0_1/c1');
  if (n) throw new Error(`${n} docs left behind`);
  if ((await left('rooms/r7/sig/duel/caller')) !== 1) throw new Error("swept a neighbouring room's signalling");
});

await check('reapRoom deletes the room, then sweeps its signalling', async () => {
  await setDoc(doc(me, 'rooms', 'r8'), room());
  await addDoc(collection(me, 'rooms/r8/sig/duel/caller'), cand);
  await addDoc(collection(them, 'rooms/r8/sig/duel/callee'), cand);
  rooms.reapRoom(as(them, THEM), 'r8');
  await settle(['rooms/r8/sig/duel/caller', 'rooms/r8/sig/duel/callee']);
  let survived = true;
  await env.withSecurityRulesDisabled(async (ctx) => {
    survived = (await getDoc(doc(ctx.firestore(), 'rooms', 'r8'))).exists();
  });
  if (survived) throw new Error('the room itself survived');
});

/* ── presence ───────────────────────────────────────────────────────────── */

console.log('\n=== presence: your own record, and it expires ===');

await check('I can check in', () =>
  assertSucceeds(
    setDoc(doc(me, 'presence', ME), { name: 'IRON', where: 'club', look: '', at: now(), expiresAt: new Date(now() + 150_000) }),
  ),
);

await check('I cannot check someone else in', () =>
  assertFails(
    setDoc(doc(them, 'presence', ME), { name: 'IRON', where: 'club', at: now(), expiresAt: new Date(now() + 150_000) }),
  ),
);

await check('an unknown room is refused', () =>
  assertFails(
    setDoc(doc(me, 'presence', ME), { name: 'IRON', where: 'moon', at: now(), expiresAt: new Date(now() + 150_000) }),
  ),
);

await check('I can check myself out', () => assertSucceeds(deleteDoc(doc(me, 'presence', ME))));

// THE SWEEP. TTL needs a billing plan, so the clients do the housekeeping —
// which only works if anyone may bin a record that has already lapsed.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'presence', 'stale'), {
    name: 'GHOST', where: 'club', at: 1, expiresAt: new Date(Date.now() - 60_000),
  });
  await setDoc(doc(db, 'presence', 'live'), {
    name: 'HERE', where: 'club', at: now(), expiresAt: new Date(now() + 150_000),
  });
  // Written back when the lease was a number — no TTL policy could ever have
  // recognised it, so the sweep has to be able to.
  await setDoc(doc(db, 'presence', 'legacy'), {
    name: 'OLD', where: 'club', at: 1, expiresAt: Date.now() - 60_000,
  });
});

await check('anyone may sweep an EXPIRED record', () =>
  assertSucceeds(deleteDoc(doc(them, 'presence', 'stale'))),
);

await check('…and one whose lease is a leftover number', () =>
  assertSucceeds(deleteDoc(doc(them, 'presence', 'legacy'))),
);

await check('but NOT a live one belonging to somebody else', () =>
  assertFails(deleteDoc(doc(them, 'presence', 'live'))),
);

/* ── probes ─────────────────────────────────────────────────────────────── */

console.log('\n=== probes: the clock probe, and only your own ===');

await check('I can write my own clock probe', () =>
  assertSucceeds(setDoc(doc(me, 'probes', ME), { t: now() })),
);

await check('I cannot write someone else\'s probe', () =>
  assertFails(setDoc(doc(them, 'probes', ME), { t: now() })),
);

/* ── reports ────────────────────────────────────────────────────────────── */

console.log('\n=== reports: file and forget ===');

await check('I can file a report', () =>
  assertSucceeds(setDoc(doc(me, 'reports', 'rep1'), { text: 'someone is cheating', from: 'IRON', uid: ME })),
);

await check('I cannot file one under someone else\'s uid', () =>
  assertFails(setDoc(doc(me, 'reports', 'rep2'), { text: 'framed', from: 'IRON', uid: THEM })),
);

await check('an over-long report is refused', () =>
  assertFails(setDoc(doc(me, 'reports', 'rep3'), { text: 'x'.repeat(500), from: 'IRON', uid: ME })),
);

await check('NOBODY can read reports back, not even the filer', () =>
  assertFails(getDoc(doc(me, 'reports', 'rep1'))),
);

/* ── gazette ────────────────────────────────────────────────────────────── */

console.log('\n=== gazette: the front page is not yours to edit ===');

// Fixture only — the real paper is written by a service account, which the
// rules do not apply to. This is the one place admin credentials appear.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'gazette', 'latest'), { edition: 1, headline: 'TIDE FALLS' });
});

await check('anyone may read the paper', () => assertSucceeds(getDoc(doc(nobody, 'gazette', 'latest'))));

await check('no client may write the paper', () =>
  assertFails(setDoc(doc(me, 'gazette', 'latest'), { edition: 99, headline: 'I WIN' })),
);

/* ── the default ────────────────────────────────────────────────────────── */

console.log('\n=== everything else is closed ===');

await check('an unruled collection cannot be written', () =>
  assertFails(setDoc(doc(me, 'whatever', 'x'), { a: 1 })),
);

await check('an unruled collection cannot be read', () =>
  assertFails(getDoc(doc(me, 'whatever', 'x'))),
);

await check('the retired run collections are closed', () =>
  assertFails(setDoc(doc(me, 'runGauntlet', 'x'), { seconds: 1 })),
);

await check('the retired lobby collections are closed', () =>
  assertFails(setDoc(doc(me, 'arcadeRooms', 'x'), { mode: 'raid' })),
);

await env.cleanup();

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILURE(S)` : `\nALL PASS (${results.length} checks)`);
process.exit(failed ? 1 : 0);
