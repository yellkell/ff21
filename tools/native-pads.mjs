#!/usr/bin/env node
/**
 * THE STREET PADS, brought home from the Quest build: converts the native
 * game's modelled platform skins (ff2meta FF2Quest Arena/Resources/Pads —
 * pads.bytes, an FFM1 blob written by Arena/Pads~/make_pads.py, plus its
 * deck maps and locker icons) into what the web loads:
 *
 *   public/store/pads.glb             one glTF node per FFM1 node (names and
 *                                     parents kept; GLOW_* markers are empty
 *                                     nodes, their extras in node.extras),
 *                                     meshes with POSITION / NORMAL /
 *                                     TEXCOORD_0 + indices, one material per
 *                                     FFM1 record with the record in
 *                                     material.extras (no images embedded)
 *   public/store/pads/<map>.webp      the deck maps: albedo lossy (q 85);
 *                                     normal / orm near-lossless (data);
 *                                     glow LOSSLESS with the RGB under clear
 *                                     alpha kept (Pillow, exact=True: every
 *                                     channel of it is data — see glow.py)
 *   public/forge/icons/pad_<id>.webp  the locker tiles (pad_ember = the
 *                                     STANDARD pad's, icon_ember.png)
 *
 *   node tools/native-pads.mjs [<native Pads dir>] [<web public dir>]
 *
 * The defaults are the sibling checkout (ff2meta/_ref/ff21-web next to
 * ff2meta/FF2Quest). make_pads.py already wrote the FFM1 in the glTF frame
 * (x, z, −y) with glTF's v (1 − v), so geometry passes straight through;
 * the native's NeonModel is what mirrors z back for Unity. Never re-run
 * Blender for this — the .bytes is the source.
 *
 * Needs sharp (in node_modules via the IWSDK dev plugin) and Python 3 with
 * Pillow for the glow maps (sharp's lossless WebP drops the colour under
 * transparent pixels and has no `exact` switch).
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const SRC = resolve(process.argv[2] ?? join(web, '../../FF2Quest/Assets/FF2/Runtime/Arena/Resources/Pads'));
const PUB = resolve(process.argv[3] ?? join(web, 'public'));
const ICON_IDS = ['helipad', 'afterglow', 'mainframe', 'smiley', 'ember'];

if (!existsSync(join(SRC, 'pads.bytes'))) {
  console.error(`[native-pads] no pads.bytes under ${SRC}`);
  process.exit(1);
}

// ── read FFM1 (Arena/Neon/NeonAsset.cs NeonModel.Parse; make_pads.py's writer) ──

function readFFM1(buf) {
  let o = 0;
  const i32 = () => {
    const v = buf.readInt32LE(o);
    o += 4;
    return v;
  };
  const f32 = () => {
    const v = buf.readFloatLE(o);
    o += 4;
    return v;
  };
  const str = () => {
    const n = i32();
    const s = buf.toString('utf8', o, o + n);
    o += n;
    return s;
  };
  const f32a = () => {
    const n = i32();
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = buf.readFloatLE(o + i * 4);
    o += n * 4;
    return a;
  };
  const u32a = () => {
    const n = i32();
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = buf.readUInt32LE(o + i * 4);
    o += n * 4;
    return a;
  };
  if (str() !== 'FFM1') throw new Error('not an FFM1 blob');
  const materials = [];
  for (let i = 0, nm = i32(); i < nm; i++) {
    const m = { name: str(), alphaMode: i32(), doubleSided: i32() !== 0, unlit: i32() !== 0 };
    m.base = [f32(), f32(), f32(), f32()];
    m.emissive = [f32(), f32(), f32()];
    m.emissiveStrength = f32();
    m.metallic = f32();
    m.roughness = f32();
    m.clearcoat = f32();
    m.baseTex = str();
    m.glowTex = str();
    m.ormTex = str();
    const ex = str();
    m.extras = ex ? JSON.parse(ex) : {};
    materials.push(m);
  }
  const nodes = [];
  for (let i = 0, nn = i32(); i < nn; i++) {
    const n = { name: str(), parent: i32() };
    const ex = str();
    n.extras = ex ? JSON.parse(ex) : {};
    n.t = [f32(), f32(), f32()];
    n.r = [f32(), f32(), f32(), f32()];
    n.s = [f32(), f32(), f32()];
    n.prims = [];
    for (let p = 0, np = i32(); p < np; p++) {
      const prim = { mat: i32(), vc: i32() };
      prim.pos = f32a();
      prim.nor = f32a();
      prim.uv = f32a();
      prim.col = f32a();
      prim.idx = u32a();
      n.prims.push(prim);
    }
    nodes.push(n);
  }
  if (o !== buf.length) throw new Error(`FFM1: ${buf.length - o} trailing bytes`);
  return { materials, nodes };
}

// ── write GLB ──────────────────────────────────────────────────────────────

function writeGLB(model) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    return bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, count, extra = {}) => {
    accessors.push({ bufferView: view(typed, extra.target), componentType, count, type, ...(extra.minmax ?? {}) });
    return accessors.length - 1;
  };
  const minmax = (a) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a[i + k]);
        max[k] = Math.max(max[k], a[i + k]);
      }
    return { min, max };
  };

  const materials = model.materials.map((m) => ({
    name: m.name,
    pbrMetallicRoughness: {
      baseColorFactor: m.base,
      metallicFactor: m.metallic,
      roughnessFactor: m.roughness,
    },
    emissiveFactor: m.emissive,
    // The whole FFM1 record: arena/nativePads.ts builds its own material from it.
    extras: {
      base: m.base,
      metallic: m.metallic,
      roughness: m.roughness,
      emissive: m.emissive,
      emissiveStrength: m.emissiveStrength,
      baseTex: m.baseTex,
      glowTex: m.glowTex,
      ormTex: m.ormTex,
      pad: m.extras,
    },
  }));

  const meshes = [];
  const nodes = model.nodes.map((n) => {
    const node = { name: n.name };
    if (n.t.some((v) => v !== 0)) node.translation = n.t;
    if (n.r[0] || n.r[1] || n.r[2] || n.r[3] !== 1) node.rotation = n.r;
    if (n.s.some((v) => v !== 1)) node.scale = n.s;
    if (Object.keys(n.extras).length) node.extras = n.extras;
    if (n.prims.length) {
      const primitives = n.prims.map((p) => {
        const attributes = {
          POSITION: accessor(p.pos, 'VEC3', 5126, p.vc, { target: 34962, minmax: minmax(p.pos) }),
        };
        if (p.nor.length === p.vc * 3) attributes.NORMAL = accessor(p.nor, 'VEC3', 5126, p.vc, { target: 34962 });
        if (p.uv.length === p.vc * 2) attributes.TEXCOORD_0 = accessor(p.uv, 'VEC2', 5126, p.vc, { target: 34962 });
        if (p.col.length === p.vc * 4) attributes.COLOR_0 = accessor(p.col, 'VEC4', 5126, p.vc, { target: 34962 });
        const small = p.vc < 65536;
        const idx = small ? Uint16Array.from(p.idx) : p.idx;
        const indices = accessor(idx, 'SCALAR', small ? 5123 : 5125, p.idx.length, { target: 34963 });
        return { attributes, indices, ...(p.mat >= 0 ? { material: p.mat } : {}), mode: 4 };
      });
      meshes.push({ name: n.name, primitives });
      node.mesh = meshes.length - 1;
    }
    return node;
  });
  model.nodes.forEach((n, i) => {
    if (n.parent < 0) return;
    (nodes[n.parent].children ??= []).push(i);
  });
  const roots = model.nodes.map((n, i) => (n.parent < 0 ? i : -1)).filter((i) => i >= 0);

  const json = {
    asset: { version: '2.0', generator: 'ff21 tools/native-pads.mjs (from ff2meta pads.bytes)' },
    scene: 0,
    scenes: [{ name: 'pads', nodes: roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  const bin = Buffer.concat(chunks);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPad.length, 8);
  const ch = (len, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, ch(jsonBuf.length, 0x4e4f534a), jsonBuf, ch(binPad.length, 0x004e4942), binPad]);
}

// ── go ─────────────────────────────────────────────────────────────────────

const model = readFFM1(readFileSync(join(SRC, 'pads.bytes')));
const glb = writeGLB(model);
mkdirSync(join(PUB, 'store/pads'), { recursive: true });
mkdirSync(join(PUB, 'forge/icons'), { recursive: true });
writeFileSync(join(PUB, 'store/pads.glb'), glb);
const tris = {};
for (const n of model.nodes) {
  let r = n;
  while (r.parent >= 0) r = model.nodes[r.parent];
  for (const p of n.prims) tris[r.name] = (tris[r.name] ?? 0) + p.idx.length / 3;
}
console.log(`[native-pads] store/pads.glb: ${model.nodes.length} nodes, ${model.materials.length} materials, ${(glb.length / 1024).toFixed(0)} KB`);
for (const [k, v] of Object.entries(tris)) console.log(`[native-pads]   ${k}: ${v} triangles`);

const written = [join(PUB, 'store/pads.glb')];
const TEX = join(SRC, 'Tex');
const glows = [];
for (const f of readdirSync(TEX).filter((f) => f.endsWith('.png'))) {
  const name = f.slice(0, -4);
  const out = join(PUB, 'store/pads', name + '.webp');
  if (name.endsWith('_glow')) {
    glows.push([join(TEX, f), out]);
    continue;
  }
  const img = sharp(join(TEX, f));
  if (name.endsWith('_albedo')) await img.webp({ quality: 85, effort: 6 }).toFile(out);
  // Data maps: near-lossless keeps every channel its own (no YUV, no chroma
  // subsampling), only a light value quantisation where it cannot show
  // (normals: at most 4/255 off, under 2° of tilt; ORM at most 2/255).
  else await img.webp({ nearLossless: true, quality: name.endsWith('_normal') ? 40 : 60, effort: 6 }).toFile(out);
  written.push(out);
}
if (glows.length) {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(py, [join(here, 'native-pads-glow.py'), ...glows.flat()], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[native-pads] the glow maps need Python 3 + Pillow (tools/native-pads-glow.py)');
    process.exit(1);
  }
  written.push(...glows.map((g) => g[1]));
}
for (const id of ICON_IDS) {
  const src = join(SRC, `icon_${id}.png`);
  if (!existsSync(src)) continue;
  const out = join(PUB, 'forge/icons', `pad_${id}.webp`);
  await sharp(src).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out);
  written.push(out);
}
let total = 0;
for (const f of written) {
  const s = statSync(f).size;
  total += s;
  console.log(`[native-pads]   ${f.slice(PUB.length + 1).replace(/\\/g, '/')}  ${(s / 1024).toFixed(0)} KB`);
}
console.log(`[native-pads] ${written.length} files, ${(total / 1024 / 1024).toFixed(2)} MB in all`);
