/**
 * THE UPGRADED VOID — the sculpted shapes (blendercyber scripts/v2/void_kit.py
 * → public/rave/void_kit.glb) swapped into the void kit's instanced banks
 * (voidkit.ts names them 'void:*').
 *
 * The void stays what it is: darkness given shape by light, every repeated
 * thing one InstancedMesh, the music driving per-instance colour. What
 * changes is the FORM under the light. The primitive stand-ins — hex
 * cylinders, boxes, half-tori — become designed pieces: fluted octagonal
 * monoliths with the light lying in recessed channels, ribbed collars, gem
 * crowns, setback megastructures on the skyline, lattice-truss spars, ribbed
 * arches and crystal shards. Each is authored in its primitive's own unit
 * frame, so every instance matrix (and the mirror's flipped clones, which
 * share them) lands it exactly where the primitive stood.
 *
 * And the dark bodies finally catch light: they reflect a painted neon
 * horizon (bands of magenta and cyan over black) — the void's own light,
 * so polished obsidian reads as SHAPE instead of as a cut-out.
 *
 * FACADES: the monoliths and the skyline wear lit window cells, computed
 * in their own shader in METRES (from each instance's scale), seeded per
 * tower, with a few columns of data-rain sliding down. No texture, no UVs,
 * no extra draws. Cells fade to their average where they'd shrink under a
 * pixel, so the far skyline reads as lit floors rather than as moiré. The
 * set drives their hue and gain (`driveFacades`), on the same cool wheel
 * as the far sky.
 */
import {
  CanvasTexture,
  Color,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Bank name (voidkit.ts) → sculpted piece (void_kit.glb). */
const SWAP: Record<string, string> = {
  'void:tower-body': 'TOWER_BODY',
  'void:tower-band': 'TOWER_BAND',
  'void:tower-stripe': 'TOWER_STRIPE',
  'void:tower-cap': 'TOWER_CAP',
  'void:sky-body': 'SKY_BODY',
  'void:sky-edge': 'SKY_EDGE',
  'void:spar': 'SPAR',
  'void:node': 'NODE',
  'void:arc-dark': 'ARC_DARK',
  'void:arc-glow': 'ARC_GLOW',
  'void:shard': 'SHARD',
  'void:shard-halo': 'SHARD',
};

/** Window-cell size in metres (w, h) per facade-wearing bank. */
const FACADE: Record<string, [number, number]> = {
  'void:tower-body': [0.15, 0.24],
  'void:sky-body': [0.75, 1.15],
};

/** Shared by every facade material, so one call drives the whole void. */
const facadeUniforms = {
  uFacHue: { value: new Color(0.62, 0.42, 1.0) },
  uFacGain: { value: 0.6 },
  uFacTime: { value: 0 },
};

/** The set (or the foyer) sets the facades' hue (linear) and gain. */
export function driveFacades(hue: Color, gain: number, time: number): void {
  facadeUniforms.uFacHue.value.copy(hue);
  facadeUniforms.uFacGain.value = gain;
  facadeUniforms.uFacTime.value = time;
}

function wearFacade(m: MeshStandardMaterial, cell: [number, number], dim: number): void {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, facadeUniforms);
    sh.uniforms.uFacCell = { value: cell };
    sh.uniforms.uFacDim = { value: dim };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacP;
        varying vec3 vFacN;
        varying vec3 vFacS;
        varying vec3 vFacSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFacP = position;
        vFacN = normal;
        #ifdef USE_INSTANCING
          vFacS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vFacSeed = instanceMatrix[3].xyz;
        #else
          vFacS = vec3(1.0);
          vFacSeed = vec3(0.0);
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uFacHue;
        uniform float uFacGain;
        uniform float uFacTime;
        uniform vec2 uFacCell;
        uniform float uFacDim;
        varying vec3 vFacP;
        varying vec3 vFacN;
        varying vec3 vFacS;
        varying vec3 vFacSeed;
        float facHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Metres around and up the tower; its translation seeds the pattern.
          float seed = facHash(vFacSeed.xz * 0.37);
          float r = 0.5 * 0.5 * (vFacS.x + vFacS.z);
          vec2 m = vec2(atan(vFacP.z, vFacP.x) * r, (vFacP.y + 0.5) * vFacS.y);
          vec2 g = m / uFacCell;
          vec2 id = floor(g);
          vec2 f = fract(g);
          float win = smoothstep(0.14, 0.24, f.x) * smoothstep(0.86, 0.76, f.x) * smoothstep(0.16, 0.28, f.y) * smoothstep(0.84, 0.72, f.y);
          float floorLit = step(0.3, facHash(vec2(floor(id.y / 5.0), seed * 91.0)));   // whole floors dark
          float h = facHash(id + seed * 57.0);
          float lit = step(0.74, h) * floorLit * (0.35 + 0.65 * facHash(id.yx + seed));
          // Data rain: a few columns carry a bright run sliding down.
          float col = step(0.93, facHash(vec2(id.x, seed * 13.0)));
          float run = fract((id.y * uFacCell.y - uFacTime * (2.0 + 6.0 * facHash(vec2(id.x, 3.1)))) / (6.0 + 10.0 * seed));
          lit = max(lit, col * smoothstep(0.75, 1.0, run) * 1.6);
          float cells = win * lit;
          // Under a pixel? fade to the average so the skyline doesn't crawl.
          vec2 fw = fwidth(g);
          cells = mix(cells, 0.06, smoothstep(0.3, 0.8, max(fw.x, fw.y)));
          // Sides only, and not the plinth or the crown.
          float side = 1.0 - smoothstep(0.35, 0.6, abs(normalize(vFacN).y));
          float band = smoothstep(0.5, 1.2, m.y) * smoothstep(0.5, 1.4, vFacS.y - m.y);
          totalEmissiveRadiance += uFacHue * (cells * side * band * uFacGain * uFacDim * 1.8);
        }`,
      );
  };
  m.customProgramCacheKey = () => `facade-${cell[0]}-${dim}`;
  m.needsUpdate = true;
}

/** Is this object inside the void's mirror (a negatively scaled ancestor)? */
function mirrored(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.scale.y < 0) return true;
  return false;
}

const roots: Object3D[] = [];
let shapes: Record<string, BufferGeometry> | null = null;
let loading = false;
let horizon: CanvasTexture | null = null;

/** The neon horizon the obsidian reflects: black, a hot line at the
 *  horizon, magenta and cyan bands above it, a few cold verticals. */
export function horizonEnv(): CanvasTexture {
  if (horizon) return horizon;
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#020104';
  g.fillRect(0, 0, W, H);
  const band = (y: number, h: number, rgb: string, a: number): void => {
    const gr = g.createLinearGradient(0, y - h, 0, y + h);
    gr.addColorStop(0, `rgba(${rgb},0)`);
    gr.addColorStop(0.5, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, y - h, W, h * 2);
  };
  band(H * 0.5, 6, '255,255,255', 0.9); // the horizon line
  band(H * 0.44, 22, '255,61,166', 0.55); // magenta haze over it
  band(H * 0.3, 14, '63,242,255', 0.35); // a cyan band higher up
  band(H * 0.62, 18, '120,60,255', 0.25); // violet below (the floor's glow)
  for (let i = 0; i < 9; i++) {
    // cold verticals: far beams
    const x = (i + 0.5) * (W / 9) + Math.sin(i * 7.3) * 18;
    const gr = g.createLinearGradient(x - 3, 0, x + 3, 0);
    gr.addColorStop(0, 'rgba(160,220,255,0)');
    gr.addColorStop(0.5, 'rgba(160,220,255,0.35)');
    gr.addColorStop(1, 'rgba(160,220,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - 3, 0, 6, H * 0.5);
  }
  horizon = new CanvasTexture(c);
  horizon.mapping = EquirectangularReflectionMapping;
  horizon.colorSpace = SRGBColorSpace;
  return horizon;
}

function upgrade(root: Object3D): void {
  if (!shapes) return;
  const env = horizonEnv();
  root.traverse((o) => {
    const key = SWAP[o.name];
    const mesh = o as Mesh;
    if (!key || !mesh.isMesh || mesh.userData.sculpted) return;
    const geo = shapes![key];
    if (!geo) return;
    mesh.geometry = geo;
    mesh.userData.sculpted = true;
    const m = mesh.material as MeshStandardMaterial;
    if (m.isMeshStandardMaterial) {
      m.envMap = env;
      m.envMapIntensity = 1.1;
      m.needsUpdate = true;
      const cell = FACADE[o.name];
      if (cell) wearFacade(m, cell, mirrored(o) ? 0.4 : 1);
    }
  });
}

/** Register a void (the raid set, the foyer, the course) to wear the sculpted kit. */
export function upgradeVoid(root: Object3D): void {
  // ?voidkit=0 keeps the primitive void (side-by-side look-dev comparison).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('voidkit') === '0') return;
  roots.push(root);
  if (shapes) {
    upgrade(root);
    return;
  }
  if (loading) return;
  loading = true;
  new GLTFLoader().load(
    'rave/void_kit.glb',
    (gltf) => {
      const out: Record<string, BufferGeometry> = {};
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) out[o.name] = m.geometry;
      });
      shapes = out;
      for (const r of roots) upgrade(r);
    },
    undefined,
    () => {
      /* no kit — the primitive void stands */
    },
  );
}
