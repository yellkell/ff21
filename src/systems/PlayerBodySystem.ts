/**
 * Head-driven IK for the player's body — now rendered, not just hitboxes.
 *
 * VR tracks the head (and hands), not the torso — so we solve a lightweight
 * upper-body spine each frame with the SAME `solveTorso` used for the
 * opponent's avatar: hips near your standing spot, spine up to the tracked
 * head, chest lerped along it. The ember iron torso (chest + pelvis) renders
 * so you see your own machine when you look down — but no head: the camera
 * lives inside it. The head/chest/pelvis hitbox spheres are placed from the
 * same solve, so the body you see, the body your rival sees and the body
 * that takes hits are one and the same.
 *
 * Runs before collision so hitboxes reflect the current frame's pose.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { buildBoxer, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { applyAvatarSkin } from '../avatar/skins.js';
import { BodyPart, PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { app } from '../menu/appState.js';
import { myAvatarSkin } from '../menu/customization.js';

const _head = new Vector3();
const _headQ = new Quaternion();
const _rig = new Vector3();
const _chest = new Vector3();
const _pelvis = new Vector3();
const _hands: [Vector3, Vector3] = [new Vector3(), new Vector3()];

export class PlayerBodySystem extends createSystem({
  parts: { required: [PlayerBodyPart] },
}) {
  private rig?: BoxerRig;

  init(): void {
    // Team 0 = ember. Only the torso joins the scene: gloves are driven by
    // PlayerGloveSystem on the controllers, and your own head stays unseen.
    this.rig = buildBoxer(0);
    this.rig.torso.name = 'player-torso';
    // The wearer's own head: never in the scene, and flagged first-person
    // so head GEAR (the horns, the crest) is never even built on it —
    // avatar/gear.ts applyGear reads this. Rivals see the pair; you don't.
    this.rig.head.userData.firstPerson = true;
    this.rig.torso.visible = false;
    applyAvatarSkin(this.rig.torso, myAvatarSkin());
    this.scene.add(this.rig.torso);
  }

  update(delta: number): void {
    const rig = this.rig;
    const headObj = this.playerHeadEntity?.object3D;
    const rigObj = this.playerEntity?.object3D;
    if (!rig || !headObj || !rigObj) return;

    // In the lobby nothing reads the torso or the hitboxes (collision,
    // boundary and the pose senders are all state-gated) — skip the whole
    // solve instead of running IK on an invisible body every menu frame.
    // app.showBody only hides the VISUAL: the solve still runs (below) so
    // hitboxes and the pose your rival sees are untouched by the setting.
    const active = app.state === 'playing' || app.state === 'training';
    rig.torso.visible = active && app.showBody;
    if (!active) return;

    headObj.getWorldPosition(_head);
    headObj.getWorldQuaternion(_headQ);
    rigObj.getWorldPosition(_rig);

    // Both controllers, when tracked, tell the solve where the shoulders
    // are; the torso's yaw trails the head either way (boxer.ts).
    const grips = this.world.playerSpaceEntities.gripSpaces;
    const left = grips.left?.object3D;
    const right = grips.right?.object3D;
    let hands: [Vector3, Vector3] | null = null;
    if (left && right) {
      left.getWorldPosition(_hands[0]);
      right.getWorldPosition(_hands[1]);
      hands = _hands;
    }
    solveTorso(rig, _head, _headQ, _rig.x, _rig.z, _chest, _pelvis, undefined, false, { dt: delta, hands });

    for (const entity of this.queries.parts.entities) {
      const obj = entity.object3D;
      if (!obj) continue;
      switch (entity.getValue(PlayerBodyPart, 'part')) {
        case BodyPart.Head:
          obj.position.copy(_head);
          break;
        case BodyPart.Chest:
          obj.position.copy(_chest);
          break;
        case BodyPart.Pelvis:
          obj.position.copy(_pelvis);
          break;
      }
    }
  }
}
