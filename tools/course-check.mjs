#!/usr/bin/env node
/**
 * THE CIRCUIT, on paper: load the course score through Vite (no browser)
 * and run its own validator — the ghost-overlay discipline, and the SWEEP:
 * no two decks may share space at ANY bar of the loop, not just at the
 * stops. Prints the route with its stops and dwell/travel timings, so a
 * change to the score can be read as a rhythm before it is walked.
 *
 *   node tools/course-check.mjs
 */

import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'error', appType: 'custom' });
try {
  const score = await vite.ssrLoadModule('/src/rave/course/score.ts');
  const cfg = await vite.ssrLoadModule('/src/rave/course/config.ts');
  const { PLATFORMS, ROUTE, INDEX, validateScore, endpointsOf } = score;
  const { MUSIC, GRID } = cfg;

  const barSec = (60 / MUSIC.bpm) * MUSIC.beatsPerBar;
  console.log(`VOIDSTEP — ${MUSIC.bpm} BPM, ${barSec.toFixed(2)} s per bar, tile ${GRID.tile} m on a ${GRID.pitch} m pitch`);
  console.log(`${PLATFORMS.length} platforms, ${ROUTE.length - 1} legs\n`);

  const fmt = (a) => `(${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})`;
  let lapBars = 0;
  for (let i = 0; i < ROUTE.length; i++) {
    const p = PLATFORMS[INDEX[ROUTE[i]]];
    const stops = endpointsOf(p).map(fmt).join(' → ');
    if (p.keys.length === 1) {
      console.log(`  ${String(i).padStart(2)}  ${p.id.padEnd(14)} static  ${p.claim.length} tile(s)  at ${stops}`);
      continue;
    }
    const segs = [];
    for (let k = 0; k + 1 < p.keys.length; k++) {
      const a = p.keys[k];
      const b = p.keys[k + 1];
      const still = a.a === b.a || (a.a.x === b.a.x && a.a.y === b.a.y && a.a.z === b.a.z);
      segs.push(`${still ? 'dwell' : 'ride'} ${b.bar - a.bar}`);
    }
    console.log(`  ${String(i).padStart(2)}  ${p.id.padEnd(14)} loop ${String(p.loopBars).padStart(2)}  ${p.claim.length} tile(s)  ${stops}\n      ${segs.join(' · ')}`);
    lapBars += p.loopBars / 2;
  }
  console.log(`\n  ~${lapBars.toFixed(0)} bars of riding per lap if every catch is clean (${(lapBars * barSec).toFixed(0)} s)`);

  const t0 = performance.now();
  validateScore();
  console.log(`\nvalidateScore: OK (${(performance.now() - t0).toFixed(0)} ms)`);
  process.exitCode = 0;
} catch (e) {
  console.error(`\nvalidateScore: FAILED\n  ${e.message}`);
  process.exitCode = 1;
} finally {
  await vite.close();
}
