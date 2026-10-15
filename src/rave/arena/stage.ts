/**
 * A sculpted nightclub riser: smoked lacquer, luminous glass and the
 * light show's crown lamps (arena/disco.ts) round the rim.
 *
 * The deck top is one clean sheet of smoked lacquer. No rings in it: the
 * painted teal pool in the middle and the six cyan footlight discs inside
 * the rim read as circles inside circles, and the footlights never lined
 * up with the laser lamps anyway. The glow lives at the edges now — the
 * bullnose, the fascia, the underlight — and the DJ stands on the dark.
 */
import {
  AdditiveBlending, CircleGeometry, CylinderGeometry, Group,
  LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  TorusGeometry, Vector2,
} from 'three';
import { RING } from '../config.js';

export function buildStage() {
  const stage = new Group();
  stage.name = 'goop-stage';
  const r = RING.stageRadius;
  const topY = RING.stageHeight;
  const lacquer = new MeshStandardMaterial({
    color: 0x0e1220, roughness: 0.23, metalness: 0.58,
    emissive: 0x080c19, emissiveIntensity: 0.6,
  });
  const metal = new MeshStandardMaterial({ color: 0x363d58, metalness: 0.8, roughness: 0.26 });
  const rubber = new MeshStandardMaterial({ color: 0x171719, metalness: 0.05, roughness: 0.85 });
  const neon = new MeshStandardMaterial({
    color: 0x327585, emissive: 0x20bfd5, emissiveIntensity: 0.7,
    roughness: 0.23, metalness: 0.08,
  });
  // The underlight: DiscoSystem pulses it on the beat (it used to pulse
  // six footlight discs on the deck top).
  const footlightMat = new MeshStandardMaterial({
    color: 0xb0ffff, emissive: 0x20dfff, emissiveIntensity: 1.1,
    roughness: 0.26, metalness: 0.05,
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
  tube(r - 0.15, 0.025, 0.065, footlightMat).name = 'stage-recessed-underlight';
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

  return { stage, footlightMat, neonMat: neon, haloMat, topY, dispose: () => {} };
}
