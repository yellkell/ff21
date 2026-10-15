/** A sculpted nightclub riser: smoked lacquer, luminous glass and recessed fixtures. */
import {
  AdditiveBlending, CanvasTexture, CircleGeometry, CylinderGeometry, Group, InstancedMesh,
  LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, SRGBColorSpace,
  TorusGeometry, Vector2,
} from 'three';
import { RING } from '../config.js';

/** A soft illuminated centre baked once; no per-frame canvas uploads. */
function deckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#080c19';
  g.fillRect(0, 0, 512, 512);
  const pool = g.createRadialGradient(256, 256, 18, 256, 256, 220);
  pool.addColorStop(0, '#287b91');
  pool.addColorStop(0.30, '#184b6b');
  pool.addColorStop(0.62, '#242247');
  pool.addColorStop(0.86, '#161325');
  pool.addColorStop(1, '#080c19');
  g.fillStyle = pool;
  g.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildStage() {
  const stage = new Group();
  stage.name = 'goop-stage';
  const r = RING.stageRadius;
  const topY = RING.stageHeight;
  const surface = deckTexture();
  const lacquer = new MeshStandardMaterial({
    map: surface, color: 0xffffff, roughness: 0.23, metalness: 0.58,
    emissiveMap: surface, emissive: 0xffffff, emissiveIntensity: 0.7,
  });
  const metal = new MeshStandardMaterial({ color: 0x363d58, metalness: 0.8, roughness: 0.26 });
  const rubber = new MeshStandardMaterial({ color: 0x171719, metalness: 0.05, roughness: 0.85 });
  const neon = new MeshStandardMaterial({
    color: 0x327585, emissive: 0x20bfd5, emissiveIntensity: 0.7,
    roughness: 0.23, metalness: 0.08,
  });
  const cyan = new MeshStandardMaterial({
    color: 0xaaffff, emissive: 0x00dfff, emissiveIntensity: 1.2,
    roughness: 0.24, metalness: 0.08,
  });

  const deck = new Mesh(new CircleGeometry(r - 0.035, 96), lacquer);
  deck.name = 'stage-smoked-deck';
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = topY;
  stage.add(deck);

  const edge = new Mesh(new LatheGeometry([
    new Vector2(r - 0.10, topY - 0.13),
    new Vector2(r - 0.015, topY - 0.12),
    new Vector2(r + 0.015, topY - 0.085),
    new Vector2(r + 0.02, topY - 0.035),
    new Vector2(r, topY - 0.006),
    new Vector2(r - 0.035, topY),
  ], 96), metal);
  edge.name = 'stage-rolled-edge';
  stage.add(edge);

  // A thick rounded glass fascia, set between physical metal shoulders.
  const fascia = new Mesh(new LatheGeometry([
    new Vector2(r - 0.09, topY - 0.29),
    new Vector2(r - 0.015, topY - 0.26),
    new Vector2(r + 0.025, topY - 0.20),
    new Vector2(r - 0.015, topY - 0.14),
    new Vector2(r - 0.09, topY - 0.12),
  ], 96), neon);
  fascia.name = 'stage-neon-glass-fascia';
  stage.add(fascia);
  const base = new Mesh(new LatheGeometry([
    new Vector2(r - 0.35, 0.015), new Vector2(r - 0.12, 0.04),
    new Vector2(r - 0.06, 0.10), new Vector2(r - 0.09, topY - 0.29),
  ], 96), metal);
  base.name = 'stage-sculpted-base';
  stage.add(base);

  const tube = (radius: number, thickness: number, y: number, material: MeshStandardMaterial | MeshBasicMaterial) => {
    const mesh = new Mesh(new TorusGeometry(radius, thickness, 10, 96), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    stage.add(mesh);
    return mesh;
  };
  // Continuous glass bullnose and a recessed blue underlight give the riser
  // real volume. Soft halos surround opaque cores instead of replacing them.
  tube(r - 0.025, 0.04, topY - 0.015, neon).name = 'stage-neon-bullnose';
  tube(r - 0.15, 0.025, 0.065, cyan).name = 'stage-recessed-underlight';
  const haloMat = new MeshBasicMaterial({
    color: 0x20bfd5, transparent: true, opacity: 0.055,
    blending: AdditiveBlending, depthWrite: false,
  });
  tube(r - 0.035, 0.105, topY - 0.08, haloMat);

  // Shallow access steps on the audience side make this a usable stage.
  for (let i = 0; i < 2; i++) {
    const height = (i + 1) * topY / 3;
    const radius = r + 0.44 - i * 0.20;
    const step = new Mesh(new CylinderGeometry(radius, radius, height, 32, 1, false,
      -0.23, 0.46), rubber);
    step.position.y = height / 2;
    step.name = 'stage-access-step';
    stage.add(step);
  }

  // Recessed cyan uplights surround the performer without tall obstructions.
  const footlightMat = new MeshStandardMaterial({
    color: 0xb0ffff, emissive: 0x20dfff, emissiveIntensity: 1.1,
    roughness: 0.26, metalness: 0.05,
  });
  const housings = new InstancedMesh(new TorusGeometry(0.09, 0.021, 8, 20), rubber, 6);
  const lenses = new InstancedMesh(new CircleGeometry(0.072, 20), footlightMat, 6);
  housings.name = 'stage-footlight-housings';
  lenses.name = 'stage-footlights';
  const at = new Object3D();
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) * Math.PI / 3;
    at.position.set(Math.sin(a) * (r - 0.22), topY + 0.021, Math.cos(a) * (r - 0.22));
    at.rotation.set(-Math.PI / 2, 0, a);
    at.updateMatrix();
    housings.setMatrixAt(i, at.matrix);
    at.position.y += 0.003;
    at.updateMatrix();
    lenses.setMatrixAt(i, at.matrix);
  }
  stage.add(housings, lenses);
  return { stage, footlightMat, neonMat: neon, haloMat, topY, dispose: () => surface.dispose() };
}
