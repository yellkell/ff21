/**
 * THE STAGE SHOW — the live half of the DJ booth and the LED wall behind it.
 *
 *  - DJ GEAR (public/club/dj_gear.glb, modelled in Blender: blendercyber
 *    scripts/v2/dj_kit.py): two decks whose jog wheels turn at the record's
 *    tempo, a four-channel mixer whose faders ride the phrase, VU columns
 *    that kick on the beat, a laptop, headphones. Real-time PBR on the baked
 *    booth, lit by the club's lights and reflecting its panorama.
 *  - THE LED WALL (ledWall.ts): a GPU VJ rig on the wall's live mesh —
 *    four scenes a phrase apart, off the club's real music, in the record's
 *    sleeve, on a true LED dot grid.
 *
 * ClubSystem calls `stageShow.update()` with the room's beat.
 */
import {
  MeshBasicMaterial,
  type Group,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ambientBeat, ambientRunning, ambientTrackId } from '../audio/music.js';
import { TRACKS } from '../audio/tracks.js';
import { CLUB } from './config.js';
import { updateLedWall } from './ledWall.js';

export { adoptLedWall } from './ledWall.js';


interface Gear {
  jogs: Object3D[];
  faders: Object3D[];
  faderZ: number[];
}

let gear: Gear | null = null;

/** Load the DJ gear onto the booth. `meterMat` is the material the beat
 *  pulses (ClubRefs.consoleMat) — the gear's VU columns wear it. */
export function loadDjGear(root: Group, meterMat: MeshBasicMaterial, envMap: () => Texture | null): void {
  const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));
  loader.load('club/dj_gear.glb', (gltf) => {
    const kit = gltf.scene;
    kit.name = 'live-dj-gear';
    const D = CLUB.stage.desk;
    kit.position.set(0, D.top, D.z);
    const g: Gear = { jogs: [], faders: [], faderZ: [] };
    kit.traverse((o) => {
      if (o.name.startsWith('jog_')) g.jogs.push(o);
      if (o.name.startsWith('fader_')) {
        g.faders.push(o);
        g.faderZ.push(o.position.z);
      }
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (o.name === 'meters') {
        mesh.material = meterMat;
        return;
      }
      const m = mesh.material as { envMap?: Texture | null; envMapIntensity?: number; needsUpdate?: boolean };
      const env = envMap();
      if (env && 'envMap' in m) {
        m.envMap = env;
        m.envMapIntensity = 1.2;
        m.needsUpdate = true;
      }
    });
    root.add(kit);
    gear = g;
  });
}

export const stageShow = {
  /** `beat`: the room's beat count; `pulse`: 1 on the kick, falling fast. */
  update(dt: number, _t: number, beat: number, pulse: number, trackId?: string | null): void {
    if (gear) {
      // a record at the room's tempo: 33⅓ rpm-ish spin, nudged on the kick
      for (const [i, j] of gear.jogs.entries()) j.rotation.y -= dt * (3.5 + pulse * 1.5) * (i === 0 ? 1 : 0.97);
      // faders ride the phrase (8 bars), each channel its own way
      gear.faders.forEach((f, i) => {
        const ph = Math.sin((beat / 32) * Math.PI * 2 + i * 1.3);
        f.position.z = gear!.faderZ[i] + ph * 0.045;
      });
    }
    // The LED wall plays the record that's on, on its own clock when it has one.
    const amb = ambientRunning() ? ambientBeat() : NaN;
    const id = trackId === undefined ? ambientTrackId() : trackId;
    updateLedWall(dt, Number.isFinite(amb) ? amb : beat, id, TRACKS.find((tr) => tr.id === id)?.title ?? null);
  },
};
