/**
 * McSystem — the headliner most nights: a GIANT of the dancers' own kind.
 *
 * Same sleek neon humanoid as the groupies (game/avatars.ts), scaled to
 * ~3.4 m on the centre stage — and his whole body ACTS OUT every attack
 * while it charges, so the tell lives at EYE LEVEL in silhouette instead of
 * on the floor:
 *
 *  beam   : both sticks thrust straight forward, parallel — a lane.
 *  sweep  : one arm out FLAT at neck height on the entry side, cocked back —
 *           then swung across on the landing while HE DUCKS UNDER IT himself.
 *  seesaw : both sticks point at the DOOMED half, then shove the flood in.
 *  surge  : same grammar front/back — a beckon (far half dies) or a
 *           palms-out push (near half dies).
 *  gate   : sticks straight up, parallel and narrow — the gap itself —
 *           leaning to stand the "doorway" over the safe column's side.
 *  nova   : arms spread wide and the whole figure winds a slow full spin,
 *           snapping arms down on the burst.
 *  donut  : arms thrown wide, then hauled in — the gather.
 *  duckdonut: the gather AND the limbo at once — get close and get small.
 *  trident: he CONJURES a cyber trident out of his fist — its colour is
 *           the pattern — cocks it over the ground the first blow takes,
 *           and strikes on every blow: a swing to the side (cyan, the
 *           halves left/right), a plunge in front of him or a thrust out
 *           over the crowd (magenta, the halves toward/away from the
 *           stage), a slash corner to corner (lime, the diagonals).
 *
 * While a move charges, everything of his that GLOWS burns WARN amber —
 * sticks, trim, and the lit sleeves and midriff — while his dark cloth
 * holds his own colour (danger speaks amber, always, but it should not
 * repaint the headliner into somebody else); between moves he does exactly
 * the groupies' dance — one
 * stick up, one down, swapping on the beat — so the crowd's motion and the
 * boss's motion are one language. Zones are platform-local and identical
 * for every seat, so one giant's mime is honest for the whole ring.
 *
 * He faces YOU (me-relative rendering — every dancer sees the show head-on),
 * which means platform-local +x (my right) is HIS left: every directional
 * mime mirrors through `mir()`.
 *
 * On finale nights he only works the count-in: the goop drops in, EATS him
 * (a panicked squash into the rising gel), and runs the set instead.
 */

import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3, type MeshBasicMaterial, type MeshStandardMaterial } from 'three';
import { MC, RING, TRIDENT, hueToColor, ringRadius, mcHueFor, mcVisitCount } from '../config.js';
import { arena } from '../arena/arena.js';
import { CyberTrident } from '../arena/trident.js';
import { CLUB as CLUB_LAYOUT } from '../club/config.js';
import { ACCENT_REST, accentHex, buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { clearBody } from '../game/bodyClear.js';
import { dressMc, type McSuit } from '../game/mcCostume.js';
import { course } from '../course/state.js';
import { PoseMotion } from '../game/poseMotion.js';
import { match, type GestureCue, showBeat } from '../game/state.js';
import { inRoom } from '../net/session.js';

/** The eat window (song beats, negative = count-in) — mirrors GoopliathSystem. */
const EAT_START = -2.8;
const EAT_LAND = -1.2;

/** 33⅓ rpm, in radians a second — the chest platter's turn. */
const PLATTER_RAD_S = ((100 / 3) * Math.PI * 2) / 60;

/** Head heights in rig-local (human) metres. */
const STAND = 1.56;
const DUCK = 0.98;

const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _shaft = new Vector3();

/** THE TRIDENT: beats the weapon takes to climb out of his fist, how long
 *  a blow's white-hot flash lasts, and how fast it dissolves after the
 *  last blow (reveal units a second). */
const CONJURE_BEATS = 1.75;
const FLASH_BEATS = 0.5;
const DISSOLVE_RATE = 2.4;

interface ActiveMime {
  cue: GestureCue;
  startBeat: number;
  dueBeat: number;
  /** How many follow-up landings this mime has been extended through — 0
   *  while the wind-up is still the whole story. THE TRIDENT reads it to
   *  know the conjure is over and the blows have started. */
  steps: number;
}

const freshPose = (): DancerPose => ({
  hx: 0, hy: STAND, hz: 0, yaw: 0, pitch: 0, roll: 0,
  lx: -0.3, ly: 1.0, lz: -0.1,
  rx: 0.3, ry: 1.0, rz: -0.1,
  slump: 0,
});

/** Where the headliner poses in the FOYER (menu screens, solo). */
const MENU_SPOT = { x: 1.55, y: 0, z: -2.55, scale: 1.35 };
/** …and where he works when the CLUB floor is open (a room is live): up on
 *  the stage behind his console, playing the record the room hears. */
const DECK_SPOT = { x: 0, y: CLUB_LAYOUT.stage.h, z: CLUB_LAYOUT.stage.z + 0.5, scale: 1.35 };

/** What the headliner is wearing right now — the probe reads it to prove
 *  he changes between the map and the record, and never wears red/yellow. */
/** `want` is the hue he is easing toward — the probe reads it so a record
 *  whose colour happens to sit beside the map's is not mistaken for a
 *  wardrobe that never turned. */
export const mcView = { hue: MC.hue, want: MC.hue, color: 0, screen: '', track: '', visit: 0 };

/**
 * THE TRIDENT's body language, pure so look-dev can pose it too. `hit` is
 * this blow's quarter bitmask, `strike` 0..1 runs cock → blow, `conj` 0..1
 * the conjure (1 once the weapon is out), `pump` the beat's throb. Writes
 * the arms, the yaw/roll and the dip (the caller has already reset the
 * rest of the pose) and RETURNS where the weapon points, rig-local (−z is
 * toward the crowd): on every blow it points at the ground it takes.
 * Platform-local +x is HIS left (he faces the crowd).
 */
export function tridentPose(
  p: DancerPose,
  hit: number,
  strike: number,
  conj: number,
  pump: number,
): [number, number, number] {
  const mir = (side: number): number => -side;
  // Where does this blow land? The doomed quarters' centre, as signs.
  const b = (c: number): number => (hit >> c) & 1;
  const dx = (b(1) + b(3) - b(0) - b(2)) / 2; // −1 dancer-left … +1 right
  const dz = (b(2) + b(3) - b(0) - b(1)) / 2; // −1 toward the stage … +1 away
  // Each blow runs cock → strike: where his trident fist is, and where the
  // weapon points.
  type V = [number, number, number];
  let cock: V;
  let blow: V;
  let aimCock: V;
  let aimBlow: V;
  if (dz === 0 && dx !== 0) {
    // SWING (cyan): raised high over the doomed side, chopped down onto it.
    const s = mir(dx);
    cock = [s * 0.42, 1.5, -0.1];
    blow = [s * 0.6, 0.95, -0.4];
    aimCock = [s * 0.35, 1, 0.1];
    aimBlow = [s * 0.8, -0.55, -0.4];
    p.yaw = s * (0.12 + strike * 0.22);
  } else if (dx === 0 && dz !== 0) {
    // THRUST (magenta) — the surge's front/back grammar: the half toward
    // the stage is the ground in front of HIM, so he plunges the trident
    // down there; the half away from the stage is behind the dancers, so
    // he levels it and drives it out over the crowd.
    if (dz < 0) {
      cock = [0.14, 1.75, -0.05];
      blow = [0.12, 1.0, -0.4];
      aimCock = [0.05, 1, 0.15];
      aimBlow = [0, -1, -0.45];
    } else {
      cock = [0.24, 1.25, 0.1];
      blow = [0.14, 1.2, -0.8];
      aimCock = [0.05, 0.35, -1];
      aimBlow = [0, -0.12, -1];
    }
  } else {
    // SLASH (lime): high over the stage-side quarter of the doomed
    // diagonal, ripped down across to the far one — the line of the cut
    // IS the line that burns.
    const s0 = mir(b(0) ? -1 : 1);
    cock = [s0 * 0.45, 1.65, -0.08];
    blow = [-s0 * 0.4, 0.95, -0.45];
    aimCock = [s0 * 0.6, 1, 0.05];
    aimBlow = [-s0 * 0.7, -0.6, -0.5];
    p.roll = s0 * 0.14 * (1 - strike);
    p.yaw = -s0 * strike * 0.2;
  }
  const k = strike;
  const lerp = (a: V, c: V): V => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
  let [rx, ry, rz] = lerp(cock, blow);
  ry += pump * 0.04 * (1 - k);
  let aim = lerp(aimCock, aimBlow);
  if (conj < 1) {
    // THE CONJURE: his fist goes up and the weapon climbs out of it,
    // upright, his eyes on it.
    const e = conj * conj * (3 - 2 * conj);
    rx = 0.3 + (rx - 0.3) * e * 0.4;
    ry = 1.5 + conj * 0.3;
    rz = -0.12;
    aim = [0.08, 1, 0];
    p.pitch = -0.05 + conj * 0.15;
  }
  const n = Math.hypot(aim[0], aim[1], aim[2]) || 1;
  aim = [aim[0] / n, aim[1] / n, aim[2] / n];
  // Two hands on the shaft: the left choked down it toward the butt.
  if (conj < 1) {
    p.lx = -0.55;
    p.ly = 1.25 + conj * 0.2;
    p.lz = -0.3;
  } else {
    p.lx = rx - aim[0] * 0.32;
    p.ly = ry - aim[1] * 0.32;
    p.lz = rz - aim[2] * 0.32;
  }
  p.rx = rx;
  p.ry = ry;
  p.rz = rz;
  // He puts his weight into every blow.
  p.hy = STAND - strike * 0.16;
  return aim;
}

export class McSystem extends createSystem({}) {
  private rig: DancerRig | null = null;
  private suit: McSuit | null = null;
  /** The RENDERED pose — everything below writes `tgt` and the motion
   *  layer carries this toward it, so idle → wind-up → strike is one
   *  continuous motion and the figure never teleports between
   *  choreography states. His hands run underdamped springs: a thrown
   *  stick whips past its mark and settles, so every mime lands with
   *  follow-through instead of decelerating politely into the hit. */
  private pose: DancerPose = freshPose();
  private tgt: DancerPose = freshPose();
  /** What is actually DRAWN: `pose` with his arms cleared of his own body
   *  (game/bodyClear.ts). Kept apart so the springs never feel it. */
  private shown: DancerPose = freshPose();
  private motion = new PoseMotion();
  private scale = MC.scale;
  private menuClock = 0;
  private generation = -1;
  private mime: ActiveMime | null = null;
  private warn = 0;
  /** THE TRIDENT, held in his right fist (see arena/trident.ts). */
  private trident: CyberTrident | null = null;
  private tridentReveal = 0;
  /** Landing beats of the trident's blows still to flash, and the beat
   *  the last flash fired. */
  private flashDues: number[] = [];
  private flashAt = -Infinity;
  /** Where the weapon points (rig-local), and its eased orientation. */
  private tridentAim = new Vector3(0, 1, 0);
  private tridentQuat = new Quaternion();
  /** Last frame's delta — applyAccents eases the wardrobe on it. */
  private lastDelta = 0;
  private baseColor = 0;
  /** The hue he is WEARING (eased toward the wardrobe's target — see
   *  config.mcHueFor). Never leaves the safe band, so he is never red or
   *  yellow: those belong to the telegraphs. */
  private hue = MC.hue;
  private eaten = false;

  private rebuild(): void {
    this.generation = match.generation;
    if (!this.rig) {
      // A giant of the dancers' own kind: the RAVE RAID figure, at 3.4 m.
      // (The blank is the PLAYERS' body — see game/blankDancer.ts. The
      // headliner and the groupies are the house's own, and stay.)
      this.hue = mcHueFor(match.screen, match.trackId);
      this.rig = buildDancer(this.hue);
      this.rig.root.name = 'the-mc'; // headless probes find him by name
      this.suit = dressMc(this.rig); // the neon district headliner's armour (game/mcCostume.ts)
      this.rig.root.scale.setScalar(MC.scale);
      // He faces the crowd — every client renders him looking at THEM.
      this.rig.root.rotation.y = Math.PI;
      this.baseColor = hueToColor(this.hue, 0.6);
      this.scene.add(this.rig.root);
      this.trident = new CyberTrident();
      // It rides the fist's POSITION but aims itself (driveTrident): the
      // hand's own orientation follows the forearm, and a weapon that
      // points at the sky on a thrust at the crowd says nothing.
      this.rig.root.add(this.trident.root);
    }
    // A fresh night starts from the neutral stance — an eased pose is state,
    // and state carried across generations carries its accidents with it.
    this.pose = freshPose();
    this.tgt = freshPose();
    this.motion.snap(this.pose, this.tgt);
    this.mime = null;
    this.warn = 0;
    this.eaten = false;
    this.tridentReveal = 0;
    this.flashDues = [];
    this.flashAt = -Infinity;
  }

  /** Face the origin (the local player) from wherever he stands — the rig's
   *  forward is −Z at yaw 0, so aim that axis along (origin − position). */
  private faceCrowd(x: number, z: number): void {
    this.rig!.root.rotation.y = Math.atan2(-(0 - x), -(0 - z));
  }

  update(delta: number): void {
    this.lastDelta = delta;
    mcView.hue = this.hue;
    mcView.want = mcHueFor(match.screen, match.trackId);
    mcView.color = this.baseColor;
    mcView.screen = match.screen;
    mcView.track = match.trackId;
    mcView.visit = mcVisitCount();
    if (this.generation !== match.generation) this.rebuild();
    const rig = this.rig;
    if (!rig) return;

    // The GREEN ROOM: on menu screens he poses beside the board — the
    // live-service lobby hero, grooving to the room loop.
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';

    // The MC works raid nights (and their podiums). The goop keeps every
    // rehearsal — and takes the stage mid-count-in on finale nights, over
    // the MC's dead body.
    const raidish =
      match.after === 'raid' &&
      (match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium');
    const finaleNight = raidish && match.bossKind === 'goop';
    const show =
      menuRoom || (raidish && (match.bossKind === 'mc' || (finaleNight && match.eatIntro && !this.eaten)));
    rig.root.visible = show;
    if (!show) return;
    // The record on his chest turns at 33⅓, whatever he's doing.
    if (this.suit?.platter) this.suit.platter.rotation.z -= delta * PLATTER_RAD_S;

    // Scale eases too, so green room ↔ stage never pops.
    const wantScale = menuRoom ? MENU_SPOT.scale : MC.scale;
    this.scale += (wantScale - this.scale) * Math.min(1, delta * 6);
    rig.root.scale.setScalar(this.scale);

    // The house clock never stops — the green room grooves on it, and it
    // covers the stage's dead air (see the guard below).
    this.menuClock += delta;

    if (menuRoom) {
      this.eaten = false;
      this.mime = null;
      // Foyer: beside the board, the live-service hero. Club floor open
      // (a room is hosting/joined): he's up at his decks, working.
      // Only when the club is actually up (ClubSystem's own rule): not while
      // the host is held in the foyer, not while you're out through THE STEP —
      // otherwise he stands on an empty stage spot in the void.
      const social = inRoom() && !match.holdFoyer && !course.active;
      const spot = social ? DECK_SPOT : MENU_SPOT;
      rig.root.position.set(spot.x, spot.y, spot.z);
      this.faceCrowd(spot.x, spot.z);
      // At the decks he plays to the ROOM's record (ClubSystem publishes its
      // beat); beside the board he keeps a clock of his own (~114 BPM).
      this.idleGroove(social && Number.isFinite(match.beat) ? match.beat : this.menuClock * 1.9);
      this.driveTrident(delta, 0, null);
      this.warn += (0 - this.warn) * Math.min(1, delta * 6);
      this.applyAccents(this.warn);
      this.motion.step(this.pose, this.tgt, delta, { headRate: 5, handHz: 2.6, zeta: 0.7 });
      this.present();
      return;
    }

    const beat = Number.isFinite(match.beat) ? match.beat : -8;
    const stage = arena()?.stage;
    const stageY = stage?.position.y ?? 0;
    rig.root.position.set(0, RING.stageHeight + stageY, -ringRadius(match.seats));
    this.faceCrowd(0, -ringRadius(match.seats));

    /* ── the finale count-in: hyping, then eaten ── */
    if (finaleNight) {
      if (beat >= EAT_LAND) {
        // Swallowed. The goop's touchdown owns the moment from here.
        this.eaten = true;
        rig.root.visible = false;
        return;
      }
      if (beat >= EAT_START) {
        // The drop is coming down on him: panic — hands up, shaking, a
        // squash as the mass arrives.
        const t = (beat - EAT_START) / (EAT_LAND - EAT_START);
        const tremble = Math.sin(beat * 40) * 0.05 * t;
        const p = this.tgt;
        p.hy = STAND - t * 0.5;
        p.hx = tremble;
        p.lx = -0.34 + tremble;
        p.rx = 0.34 + tremble;
        p.ly = p.ry = STAND + 0.45 - t * 0.6;
        p.lz = p.rz = -0.1;
        // Watching it come: head back, and shaking with the rest of him.
        p.pitch = t * 0.9;
        p.roll = tremble * 3;
        rig.root.scale.set(this.scale * (1 + t * 0.25), this.scale * (1 - t * 0.55), this.scale * (1 + t * 0.25));
        this.applyAccents(1); // full alarm
        // Stiff, springy panic — the tremble rings through his hands.
        this.motion.step(this.pose, this.tgt, delta, { headRate: 14, handHz: 6, zeta: 0.65 });
        this.present();
        return;
      }
    }

    /* ── gestures in, mime state forward ── */
    if (match.bossKind === 'mc') this.drainGestures(beat);
    if (this.mime && beat > this.mime.dueBeat + 0.45) this.mime = null;

    /* ── choreography: the mime if one is charging, else the groove ── */
    const miming = Boolean(this.mime && match.screen === 'raid');
    let striking = false;
    if (this.mime && miming) {
      striking = beat > this.mime.dueBeat - 0.9;
      this.performMime(this.mime, beat);
    }
    this.driveTrident(delta, beat, this.mime && miming && this.mime.cue.kind === 'trident' ? this.mime : null);
    if (!(this.mime && miming)) {
      // The groove pumps to the RECORD — on a double-time chart the raw
      // beat runs the record's eighths, and a DJ pumping his arms at 190
      // over a 95 BPM strut looked exactly as wrong as it sounds.
      //
      // And NEVER to dead air: between startRaid and the record cueing,
      // match.beat is −Infinity, and sin(−Infinity) is NaN. One such frame
      // used to poison the eased pose PERMANENTLY — cos(NaN) took the
      // shoulders, the shoulders took every limb, and easeTo can never
      // recover (c += (NaN − c)·k is NaN forever) — so the DJ played every
      // MC night invisible. Pre-cue he grooves on the house clock instead.
      this.idleGroove(Number.isFinite(match.beat) ? showBeat() : this.menuClock * 1.9);
    }

    // WARN burn while charging, seat-cyan otherwise.
    const warnTarget = miming ? 1 : 0;
    this.warn += (warnTarget - this.warn) * Math.min(1, delta * 8);
    this.applyAccents(this.warn);

    // Wind-ups chase briskly; the strike stiffens the hand springs so the
    // snap arrives HOT — underdamped, it carries through the mark and
    // settles, which is what a hit looks like (the old single-rate ease
    // was fastest leaving and dead on arrival, the reverse of a strike).
    this.motion.step(this.pose, this.tgt, delta, {
      headRate: striking ? 16 : 9,
      handHz: striking ? 5.5 : 3.2,
      zeta: 0.62,
    });
    this.present();
  }

  private drainGestures(beat: number): void {
    for (const cue of match.gestures.splice(0)) {
      const due = cue.dueBeat ?? beat + cue.chargeBeats;
      // Step cues extend the running mime's life; full cues replace it.
      if (cue.step && this.mime && this.mime.cue.kind === cue.kind) {
        this.mime.dueBeat = due;
        this.mime.steps++;
        this.mime.cue = { ...this.mime.cue, side: cue.side ?? this.mime.cue.side, hit: cue.hit ?? this.mime.cue.hit };
        if (cue.kind === 'trident') this.flashDues.push(due);
        continue;
      }
      this.mime = { cue, startBeat: beat, dueBeat: due, steps: 0 };
      if (cue.kind === 'trident') this.flashDues = [due];
    }
  }

  /** THE TRIDENT's life: conjured while its move runs (the scan climbing
   *  out of his fist over CONJURE_BEATS), flashing white-hot on every blow,
   *  dissolving back down after the last. The glowstick in that fist
   *  stands down while the weapon is out. */
  private driveTrident(delta: number, beat: number, mime: ActiveMime | null): void {
    const t = this.trident;
    if (!t) return;
    if (mime) {
      const form = TRIDENT.forms[mime.cue.form ?? 0] ?? TRIDENT.forms[0];
      t.setColor(form.color);
      const conj = mime.steps === 0 ? Math.max(0, (beat - mime.startBeat) / CONJURE_BEATS) : 1;
      this.tridentReveal = Math.max(this.tridentReveal, Math.min(1, conj));
    } else {
      this.tridentReveal = Math.max(0, this.tridentReveal - delta * DISSOLVE_RATE);
      if (this.tridentReveal === 0) this.flashDues = [];
    }
    while (this.flashDues.length && beat >= this.flashDues[0]) this.flashAt = this.flashDues.shift()!;
    const flash = Math.max(0, 1 - (beat - this.flashAt) / FLASH_BEATS);
    t.update(delta, this.tridentReveal, flash);
    const out = t.root.visible;
    if (out) {
      // Aim eases on its own spring — quick, so a blow still snaps.
      _q.setFromUnitVectors(_up, this.tridentAim);
      this.tridentQuat.slerp(_q, Math.min(1, delta * 14));
      t.root.quaternion.copy(this.tridentQuat);
    }
    for (const name of ['stick-blade', 'stick-glow']) {
      const o = this.rig?.mount?.handR.getObjectByName(name);
      if (o) o.visible = !out;
    }
  }

  /** Draw the frame: the eased pose, solved with his arms — and the
   *  trident's shaft while it's out — kept clear of his own body, then the
   *  weapon set in the fist where that solve actually put it. */
  private present(): void {
    const rig = this.rig!;
    const t = this.trident;
    const out = Boolean(t?.root.visible);
    clearBody(rig, this.pose, this.shown, out ? _shaft.set(0, 1, 0).applyQuaternion(this.tridentQuat) : null);
    const hand = rig.mount?.handR;
    if (out && hand) t!.root.position.copy(hand.position);
  }

  /** Platform-local x-sign → HIS side of the stage (he faces the crowd). */
  private mir(side: number): number {
    return -side;
  }

  /* ── the language ─────────────────────────────────────────────────────── */

  private idleGroove(beat: number): void {
    const p = this.tgt;
    const bounce = Math.abs(Math.sin(beat * Math.PI)) * 0.06;
    p.hx = Math.sin(beat * 0.5) * 0.1;
    p.hz = 0;
    p.hy = STAND - bounce;
    p.yaw = Math.sin(beat * 0.25) * 0.2;
    // He nods on the beat and rolls his head across the bar — the neck the
    // rig grew for the club floor, spent on the man everyone is watching.
    p.pitch = -0.1 - Math.abs(Math.sin(beat * Math.PI)) * 0.16;
    p.roll = Math.sin(beat * 0.33) * 0.12;
    p.slump = 0;
    // The groupies' exact move, giant-sized: one stick up, one down.
    const wave = Math.sin(beat * Math.PI);
    const upL = Math.max(0, wave);
    const upR = Math.max(0, -wave);
    p.lx = p.hx - 0.3 - upL * 0.08;
    p.ly = p.hy - 0.5 + upL * 0.75;
    p.lz = -0.08 - upL * 0.06;
    p.rx = p.hx + 0.3 + upR * 0.08;
    p.ry = p.hy - 0.5 + upR * 0.75;
    p.rz = -0.08 - upR * 0.06;
  }

  private performMime(mime: ActiveMime, beat: number): void {
    const p = this.tgt;
    const span = Math.max(0.001, mime.dueBeat - mime.startBeat);
    const u = Math.min(1, Math.max(0, (beat - mime.startBeat) / span));
    /** Strike phase: the last ~0.9 beats snap from wind-up into the hit. */
    const strike = Math.min(1, Math.max(0, (beat - (mime.dueBeat - 0.9)) / 0.9));
    const pump = Math.abs(Math.sin(beat * Math.PI)); // charges throb on the beat
    p.slump = 0;
    p.hx = 0;
    p.hz = 0;
    p.yaw = 0;
    p.hy = STAND;
    // Chin down through the wind-up, up on the release — he stares the
    // crowd down while he charges and throws his head back when it lands.
    // (Set here, not left over: the groove's nod would otherwise ride out
    // the whole mime, because easeTo only ever chases `tgt`.)
    p.pitch = -0.24 + strike * 0.4;
    p.roll = 0;

    switch (mime.cue.kind) {
      case 'beam': {
        const reach = 0.35 + u * 0.3 + strike * 0.25;
        if (mime.cue.crossed) {
          // THE X: the sticks thrown CROSSED in front of him — each hand
          // over the other shoulder's line, scissoring tighter as it lands.
          const over = 0.16 + u * 0.14 + strike * 0.1;
          p.lx = over; p.rx = -over;
          p.ly = 1.3 - strike * 0.15; p.ry = 1.0 + strike * 0.15;
          p.lz = p.rz = -reach - pump * 0.05;
          break;
        }
        // Twin rails, dead ahead (his forward IS toward the crowd).
        p.lx = -0.18; p.rx = 0.18;
        p.ly = p.ry = 1.15 - strike * 0.1;
        p.lz = p.rz = -reach - pump * 0.05;
        break;
      }
      case 'sweep': {
        // One arm FLAT at neck height on the entry side, cocked further
        // back as it charges — then swung across while he ducks under it.
        const s = this.mir(mime.cue.side ?? 1);
        const cock = 0.55 + u * 0.35;
        const swing = strike * 2 - 1; // −1 cocked … +1 followed through
        const armX = strike < 0.02 ? s * cock : s * cock * -swing;
        const lead = s < 0 ? 'l' : 'r';
        if (lead === 'l') {
          p.lx = armX; p.ly = 1.32; p.lz = -0.18;
          p.rx = 0.3; p.ry = 0.85 - strike * 0.2; p.rz = -0.05;
        } else {
          p.rx = armX; p.ry = 1.32; p.rz = -0.18;
          p.lx = -0.3; p.ly = 0.85 - strike * 0.2; p.lz = -0.05;
        }
        // He limbos under his own blade on the hit — do as he does.
        p.hy = STAND - strike * (STAND - DUCK);
        break;
      }
      case 'seesaw': {
        // Both sticks point the DOOMED half out, then shove the flood in.
        const s = this.mir(mime.cue.side ?? 1);
        const reach = 0.5 + u * 0.3 + strike * 0.3;
        p.lx = s * reach - 0.12;
        p.rx = s * reach + 0.12;
        p.ly = p.ry = 1.2 + pump * 0.08;
        p.lz = p.rz = -0.15;
        p.yaw = s * (0.35 + strike * 0.25);
        break;
      }
      case 'surge': {
        // Front/back grammar: far half doomed → a beckon (come close!);
        // near half doomed → palms-out push (get back!). zone side +1 = the
        // near half (platform +z, behind the dancer).
        const nearDoomed = (mime.cue.side ?? 1) > 0;
        const reach = 0.4 + u * 0.3 + strike * 0.3;
        p.lx = -0.2; p.rx = 0.2;
        if (nearDoomed) {
          // Push: hands high, palms out, shoving toward the crowd.
          p.ly = p.ry = 1.3 + pump * 0.06;
          p.lz = p.rz = -reach;
        } else {
          // Beckon: hands low, drawing in.
          p.ly = p.ry = 1.0 - strike * 0.2;
          p.lz = p.rz = -0.55 + reach * 0.4;
          p.hy = STAND - 0.1 - strike * 0.15;
        }
        break;
      }
      case 'gate': {
        const gap = 0.14 + pump * 0.03;
        if ((mime.cue.axis ?? 0) === 1) {
          // The horizontal cousin: the clear band runs near/far, so his
          // body borrows the surge's grammar — a push says the safe row is
          // behind you (get back), a beckon says it's toward the stage —
          // with the doorway's tight parallel sticks kept as the noun.
          const safeNear = (mime.cue.gapX ?? 0) > 0;
          p.lx = -gap; p.rx = gap;
          if (safeNear) {
            p.ly = p.ry = 1.32 + u * 0.1 - strike * 0.4;
            p.lz = p.rz = -(0.4 + u * 0.25 + strike * 0.2);
          } else {
            p.ly = p.ry = 0.95 - u * 0.05 - strike * 0.15;
            p.lz = p.rz = -0.5 + u * 0.2 + strike * 0.15;
            p.hy = STAND - 0.08 - strike * 0.12;
          }
          break;
        }
        // The doorway: sticks straight up, tight and parallel, the whole
        // figure leaning to hold the "gap" over the safe column's side.
        const s = this.mir(Math.sign(mime.cue.gapX ?? 0) || 0);
        p.hx = s * 0.25;
        p.lx = p.hx - gap; p.rx = p.hx + gap;
        p.ly = p.ry = STAND + 0.75 + u * 0.15 - strike * 0.5;
        p.lz = p.rz = -0.1;
        p.yaw = s * 0.2;
        break;
      }
      case 'cross': {
        // THE CROSSFIRE: he loads a laser on ONE rail — that arm goes out
        // flat to the side, level with the strip — then throws it across
        // his body on the hit. The other arm reads the ground: pushing the
        // crowd back off the near strip, or waving them in off the far one.
        const s = this.mir(mime.cue.side ?? 1);
        const nearDoomed = (mime.cue.axis ?? 0) === 1;
        const load = 0.62 + u * 0.22 + pump * 0.05;
        const throwX = s * load * (1 - strike * 2); // out … then dragged across
        const lead = s < 0 ? 'l' : 'r';
        const leadY = 1.12;
        const offX = nearDoomed ? 0.26 : 0.16;
        const offY = nearDoomed ? 1.3 : 0.95;
        const offZ = nearDoomed ? -0.42 - strike * 0.2 : -0.2 + strike * 0.12;
        if (lead === 'l') {
          p.lx = throwX; p.ly = leadY; p.lz = -0.12 - strike * 0.15;
          p.rx = offX; p.ry = offY; p.rz = offZ;
        } else {
          p.rx = throwX; p.ry = leadY; p.rz = -0.12 - strike * 0.15;
          p.lx = -offX; p.ly = offY; p.lz = offZ;
        }
        // He leans off the doomed ground himself.
        p.hz = nearDoomed ? -0.1 * strike : 0.1 * strike;
        p.yaw = s * 0.18;
        break;
      }
      case 'trident': {
        const conj = mime.steps === 0 ? Math.min(1, (beat - mime.startBeat) / CONJURE_BEATS) : 1;
        const aim = tridentPose(p, mime.cue.hit ?? 0, strike, conj, pump);
        this.tridentAim.set(aim[0], aim[1], aim[2]);
        break;
      }
      case 'donut': {
        // THE GATHER: arms thrown wide and high, then HAULED in against
        // his chest as the rim closes — the nova's mime run backwards, and
        // the crowd's instruction either way is what his hands do.
        const wide = 0.78 - strike * 0.68;
        const y = 1.34 - strike * 0.34 + pump * 0.05;
        p.lx = -wide; p.rx = wide;
        p.ly = p.ry = y;
        p.lz = p.rz = -0.32 + strike * 0.24;
        // He crouches into the huddle he's demanding.
        p.hy = STAND - strike * 0.18;
        break;
      }
      case 'wave': {
        // THE WAVE: a four-count. One stick chops lane by lane across his
        // body — or, front-to-back, walks its chops away from or in toward
        // the crowd — and where the count is IS where the doom is.
        const start = this.mir(mime.cue.side ?? 1);
        // Three stops out (steps 0–2); the count wheels at the exit and
        // walks home (steps 3–5); and on EXPERT's LONG WAVE it wheels once
        // more and runs back out (steps 6–8). His arm rides every leg,
        // holding at each end through the breather that makes the wheel
        // readable — so the body always says which way the march is going.
        const raw = Math.min(8, mime.steps) + strike * 0.5;
        const frac =
          raw <= 2
            ? Math.min(1, raw / 2)
            : raw <= 5
              ? Math.max(0, (5 - raw) / 2)
              : Math.min(1, Math.max(0, (raw - 6) / 2));
        const chop = Math.max(0, Math.sin(beat * Math.PI)) * 0.16;
        if ((mime.cue.axis ?? 0) === 1) {
          // Crowd-near ground is HIS far reach (he faces you): a march
          // starting near begins at full extension and draws home.
          const startNear = (mime.cue.side ?? 1) > 0;
          const reach = startNear ? 0.72 - frac * 0.5 : 0.22 + frac * 0.5;
          p.rx = 0.18; p.ry = 1.15 - chop; p.rz = -reach;
          p.lx = -0.3; p.ly = 0.85; p.lz = -0.05;
        } else {
          const armX = start * (0.55 - frac * 1.1); // start side → far side
          const lead = start < 0 ? 'l' : 'r';
          if (lead === 'l') {
            p.lx = armX; p.ly = 1.18 - chop; p.lz = -0.2;
            p.rx = 0.3; p.ry = 0.85; p.rz = -0.05;
          } else {
            p.rx = armX; p.ry = 1.18 - chop; p.rz = -0.2;
            p.lx = -0.3; p.ly = 0.85; p.lz = -0.05;
          }
        }
        p.hy = STAND - chop * 0.3;
        break;
      }
      case 'duckdonut': {
        // DUCK DONUT: the gather and the limbo in one body — arms thrown
        // wide and HAULED in as the rim closes, the whole figure sinking
        // under the blade it drags with it. Get close AND get small.
        const wide = 0.78 - strike * 0.68;
        p.lx = -wide; p.rx = wide;
        p.ly = p.ry = 1.3 - strike * 0.55 + pump * 0.04;
        p.lz = p.rz = -0.3 + strike * 0.2;
        p.hy = STAND - u * 0.1 - strike * (STAND - DUCK - 0.1);
        break;
      }
      case 'nova': {
        // The shockwave: arms spread flat, a slow wind-up spin, arms
        // snapping down on the burst.
        const spin = u * Math.PI * 2 * (0.75 + strike);
        const spread = 0.72 + pump * 0.05 - strike * 0.25;
        p.yaw = Math.sin(spin) * 0.6;
        p.lx = -spread; p.rx = spread;
        p.ly = p.ry = 1.3 - strike * 0.75;
        p.lz = p.rz = -0.1 - Math.cos(spin) * 0.12;
        break;
      }
    }
  }

  /** Walk his colour toward what the place (and the record) call for. Both
   *  ends live inside the safe band, so the walk between them can never
   *  pass through red or yellow — it is a scalar ease, not a trip round
   *  the wheel. */
  private wardrobe(delta: number): void {
    const want = mcHueFor(match.screen, match.trackId);
    if (Math.abs(want - this.hue) < 1e-4) {
      this.hue = want;
    } else {
      const step = MC.changeRate * delta;
      this.hue += Math.max(-step, Math.min(step, want - this.hue));
    }
    this.baseColor = hueToColor(this.hue, 0.6);
  }

  private applyAccents(warn: number): void {
    const rig = this.rig;
    if (!rig) return;
    this.wardrobe(this.lastDelta);
    // WARN burns everything of his that GLOWS amber — sticks, collar, belt,
    // cuffs, seams, scan-slit, halos, and the lit sleeves and midriff with
    // them — while the dark cloth and the helm hold his own colour.
    //
    // That split is the whole point: the parts that light up are the parts
    // a dancer thirty metres away can see change, so the tell lands, and
    // the figure stays recognisably HIM. Burning the dark cloth as well
    // swapped the headliner for a different dancer mid-wind-up.
    const warm = warn > 0.5;
    const drive = 1.1 + warn * 1.5;
    for (const a of rig.accents) {
      // Through accentHex(): his blades stay white-cored in violet AND in
      // warn amber — the whitening is the figure's anatomy, not a state.
      const color = accentHex(a, a.neon && warm ? MC.warnColor : this.baseColor);
      const std = a.mat as MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.setHex(color);
        // Scaled by the material's authored gain — his sleeves never
        // outshine his sticks. The dark cloth sits at its authored rest
        // the whole way through.
        std.emissiveIntensity = (a.neon ? drive : ACCENT_REST) * a.gain;
      } else {
        (a.mat as MeshBasicMaterial).color.setHex(color);
      }
    }
  }
}
