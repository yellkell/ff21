#!/usr/bin/env node
// GPU resource ownership: eliminating one dancer must not destroy another's warning.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/rave/choreo/telegraphs.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace("from 'three'", `from '${import.meta.resolve('three')}'`);
const { beamTelegraph, sweepTelegraph, novaTelegraph } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

const first = beamTelegraph(0.2, 2);
first.group.position.set(0.4, 0.05, 1);
const ring = [first, ...Array.from({ length: 23 }, () => first.fork())];
const mesh = first.group.children[0];
let geoDisposals = 0;
let matDisposals = 0;
mesh.geometry.addEventListener('dispose', () => geoDisposals++);
mesh.material.addEventListener('dispose', () => matDisposals++);
for (const t of ring) {
  assert.equal(t.group.children[0].geometry, mesh.geometry);
  assert.equal(t.group.children[0].material, mesh.material);
  assert.equal(t.group.position.x, 0.4);
}
ring[1].group.visible = false;
ring[1].group.position.x = -0.3;
assert.equal(first.group.visible, true);
assert.equal(first.group.position.x, 0.4);
first.dispose();
first.dispose();
assert.equal(geoDisposals, 0);
assert.equal(matDisposals, 0);
ring[2].update(0.75, 9);
assert.equal(mesh.material.uniforms.uFill.value, 0.75);
assert.equal(mesh.material.uniforms.uTime.value, 9);
const nextLanding = beamTelegraph(0.2, 2);
nextLanding.update(0.1, 9);
assert.equal(mesh.material.uniforms.uFill.value, 0.75);
for (const t of ring.slice(1).reverse()) t.dispose();
assert.equal(geoDisposals, 1);
assert.equal(matDisposals, 1);
assert.throws(() => first.fork(), /disposed/);
nextLanding.dispose();
console.log('PASS: 24 seats share resources; placement, visibility, landing clocks and disposal stay independent');

const local = sweepTelegraph(2, 2, 1.2, 0.1, 1);
const remote = sweepTelegraph(2, 2, 1.2, 0.1, 1, false);
assert.equal(local.group.children.length, 6);
assert.equal(remote.group.children.length, 3);
const roofs = remote.group.children.filter(m => m.rotation.x === -Math.PI / 2);
assert.equal(roofs.length, 1);
assert.equal(roofs[0].position.y, 1.2);
const rails = remote.group.children.filter(m => m.rotation.x === 0);
assert.equal(rails.length, 2);
assert(rails[0].position.z * rails[1].position.z < 0);
local.dispose();
remote.dispose();
console.log('PASS: remote sweeps halve warning meshes while retaining danger height and both rails');

const north = novaTelegraph(1, 0, 0.4);
const east = novaTelegraph(1, Math.PI / 2, 0.4);
assert.notEqual(north.group.children[0].material, east.group.children[0].material);
assert.equal(east.group.children[0].material.uniforms.uAngle.value, Math.PI / 2);
north.dispose();
east.dispose();
console.log('PASS: directional nova materials remain independent');
