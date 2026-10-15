/**
 * Renders the OTHER boxers — the floating-hands iron boxer (head + IK torso +
 * gloves, no legs) — from the opponent pose bus, and keeps each one's three
 * hitbox spheres (head/chest/pelvis) glued to that pose. The bus is written by
 * BotSystem in bot bouts and NetworkSystem in online bouts, so this system
 * neither knows nor cares which one it is fighting for.
 *
 * The classic duel has one rig; arcade 2v2 / FFA light up to MAX_OPPONENTS
 * rigs, one per roster slot, each placed on its own platform and tinted to its
 * team colour.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import { CylinderGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { buildBoxer, setAvatarAccent, setGloveLit, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import { spawnPopup } from '../fx/effects.js';
import { HAND_ADDUCTION, setHandCurl } from '../avatar/hands.js';
import {
  AVATAR_SKINS,
  OPPONENT_DEFAULT_AVATAR,
  OPPONENT_DEFAULT_PLATFORM,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
  resolveAvatarSkin,
  type AvatarSkin,
} from '../avatar/skins.js';
import { platformName } from '../arena/arena.js';
import { applyLook, paintHiddenAll, paintPrefs, unpackLook } from '../avatar/paint.js';
import { applyGear, cleanGear } from '../avatar/gear.js';
import { socialPaintHidden, socialState } from '../pub/social.js';
import { Combatant } from '../components/Combatant.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { Health } from '../components/Health.js';
import { Hitbox, HitboxKind } from '../components/Hitbox.js';
import { MAX_OPPONENTS, opponents } from '../combat/opponentBus.js';
import { classicDuel, localLayout } from '../combat/layout.js';
import { app } from '../menu/appState.js';
import { mesh } from '../net/mesh.js';
import { rival } from '../net/leaderboard.js';
import { BODY_IK, hueToColor, teamColor } from '../config.js';

const _chest = new Vector3();
const _pelvis = new Vector3();
const _localHead = new Vector3();
const _xPos = new Vector3();
/** A knocked-out fighter washes out to this grey. */
const DEAD_GREY = 0x8a8f99;

/**
 * The pool a bot rolls its bout skin from. Locked entries are filtered out:
 * applyAvatarSkin refuses to paint a locked skin, so rolling one would leave
 * the bot in whatever colours its rig happened to be built with rather than
 * a skin at all. Nothing in the roster is locked today — this keeps the roll
 * honest the moment something is.
 */
const BOT_SKINS = AVATAR_SKINS.filter((s) => !s.locked);

interface OppRig {
  rig: BoxerRig;
  hitboxes: { head?: Entity; chest?: Entity; pelvis?: Entity };
  built: boolean;
  appliedSkins: string;
  accentColor: number;
  /** Random skin an arcade bot wears for this bout (re-rolled each bout). */
  botSkin?: AvatarSkin;
}

export class OpponentSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private rigs: OppRig[] = [];
  /** Grey "you're out" spotlight per fighter slot (index 0 = the local player). */
  private spotlights: Mesh[] = [];
  /** Was each fighter slot alive last frame, so a death fires the red X once. */
  private wasAlive: boolean[] = [];
  /** Out-of-bout: the rigs were hidden/parked once and we're sleeping. */
  private parked = false;

  init(): void {
    for (let i = 0; i < MAX_OPPONENTS; i++) {
      const rig = buildBoxer(1);
      for (const piece of rig.all) {
        piece.visible = false;
        this.scene.add(piece);
      }
      this.rigs[i] = { rig, hitboxes: {}, built: false, appliedSkins: '', accentColor: teamColor(1) };
    }
    // A dim grey light-cone over each platform a downed fighter is stuck under.
    const cone = new CylinderGeometry(0.16, 0.82, 2.4, 20, 1, true);
    for (let slot = 0; slot <= MAX_OPPONENTS; slot++) {
      const mat = new MeshBasicMaterial({ color: DEAD_GREY, transparent: true, opacity: 0.16, depthWrite: false });
      const spot = new Mesh(cone, mat);
      spot.position.y = 1.2;
      spot.visible = false;
      this.spotlights[slot] = spot;
      this.scene.add(spot);
      this.wasAlive[slot] = true;
    }
  }

  update(delta: number): void {
    // SOLO campaign bouts never field a humanoid — the titan replaces slot 1.
    // Gating here (not just on Combatant.active) kills the one-frame flash of
    // a normal bot before CampaignSystem's begin() stands it down. RAIDS are
    // campaign-mode too but their other seats are REAL raiders — render them.
    const playing = app.state === 'playing' && !(app.mode === 'campaign' && app.arcade !== 'raid');

    // Lobby / queueing / solo campaign: park everything ONCE, then sleep —
    // re-hiding three full mech rigs (hundreds of `.visible` writes) every
    // menu frame was pure waste.
    if (!playing) {
      if (!this.parked) {
        this.parked = true;
        for (let i = 0; i < MAX_OPPONENTS; i++) {
          const r = this.rigs[i];
          if (!r) continue;
          const pose = opponents[i];
          pose.active = false;
          for (const piece of r.rig.all) piece.visible = false;
          r.botSkin = undefined; // forget the bout skin so the next bout re-rolls
          r.appliedSkins = '';
          this.deathFx(i + 1, false, pose.headPos);
          if (r.built) this.parkHitboxes(i);
        }
        this.deathFx(0, false, _localHead); // pos unused while alive
      }
      return;
    }
    this.parked = false;
    const roster = localLayout();

    for (let i = 0; i < MAX_OPPONENTS; i++) {
      const slot = i + 1;
      const seat = roster[slot];
      const r = this.rigs[i];
      if (!r) continue;
      if (!r.built) this.buildHitboxes(i, slot);

      const combatant = this.findCombatant(slot);
      const active = playing && !!seat && (combatant?.getValue(Combatant, 'active') ?? 0) === 1;
      const pose = opponents[i];
      pose.active = active;
      for (const piece of r.rig.all) piece.visible = active;
      if (!active || !seat) {
        // Idle: forget this rig's bout skin so the next bout re-rolls it.
        r.botSkin = undefined;
        r.appliedSkins = '';
        this.deathFx(slot, false, pose.headPos);
        this.parkHitboxes(i);
        continue;
      }

      // Knocked out: wash the avatar grey, dim its gloves, light the spotlight.
      const dead = (combatant?.getValue(Health, 'current') ?? 1) <= 0;
      this.deathFx(slot, dead, pose.headPos);

      // Keep the hitboxes' team in step with the combatant (it shifts per mode).
      const team = combatant?.getValue(Combatant, 'team') ?? seat.team;
      for (const e of [r.hitboxes.head, r.hitboxes.chest, r.hitboxes.pelvis]) {
        if (e && (e.getValue(Hitbox, 'team') ?? -1) !== team) e.setValue(Hitbox, 'team', team);
      }

      this.applySkins(r, slot);

      // Neon: a downed fighter greys out; otherwise every remote HUMAN wears
      // their own synced accent (their pose packets carry it in ALL online
      // modes — duel, 2v2, FFA and raids; ball fire stays team-tinted, which
      // already tells friend from foe) and bots wear the team tint. accentHue
      // is -1 until a real peer packet arrives. Recolour only on a change.
      // The TUTORIAL is the one bot bout allowed through: it paints its
      // sparring bot rust via the same accent channel (see TutorialSystem).
      const human = pose.accentHue >= 0 && (app.mode === 'net' || (app.arcade === 'raid' && mesh.joined) || app.tutorial);
      const want = dead
        ? DEAD_GREY
        : human
          ? hueToColor(pose.accentHue, pose.accentLight)
          : teamColor(team);
      if (want !== r.accentColor) {
        r.accentColor = want;
        for (const piece of r.rig.all) setAvatarAccent(piece, want);
      }

      // Head + torso from the bus pose, anchored on this fighter's platform.
      solveTorso(r.rig, pose.headPos, pose.headQuat, seat.pos[0], seat.pos[2], _chest, _pelvis, undefined, false, {
        dt: delta,
        hands: pose.handPos,
      });
      for (const hand of [0, 1] as const) {
        r.rig.gloves[hand].position.copy(pose.handPos[hand]);
        r.rig.gloves[hand].quaternion.copy(pose.handQuat[hand]).multiply(HAND_ADDUCTION[hand]);
        const lit = !dead && (pose.orbiting[hand] || pose.blocking[hand] || this.ballReturning(slot, hand));
        const fisting = !dead && pose.fisting[hand];
        setGloveLit(r.rig.gloves[hand], lit, delta);
        setHandCurl(
          r.rig.gloves[hand],
          lit || fisting ? 1 : 0.35,
          lit || fisting ? 1 : 0.4,
          lit || fisting ? 0.9 : 0.45,
        );
      }

      r.hitboxes.head?.object3D?.position.copy(pose.headPos);
      r.hitboxes.chest?.object3D?.position.copy(_chest);
      r.hitboxes.pelvis?.object3D?.position.copy(_pelvis);
    }

    // The local player has no avatar to grey, but still gets the spotlight +
    // red X when they're knocked out of a brawl.
    const me = this.findCombatant(0);
    const head = this.playerHeadEntity?.object3D;
    if (head) head.getWorldPosition(_localHead);
    else _localHead.set(0, 1.5, 0);
    const meDead = playing && (me?.getValue(Health, 'current') ?? 1) <= 0;
    this.deathFx(0, meDead, _localHead);
  }

  /** Light a fighter's grey spotlight while down and pop a red X the moment
   *  they're knocked out. `slot` 0 is the local player. */
  private deathFx(slot: number, dead: boolean, headPos: Vector3): void {
    const spot = this.spotlights[slot];
    if (spot) {
      spot.visible = dead;
      if (dead) {
        const seat = localLayout()[slot];
        if (seat) spot.position.set(seat.pos[0], spot.position.y, seat.pos[2]);
      }
    }
    if ((this.wasAlive[slot] ?? true) && dead) {
      _xPos.copy(headPos);
      _xPos.y += 0.05;
      spawnPopup(this.world, _xPos, 'X', '#ff2a2a', 'rgba(255,40,30,1)', 1.9);
    }
    this.wasAlive[slot] = !dead;
  }

  /**
   * Dress every remote HUMAN the way THEY chose — the 1v1 rival from the
   * duel's `iam` (leaderboard) store, every mesh fighter (2v2 / FFA rivals,
   * raid squadmates) from the cosmetics their mesh `iam` broadcast — and give
   * bots a random bout skin. Their PAINT bakes here too (the packed look off
   * the same `iam`, re-validated by unpackLook), so anywhere their body
   * renders, their painting renders — unless you hid it. Visual only.
   */
  private applySkins(r: OppRig, slot: number): void {
    // The classic duel rival syncs through the 1v1 net client's store; it is
    // NOT valid in mesh bouts (it holds whoever you last duelled — reading it
    // for mesh slot 1 was why 2v2/FFA rivals sometimes wore a stranger's kit).
    const duel = app.mode === 'net' && classicDuel() && slot === 1;
    // Any seated mesh peer: look their cosmetics up by canonical seat.
    const seat = !duel && mesh.joined ? (localLayout()[slot]?.canonical ?? -1) : -1;
    const peer = seat >= 0 ? mesh.cosmetics[seat] : undefined;
    let av: AvatarSkin;
    if (duel && rival.avatarSkin) av = resolveAvatarSkin(rival.avatarSkin, rival.avColor, rival.avLight);
    else if (peer?.av) av = resolveAvatarSkin(peer.av, peer.avc ?? -1, peer.avl ?? 0.5);
    else if (!mesh.joined && app.mode === 'bot') {
      // BOTS wear a random head/chassis skin for the bout (the team-colour
      // accent is still applied above, so teams stay readable).
      //
      // This used to be gated on `app.arcade !== '1v1'`, which quietly excluded
      // every bot the game actually serves most often: QUICK MATCH, VS BOT and
      // the tutorial all run a 1v1 layout, so all of them fell through to the
      // house team-blue default and every bot bout looked identical. What the
      // guard was really protecting is a duel RIVAL whose `iam` hasn't landed
      // yet — and `app.mode === 'bot'` says that directly, without also
      // catching the bots. Campaign titans (mode 'campaign') keep their
      // bespoke chassis; a mesh peer mid-handshake still gets the house
      // default, which is what stopped the "teammates in random skins" raid
      // bug.
      r.botSkin ??= BOT_SKINS[Math.floor(Math.random() * BOT_SKINS.length)];
      av = r.botSkin;
    } else av = OPPONENT_DEFAULT_AVATAR;
    // Only the duel rival overrides their platform skin; mesh fighters and
    // bots keep the team tint applyArenaLayout painted (so FFA pads stay
    // colour-coded), so the skin key folds the platform in only for the rival.
    const pf = duel && rival.platformSkin ? platformSkin(rival.platformSkin) : OPPONENT_DEFAULT_PLATFORM;
    // Their paint, off the same `iam` channels. Bots carry none — an
    // unpainted body means nobody's home. HIDE PAINT (global breaker or the
    // club console's per-name switch) bakes them bare instead; paintPrefs/
    // socialState fold into the key so a flip repaints on the spot.
    const wire = duel ? rival.look : (peer?.lk ?? '');
    const name = duel ? rival.name : seat >= 0 ? (mesh.names[seat] ?? '') : '';
    const hidden = paintHiddenAll() || (!!name && socialPaintHidden(name));
    const gr = duel ? rival.gear : (peer?.gr ?? '');
    const key = `${av.id}|${peer?.avc ?? ''}|${peer?.avl ?? ''}|${duel ? pf.id : 'tint'}|${hidden ? '' : wire}|${gr}|${paintPrefs.version}|${socialState.version}`;
    if (key === r.appliedSkins) return;
    r.appliedSkins = key;
    for (const piece of r.rig.all) applyAvatarSkin(piece, av);
    // Their GEAR first (off the same channels; bots wear none — nobody's
    // home), THEN the look: gear is a paint surface, so the bake must see it.
    for (const piece of r.rig.all) applyGear(piece, cleanGear(gr), av.id === 'onyx' ? 'onyx' : 'white');
    const look = hidden ? { paint: [] } : unpackLook(wire);
    for (const piece of r.rig.all) applyLook(piece, look);
    if (duel) {
      const pad = this.scene.getObjectByName(platformName(slot));
      if (pad) applyPlatformSkin(pad, pf);
    }
    r.accentColor = Number.NaN; // force the accent recolour next frame
  }

  /** True while this fighter's bound ball for `hand` is homing back. */
  private ballReturning(slot: number, hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === slot &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        return (e.getValue(Fireball, 'state') ?? 0) === BallState.Returning;
      }
    }
    return false;
  }

  private findCombatant(slot: number): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? 0) === slot) return e;
    }
    return undefined;
  }

  private buildHitboxes(i: number, slot: number): void {
    const owner = this.findCombatant(slot);
    if (!owner) return;
    const r = this.rigs[i];
    const team = owner.getValue(Combatant, 'team') ?? 1;
    const make = (radius: number, kind: number): Entity => {
      const seg = this.world.createTransformEntity(new Object3D(), { persistent: true });
      seg.addComponent(Hitbox, { radius, team, kind, owner });
      return seg;
    };
    r.hitboxes.head = make(BODY_IK.headRadius, HitboxKind.Head);
    r.hitboxes.chest = make(BODY_IK.chestRadius, HitboxKind.Body);
    r.hitboxes.pelvis = make(BODY_IK.pelvisRadius, HitboxKind.Body);
    this.parkHitboxes(i);
    r.built = true;
  }

  /** Move a rig's hitboxes far away so nothing can connect while it's idle. */
  private parkHitboxes(i: number): void {
    const r = this.rigs[i];
    if (!r) return;
    for (const e of [r.hitboxes.head, r.hitboxes.chest, r.hitboxes.pelvis]) {
      e?.object3D?.position.set(0, -100, 0);
    }
  }
}
