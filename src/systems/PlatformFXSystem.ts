/**
 * Animates the two earned trophy platforms.
 *
 * Ordinary platform skins stay static and cheap. BLAZING and TIDEBREAKER tag
 * only their small ornament groups in arena.ts, so this system can give those
 * rewards a living silhouette without touching gameplay geometry or hitboxes.
 */

import { createSystem } from '@iwsdk/core';
import { Mesh, MeshBasicMaterial, type Object3D } from 'three';

/** Animate one tagged ornament. Exported so the lightweight visual test scene
 * can exercise the exact same motion as the in-game system. */
export function animatePlatformFxNode(node: Object3D, t: number): void {
  const role = node.userData.fxRole as string;
  const phase = (node.userData.fxPhase as number | undefined) ?? 0;
  switch (role) {
    case 'blazing-emblem':
    case 'blazing-emblem-core': {
      const pulse = 1 + Math.sin(t * 2.8) * 0.02;
      node.scale.set(pulse, pulse, 1);
      break;
    }
    case 'blazing-rail': {
      node.rotation.z = t * 0.1;
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = 0.34 + Math.sin(t * 3.2) * 0.06;
      break;
    }
    case 'blazing-jet': {
      const lick = 0.9 + Math.sin(t * 4.2 + phase) * 0.1;
      node.scale.set(0.94 + lick * 0.06, lick, 1);
      break;
    }
    case 'tide-emblem': {
      const breathe = 1 + Math.sin(t * 1.8) * 0.025;
      node.scale.set(breathe, breathe, 1);
      break;
    }
    case 'tide-pool': {
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = 0.16 + Math.sin(t * 1.5) * 0.03;
      break;
    }
    case 'tide-ring': {
      const wash = (t * 0.2 + phase) % 1;
      const scale = 0.82 + wash * 0.3;
      node.scale.setScalar(scale);
      const mat = (node as Mesh).material as MeshBasicMaterial;
      mat.opacity = (1 - wash) * 0.34;
      break;
    }
    case 'tide-crest': {
      const swell = 0.9 + Math.sin(t * 2 + phase) * 0.1;
      node.scale.y = swell;
      break;
    }
    case 'tide-drip':
      node.position.y = (node.userData.fxBaseY as number) + Math.sin(t * 1.7 + phase) * 0.008;
      break;
  }
}

export class PlatformFXSystem extends createSystem({}) {
  private time = 0;
  private nodes: Object3D[] = [];

  init(): void {
    this.scene.traverse((o) => {
      if (o.userData?.fxRole) this.nodes.push(o);
    });
  }

  update(delta: number): void {
    this.time += delta;
    const t = this.time;

    for (const node of this.nodes) {
      // A hidden skin ornament inherits invisibility from its root. Skip its
      // animation entirely until that platform is actually being worn.
      let visible = node.visible;
      for (let p = node.parent; visible && p; p = p.parent) visible = p.visible;
      if (!visible) continue;

      animatePlatformFxNode(node, t);
    }
  }
}
