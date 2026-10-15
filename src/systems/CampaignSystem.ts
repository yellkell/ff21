/**
 * ARCADE — the titan gauntlet. Owns a campaign bout end to end:
 *
 *  INTRO   : klaxon + strobing pit light, the titan grinds up out of the
 *            floor behind the far platform, name card + roar, FIGHT, bell.
 *            (Squeeze a trigger to skip the ceremony.)
 *  FIGHT   : the titan cycles telegraphed attacks — every kill zone charges
 *            visibly ON YOUR PLATFORM (see campaign/telegraphs.ts): fist
 *            SLAMS (a ghost hammer descends onto the disc — step out),
 *            horizontal SWEEPS (duck the travelling blade), eye BEAMS
 *            (sidestep the strip) and pod VOLLEYS (fireballs hurled straight
 *            at you — dodge them or BLOCK with a fist). The blow comes FROM
 *            the titan (campaign/delivery.ts): as a zone comes due, a fire
 *            bolt leaves the striking fist and lands in the burning part of
 *            it on the beat, the chassis lunging in behind the throw, and
 *            the sweep's blade rides a lit haft back to the fist. Damage runs on
 *            per-boss WEAK-POINT PATTERNS
 *            (BossDef.weakPattern): whatever is vulnerable BLINKS — the
 *            visor tell, the chest core, the low emblem — and everything
 *            else is armour that clanks. Dodge, re-aim, punish, repeat.
 *  VICTORY : collapse, floating payout line (double coins/XP on a first fell).
 *  DEFEAT  : SCRAPPED. The titan stands. Consolation pay.
 *
 * The titan is NOT the pose-bus opponent — OpponentSystem stands down in
 * campaign mode and this system drives its own rig + weak-point hitboxes
 * (CollisionSystem's damageScale law does the rest). GameStateSystem also
 * stands down: a titan bout is one long round with no timer.
 */

import { createSystem, Vector3, type Entity } from '@iwsdk/core';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PointLight,
} from 'three';
import { BOSSES, GOOPLIATH_DEF, buildTitan, goopliathBoss, raidBoss, runLineup, type AttackKind, type BossDef, type RunStage, type TitanRig } from '../campaign/bosses.js';
import {
  GRAMMAR_ACT_MIN,
  GRAMMAR_KINDS,
  buildGrammarMove,
  evictsPark,
  grammarZoneHit,
  mulberry32,
  parkOf,
  pickWeighted,
  type GrammarKind,
  type Park,
} from '../campaign/grammar.js';
import { keepArmsApart, type GuardMemo } from '../campaign/armGuard.js';
import {
  ARM_REST,
  armFor,
  CLASSIC_SHAPE,
  gestureFocusOf,
  gestureShapeOf,
  gestureTemper,
  grammarFollowThrough,
  grammarGesture,
  rigFold,
  rigPitch,
  type ArmDelta,
  type GestureFocus,
  type GestureShape,
} from '../campaign/gestures.js';
import { RecitalBlockfall } from '../campaign/blockfall.js';
import type { Zone } from '../campaign/zones.js';
import { Bolt, impactOf, lungeEnvelope, throwingArm } from '../campaign/delivery.js';
import { playBossVoice, preloadBossVoice } from '../audio/bossVoice.js';
import { GelCreature } from '../goopliath/GelCreature.js';
import { GooFx } from '../goopliath/splats.js';
import { ATTACKS as GOOP_ATTACKS, CREATURE as GOOP_BODY, type AttackName as GoopAttackName } from '../goopliath/goopConfig.js';
import {
  bankDifficultyClear,
  campaign,
  campaignProgress,
  fmtRunTime,
  raidInbox,
  recordRunTime,
  saveCampaignProgress,
} from '../campaign/campaignState.js';
import {
  beamTelegraph,
  circleTelegraph,
  donutTelegraph,
  gateTelegraph,
  halfTelegraph,
  laneTelegraph,
  novaTelegraph,
  quarterTelegraph,
  railTelegraph,
  recitalMarksTelegraph,
  sweepTelegraph,
  xTelegraph,
  type Telegraph,
} from '../campaign/telegraphs.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { Hitbox } from '../components/Hitbox.js';
import { PlayerBodyPart } from '../components/PlayerBodyPart.js';
import { match } from '../combat/matchState.js';
import { applyRoster, fighterAt } from '../combat/setup.js';
import { localIndexOf, peerPos, worldToPeer } from '../combat/layout.js';
import { opponents } from '../combat/opponentBus.js';
import { applyArenaLayout, platformName, setPlatformHazard, tintPlatform } from '../arena/arena.js';
import { OPPONENT_DEFAULT_PLATFORM, applyPlatformSkin, platformSkin } from '../avatar/skins.js';
import { teamColor } from '../config.js';
import { app, saveStats } from '../menu/appState.js';
import { ownPlatform, platformOwned, setPlatformSkin } from '../menu/customization.js';
import { addCoins } from '../menu/wallet.js';
import { mesh } from '../net/mesh.js';
import type { PeerMessage } from '../net/protocol.js';
import { myName, reportCampaign, reportRun, reportRunClear } from '../net/leaderboard.js';
import { announce } from '../audio/announcer.js';
import { playCash } from '../audio/cash.js';
import { BOSS_BATTLE_VOLUME, playVictory, startBattleMusic, startFinaleTrack, stopBattleTrack } from '../audio/battleMusic.js';
import { emberBurst } from '../fx/fire.js';
import { spawnFireImpact } from '../fx/effects.js';
import { feedback } from '../fx/feedback.js';
import { glowSprite } from '../materials/glow.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { createCampaignHud, type CampaignHud } from '../ui/campaignHud.js';
import { titanView } from '../campaign/titanView.js';
import { telemetry } from '../net/telemetry.js';
import {
  ARENA_GAP,
  BOSS_STUN,
  CAMPAIGN,
  COMBAT,
  CURRENCY,
  DELIVERY,
  DIFFICULTY,
  FIREBALL,
  GOOPLIATH,
  type Difficulty,
  GRAMMAR,
  MODE_LAYOUT,
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
  PALETTE,
  RAID,
  RAID_RING_RADIUS,
} from '../config.js';


/** 'resurrect' is raid GOLIATH's second wind — fall, shake, rise, phase 2. */
type Phase = 'idle' | 'intro' | 'fight' | 'victory' | 'defeat' | 'resurrect';

/** rst wire codes for Phase (guests follow the host's machine). */
const PHASE_CODE: Record<Phase, number> = { idle: 0, intro: 1, fight: 2, victory: 3, defeat: 4, resurrect: 5 };

/** A weak point a pattern can light. The crown circuit uses all five. */
type WeakSpot = 'head' | 'core' | 'low' | 'shoulderL' | 'shoulderR';

/** GOLIATH's ring order — one full loop of the crown. `shoulderL` is the
 *  KING's left (the lamp on YOUR right as you face him), so the circuit
 *  reads head → his left shoulder → core → his right shoulder → low. */
const CROWN_RING: WeakSpot[] = ['head', 'shoulderL', 'core', 'shoulderR', 'low'];
/** His second life walks it BACKWARD — low → right shoulder → core → left
 *  shoulder → head. Raid only. */
const REVERSE_RING: WeakSpot[] = [...CROWN_RING].reverse();

interface ActiveAttack {
  kind: AttackKind | GrammarKind;
  zones: Zone[];
  telegraphs: (Telegraph | null)[];
  /** Seconds after the charge completes at which each zone detonates. */
  staggers: number[];
  resolved: boolean[];
  time: number;
  chargeTime: number;
  arm: 0 | 1;
  /** VULTURE's law: beams re-aim at you until the late lock. */
  tracks: boolean;
  /** Per-beam lateral offsets, kept so tracking re-aims stay parallel. */
  beamOffsets: number[];
  /**
   * Slam attacks only: a ghost hammer hovering over each marked disc,
   * descending as its countdown fills — so "arm goes up" visibly connects to
   * "THIS spot gets hit". Disposed at that zone's detonation.
   */
  markers: (Group | null)[];
  /** RAID: the canonical seats this attack hunts ([0] in solo). Zone
   *  coordinates are in each TARGET's local frame; only a zone's own target
   *  judges damage — everyone else renders. Sweeps and stage III+ attacks
   *  mark the whole squad at once. */
  seats: number[];
  /** Which target seat each zone belongs to (parallel with zones). */
  zoneSeats: number[];
  /** Seconds before a zone's due time its telegraph shows and fills. The
   *  classic kinds use the whole run-up (old behaviour); a grammar cascade
   *  opens each step's read one charge ahead — the return's telegraph opens
   *  as the first pair fires, never sooner (RAVE RAID's law). */
  windows: number[];
  /** THE RECITAL's falling blocks, one per quad zone (null elsewhere). */
  blockfalls: (RecitalBlockfall | null)[];
  /** Zone-less furniture updated with the overall charge and disposed with
   *  the attack: the recital's quarter lines + THE LESSON's marks. */
  dressing: Telegraph[];
  /** THE RECITAL's sounds, on the attack clock — the lesson's notes as each
   *  quarter lights, the recital's cues ahead of each landing — each fired
   *  once. Empty for every other kind. */
  cues: { at: number; corner: number; hold: boolean; lesson: boolean; fired: boolean }[];
  /** THE RECITAL only: how the lesson is timed, for the gesture that
   *  follows it (pendingGesture) — one slot per taught step. */
  lesson?: { stepSecs: number; steps: number };
  /** THE DELIVERY (campaign/delivery.ts): the bolt thrown at each zone,
   *  in flight until the zone detonates (null before the throw, after the
   *  landing, and for zones with no thrown blow). */
  bolts: (Bolt | null)[];
  /** Per zone: 0 not yet thrown, 1 THROWN (its swing went with the throw,
   *  so the detonation mustn't swing it again), 2 nothing to throw (the
   *  detonation swings, as it always did). */
  thrown: (0 | 1 | 2)[];
}

/** One volley fireball in flight — dodge it, or put a fist in its path. */
interface VolleyShot {
  pos: Vector3;
  vel: Vector3;
  age: number;
  group: Group;
  trail: number;
  /** The canonical seat this shot chases — only that client judges it. */
  seat: number;
}

/** A short-lived strike visual driven by a closure. */
interface Strike {
  age: number;
  life: number;
  update(age: number): void;
  dispose(): void;
}

const _v = new Vector3();
const _p = new Vector3();
const _head = new Vector3();
const _up = new Vector3(0, 1, 0);
const _eyeShade = new Color();
const _eyeAccent = new Color();

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));


export class CampaignSystem extends createSystem({
  playerParts: { required: [Hitbox, PlayerBodyPart] },
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private hud!: CampaignHud;
  private light!: PointLight;

  private phase: Phase = 'idle';
  private t = 0;
  private time = 0; // global clock for shader pulses
  private def: BossDef = BOSSES[0];
  private rig?: TitanRig;

  // --- GOOPLIATH state ------------------------------------------------------
  /** The gel boss (def.style 'goop'): the vendored creature replaces the
   *  titan rig outright — same phases/attacks/netcode, different body. */
  private goop?: GelCreature;
  private goopFx?: GooFx;
  /** Scaled parent group: the sim stays man-sized inside it, so every dent,
   *  lump and wobble keeps the original creature's exact proportions. */
  private goopRoot?: Group;
  private goopScale = 1;
  /** Per-ball "was inside the gel last frame" — hits fire on the ENTRY edge,
   *  so a squadmate's rendered ball splashes once, not every frame. */
  private goopInside = new Map<Entity, boolean>();
  /** Last frame's world position per ball — the swept segment's start. */
  private goopPrev = new Map<Entity, Vector3>();
  /** True while the CURRENT stage's boss is the gel (solo, breaker, or a
   *  blazing run passing through GOOPLIATH's slot). Drives all body behaviour. */
  private goopStage = false;

  // --- DIFFICULTY state -----------------------------------------------------
  /** The active tier's knobs (health/charge/cooldown/stun/elite). */
  private diff = DIFFICULTY.normal;
  /** Bosses in THIS run (blazing wedges GOOPLIATH in); length drives the
   *  "last stage" / "X of Y" logic instead of BOSSES.length. */
  private runLen = BOSSES.length;
  /** EASY stun: a decaying hit counter; cross BOSS_STUN.hits and the boss
   *  reels (attacks suspended) for `stunTimer` seconds. */
  private stunTimer = 0;
  private stunMeter = 0;

  // Boss weak-point spheres (created once, repositioned per stage/frame).
  private boxes: {
    body?: Entity;
    pelvis?: Entity;
    head?: Entity;
    core?: Entity;
    shoulderL?: Entity;
    shoulderR?: Entity;
    pods: Entity[];
  } = { pods: [] };

  private attack: ActiveAttack | null = null;
  private cooldown = 2.5;
  /** The headless probe holding the titan's own picks while it forces moves. */
  private probeHold = false;
  /** The headless probe's clock: frozen, the system only moves when the
   *  probe STEPS it (a GPU-less runner renders a frame every few seconds,
   *  so whole attacks would land between two looks). */
  private probeFrozen = false;
  private probeStepping = false;
  /** Last attack picked, classic or grammar — the never-twice law spans
   *  both vocabularies on a titan that learned to dance. */
  private lastKind: AttackKind | GrammarKind | null = null;
  /** THE FLOOR MANAGER's park — where the last move's correct dodge left a
   *  fighter who played it right. Reset to centre each stage. */
  private park: Park = { x: 0, z: 0 };
  private strikes: Strike[] = [];
  private shots: VolleyShot[] = [];
  /**
   * The weak-point pattern (BossDef.weakPattern) drives which point(s) BLINK
   * live right now: `cycleIdx` walks the boss's sequence, `hitsOnPoint`
   * counts landed hits on the current stop (VULTURE needs two per stop).
   * No text prompts — the blink IS the tell.
   */
  private cycleIdx = 0;
  private hitsOnPoint = 0;
  private invuln = 0; // player i-frames after eating a strike
  private strikeSwing: [number, number] = [0, 0]; // post-strike arm follow-through
  /** Each hand's curl, eased (0 open … 1 fist) — the digits read it. */
  private curl: [number, number] = [ARM_REST.curl, ARM_REST.curl];
  /** Where each arm's last WINDUP left it: an arm a strike doesn't own
   *  comes home from here over the swing, instead of jumping. */
  private lastWind: [ArmDelta, ArmDelta] = [
    { x: 0, z: 0, elbow: ARM_REST.elbow, wrist: ARM_REST.wrist, curl: ARM_REST.curl },
    { x: 0, z: 0, elbow: ARM_REST.elbow, wrist: ARM_REST.wrist, curl: ARM_REST.curl },
  ];
  /** What the live follow-through is FOR — a classic kind or a grammar
   *  gesture shape (campaign/gestures.ts) — and where it was aimed. */
  private swingShape: GestureShape = 'hammer';
  private swingFocus: GestureFocus = { side: 0, fwd: 0 };
  /** Attack clock of the last grammar swing — a raid's five-deck chord
   *  detonates one zone per seat on the same frame, and is ONE swing. */
  private swingAt = -1;
  private flinch = 0;
  /** THE DELIVERY's chassis step: seconds since the last throw (−1 idle),
   *  the eased step actually applied (0..1), and the offset it put on the
   *  root last frame (taken back off before the sway eases x). */
  private lungeAge = -1;
  private lungeCur = 0;
  private readonly lungeOff = new Vector3();
  /** Where GOOPLIATH's current heave is aimed (world) — see surgeAt. */
  private readonly surgeAim = new Vector3(0, 0, 0);
  /** attack.time of the last throw sound — a raid chord is one throw. */
  private throwSfxAt = -1;
  private enraged = false;
  private lastBossHp = 0;
  private hudTimer = 0;
  private emberTimer = 0;
  private cardTimer = 0; // auto-clear for transient cards (ENRAGED)
  // Gauntlet runs: fight-time-only clock, and whether this victory chains on.
  private runClock = 0;
  private advanceAfterVictory = false;
  private victoryDelay = CAMPAIGN.victoryDelay;
  // Beat counters for the staged entrances/deaths (press strokes, winch
  // jerks, the king's stalls) — they gate the one-shot sfx per beat.
  private introStep = 0;
  /** VULTURE wing pose (0 mantled … 1 full span) — starts open for the intro. */
  private wingSpread = 1;
  private outroStep = 0;
  /** Where the titan STOOD when the killing blow landed (it sways in the
   *  fight) — the collapse anchors here so it falls from where it stands
   *  instead of teleporting back to centre. */
  private fellX = 0;

  // --- RAID state ---------------------------------------------------------
  /** The titan's OWN Health pool (used in every mode — in a raid slot 1 is a
   *  real raider, so the boss can't borrow a fighter's pool any more). */
  private bossEnt?: Entity;
  /** GOLIATH's second life is live (raid finale — reverse crown, max enrage). */
  private p2 = false;
  /** Host: rst echo cadence + change detector for immediate re-sends. */
  private stateTimer = 0;
  private lastRstKey = '';
  /** Guest: the last authoritative boss hp (local sims snap back to it). */
  private syncedHp = 0;
  /** Whose platform the titan squares up to (raid: the current target). */
  private faceSeat = 0;
  private lastTarget = -1;
  /** Seconds left of the full-turn lash a squad sweep detonates with. */
  private spinT = 0;

  init(): void {
    this.hud = createCampaignHud(this.scene);
    this.light = new PointLight(0xffffff, 0, 16);
    this.light.visible = false;
    this.scene.add(this.light);

  }

  /** Headless probe (tools/encore-check.mjs): watch the live bout and FORCE
   *  a specific grammar move — the same buildAttack path a real pick takes,
   *  so a probe screenshot shows the true telegraphs. Installed at bout
   *  start: the wrap owns (and rebuilds) the __ff2 namespace during lobby
   *  boot, so an init-time install would be clobbered. */
  private installTitanHook(): void {
    const w = window as unknown as { __ff2?: Record<string, unknown> };
    {
      (w.__ff2 ??= {}).titan = {
        phase: (): string => this.phase,
        boss: (): string => this.def.name,
        moves: (): string[] => Object.keys(this.def.grammar ?? {}),
        kind: (): string | null => this.attack?.kind ?? null,
        zones: (): string[] => this.attack?.zones.map((z) => z.kind) ?? [],
        /** The live gesture: shape + read fill, and each arm's pivot delta
         *  from rest [pitch, yaw] — the probe's silhouette check. */
        pose: (): { shape: string | null; fill: number; arms: number[][]; elbows: number[]; wrists: number[]; curl: number[]; lean: number } | null => {
          const rig = this.rig;
          if (!rig) return null;
          const g = this.pendingGesture();
          return {
            shape: g?.shape ?? null,
            fill: g?.fill ?? 0,
            // In the language's own terms (rigPitch / rigFold undone).
            arms: rig.arms.map((a) => [a.restX - a.pivot.rotation.x, a.pivot.rotation.z - a.restZ]),
            elbows: rig.arms.map((a) => a.elbow.rotation.x),
            wrists: rig.arms.map((a) => a.wrist.rotation.x),
            curl: [...this.curl],
            lean: rig.root.rotation.x,
          };
        },
        force: (kind: string, seed?: number): boolean => {
          if (this.phase !== 'fight') return false;
          if ((['slam', 'sweep', 'beam', 'volley', 'nova', 'seesaw', 'surge'] as string[]).includes(kind)) {
            this.launchClassic(kind as AttackKind);
            return true;
          }
          this.buildAttack(kind as GrammarKind, [this.mySeatId()], {
            g: (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0,
          });
          return true;
        },
        hold: (on: boolean): void => {
          this.probeHold = on;
        },
        /** Freeze the titan's clock; it then moves only on step(). */
        freeze: (on: boolean): void => {
          this.probeFrozen = on;
        },
        /** Advance the titan `n` fixed frames of `dt` seconds. */
        step: (dt: number, n = 1): void => {
          this.probeStepping = true;
          try {
            for (let i = 0; i < n; i++) this.update(dt);
          } finally {
            this.probeStepping = false;
          }
        },
        /** THE DELIVERY, live (tools/delivery-check.mjs): bolts in flight
         *  and where, both fists, the chassis step, and — per thrown zone —
         *  whether its impact point burns under the zone's own law (the
         *  throw must never land on safe ground). */
        delivery: (): {
          bolts: number[][];
          origins: number[][];
          fists: number[][];
          lunge: number;
          thrown: number;
          impactsBurn: boolean[];
          early: number;
          root: number[];
          step: number[];
        } => {
          const a = this.attack;
          const live = (a?.bolts ?? []).filter((b): b is Bolt => !!b);
          const bolts = live.map((b) => b.group.position.toArray());
          const origins = live.map((b) => b.from.toArray());
          const fists = this.rig || this.goop ? [0, 1].map((i) => this.fistPos(i as 0 | 1, new Vector3()).toArray()) : [];
          const impactsBurn: boolean[] = [];
          for (const zone of a?.zones ?? []) {
            const p = impactOf(zone);
            if (p) impactsBurn.push(this.pointBurns(zone, p.x, p.z));
          }
          // Reads showing before their turn (a cascade's later steps must stay
          // hidden until their window opens) — the WAVE's all-at-once flash.
          let early = 0;
          if (a) {
            a.telegraphs.forEach((t, i) => {
              if (!t?.group.visible || a.resolved[i]) return;
              const due = a.chargeTime + a.staggers[i];
              const rem = due - a.time;
              const open =
                a.zones[i].kind === 'half'
                  ? rem < GOOPLIATH.seesawGap * 1.9
                  : a.windows[i] === undefined || rem <= Math.min(a.windows[i], due);
              if (!open) early++;
            });
          }
          const root = this.rig || this.goop ? this.bossRootPos().toArray() : [];
          return { early, root, step: this.lungeOff.toArray(), bolts, origins, fists, lunge: this.lungeCur, thrown: (a?.thrown ?? []).filter((t) => t === 1).length, impactsBurn };
        },
        heal: (): void => {
          const me = fighterAt(0);
          me?.setValue(Health, 'current', me.getValue(Health, 'max') ?? 100);
        },
      };
    }
  }

  update(delta: number): void {
    if (this.probeFrozen && !this.probeStepping) return;
    this.time += delta;
    const live = app.state === 'playing' && app.mode === 'campaign';

    if (!live) {
      if (this.phase !== 'idle') this.teardown();
      return;
    }
    if (this.phase === 'idle') this.begin();
    this.publishView();

    this.t += delta;
    if (this.raid()) this.raidNet(delta);
    this.updateStrikes(delta);

    switch (this.phase) {
      case 'intro':
        this.intro(delta);
        break;
      case 'fight':
        this.fight(delta);
        break;
      case 'victory':
      case 'defeat':
        this.outro(delta);
        break;
      case 'resurrect':
        this.resurrect(delta);
        break;
    }

    if (this.rig) this.animateTitan(delta);
    else if (this.goop) this.animateGoop(delta);
    this.placeHitboxes();
    this.refreshHud(delta);
  }

  // --- lifecycle -------------------------------------------------------------

  private runMode(): boolean {
    // GOOPLIATH is one marquee fight, not a chained run — full ceremony, no
    // speedrun clock (raids keep their own run flow regardless of boss).
    return app.campaignMode !== 'single' && app.campaignMode !== 'goopliath';
  }

  /** The DEDICATED gel fight — the sealed solo campaign entry, or a raid with
   *  the breaker thrown. (Distinct from a blazing RUN merely PASSING THROUGH a
   *  goop stage — that's goopStage, set per stage in stageSetup.) */
  private goopSolo(): boolean {
    return app.campaignMode === 'goopliath' || (app.campaignMode === 'raid' && app.raidGoopliath);
  }

  /** The active difficulty. Single titan stages always run NORMAL; the run
   *  modes (gauntlet/hardcore/raid) and the dedicated GOOPLIATH fight honour
   *  the player's / host's pick (the goop fight gets its own pick-your-damage
   *  pop-up, so hard/blazing drop badges are earnable against the tide). */
  private activeDifficulty(): Difficulty {
    const m = app.campaignMode;
    if (m === 'gauntlet' || m === 'hardcore' || m === 'raid' || m === 'goopliath') return app.difficulty;
    return 'normal';
  }

  /** The RUN lineup for the active difficulty (blazing wedges GOOPLIATH in);
   *  the five titans otherwise. Used for stage → boss resolution off the
   *  bout floor (names, cleared flags). */
  private lineup(): RunStage[] {
    return this.runMode() ? runLineup(this.activeDifficulty()) : BOSSES.map((_, i) => ({ kind: 'titan', index: i }));
  }

  /** The boss at run stage `i` — its display name for the FELLED card. */
  private stageName(i: number): string {
    const l = this.lineup();
    const rs = l[clamp(i, 0, l.length - 1)];
    return rs.kind === 'goop' ? GOOPLIATH_DEF.name : BOSSES[rs.index].name;
  }

  /** HARD+ spreads the fanciest attacks to the whole roster — every boss can
   *  also throw the safe-wedge nova, the left/right seesaw and the front/back
   *  surge. (A returned COPY; the shared BOSSES data is never mutated.) */
  private applyElite(def: BossDef): BossDef {
    if (!this.diff.elite) return def;
    const weights = { ...def.weights };
    for (const k of ['nova', 'seesaw', 'surge'] as AttackKind[]) weights[k] = Math.max(weights[k], 3);
    return { ...def, weights };
  }

  /** GOOPLIATH's tier dressing — difficulty changes the FIGHT, not just the
   *  pool (the generic knobs already quicken him; these are the tide's own):
   *  HARD volleys wider and angers sooner; BLAZING adds a second beam strip,
   *  volleys wider still, and rages from over half health. (The seesaw also
   *  rocks one extra half per swing on blazing — see seesawStages.) */
  private applyGoopTier(def: BossDef): BossDef {
    const d = this.activeDifficulty();
    if (d !== 'hard' && d !== 'blazing') return def;
    const blazing = d === 'blazing';
    return {
      ...def,
      volleyCount: def.volleyCount + (blazing ? 2 : 1),
      beams: def.beams + (blazing ? 1 : 0),
      enrageAt: blazing ? 0.55 : 0.45,
    };
  }

  // --- RAID plumbing -----------------------------------------------------------

  private raid(): boolean {
    return app.campaignMode === 'raid';
  }

  /** Solo campaigns are always their own authority; raids follow the mesh
   *  host (which MIGRATES if the host's headset dies — see mesh.isHost). */
  private isAuthority(): boolean {
    // A raid with NO mesh under it — dealt from the club's room of one, the
    // arena's own bots for company — has nobody else to defer to: this
    // headset is the authority, or the boss never takes a hit and the run
    // has no clock to post.
    return !this.raid() || !mesh.joined || mesh.isHost();
  }

  private mySeatId(): number {
    return this.raid() ? mesh.mySeat : 0;
  }

  /** The titan's own Health pool — hitbox owner and the HUD's boss bar. */
  private ensureBoss(): Entity {
    if (!this.bossEnt) {
      this.bossEnt = this.world.createTransformEntity(new Object3D(), { persistent: true });
      this.bossEnt.addComponent(Health, { current: 100, max: 100 });
    }
    return this.bossEnt;
  }

  /** A TARGET-local point → my world (identity for my own seat). */
  private seatPoint(seat: number, x: number, y: number, z: number, out: Vector3): Vector3 {
    if (!this.raid() || seat === mesh.mySeat) return out.set(x, y, z);
    return peerPos(out, seat, x, y, z);
  }

  /** How much a seat's local frame is yawed relative to mine (decal spin). */
  private seatYawDelta(seat: number): number {
    if (!this.raid() || seat === mesh.mySeat) return 0;
    const canonical = MODE_LAYOUT[app.arcade];
    return (canonical[seat]?.yaw ?? 0) - (canonical[mesh.mySeat]?.yaw ?? 0);
  }

  /** A seat's head position in MY world (mine tracked, theirs off the bus). */
  private playerHeadOf(seat: number, out: Vector3): void {
    if (!this.raid() || seat === mesh.mySeat) {
      this.playerHead(out);
      return;
    }
    const li = localIndexOf(seat);
    if (li > 0) out.copy(opponents[li - 1].headPos);
    else this.seatPoint(seat, 0, 1.6, 0, out);
  }

  /** Occupied raid seats (mine included in solo terms: [0]). */
  private occupiedSeats(): number[] {
    if (!this.raid()) return [0];
    const seats: number[] = [];
    for (let s = 0; s < mesh.occupants.length; s++) if (mesh.occupants[s]) seats.push(s);
    return seats.length ? seats : [mesh.mySeat];
  }

  /** Every raider's callsign for the run board (mine + the mesh names). */
  private squadNames(): string[] {
    // A raid with no mesh under it (the club's room of one) is a squad of
    // me — and a squad of nobody would leave the run off the board, since a
    // post with no names is refused (net/leaderboard.ts reportRun).
    if (!this.raid() || !mesh.joined) return [myName()];
    const names = this.occupiedSeats().map((s) => (s === mesh.mySeat ? myName() : mesh.names[s] || `RAIDER ${s + 1}`));
    return names.length ? names : [myName()];
  }

  /** Seats with a living fighter on them (hp > 0). */
  private aliveSeats(): number[] {
    return this.occupiedSeats().filter((s) => {
      const li = this.raid() ? localIndexOf(s) : 0;
      const e = fighterAt(li < 0 ? 0 : li);
      return (e?.getValue(Health, 'current') ?? 0) > 0;
    });
  }

  /** The launch-time squad size (2–5) every raid scale reads. */
  private raidSize(): number {
    return Math.min(5, Math.max(1, app.raidSize));
  }

  /** GOLIATH crown tuning, phase- and mode-aware: full squads take doubled
   *  ring stops; a duo gets solo's single-hit stops (two fists shred nothing). */
  private crownPerStop(): number {
    return this.raid() && this.raidSize() >= 3 ? RAID.crownPerStop : 1;
  }

  private crownLoopsNow(): number {
    // The second life is a REAL second fight above EASY: the reverse crown
    // walks twice as many loops on every other tier (campaign blazing and
    // all raids — the only places the king rises at all).
    const p2Mult = this.activeDifficulty() === 'easy' ? 1 : 2;
    return this.p2 ? RAID.phase2Loops * p2Mult : CAMPAIGN.crownLoops;
  }

  private crownTargetHits(): number {
    // Difficulty scales the required ring hits too, so GOLIATH is frail on
    // EASY and a wall on BLAZING like every other boss (min one loop's worth).
    const base = CROWN_RING.length * this.crownLoopsNow() * this.crownPerStop();
    return Math.max(CROWN_RING.length, Math.round(base * this.diff.health));
  }

  /** Drain the raid wire; host echoes state; host watches for the squad wipe. */
  private raidNet(delta: number): void {
    for (const { seat, msg } of raidInbox.splice(0)) {
      if (msg.k === 'rdmg' && this.isAuthority()) {
        this.applyBossDamage(msg.spot, msg.pts);
      } else if (msg.k === 'ratk' && seat !== mesh.mySeat) {
        this.buildAttack(msg.kind, msg.seats, { x: msg.x, z: msg.z, y: msg.y, a: msg.a, g: msg.g });
      } else if (msg.k === 'rst' && !this.isAuthority()) {
        this.applyRaidState(msg);
      }
    }

    if (!this.isAuthority()) return;
    // Host: echo the authoritative boss state on a cadence and on any change.
    this.stateTimer -= delta;
    const rst = this.buildRst();
    const key = `${rst.ph}|${rst.stage}|${rst.hp}|${rst.cyc}|${rst.hits}|${rst.enr}|${rst.p2}|${rst.stn}`;
    if (this.stateTimer <= 0 || key !== this.lastRstKey) {
      this.stateTimer = RAID.stateEcho;
      this.lastRstKey = key;
      mesh.send(rst);
    }
    // The wipe: every raider down mid-fight ends the run for everyone.
    if (this.phase === 'fight' && this.aliveSeats().length === 0) this.toDefeat();
  }

  private buildRst(): Extract<PeerMessage, { k: 'rst' }> {
    const boss = this.ensureBoss();
    return {
      k: 'rst',
      ph: PHASE_CODE[this.phase],
      t: this.t,
      stage: app.campaignStage,
      hp: boss.getValue(Health, 'current') ?? 0,
      max: boss.getValue(Health, 'max') ?? 1,
      cyc: this.cycleIdx,
      hits: this.hitsOnPoint,
      enr: this.enraged ? 1 : 0,
      p2: this.p2 ? 1 : 0,
      stn: this.stunTimer > 0 ? 1 : 0,
    };
  }

  /** Guest: adopt the host's authoritative boss state (pattern, hp, phase). */
  private applyRaidState(msg: Extract<PeerMessage, { k: 'rst' }>): void {
    // A stage change first — the host advanced to the next boss. The lineup
    // (blazing wedges GOOPLIATH in) is derived from the synced difficulty, so
    // host and guests resolve the same boss for a given stage index.
    const lineLen = runLineup(this.activeDifficulty()).length;
    if (msg.stage !== app.campaignStage && msg.stage < lineLen) {
      app.campaignStage = msg.stage;
      this.stageSetup(!app.raidHardcore, 'the next boss approaches');
    }
    this.p2 = msg.p2 === 1;
    this.cycleIdx = msg.cyc;
    this.hitsOnPoint = msg.hits;
    this.enraged = msg.enr === 1;
    // Mirror the reeling state so guests freeze the boss + show the card.
    if (msg.stn === 1 && this.stunTimer <= 0) {
      this.stunTimer = BOSS_STUN.duration;
      this.hud.title('STUNNED', '', this.accentCss());
      this.cardTimer = 1.2;
    } else if (msg.stn === 0 && this.stunTimer > 0) {
      this.stunTimer = 0;
    }
    this.syncedHp = msg.hp;
    const boss = this.ensureBoss();
    boss.setValue(Health, 'max', msg.max);
    // During the resurrection the bar refill is driven by the local rise
    // clock (so it tracks the music beat), not by echo quantisation.
    if (msg.ph !== PHASE_CODE.resurrect) boss.setValue(Health, 'current', msg.hp);
    this.lastBossHp = boss.getValue(Health, 'current') ?? 0;

    if (msg.ph !== PHASE_CODE[this.phase]) {
      switch (msg.ph) {
        case PHASE_CODE.fight:
          if (this.phase === 'intro') this.startFight();
          else if (this.phase === 'resurrect') this.startFight(true);
          break;
        case PHASE_CODE.victory:
          if (this.phase === 'fight' || this.phase === 'intro') this.toVictory();
          break;
        case PHASE_CODE.defeat:
          if (this.phase !== 'defeat') this.toDefeat();
          break;
        case PHASE_CODE.resurrect:
          if (this.phase !== 'resurrect') this.toResurrect();
          break;
      }
      this.t = msg.t;
    } else if (Math.abs(this.t - msg.t) > 0.75) {
      this.t = msg.t; // drift correction within a phase
    }
  }

  /** THE TITAN, READABLE (campaign/titanView.ts): what THE CHANNEL draws
   *  and THE TAPE stamps — name plate, health, phase, where it stands. */
  private publishView(): void {
    titanView.active = true;
    titanView.name = this.def.name;
    titanView.hp = this.bossHpFrac();
    titanView.phase = this.phase;
    titanView.stage = app.campaignStage;
    const p = this.bossRootPos();
    titanView.x = p.x;
    titanView.y = p.y;
    titanView.z = p.z;
  }

  private begin(): void {
    this.installTitanHook();
    titanView.outcome = '';
    this.runClock = 0;
    this.p2 = false;
    this.lastTarget = -1;
    this.hud.setVisible(true);
    this.light.visible = true;
    if (this.raid()) {
      // RAID: the arc layout is already selected (app.arcade === 'raid') and
      // the squad roster comes from the mesh seats. The titan stands in the
      // pit at the arc's focus — dead ahead of every raider.
      app.campaignStage = 0;
      this.faceSeat = mesh.mySeat;
      applyRoster();
      applyArenaLayout(this.scene);
      this.stageSetup(true, this.goopSolo() ? 'the pit is flooding' : 'the raid begins');
      return;
    }
    // Stamp the classic 1v1 platforms/roster (the last bout may have been an
    // FFA cross), then stand the slot-1 humanoid down — the titan replaces it.
    app.arcade = '1v1';
    applyRoster();
    applyArenaLayout(this.scene);
    this.stageSetup(true, this.goopSolo() ? 'something stirs beneath the pit' : 'a titan approaches the pit');
  }

  /** Chain to the next titan mid-run — no lobby, straight into its intro. */
  private advanceRun(): void {
    app.campaignStage += 1;
    // GAUNTLET (and a non-hardcore raid) refits you between titans; HARDCORE
    // sends you in as you are — dead raiders only rise again on a refit.
    const heal = this.raid() ? !app.raidHardcore : app.campaignMode === 'gauntlet';
    this.stageSetup(heal, 'the next titan approaches');
  }

  /** Everything one titan bout needs: rig, pools, weak points, intro cue. */
  private stageSetup(healPlayer: boolean, warning: string): void {
    // Difficulty first — it decides the run lineup (blazing wedges GOOPLIATH
    // in), the health/pacing knobs, and whether the elite attacks are shared.
    this.diff = DIFFICULTY[this.activeDifficulty()];
    let goopStage = false;
    if (this.goopSolo()) {
      // The dedicated gel fight — solo entry or raid breaker.
      this.def = goopliathBoss(this.raid(), this.raidSize());
      // GOOPLIATH's pools are hand-set per tier (75 / 135 / 250 per pair of
      // fists — not multiplier math), pre-divided by the tier's health
      // multiplier so the hp line below lands exactly on them. The campaign
      // fight takes one pool; a raid takes pool × squad, so the host's pick
      // scales the tide on the SAME curve and each raider's share of the
      // work matches the solo fight at that tier.
      {
        const d = this.activeDifficulty();
        const pool =
          d === 'blazing'
            ? GOOPLIATH.hitsCampaignBlazing
            : d === 'hard'
              ? GOOPLIATH.hitsCampaignHard
              : d === 'easy'
                ? GOOPLIATH.hitsEasy
                : GOOPLIATH.hitsCampaign;
        const fists = this.raid() ? this.raidSize() : 1;
        this.def = { ...this.def, health: (pool * fists) / DIFFICULTY[d].health };
      }
      this.def = this.applyGoopTier(this.def);
      this.runLen = 1;
      goopStage = true;
    } else if (this.runMode()) {
      // A full run: resolve this stage from the lineup (a blazing run has a
      // GOOPLIATH slot 2nd-to-last).
      const lineup = runLineup(this.activeDifficulty());
      this.runLen = lineup.length;
      const rs = lineup[clamp(app.campaignStage, 0, lineup.length - 1)];
      if (rs.kind === 'goop') {
        this.def = this.applyGoopTier(goopliathBoss(this.raid(), this.raidSize()));
        // The run WEDGE is one stage of six, not the dedicated fight — a
        // short hand-set pool (pre-divided so the hp line lands exactly).
        const fists = this.raid() ? this.raidSize() : 1;
        this.def = { ...this.def, health: (GOOPLIATH.hitsRunWedge * fists) / this.diff.health };
        goopStage = true;
      } else {
        const base = BOSSES[rs.index];
        this.def = this.raid() ? raidBoss(base, app.campaignStage, this.raidSize()) : base;
      }
    } else {
      // A single campaign stage.
      this.def = BOSSES[clamp(app.campaignStage, 0, BOSSES.length - 1)];
      this.runLen = BOSSES.length;
    }
    this.park = { x: 0, z: 0 }; // THE FLOOR MANAGER: everyone spawns centre
    // HARD+ shares the elite attacks (nova / seesaw / surge) to every boss.
    this.def = this.applyElite(this.def);
    this.goopStage = goopStage;
    this.p2 = false;
    this.rig?.dispose();
    this.rig = undefined;
    this.disposeGoop();
    if (goopStage) {
      this.buildGoop();
    } else {
      this.rig = buildTitan(this.def);
      // The rig's face (visor/core) sits on local −Z, same as the duel boxer —
      // yaw the whole machine to face the player across the gap. Each chassis
      // then stages its OWN entrance mark (the pit, the sky, the flank, the
      // dark): entrancePose(0) parks it there until the klaxon ends.
      this.rig.root.rotation.set(0, Math.PI, 0);
      this.scene.add(this.rig.root);
    }
    this.introStep = 0;
    this.wingSpread = 1; // wings open for the ceremony; the fight folds them
    this.entrancePose(0);
    // Start the entrance line fetching now — it has the klaxon + rise to
    // arrive before the name card asks for it.
    preloadBossVoice(this.def.name);

    // Health pools: the titan carries its OWN pool (bossEnt — every weak-point
    // hitbox's owner). In a SOLO campaign the slot-1 humanoid also stands down
    // (Combatant.active 0 parks OpponentSystem's rig and hitboxes); in a RAID
    // slot 1 is a real raider, so the roster is left alone.
    const boss = this.ensureBoss();
    // Difficulty scales the pool (EASY frail, BLAZING tanky). For GOLIATH the
    // bar is a crown-hit counter (see crownTargetHits, also scaled) — the raw
    // max here still drives the HUD fraction.
    const hp = Math.max(1, Math.round(this.def.health * this.diff.health));
    boss.setValue(Health, 'max', hp);
    boss.setValue(Health, 'current', hp);
    this.syncedHp = hp;
    if (!this.raid()) fighterAt(1)?.setValue(Combatant, 'active', 0);
    if (healPlayer) {
      const me = fighterAt(0);
      me?.setValue(Health, 'current', me.getValue(Health, 'max') ?? COMBAT.playerHealth);
    }
    this.lastBossHp = hp;

    if (goopStage) this.parkHitboxes(); // no weak points — the SDF is the hitbox
    else this.ensureHitboxes();
    // The boss dresses his own ground: GOLIATH's pit BURNS and GOOPLIATH's
    // FLOODS (def.platform), every other titan stands on the plain pedestal in
    // danger red. Applied as a full platform SKIN, not a re-tint — those two
    // decks carry ornaments (flame jets, tide wash) that a tint alone can't
    // raise, and it would leave whatever the lobby last wore showing under the
    // new colour. Each stage re-applies, so a blazing run walks the pit from
    // green for GOOPLIATH's slot to fire for GOLIATH's.
    {
      const pad = this.scene.getObjectByName(this.raid() ? 'raid-boss-platform' : platformName(1));
      if (pad) {
        const deck = this.def.platform;
        applyPlatformSkin(pad, deck ? platformSkin(deck) : OPPONENT_DEFAULT_PLATFORM);
        // No signature deck? Fall back to the house tint the pit has always
        // worn. (The skin pass above is still what clears a stale ornament.)
        if (!deck) tintPlatform(pad, this.raid() ? PALETTE.danger : teamColor(1));
        // This pedestal is a titan's ground for the duration — wear the hazard
        // band. (The raid pit already has it; a campaign titan borrows slot 1's
        // ordinary boxer pad, so it has to be switched on and off.)
        setPlatformHazard(pad, true);
      }
    }
    this.disposeShots();
    this.disposeAttack();
    this.cycleIdx = 0; // every pattern opens on the head
    this.hitsOnPoint = 0;
    this.invuln = 0;
    this.spinT = 0;
    this.lungeAge = -1;
    this.lungeCur = 0;
    this.lungeOff.set(0, 0, 0);
    this.stunTimer = 0;
    this.stunMeter = 0;
    this.enraged = false;
    this.cardTimer = 0;
    this.cooldown = this.attackCooldown() + 0.8;
    this.lastKind = null;
    campaign.coreOpen = false;
    this.hud.setBoss(this.def.name, this.accentCss(), '');

    // Collisions and rim-drain stay off until the bell (phase 'roundOver').
    match.phase = 'roundOver';
    match.message = '';
    match.resetCount += 1; // park the fireballs at your fists

    this.light.color.setHex(this.def.accent);
    this.light.position.set(0, this.bossHeight() * 0.8 + 1, this.bossZ() + 1.2);
    this.light.intensity = 0;

    this.phase = 'intro';
    this.t = 0;
    this.hud.title('WARNING', warning, '#ffb000');
    sfx.klaxon();
  }

  // --- GOOPLIATH body -----------------------------------------------------------

  /** Full standing height of whichever body is in the pit (world metres). */
  private bossHeight(): number {
    return this.rig ? this.rig.height : GOOP_BODY.height * this.goopScale;
  }

  /** Where the boss's feet are — the titan rig's root or the gel's parent.
   *  Only meaningful once a stage is set up (one of the two always exists). */
  private bossRootPos(): Vector3 {
    return this.rig ? this.rig.root.position : this.goopRoot!.position;
  }

  /**
   * Build the gel boss: the vendored creature at native man-size inside a
   * scaled parent. The scale conversion keeps him honest against the titans
   * — def.scale is in TITAN units, the sim is 1.78 m tall.
   */
  private buildGoop(): void {
    this.goopFx = new GooFx();
    this.scene.add(this.goopFx.group);
    this.goop = new GelCreature(this.goopFx);
    // The man-sized distance LOD reads garbage inside a scaled parent — and a
    // boss that fills the view is never "far". Pin the step budget instead
    // (animateGoop sheds it further while a limb is mid-swing).
    this.goop.qualityOverride = GOOPLIATH.quality;
    // Fireballs hit HARDER than fists — wider shove, deeper craters, bigger
    // lumps. Spectacle only; the hit count is untouched.
    this.goop.sim.impactScale = GOOPLIATH.impactScale;
    this.goopScale = (this.def.scale * GOOPLIATH.titanHeightPerScale) / GOOP_BODY.height;
    this.goopRoot = new Group();
    this.goopRoot.scale.setScalar(this.goopScale);
    this.goopRoot.position.set(0, 0, this.bossZ());
    this.goopRoot.add(this.goop.group);
    this.scene.add(this.goopRoot);
  }

  private disposeGoop(): void {
    this.goop?.dispose();
    this.goop = undefined;
    this.goopFx?.dispose();
    this.goopFx = undefined;
    this.goopRoot?.removeFromParent();
    this.goopRoot = undefined;
    this.goopInside.clear();
    this.goopPrev.clear();
  }

  /** Tear down the live attack: telegraphs AND any ghost hammer markers. */
  private disposeAttack(): void {
    const a = this.attack;
    if (!a) return;
    a.telegraphs.forEach((t) => t?.dispose());
    a.markers.forEach((m) => this.disposeMarker(m));
    a.blockfalls.forEach((b) => b?.dispose());
    a.dressing.forEach((d) => d.dispose());
    a.bolts.forEach((b) => b?.dispose());
    this.attack = null;
  }

  private disposeMarker(m: Group | null): void {
    if (!m) return;
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
    m.removeFromParent();
  }

  private teardown(): void {
    this.phase = 'idle';
    titanView.active = false; // the outcome stays for the tape's final read
    this.disposeAttack();
    this.disposeShots();
    for (const s of this.strikes) s.dispose();
    this.strikes = [];
    this.rig?.dispose();
    this.rig = undefined;
    this.disposeGoop();
    this.light.visible = false;
    this.hud.setVisible(false);
    this.hud.title('', '');
    campaign.coreOpen = false;
    campaign.aimPoint.set(0, 1.25, -ARENA_GAP);
    this.parkHitboxes();
    stopBattleTrack(); // a forfeit mid-bout leaves the score running otherwise
    // A raid leaves the arc layout behind; everything returns to the classic
    // lobby footing. (The titan's own Health pool needs no restoring — no
    // fighter ever lent it one.) The SEAT must reset with the mode: the 1v1
    // layout has two seats, and a raider's mySlot of 2/3 left in place made
    // the very next localLayout() index off the end of MODE_LAYOUT['1v1'] and
    // THROW — the end-of-raid crash, on every client but the host.
    if (app.arcade === 'raid') {
      app.arcade = '1v1';
      app.mySlot = 0;
    }
    applyRoster();
    applyArenaLayout(this.scene);
    // A signature deck (GOLIATH's fire, GOOPLIATH's tide) has to come off with
    // the boss, ornaments and all: applyArenaLayout re-TINTS the slot pads but
    // never clears a skin, so without this the lobby's opponent pedestal would
    // still be alight next bout. Strip both candidate pads back to the house
    // look — slot 1's borrowed boxer pad and the raid pit.
    for (const name of ['raid-boss-platform', platformName(1)]) {
      const pad = this.scene.getObjectByName(name);
      if (!pad) continue;
      applyPlatformSkin(pad, OPPONENT_DEFAULT_PLATFORM);
      tintPlatform(pad, name === 'raid-boss-platform' ? PALETTE.danger : teamColor(1));
    }
  }

  // --- intro ceremony ---------------------------------------------------------

  private intro(delta: number): void {
    // Runs get the condensed ceremony — the clock only ticks in fights, but
    // nobody speedruns for the klaxon.
    const T = this.runMode()
      ? CAMPAIGN.runIntro
      : { klaxon: CAMPAIGN.klaxonTime, rise: CAMPAIGN.riseTime, title: CAMPAIGN.titleTime, fightCard: CAMPAIGN.fightCardTime };
    const { klaxon: klaxonTime, rise: riseTime, title: titleTime, fightCard: fightCardTime } = T;
    const rig = this.rig!;

    // Strobing pit light while the klaxon sounds; steady key light after.
    const strobing = this.t < klaxonTime;
    this.light.intensity = strobing ? (Math.sin(this.time * 26) > 0 ? 9 : 1) : 5;

    // The arrival — each chassis makes its entrance its own way (see
    // entrancePose): the hook grinds up crooked, the press drops in strokes,
    // the vulture swoops the flank, the fortress rolls out of the dark, the
    // king rises on his own clock.
    const riseStart = klaxonTime;
    if (this.t >= riseStart && this.t < riseStart + riseTime + 0.2) {
      if (this.t - delta < riseStart) {
        this.introStep = 0;
        if (this.def.style === 'goop') sfx.gooWobble(1);
        else if (this.def.style === 'vulture') sfx.sweepWhoosh();
        else sfx.titanRise();
      }
      const k = clamp((this.t - riseStart) / riseTime, 0, 1);
      this.entrancePose(k);

      // Per-chassis beats: the sounds that sell the motion.
      if (this.def.style === 'piston') {
        // Every press stroke seats with a slam and a splash of sparks.
        const seg = Math.min(2, Math.floor(k * 3));
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.slamImpact();
          _v.set(0, 0.1, this.bossZ());
          emberBurst(_v, 22, true);
        }
      } else if (this.def.style === 'hook') {
        // Each jerk of the winch bites with a clank.
        const seg = Math.min(4, Math.floor(k * 5));
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.armorClank();
        }
      } else if (this.def.style === 'king') {
        // The ascent stalls twice — each hold breaks with a deeper roar.
        const seg = k < 0.45 ? 0 : k < 0.8 ? 1 : 2;
        if (seg > this.introStep) {
          this.introStep = seg;
          sfx.bossRoar(this.def.scale * 0.5);
        }
      }

      this.emberTimer -= delta;
      if (this.emberTimer <= 0 && k < 1) {
        if (this.def.style === 'goop') {
          // The pit BUBBLES as the tide swells up out of it — green droplets,
          // not sparks: he was always liquid.
          this.emberTimer = 0.18;
          _v.set(rand(-0.5, 0.5) * this.def.scale, 0.15, this.bossZ() + rand(-0.6, 0.6));
          _p.set(rand(-0.3, 0.3), 1, rand(-0.3, 0.3)).normalize();
          this.goopFx?.burst(_v, _p, 4, 1.6);
        } else if (this.def.style === 'vulture') {
          // Sparks stream off the banking wing on the way in.
          this.emberTimer = 0.22;
          _v.set(
            rig.root.position.x + rand(-0.4, 0.4),
            rig.root.position.y + rig.height * rand(0.5, 0.8),
            rig.root.position.z,
          );
          emberBurst(_v, 5, true);
        } else if (this.def.style === 'fortress') {
          // A grinding wake kicked up along the roll-in.
          this.emberTimer = 0.1;
          _v.set(rand(-0.9, 0.9), 0.1, rig.root.position.z + rand(-0.3, 0.6));
          emberBurst(_v, 8, true);
        } else {
          // Pit eruption under the climbers.
          this.emberTimer = 0.12;
          _v.set(rig.root.position.x + rand(-0.8, 0.8), 0.1, this.bossZ() + rand(-0.4, 0.4));
          emberBurst(_v, 8, true);
        }
      }
    }

    // Name reveal once it stands — the boss speaks its line if one shipped,
    // and roars the old roar if not (or if the file hasn't arrived yet).
    const titleStart = klaxonTime + riseTime;
    if (this.t >= titleStart && this.t - delta < titleStart) {
      this.entrancePose(1);
      // Just the name, big and centred — the epithet sub-lines ("arena
      // executioner" and kin) are gone; the chassis does the talking.
      this.hud.title(this.def.name, '', this.accentCss());
      if (!playBossVoice(this.def.name)) sfx.bossRoar(this.def.scale * 0.8);
    }

    // FIGHT flash, then the bell — the same neon FIGHT plate the ring
    // countdown shows. Re-asserted every frame of the beat (the HUD guards on
    // content, so it's a no-op once drawn) so the art swaps in the moment its
    // PNG finishes decoding, even if that lands a frame or two late.
    const fightStart = titleStart + titleTime;
    if (this.t >= fightStart && this.t < fightStart + fightCardTime) {
      this.hud.title('FIGHT', '', '#ffc04d');
    }

    // The intro ceremony plays out in full — no trigger-skip. Every boss gets
    // its entrance (a raid squad always shared the host's clock anyway).
    if (this.t >= fightStart + fightCardTime) {
      this.startFight();
    }
  }

  /**
   * The entrance, per chassis — k runs 0 (staged at its mark) → 1 (standing
   * ready at the boss line). Sets the FULL root transform, so a trigger-skip
   * from any mid-entrance pose lands clean via startFight's reset.
   */
  private entrancePose(k: number): void {
    if (this.def.style === 'goop') {
      // GOOPLIATH doesn't climb out of the pit — he FILLS it and keeps
      // coming: the mass swells from a puddle's worth of gel to full boss
      // volume, and pulls itself up into the fighter late in the rise.
      const root = this.goopRoot!;
      const e = k * k * (3 - 2 * k);
      root.position.set(0, 0, this.bossZ());
      root.scale.setScalar(this.goopScale * (0.12 + 0.88 * e));
      if (k > 0.55) this.goop!.setFormTarget(1); // gooRise fires inside
      return;
    }
    const rig = this.rig!;
    const h = rig.height;
    const z = this.bossZ();
    const root = rig.root;
    root.rotation.set(0, Math.PI, 0);
    root.scale.setScalar(1);
    switch (this.def.style) {
      case 'hook': {
        // RUSTHOOK grinds up CROOKED, in seizing winch-jerks, and only
        // straightens with a lurch at the top — salvage, not ceremony.
        const steps = 5;
        const seg = Math.floor(k * steps);
        const bite = Math.min(1, (k * steps - seg) / 0.55); // jerk early, hold
        const e = Math.min(1, (seg + bite) / steps);
        root.position.set(0, -(h + 0.4) * (1 - e), z);
        root.rotation.z = 0.3 * (1 - e * e) + Math.sin(this.time * 34) * 0.015 * (1 - k);
        break;
      }
      case 'piston': {
        // PISTON arrives from ABOVE — the press comes down in strokes, and
        // the last stroke is the slam that seats it on its mark.
        const strokes = 3;
        const seg = Math.floor(k * strokes);
        const drop = Math.min(1, (k * strokes - seg) / 0.4); // fast fall, long hold
        const e = Math.min(1, (seg + drop * drop) / strokes);
        root.position.set(0, (h * 0.8 + 2.2) * (1 - e), z);
        break;
      }
      case 'vulture': {
        // VULTURE swoops in high off the flank, banking through the dive
        // and flaring level at the mark.
        const e = k * k * (3 - 2 * k); // smoothstep
        root.position.set(3.4 * (1 - e), 2.6 * (1 - e) * (1 - e), z - 1.6 * (1 - e));
        root.rotation.z = -0.5 * Math.sin(e * Math.PI);
        // Wings hold FULL SPAN for the whole ceremony — the dive, the landing
        // and the name card all play under open wings (a slow beat keeps them
        // alive). They only come down when the bell rings: animateTitan owns
        // them from the first fight frame and folds them to the mantled rest.
        const beat = Math.sin(this.time * 8) * 0.06;
        for (const w of this.rig!.wings) {
          w.group.rotation.y = w.side * 0.05;
          w.group.rotation.z = w.side * (0.15 + beat);
          w.wrist.rotation.z = w.side * (0.1 - beat * 0.7);
        }
        break;
      }
      case 'fortress': {
        // JUGGERNAUT was never below the floor — it rolls up out of the
        // dark at ground level, rattling on its own tracks.
        const e = k * k * (3 - 2 * k);
        root.position.set(
          0,
          Math.abs(Math.sin(this.time * 22)) * 0.03 * (1 - k),
          z - 3.8 * (1 - e),
        );
        break;
      }
      default: {
        // GOLIATH rises the old way but on HIS clock — the ascent stalls
        // twice, holds, and resumes. A king does not hurry.
        let e: number;
        if (k < 0.3) e = (k / 0.3) * 0.42;
        else if (k < 0.45) e = 0.42;
        else if (k < 0.7) e = 0.42 + ((k - 0.45) / 0.25) * 0.36;
        else if (k < 0.8) e = 0.78;
        else e = 0.78 + ((k - 0.8) / 0.2) * 0.22;
        root.position.set(0, -(h + 0.4) * (1 - e), z);
        break;
      }
    }
  }

  /** The bell. `finale` keeps the resurrection anthem rolling instead of
   *  restarting the regular battle loop (raid GOLIATH's second life). */
  private startFight(finale = false): void {
    this.phase = 'fight';
    this.t = 0;
    // Snap to the rest pose — a trigger-skip can land mid-swoop/mid-stroke.
    if (this.rig) {
      const root = this.rig.root;
      root.position.set(0, 0, this.bossZ());
      root.rotation.set(0, Math.PI, 0);
      root.scale.setScalar(1);
    } else if (this.goopRoot) {
      this.goopRoot.position.set(0, 0, this.bossZ());
      this.goopRoot.scale.setScalar(this.goopScale);
      this.goop?.setFormTarget(1); // a skip can land before the form-up cue
    }
    match.phase = 'playing';
    this.hud.title('', '');
    this.cardTimer = 0;
    this.light.intensity = 5; // steady key light (a skip can leave a strobe)
    if (!finale) startBattleMusic(BOSS_BATTLE_VOLUME); // loud enough to carry over the titan's SFX
    announce('fight');
    sfx.roundBell();
  }

  /** Which points blink live right now, per the boss's weak pattern. The
   *  second-life crown (raid GOLIATH) walks the ring in REVERSE. */
  private litPoints(): WeakSpot[] {
    switch (this.def.weakPattern) {
      case 'body':
        return []; // GOOPLIATH: nothing blinks — the whole body takes hits
      case 'both':
        return ['head', 'core']; // any order, all fight
      case 'triple':
        return [(['head', 'core', 'low'] as const)[this.cycleIdx % 3]];
      case 'crown': {
        const ring = this.p2 ? REVERSE_RING : CROWN_RING;
        return [ring[this.cycleIdx % ring.length]];
      }
      default: // 'alternate' and 'double' walk head↔core
        return [this.cycleIdx % 2 === 0 ? 'head' : 'core'];
    }
  }

  // --- the fight --------------------------------------------------------------

  private fight(delta: number): void {
    this.invuln = Math.max(0, this.invuln - delta);
    if (this.runMode()) this.runClock += delta; // fights only — intros are free

    // Transient title (ENRAGED) auto-clears.
    if (this.cardTimer > 0) {
      this.cardTimer -= delta;
      if (this.cardTimer <= 0) this.hud.title('', '');
    }

    this.updateShots(delta);
    if (this.goopStage) this.goopBalls();
    if (this.stunTimer > 0) this.stunTimer -= delta;
    if (this.stunMeter > 0) this.stunMeter = Math.max(0, this.stunMeter - BOSS_STUN.decayPerSec * delta);

    // Watch the health pools. LOCAL hp drops are MY landed hits (only my
    // balls collide on my sim): route them through the ONE authoritative
    // damage path — directly when I'm the authority, over the wire when a
    // raid host owns the boss (my local pool then snaps back to the echo).
    const boss = this.ensureBoss();
    let bossHp = boss.getValue(Health, 'current') ?? 0;
    const bossMax = boss.getValue(Health, 'max') ?? 1;
    const meHp = fighterAt(0)?.getValue(Health, 'current') ?? 0;
    if (bossHp < this.lastBossHp) {
      const pts = this.lastBossHp - bossHp;
      const spot: string = this.litPoints()[0] ?? 'pod';
      this.flinch = 0.35;
      this.hudTimer = 0; // instant bar update on damage
      if (this.isAuthority()) {
        boss.setValue(Health, 'current', this.lastBossHp); // the path re-applies
        this.applyBossDamage(spot, pts);
        bossHp = boss.getValue(Health, 'current') ?? 0;
      } else {
        mesh.send({ k: 'rdmg', spot, pts });
        boss.setValue(Health, 'current', this.syncedHp); // host owns the pool
        bossHp = this.syncedHp;
      }
    }
    this.lastBossHp = bossHp;

    // GOLIATH's law: wound it deep enough and it stops playing fair. (The
    // second life is BORN enraged; guests take both flags from the echo.)
    if (
      this.isAuthority() &&
      !this.enraged &&
      !this.p2 &&
      this.def.enrageAt > 0 &&
      bossHp > 0 &&
      bossHp / bossMax <= this.def.enrageAt
    ) {
      this.enraged = true;
      this.flinch = 0.35;
      this.hud.title(this.goopStage ? 'THE TIDE RISES' : 'ENRAGED', '', this.accentCss());
      this.cardTimer = 1.3;
      sfx.bossRoar(this.def.scale * 1.1);
    }

    // Endings are the AUTHORITY's call (guests follow the echo): the kill —
    // or the false kill, for a finale GOLIATH not yet on his second life.
    // The second wind belongs to every raid AND to BLAZING campaign runs —
    // the hottest solo tier earns the raid king (other tiers kill him once).
    if (this.isAuthority() && bossHp <= 0) {
      const finaleKing = !this.goopStage && app.campaignStage === this.runLen - 1 && !this.p2;
      const secondWind = this.raid() || this.activeDifficulty() === 'blazing';
      if (finaleKing && secondWind) this.toResurrect();
      else this.toVictory();
      return;
    }
    // Your own death: solo, it's the end. In a raid you're DOWN — the squad
    // fights on, you spectate, and a refit between titans stands you back up.
    // The wipe (everyone down) is declared by the host in raidNet.
    if (meHp <= 0) {
      if (!this.raid()) {
        this.toDefeat();
        return;
      }
      if (this.cardTimer <= 0) {
        this.hud.title('DOWN', 'the squad fights on', '#e8352a');
        this.cardTimer = 2.4;
      }
    }

    // Attack scheduling is the authority's; everyone advances the live copy.
    // A REELING boss (EASY stun) holds its fire — the cooldown clock only
    // ticks once it shakes the stagger off.
    if (!this.attack) {
      if (this.isAuthority() && this.stunTimer <= 0) {
        if (!this.probeHold) {
          this.cooldown -= delta;
          if (this.cooldown <= 0) this.startAttack();
        }
      }
    } else {
      this.advanceAttack(delta);
    }
  }

  /**
   * THE one authoritative boss-damage path — solo self and raid host alike,
   * fed by local hits and rdmg reports. Validates the spot against the LIVE
   * pattern (a stale report clanks off), applies the damage — the crown steps
   * its bar in exact ring-hit notches — and walks the weak-point pattern.
   */
  private applyBossDamage(spot: string, pts: number): void {
    if (this.phase !== 'fight') return;
    const boss = this.ensureBoss();
    const max = boss.getValue(Health, 'max') ?? 1;
    let hp = boss.getValue(Health, 'current') ?? 0;
    if (this.def.weakPattern === 'body') {
      // GOOPLIATH: the bar IS a hit counter — every landed ball is one notch,
      // whoever threw it, wherever it landed. 300 in a raid, 75 solo.
      if (spot !== 'body') return;
      this.hudTimer = 0;
      hp = Math.max(0, hp - Math.max(1, Math.round(pts)));
      boss.setValue(Health, 'current', hp);
      this.lastBossHp = hp;
      this.tallyStun();
      return;
    }
    const lit = this.litPoints() as string[];
    const podShot = spot === 'pod' && this.attack?.kind === 'volley';
    if (!lit.includes(spot) && !podShot) return;
    this.tallyStun();

    this.flinch = 0.35;
    this.hudTimer = 0;
    if (this.def.weakPattern === 'crown') {
      if (podShot) return; // the crown circuit ignores pod bonuses outright
      this.hitsOnPoint += 1;
      if (this.hitsOnPoint >= this.crownPerStop()) {
        this.hitsOnPoint = 0;
        this.cycleIdx += 1;
        if (this.cycleIdx % CROWN_RING.length === 0) {
          // A full loop closed: the king roars and quickens.
          this.flinch = 0.5;
          sfx.bossRoar(this.def.scale * 1.1);
        } else {
          sfx.coreExposed();
        }
      }
      // The bar steps down one notch per ring hit — the kill is EXACTLY the
      // loop count, whatever the ball would have dealt.
      const done = this.cycleIdx * this.crownPerStop() + this.hitsOnPoint;
      hp = max * Math.max(0, 1 - done / this.crownTargetHits());
      boss.setValue(Health, 'current', hp);
    } else {
      hp = Math.max(0, hp - pts);
      boss.setValue(Health, 'current', hp);
      if (hp > 0 && !podShot && this.def.weakPattern !== 'both') {
        this.hitsOnPoint += 1;
        const perStop = this.def.weakPattern === 'double' ? 2 : 1;
        if (this.hitsOnPoint >= perStop) {
          this.hitsOnPoint = 0;
          this.cycleIdx += 1;
          sfx.coreExposed();
        }
      }
    }
    this.lastBossHp = hp;
  }

  // --- GOOPLIATH: ball-vs-gel collision -------------------------------------------

  /**
   * The whole body is the hitbox: every fireball is swept against the gel's
   * OWN signed-distance field — the same field the shader draws, so what you
   * see is exactly what you hit. Contact triggers the full GOOP reaction
   * (verlet shove + carved dent + surface roil, lumps torn loose by the
   * hardest throws) plus the wet foley. MY balls are spent and score one hit
   * through the one authoritative path; a squadmate's RENDERED ball splashes
   * cosmetically (their own client scores it) — entry-edge detection keeps
   * it to one splash per pass.
   */
  private goopBalls(): void {
    const goop = this.goop;
    const root = this.goopRoot;
    if (!goop || !root) return;
    const S = this.goopScale;
    const bound = S * 2.4; // generous sphere around the whole sim AABB
    // Destroyed transient shards leave orphan map entries — sweep them out
    // before they pile up over a 300-hit fight.
    if (this.goopPrev.size > 24) {
      const live = new Set(this.queries.balls.entities);
      for (const key of this.goopPrev.keys()) if (!live.has(key)) this.goopPrev.delete(key);
      for (const key of this.goopInside.keys()) if (!live.has(key)) this.goopInside.delete(key);
    }
    for (const ball of this.queries.balls.entities) {
      const obj = ball.object3D;
      if (!obj || !obj.visible) {
        this.goopInside.delete(ball);
        continue;
      }
      const state = ball.getValue(Fireball, 'state') ?? 0;
      const returning = state === BallState.Returning;
      if ((state !== BallState.Flying && !returning) || (returning && (ball.getValue(Fireball, 'returnHit') ?? 0) === 1)) {
        this.goopInside.delete(ball);
        this.goopPrev.delete(ball);
        continue;
      }
      obj.getWorldPosition(_p);
      let prev = this.goopPrev.get(ball);
      if (!prev) {
        prev = new Vector3().copy(_p);
        this.goopPrev.set(ball, prev);
      }
      // Broad phase before any SDF sampling.
      if (_p.distanceTo(root.position) > bound) {
        this.goopInside.set(ball, false);
        prev.copy(_p);
        continue;
      }
      const radius = ball.getValue(Fireball, 'radius') ?? FIREBALL.radius;
      const skin = (radius + 0.05) / S; // contact threshold in the sim's native metres
      // Sweep this frame's path so a fast ball can't tunnel through a limb.
      const dist = prev.distanceTo(_p);
      const steps = Math.min(8, 1 + Math.ceil(dist / 0.12));
      let inside = false;
      for (let i = steps; i >= 1; i--) {
        _v.copy(prev).lerp(_p, i / steps);
        if (goop.fieldAtWorld(_v) <= skin) {
          inside = true;
          break;
        }
      }
      const wasInside = this.goopInside.get(ball) === true;
      this.goopInside.set(ball, inside);
      prev.copy(_p);
      if (!inside || wasInside) continue;

      // Contact (_v holds the hit sample): the gel takes the ball like a
      // punch, scaled by throw speed — only genuinely hard throws tear lumps.
      const v = ball.getVectorView(Fireball, 'velocity');
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (speed > 1e-3) _head.set(v[0] / speed, v[1] / speed, v[2] / speed);
      else _head.set(0, 0, -1);
      const punch = Math.min(GOOPLIATH.punchMax, GOOPLIATH.punchBase + speed * GOOPLIATH.punchGain);
      const res = goop.receivePunchWorld(_v, _head, punch);
      sfx.squelch(0.5 + res.strength * 0.5);
      this.goopFx?.flash(_v, 0x8cff70, 0.7 + res.strength * 0.9);
      // Splash-back: a second spray of droplets kicked TOWARD the thrower —
      // the follow-through that sells the ball burying itself in the gel.
      _p.set(-_head.x, Math.abs(_head.y) + 0.6, -_head.z).normalize();
      this.goopFx?.burst(_v, _p, 3 + Math.round(res.strength * 4), 2.2 + res.strength * 1.6);

      if ((ball.getValue(Fireball, 'owner') ?? 0) !== 0) continue; // a squadmate's — theirs to score
      const hand = (ball.getValue(Fireball, 'hand') ?? 0) as 0 | 1;
      pulseHand(this.world.session, hand === 0 ? 'left' : 'right', 0.5, 60);
      if (returning) ball.setValue(Fireball, 'returnHit', 1);
      else this.spendGoopBall(ball);
      if (this.isAuthority()) this.applyBossDamage('body', 1);
      else mesh.send({ k: 'rdmg', spot: 'body', pts: 1 });
    }
  }

  /** Same law as CollisionSystem.spendBall — the gel keeps what it catches. */
  private spendGoopBall(ball: Entity): void {
    if ((ball.getValue(Fireball, 'transient') ?? 0) === 1) {
      ball.destroy();
      return;
    }
    ball.setValue(Fireball, 'state', BallState.Dead);
    ball.setValue(Fireball, 'recallLock', FIREBALL.recallLockout);
    const v = ball.getVectorView(Fireball, 'velocity');
    v[0] = 0;
    v[1] = 0;
    v[2] = 0;
  }

  // --- the volley: blockable fireballs -----------------------------------------

  /** Pod muzzle world position on `side` (matches the pod bonus hitboxes).
   *  GOOPLIATH has no pods — his volley spits from the gel's shoulder mass. */
  private podPos(side: -1 | 1, out: Vector3): void {
    if (this.goop) {
      const root = this.goopRoot!.position;
      out.set(root.x + side * 0.42 * this.goopScale, root.y + 1.32 * this.goopScale, root.z);
      return;
    }
    const s = this.def.scale;
    const root = this.rig!.root.position;
    out.set(root.x + side * 0.37 * s, root.y + 1.44 * s, root.z);
  }

  /** Hurl one fireball from the pod on `side`, aimed at the TARGET's head
   *  RIGHT NOW — after launch it flies straight: step off the line, or (if
   *  it's chasing you) block it. */
  private launchShot(side: -1 | 1, seat: number): void {
    this.podPos(side, _v);
    this.playerHeadOf(seat, _head);
    const group = new Group();
    group.add(glowSprite(this.def.accent, 0.55));
    // The gel spits GREEN fire — a pale lime core instead of furnace-warm.
    const core = glowSprite(this.goop ? 0xeaffdd : 0xffe9c2, 0.26);
    group.add(core);
    group.position.copy(_v);
    this.scene.add(group);
    // Raids fire hotter: the pit is twice as far out, so the mult keeps the
    // flight near the solo one-second beat.
    const speed = CAMPAIGN.volleySpeed * (this.raid() ? RAID.volleySpeedMult : 1);
    const vel = new Vector3().copy(_head).sub(_v).normalize().multiplyScalar(speed);
    this.shots.push({ pos: _v.clone(), vel, age: 0, group, trail: 0, seat });
    if (this.goop) sfx.gooWhoosh(); // spat, not fired
    else sfx.mortarThump();
  }

  private updateShots(delta: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.age += delta;
      shot.pos.addScaledVector(shot.vel, delta);
      shot.group.position.copy(shot.pos);
      shot.trail -= delta;
      if (shot.trail <= 0) {
        shot.trail = 0.07;
        emberBurst(shot.pos, 2, true);
      }

      // Shots chasing SOMEONE ELSE are pure theatre on my sim — their own
      // client judges the block/hit; mine just flies the visual and expires.
      if (shot.seat !== this.mySeatId()) {
        if (shot.age > 3.5 || shot.pos.y < -0.4) this.disposeShot(i);
        continue;
      }

      // BLOCKED: a fist in the path detonates the shot harmlessly — but ONLY
      // an ARMED fist. Same law as the main game's parry: your ball must be
      // roaring in ORBIT (trigger/grip held) or homing back (RETURNING). A
      // bare, un-orbited hand passes straight through and takes the hit.
      let blocked = false;
      for (const hand of ['left', 'right'] as const) {
        const idx: 0 | 1 = hand === 'left' ? 0 : 1;
        if (!this.handArmed(idx)) continue;
        const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
        if (!grip) continue;
        grip.getWorldPosition(_p);
        if (_p.distanceTo(shot.pos) <= CAMPAIGN.volleyBlockRadius) {
          spawnFireImpact(this.world, shot.pos, 1, 0.9);
          emberBurst(shot.pos, 20, true);
          sfx.deflect();
          pulseHand(this.world.session, hand, 0.8, 90);
          blocked = true;
          break;
        }
      }
      if (blocked) {
        this.disposeShot(i);
        continue;
      }

      // HIT: the shot core reaching any body sphere burns like any strike.
      let hit = false;
      for (const part of this.queries.playerParts.entities) {
        const obj = part.object3D;
        if (!obj) continue;
        obj.getWorldPosition(_p);
        const r = part.getValue(Hitbox, 'radius') ?? 0.15;
        if (_p.distanceTo(shot.pos) <= CAMPAIGN.volleyHitRadius + r * 0.8) {
          hit = true;
          break;
        }
      }
      if (hit) {
        spawnFireImpact(this.world, shot.pos, 1, 1.2);
        if (this.invuln <= 0) {
          this.invuln = 0.7;
          this.damagePlayer(CAMPAIGN.attackDamage);
        }
        this.disposeShot(i);
        continue;
      }

      // Missed everything: let it sail past and gutter out.
      if (shot.age > 3.5 || shot.pos.z > 2 || shot.pos.y < -0.4) this.disposeShot(i);
    }
  }

  private disposeShot(i: number): void {
    const shot = this.shots[i];
    shot.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial | undefined)?.dispose?.();
    });
    shot.group.removeFromParent();
    this.shots.splice(i, 1);
  }

  private disposeShots(): void {
    for (let i = this.shots.length - 1; i >= 0; i--) this.disposeShot(i);
  }

  /** Is this hand's ball ARMED to parry — roaring in orbit or homing back?
   *  (The same states CollisionSystem lets deflect an enemy ball.) */
  private handArmed(hand: 0 | 1): boolean {
    for (const e of this.queries.balls.entities) {
      if ((e.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((e.getValue(Fireball, 'hand') ?? 0) !== hand) continue;
      if ((e.getValue(Fireball, 'transient') ?? 0) !== 0) continue;
      const st = e.getValue(Fireball, 'state') ?? 0;
      return st === BallState.Orbit || st === BallState.Returning;
    }
    return false;
  }

  /**
   * The stage's targeting doctrine: SWEEPS always mark the WHOLE squad (the
   * spinning lash catches everyone); other attacks hunt ONE raider on stage
   * I, TWO at random on stage II, and EVERYONE from stage III on. Group
   * picks come back sorted around the arc so cascades travel one way.
   */
  private raidTargets(kind: AttackKind | GrammarKind | 'decree'): number[] {
    if (!this.raid()) return [0];
    const alive = this.aliveSeats();
    if (!alive.length) return [this.mySeatId()];
    const arcOrder = (seats: number[]): number[] => {
      const canonical = MODE_LAYOUT[app.arcade];
      return seats.slice().sort((a, b) => (canonical[a]?.yaw ?? 0) - (canonical[b]?.yaw ?? 0));
    };
    // The seesaw is squad-wide like the sweep: every platform rocks at once,
    // each starting on the half its own raider stands on. The GRAMMAR moves
    // are squad-wide by RAVE RAID's own law — one chart, every deck.
    if (
      kind === 'sweep' ||
      kind === 'decree' ||
      kind === 'seesaw' ||
      kind === 'surge' ||
      (GRAMMAR_KINDS as readonly string[]).includes(kind)
    ) {
      return arcOrder(alive);
    }
    const stage = app.campaignStage;
    if (stage <= 0 || alive.length === 1) {
      // Stage I: one raider at a time — never the same one twice while
      // others stand, so the heat visibly rotates around the arc.
      const pickFrom = alive.length > 1 ? alive.filter((s) => s !== this.lastTarget) : alive;
      const seat = pickFrom[Math.floor(Math.random() * pickFrom.length)] ?? alive[0];
      this.lastTarget = seat;
      return [seat];
    }
    if (stage === 1) {
      // Stage II: two at random, together.
      const pool = alive.slice();
      const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const second = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
      this.lastTarget = -1;
      return arcOrder(second === undefined ? [first] : [first, second]);
    }
    // Stage III+: the whole squad, every swing.
    this.lastTarget = -1;
    return arcOrder(alive);
  }

  /**
   * AUTHORITY: pick a weighted attack (avoiding an immediate repeat), pick
   * its TARGETS per the stage doctrine, broadcast (raid), then build the
   * live copy locally. Guests build theirs from the ratk message.
   */
  private startAttack(): void {
    // The DECREE: GOLIATH's raid-only group attack, once he's angry (either
    // life). Rolls ahead of the normal pool — everyone gets marked at once.
    if (
      this.raid() &&
      app.campaignStage === BOSSES.length - 1 &&
      (this.enraged || this.p2) &&
      Math.random() * (RAID.decreeWeight + 10) < RAID.decreeWeight
    ) {
      const seats = this.raidTargets('decree');
      const a = [rand(-Math.PI, Math.PI)]; // one CANONICAL safe bearing for all
      mesh.send({ k: 'ratk', kind: 'decree', seats, a });
      this.buildAttack('decree', seats, { a });
      return;
    }

    // A titan that LEARNED TO DANCE picks over both vocabularies under the
    // chart laws (never twice, verbs damped, THE FLOOR MANAGER) — its own
    // path, seeded so the raid wire replays it.
    if (this.def.grammar) {
      this.startGrammar();
      return;
    }

    const kinds: AttackKind[] = ['slam', 'sweep', 'beam', 'volley', 'nova', 'seesaw', 'surge'];
    let total = 0;
    const pool: Array<[AttackKind, number]> = [];
    for (const k of kinds) {
      let w = this.def.weights[k];
      if (w <= 0) continue;
      if (k === this.lastKind) w *= 0.35; // discourage repeats
      pool.push([k, w]);
      total += w;
    }
    let roll = Math.random() * total;
    let kind: AttackKind = pool[0]?.[0] ?? 'slam';
    for (const [k, w] of pool) {
      roll -= w;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    this.lastKind = kind;
    this.launchClassic(kind);
  }

  /** Aim + send + build one CLASSIC attack (the pre-Encore pipeline, pulled
   *  out so the Encore's mixed picker can reach it too). */
  private launchClassic(kind: AttackKind): void {
    // Aim parameters PER TARGET, each in that target's local frame (their
    // platform at their origin). A remote target's head comes off the pose
    // bus in MY world and gets pulled back into their frame.
    const seats = this.raidTargets(kind);
    const params: { x: number[]; z: number[]; y: number[]; a: number[] } = { x: [], z: [], y: [], a: [] };
    for (const seat of seats) {
      if (seat === this.mySeatId()) this.playerHead(_head);
      else {
        this.playerHeadOf(seat, _p);
        worldToPeer(_head, seat, _p.x, _p.y, _p.z);
      }
      if (kind === 'slam') {
        params.x.push(clamp(_head.x, -OCTAGON_HALF_WIDTH + 0.15, OCTAGON_HALF_WIDTH - 0.15));
        params.z.push(clamp(_head.z, -OCTAGON_HALF_DEPTH + 0.1, OCTAGON_HALF_DEPTH - 0.1));
      } else if (kind === 'sweep') {
        params.y.push(clamp(_head.y - 0.12, 1.3, 1.55));
      } else if (kind === 'nova') {
        const playerAng = Math.hypot(_head.x, _head.z) > 0.15 ? Math.atan2(_head.x, _head.z) : rand(-Math.PI, Math.PI);
        params.a.push(playerAng + Math.PI + rand(-0.5, 0.5));
      } else if (kind === 'seesaw' || kind === 'surge') {
        // First flood the half the target STANDS on — they must cross. One
        // signed value per seat: |a| is the stage count (grows as he drains),
        // its sign the first doomed half. Seesaw splits left/right (x), surge
        // front/back (z).
        const along = kind === 'surge' ? _head.z : _head.x;
        const side = along >= 0 ? 1 : -1;
        params.a.push(side * this.seesawStages());
      }
    }

    if (this.raid()) mesh.send({ k: 'ratk', kind, seats, ...params });
    this.buildAttack(kind, seats, params);
  }

  /** Escalation act for the grammar (0..4): the picked difficulty sets the
   *  floor, enrage lifts one act — synced discretely (enr rides the rst
   *  echo), so every client derives the same act for the same attack. */
  private grammarAct(): number {
    const base = { easy: 1, normal: 2, hard: 3, blazing: 3 }[this.activeDifficulty()];
    return Math.min(4, base + (this.enraged ? 1 : 0));
  }

  /** THE SWEPT ROUTINE's coin, derived from the attack seed so every client
   *  agrees without another wire field. RAVE RAID rolled it per chart; a
   *  per-move eighth keeps it a legend, not a garnish (it only ever bites
   *  at act 4 anyway). */
  private sweptCoin(seed: number): boolean {
    return (seed & 7) === 0;
  }

  /**
   * A dancing titan's pick: both vocabularies in one weighted pool under
   * the chart laws — never the same move twice (classic or grammar),
   * repeated body-verbs damped, each grammar kind gated by its escalation
   * act, and THE FLOOR MANAGER re-rolling any grammar move whose danger
   * never touches the parked ground. Each attempt rolls a fresh 32-bit
   * seed; the accepted seed rides the raid wire, and every client replays
   * pick + build from it byte for byte.
   */
  private startGrammar(): void {
    const def = this.def;
    const classicKinds: AttackKind[] = ['slam', 'sweep', 'beam', 'volley', 'nova', 'seesaw', 'surge'];
    const act = this.grammarAct();
    const entries: Array<[AttackKind | GrammarKind, number]> = [];
    for (const k of classicKinds) if (def.weights[k] > 0) entries.push([k, def.weights[k]]);
    for (const k of GRAMMAR_KINDS) {
      const w = def.grammar?.[k] ?? 0;
      if (w > 0 && act >= GRAMMAR_ACT_MIN[k]) entries.push([k, w]);
    }
    const expert = this.activeDifficulty() === 'blazing';
    for (let attempt = 0; attempt < 12; attempt++) {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const rng = mulberry32(seed);
      const kind = pickWeighted(rng, entries, this.lastKind);
      if (!(GRAMMAR_KINDS as readonly string[]).includes(kind)) {
        // A classic pick: the usual aimed machinery. Aimed at the player,
        // it always asks for a dodge — the park law is satisfied by design —
        // and the dodge leaves them somewhere the grammar can't know.
        this.lastKind = kind;
        this.park = kind === 'sweep' ? this.park : null; // ducked in place vs. moved
        this.launchClassic(kind as AttackKind);
        return;
      }
      const gk = kind as GrammarKind;
      const landings = buildGrammarMove(gk, rng, {
        act,
        beat: def.beat ?? 0.5,
        expert,
        swept: this.sweptCoin(seed),
        park: this.park,
      });
      // THE FLOOR MANAGER: a move that asks nothing of the parked ground
      // didn't happen — roll a fresh seed. The final attempt stands (best
      // effort, like RAVE RAID's twelve-shapes rule).
      if (!evictsPark(landings, this.park) && attempt < 11) continue;
      this.lastKind = gk;
      const park = this.park;
      // RAVE RAID's raid model, kept: the same seat-local pattern marks
      // EVERY standing platform at once — fair by construction, and the
      // whole ring dances one chart.
      const seats = this.raidTargets(gk);
      if (this.raid()) {
        mesh.send({ k: 'ratk', kind: gk, seats, g: seed, x: park ? [park.x] : [], z: park ? [park.z] : [] });
      }
      this.buildAttack(gk, seats, { g: seed, x: park ? [park.x] : undefined, z: park ? [park.z] : undefined });
      this.park = parkOf(gk, landings, park);
      return;
    }
  }

  /**
   * Build the LIVE attack — shared by the authority (its own pick) and every
   * guest (from the ratk message). Zone coordinates are TARGET-local; the
   * telegraphs/markers are placed through seatPoint so they land on the right
   * platforms in every player's frame. Only each zone's own target judges
   * damage. Multi-target builds carry a zone set PER SEAT — hammer ghosts on
   * every marked platform, a fan of beams, volleys cycling raiders, novas
   * with per-raider wedges, and the squad sweep's cascading blade.
   */
  private buildAttack(
    kind: AttackKind | GrammarKind | 'decree',
    seats: number[],
    params: { x?: number[]; z?: number[]; y?: number[]; a?: number[]; g?: number },
  ): void {
    this.disposeAttack(); // a straggling ratk never stacks two live attacks
    this.swingAt = -1; // the swing de-dup is per attack clock, which restarts here
    this.throwSfxAt = -1; // …and so is the throw/heave de-dup
    if (!seats.length) seats = [this.mySeatId()];
    this.faceSeat = seats[0];
    const grammar = (GRAMMAR_KINDS as readonly string[]).includes(kind);
    // The windup is SACRED whatever the phase — enrage and GOOPLIATH's haste
    // compress the cooldown between attacks (attackCooldown), never the
    // telegraph itself: a late-fight laser reads exactly like the first one.
    // Difficulty stretches (EASY) or tightens (BLAZING) the windup.
    let chargeTime =
      (kind === 'decree'
        ? RAID.decreeCharge
        : grammar
          ? (this.def.grammarCharge ?? 2)
          : this.def.charge[kind as AttackKind]) * this.diff.charge;
    // The one exception, and it buys back readability rather than spending
    // it: the king's second life on BLAZING gives its falling block a little
    // longer to come down (see CAMPAIGN.phase2SlamCharge). Every client
    // derives this from synced state (p2 rides the rst echo), so hosts and
    // guests still build the same telegraph.
    if (kind === 'slam' && this.p2 && this.activeDifficulty() === 'blazing') {
      chargeTime *= CAMPAIGN.phase2SlamCharge;
    }
    const zones: Zone[] = [];
    const zoneSeats: number[] = [];
    const telegraphs: (Telegraph | null)[] = [];
    const staggers: number[] = [];
    const beamOffsets: number[] = [];
    const markers: (Group | null)[] = [];
    const windows: number[] = [];
    const blockfalls: (RecitalBlockfall | null)[] = [];
    const dressing: Telegraph[] = [];
    const cues: ActiveAttack['cues'] = [];
    let lesson: ActiveAttack['lesson'];
    // Strike with the arm nearer the primary target (multi-target windups
    // hoist BOTH arms — see animateTitan).
    this.seatPoint(seats[0], 0, 0, 0, _p);
    const arm: 0 | 1 = _p.x + (seats[0] === this.mySeatId() ? this.headX() : 0) < 0 ? 1 : 0;

    if (grammar) {
      // A GRAMMAR move: rebuild the whole thing from the seed — the
      // authority and every guest run the identical seeded stream (one roll
      // for the pick, then the build), so the wire is one number. RAVE
      // RAID's raid law holds: the SAME seat-local pattern marks every
      // target platform at once. Each landing gets its own stagger and a
      // one-charge telegraph WINDOW, so a cascade's later steps open their
      // read as the earlier ones fire — never sooner.
      const gk = kind as GrammarKind;
      const seed = params.g ?? 0;
      const rng = mulberry32(seed);
      rng(); // the pick's roll — keeps this stream aligned with startGrammar
      const park: Park =
        params.x && params.x.length ? { x: params.x[0] ?? 0, z: params.z?.[0] ?? 0 } : null;
      const landings = buildGrammarMove(gk, rng, {
        act: this.grammarAct(),
        beat: this.def.beat ?? 0.5,
        expert: this.activeDifficulty() === 'blazing',
        swept: this.sweptCoin(seed),
        park,
      });
      // THE RECITAL: the read IS THE LESSON. Its length is the pattern's —
      // one slot per taught step and a breath after — so the charge is set
      // from the landings rather than the titan's usual read; every
      // headset builds the same landings from the seed, so every headset
      // agrees. The sounds are scheduled here too: a lesson note as each
      // quarter lights, and the recital's cue ahead of each landing.
      if (gk === 'recital') {
        const beat = this.def.beat ?? 0.5;
        const stepSecs = GRAMMAR.recitalLessonBeats * beat * this.diff.charge;
        let steps = 0;
        for (const l of landings) if (l.zone.kind === 'quad') steps++;
        lesson = { stepSecs, steps };
        chargeTime = stepSecs * steps + GRAMMAR.recitalPauseBeats * beat * this.diff.charge;
        for (const l of landings) {
          if (l.zone.kind !== 'quad') continue;
          cues.push({ at: l.zone.step * stepSecs + 0.04, corner: l.zone.corner, hold: l.zone.hold, lesson: true, fired: false });
          cues.push({
            at: chargeTime + l.delay - GRAMMAR.recitalCueBeats * beat,
            corner: l.zone.corner,
            hold: l.zone.hold,
            lesson: false,
            fired: false,
          });
        }
      }
      for (const seat of seats) {
        this.seatPoint(seat, 0, CAMPAIGN.decalY, 0, _v);
        const deckX = _v.x;
        const deckY = _v.y;
        const deckZ = _v.z;
        const yawD = this.seatYawDelta(seat);
        // The sweep line (the duckdonut's blade / the swept recital) hangs
        // at MY height on my own deck; a remote deck wears the house line —
        // visual only, their own client judges their own zone.
        this.playerHead(_head);
        const sweepY = seat === this.mySeatId() ? clamp(_head.y - 0.12, 1.3, 1.55) : 1.4;
        const xDone = new Set<number>(); // one X pane per landing beat
        for (const l of landings) {
          const gz = l.zone;
          const zone: Zone = gz.kind === 'sweep' ? { kind: 'sweep', y: sweepY } : gz;
          zones.push(zone);
          zoneSeats.push(seat);
          staggers.push(l.delay);
          // The recital's reads open one step ahead (the conductor's fill
          // runs per step; a swept recital's blade shows a step early).
          windows.push(gk === 'recital' ? GRAMMAR.recitalStepBeats * (this.def.beat ?? 0.5) : chargeTime);
          markers.push(null);
          let tg: Telegraph | null = null;
          if (gz.kind === 'lane' && gz.yaw) {
            // THE X: both arms drawn as ONE pane (the union composes); the
            // second arm of the pair carries no telegraph of its own.
            if (!xDone.has(l.delay)) {
              xDone.add(l.delay);
              tg = xTelegraph(gz.halfW);
              tg.group.position.set(deckX, deckY, deckZ);
              tg.group.rotation.y = yawD;
            }
          } else if (gz.kind === 'lane') {
            tg = laneTelegraph(gz.halfW, OCTAGON_HALF_DEPTH * 2 + 0.6);
            this.seatPoint(seat, gz.x, CAMPAIGN.decalY, 0, _v);
            tg.group.position.copy(_v);
            tg.group.rotation.y = yawD;
          } else if (gz.kind === 'rail') {
            tg = railTelegraph(gz.halfD, OCTAGON_HALF_WIDTH * 2 + 0.6, gz.from);
            this.seatPoint(seat, 0, CAMPAIGN.decalY, gz.z, _v);
            tg.group.position.copy(_v);
            tg.group.rotation.y = yawD;
          } else if (gz.kind === 'gate') {
            tg = gateTelegraph(OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH, gz.at, gz.half, gz.axis);
            tg.group.position.set(deckX, deckY, deckZ);
            tg.group.rotation.y = yawD;
          } else if (gz.kind === 'ring') {
            tg = donutTelegraph(GRAMMAR.donutRadius, gz.innerR);
            tg.group.position.set(deckX, deckY, deckZ);
            tg.group.rotation.y = yawD;
          } else if (gz.kind === 'sweep') {
            const dir: 1 | -1 = arm === 0 ? -1 : 1;
            tg = sweepTelegraph(OCTAGON_HALF_WIDTH * 2 + 0.5, OCTAGON_HALF_DEPTH * 2 + 0.3, sweepY, CAMPAIGN.sweepThickness, dir);
            this.seatPoint(seat, 0, 0, 0, _v);
            tg.group.position.copy(_v);
            tg.group.rotation.y = yawD;
          }
          // quad: no zone telegraph — the lesson teaches (below), the NOTE
          // is the per-step warning, and the block only confirms it: a
          // short fall from low, too late to be read instead of remembered.
          if (tg) this.scene.add(tg.group);
          telegraphs.push(tg);
          if (gz.kind === 'quad') {
            const bf = new RecitalBlockfall(
              this.scene,
              gz.corner,
              chargeTime + l.delay,
              GRAMMAR.recitalDropBeats * (this.def.beat ?? 0.5),
              seed,
              gz.step,
              3.2,
            );
            bf.root.position.set(deckX, 0, deckZ);
            bf.root.rotation.y = yawD;
            blockfalls.push(bf);
          } else {
            blockfalls.push(null);
          }
        }
        // THE RECITAL's furniture: the chalk quarter lines for the whole
        // move and THE LESSON's marks, lit one step at a time with the
        // notes and dark for the recital itself.
        const firstQuad = landings.find((l) => l.zone.kind === 'quad')?.zone;
        if (firstQuad?.kind === 'quad' && lesson) {
          const quarters = quarterTelegraph(OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH);
          const marks = recitalMarksTelegraph(
            firstQuad.pattern,
            firstQuad.holds,
            OCTAGON_HALF_WIDTH,
            OCTAGON_HALF_DEPTH,
            lesson.stepSecs,
            chargeTime,
          );
          for (const d of [quarters, marks]) {
            d.group.position.set(deckX, deckY, deckZ);
            d.group.rotation.y = yawD;
            this.scene.add(d.group);
            dressing.push(d);
          }
        }
      }
    } else if (kind === 'decree') {
      // Novas bloom on EVERY standing platform around ONE canonical bearing —
      // the whole squad rotates to the same compass point together, or burns.
      const canonicalA = params.a?.[0] ?? 0;
      const canonical = MODE_LAYOUT[app.arcade];
      const halfAngle = CAMPAIGN.novaEnragedHalfAngle;
      for (const s of seats) {
        const localA = canonicalA - (canonical[s]?.yaw ?? 0);
        zones.push({ kind: 'nova', angle: localA, halfAngle });
        zoneSeats.push(s);
        const tg = novaTelegraph(CAMPAIGN.novaRadius, localA, halfAngle);
        this.seatPoint(s, 0, CAMPAIGN.decalY, 0, _v);
        tg.group.position.copy(_v);
        tg.group.rotation.y = this.seatYawDelta(s);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        staggers.push(0);
        markers.push(null);
      }
    } else if (kind === 'slam') {
      // Disc grows with the titan but CAPS at slamRadiusMax — JUGGERNAUT and
      // GOLIATH (and every raid giant) otherwise drop discs that swallow the
      // platform and stop being honestly dodgeable.
      const r = Math.min(CAMPAIGN.slamRadius + this.def.scale * 0.02, CAMPAIGN.slamRadiusMax);
      // The drumline shortens as the target list grows — four platforms of
      // three-disc marches each would read as noise, not rhythm.
      const count =
        this.def.slamStyle === 'single' ? 1 : Math.max(1, Math.min(this.def.slamCount, seats.length > 2 ? 2 : 3));
      seats.forEach((seat, ti) => {
        const x0 = params.x?.[ti] ?? 0;
        const z0 = params.z?.[ti] ?? 0;
        // A marching drumline steps toward the open side of the platform.
        const marchDir = x0 > 0 ? -1 : 1;
        for (let i = 0; i < count; i++) {
          const x =
            this.def.slamStyle === 'march' && i > 0
              ? clamp(x0 + marchDir * CAMPAIGN.marchStep * i, -OCTAGON_HALF_WIDTH + 0.15, OCTAGON_HALF_WIDTH - 0.15)
              : x0; // 'rehit' re-marks the SAME crater
          zones.push({ kind: 'circle', x, z: z0, r });
          zoneSeats.push(seat);
          const tg = circleTelegraph(r);
          this.seatPoint(seat, x, CAMPAIGN.decalY, z0, _v);
          tg.group.position.copy(_v);
          this.scene.add(tg.group);
          telegraphs.push(tg);
          // A breath of extra hang on top of the charge, so the fist lands a
          // touch later than the disc fills — a fairer window to clear it.
          staggers.push(
            CAMPAIGN.slamImpactDelay + i * (this.def.slamStyle === 'rehit' ? CAMPAIGN.rehitDelay : CAMPAIGN.marchDelay),
          );
          // The ghost hammer: hangs over the disc and descends with the
          // countdown, so the raised arm connects to THIS spot on the floor.
          markers.push(this.makeHammerMarker(x, z0, seat));
        }
      });
    } else if (kind === 'sweep') {
      // A horizontal blade slice just under head height: duck it. Never
      // below 1.3 m — the pelvis is pinned near 0.95 m, so lower slices
      // would clip a standing body no matter what; 1.3 keeps "deep duck"
      // as the honest answer. A SQUAD sweep (raid) marks every platform at
      // its own raider's height and lands as ONE cascading cut around the
      // arc (seats arrive arc-ordered) while the titan spins full-turn.
      seats.forEach((seat, ti) => {
        const y = params.y?.[ti] ?? 1.4;
        zones.push({ kind: 'sweep', y });
        zoneSeats.push(seat);
        // Which way the cut will actually run. spawnBladeSweep starts the
        // blade at `from * span` and drives it to `-from * span`, with
        // from = arm === 0 ? 1 : -1 — so arm 0 travels toward −x and arm 1
        // toward +x. The telegraph used to ignore the arm entirely and always
        // wipe −x → +x, so every arm-0 sweep warned in the opposite direction
        // to the blade that followed.
        const dir: 1 | -1 = arm === 0 ? -1 : 1;
        const tg = sweepTelegraph(
          OCTAGON_HALF_WIDTH * 2 + 0.5,
          OCTAGON_HALF_DEPTH * 2 + 0.3,
          y,
          CAMPAIGN.sweepThickness,
          dir,
        );
        this.seatPoint(seat, 0, 0, 0, _v);
        tg.group.position.copy(_v);
        tg.group.rotation.y = this.seatYawDelta(seat);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        staggers.push(ti * RAID.sweepCascade);
      });
    } else if (kind === 'beam') {
      // A strip through (or beside) each target, raked from the visor. One
      // target gets the boss's full battery; a group gets one ray each — a
      // FAN of beams sweeping out across the arc.
      const strips = seats.length > 1 ? 1 : this.def.beams;
      seats.forEach((seat, ti) => {
        for (let i = 0; i < strips; i++) {
          const offset = i === 0 ? 0 : (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 0.8);
          const zone: Zone = { kind: 'beam', x: 0, z: 0, dx: 0, dz: 1, halfW: CAMPAIGN.beamHalfWidth };
          const tg = beamTelegraph(CAMPAIGN.beamHalfWidth, 3.2);
          this.scene.add(tg.group);
          zones.push(zone);
          zoneSeats.push(seat);
          telegraphs.push(tg);
          beamOffsets.push(offset);
          staggers.push((ti * strips + i) * 0.5); // half a beat between shots of a battery
          this.aimBeam(zone, tg, offset, seat); // initial aim (tracking re-aims)
        }
      });
    } else if (kind === 'seesaw' || kind === 'surge') {
      // THE SEESAW (x, left/right) and its SURGE cousin (z, front/back): one
      // half of the platform floods, then the other, `stages` times over —
      // every pane is up from the start (the whole sequence reads ahead),
      // each filling on its own clock, so the player hurls themselves across
      // the centreline on the beat. More stages as the boss drains.
      const axis: 0 | 1 = kind === 'surge' ? 1 : 0;
      // The z-split reuses the x-split pane, turned a quarter turn (the group
      // yaw carries the seat rotation plus this), so the flood runs the other
      // way. The pane's own extents swap to keep the platform covered.
      const halfW = (axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
      const depth = (axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH) * 2 + 0.3;
      seats.forEach((seat, ti) => {
        const enc = params.a?.[ti] ?? params.a?.[0] ?? 2;
        const stages = clamp(Math.round(Math.abs(enc)), 2, 8);
        let side: -1 | 1 = enc < 0 ? -1 : 1;
        for (let i = 0; i < stages; i++) {
          zones.push({ kind: 'half', side, axis });
          zoneSeats.push(seat);
          const tg = halfTelegraph(side, halfW, depth);
          this.seatPoint(seat, 0, CAMPAIGN.decalY, 0, _v);
          tg.group.position.copy(_v);
          // −90° (not +90°): a +90° turn maps the +x half to −z, but the hit
          // test damages the +z half (the one the player stands on) — so the
          // flood must land there too, or the shown danger reads inverted.
          tg.group.rotation.y = this.seatYawDelta(seat) + (axis ? -Math.PI / 2 : 0);
          this.scene.add(tg.group);
          telegraphs.push(tg);
          staggers.push(i * GOOPLIATH.seesawGap);
          markers.push(null);
          side = side === 1 ? -1 : 1;
        }
      });
    } else if (kind === 'nova') {
      // GOLIATH's nova: everything burns EXCEPT one safe wedge — and each
      // wedge opens roughly OPPOSITE where its raider stands, so everyone
      // marked must cross their own platform while the flood charges.
      const halfAngle = this.enraged ? CAMPAIGN.novaEnragedHalfAngle : CAMPAIGN.novaHalfAngle;
      seats.forEach((seat, ti) => {
        const angle = params.a?.[ti] ?? 0;
        zones.push({ kind: 'nova', angle, halfAngle });
        zoneSeats.push(seat);
        const tg = novaTelegraph(CAMPAIGN.novaRadius, angle, halfAngle);
        this.seatPoint(seat, 0, CAMPAIGN.decalY, 0, _v);
        tg.group.position.copy(_v);
        tg.group.rotation.y = this.seatYawDelta(seat);
        this.scene.add(tg.group);
        telegraphs.push(tg);
        staggers.push(0);
      });
    } else {
      // The VOLLEY: no floor marks at all — the shoulder pods spool up
      // (watch the muzzle glows swell through the windup) and then hurl
      // blockable fireballs, alternating pods. Every shot is aimed where its
      // raider's head is at ITS launch: keep moving, or catch it on a fist.
      // A SQUAD volley is a BARRAGE — many rounds of fire, one shot at every
      // marked raider each round, the pods hammering shot after shot across
      // the whole arc.
      const squad = seats.length > 1;
      const rounds = squad ? RAID.volleySquadRounds : this.def.volleyCount;
      const roundGap = squad ? RAID.volleySquadInterval : CAMPAIGN.volleyInterval;
      let s = 0;
      for (let r = 0; r < rounds; r++) {
        for (let j = 0; j < seats.length; j++) {
          const side = (s % 2 === 0 ? -1 : 1) as -1 | 1;
          zones.push({ kind: 'shot', side });
          zoneSeats.push(seats[j]);
          telegraphs.push(null);
          // Rounds are spaced by the interval; within a round the shots fan
          // out fast across the arc, so each round reads as one salvo.
          staggers.push(r * roundGap + j * (roundGap / (seats.length + 1)));
          markers.push(this.makeMuzzleGlow(side));
          s++;
        }
      }
    }

    this.attack = {
      kind: kind === 'decree' ? 'nova' : kind,
      zones,
      telegraphs,
      staggers,
      resolved: zones.map(() => false),
      time: 0,
      chargeTime,
      arm,
      tracks: kind === 'beam' && this.def.beamTracks,
      beamOffsets,
      markers,
      seats,
      zoneSeats,
      windows,
      blockfalls,
      dressing,
      cues,
      lesson,
      bolts: zones.map(() => null),
      thrown: zones.map(() => 0 as const),
    };
    if (this.goop) this.goopTelegraph(this.attack.kind as AttackKind, chargeTime, seats[0]);
    sfx.chargeWhine(chargeTime);
    // Settle every read NOW, before this frame renders: each telegraph was
    // added to the scene visible and unfilled, and a cascade's later steps
    // (THE WAVE's lanes, a seesaw's far halves) only get hidden by the first
    // advanceAttack — which runs NEXT frame. Without this, every beam of the
    // whole cascade flashed down at once as the move began.
    this.advanceAttack(0);
  }

  /** Seconds from fist to floor — longer across the raid's wide pit. */
  private throwTravel(): number {
    // GOOPLIATH throws nothing: his "throw" is the surge, started so its
    // peak lands on the beat.
    if (this.goop) return DELIVERY.lungeTime * 0.3;
    return DELIVERY.travel * (this.raid() ? DELIVERY.raidTravelMult : 1);
  }

  /** Where the fist on `arm` is right now (world) — the titan's gauntlet,
   *  or the gel's own fist mass. */
  private fistPos(arm: 0 | 1, out: Vector3): Vector3 {
    if (this.rig) return this.rig.arms[arm].fist.getWorldPosition(out);
    if (this.goop) return this.goop.fistWorld(arm === 0 ? 'left' : 'right', out);
    return out.set(0, 1.5, this.bossZ());
  }

  /**
   * THE DELIVERY: throw zone i's blow. A bolt leaves the fist on the zone's
   * side and lobs onto the TARGET's deck inside the danger (impactOf), due
   * exactly as the zone detonates; the arm swings through as it lets go and
   * the chassis steps in behind it. Zones with no thrown blow (the sweep's
   * scythe, the beam, a volley shot, the conducted recital, the slam's own
   * ghost hammer) are marked done and keep their old path.
   */
  private throwAt(a: ActiveAttack, i: number, remaining: number): void {
    const zone = a.zones[i];
    const seat = a.zoneSeats[i] ?? a.seats[0];
    const impact = a.kind === 'slam' ? null : impactOf(zone);
    if (!impact) {
      a.thrown[i] = 2; // never ask again; the detonation swings as before
      return;
    }
    a.thrown[i] = 1;
    const target = this.seatPoint(seat, impact.x, 0.06, impact.z, new Vector3());
    if (this.goop) {
      this.surgeAt(target, a.time);
      return;
    }
    // THE X's two arms (and any twin landing on one spot) are ONE throw.
    for (let j = 0; j < i; j++) {
      const b = a.bolts[j];
      if (!b || (a.zoneSeats[j] ?? a.seats[0]) !== seat || a.staggers[j] !== a.staggers[i]) continue;
      if (b.target.distanceTo(target) < 0.05) return;
    }
    // The fist on the target's side of the chassis: right-hand vector of a
    // body yawed `ry` (it faces (−sin ry, −cos ry)) is (−cos ry, sin ry).
    const root = this.bossRootPos();
    const ry = this.rig ? this.rig.root.rotation.y : Math.PI;
    const side = (target.x - root.x) * -Math.cos(ry) + (target.z - root.z) * Math.sin(ry);
    const arm = throwingArm(side, a.arm);
    const from = this.fistPos(arm, new Vector3());
    const travel = Math.max(0.08, Math.min(this.throwTravel(), remaining));
    const mine = seat === this.mySeatId();
    a.bolts[i] = new Bolt(this.scene, from, target, travel, DELIVERY.arcLift * from.distanceTo(target), {
      halo: this.def.accent,
      core: 0xffe9c2,
      size: DELIVERY.boltSize,
      trail: (p) => emberBurst(p, 2, true),
    }, !mine);
    this.swingFor(a.kind, zone);
    this.startLunge();
    if (a.time - this.throwSfxAt > 0.05) {
      this.throwSfxAt = a.time;
      sfx.mortarThump();
    }
  }

  /**
   * GOOPLIATH doesn't throw — he MOVES. Each beat of an attack heaves his
   * whole body toward the part of your deck about to burn, so it peaks as
   * the zone goes off: the seesaw rocks him left, right, left in time with
   * the floods, the nova's lurch lands on the burning side, and the gel
   * shudders with every beat. (A raid chord of five decks is one heave,
   * toward the first.)
   */
  private surgeAt(target: Vector3, at: number): void {
    if (at - this.throwSfxAt <= 0.05) return;
    this.throwSfxAt = at;
    this.surgeAim.copy(target);
    this.lungeAge = 0; // every beat is its own heave (the eased step hides the restart)
    if (this.goop) this.goop.sim.agitation = Math.max(this.goop.sim.agitation, DELIVERY.gooShudder);
    sfx.gooWhoosh();
  }

  /** Step the body in behind a throw (the sweep's cut, too): the titan
   *  along its facing, GOOPLIATH toward the hunted fighter. */
  private startLungeAtPrey(): void {
    if (this.goop) {
      this.playerHeadOf(this.faceSeat, this.surgeAim);
      this.surgeAim.y = 0;
    }
    this.startLunge();
  }

  /** Step the chassis in behind a throw. A throw landing while the last
   *  step is still coming IN doesn't restart it — only a settling one. */
  private startLunge(): void {
    if (this.lungeAge >= 0 && this.lungeAge < DELIVERY.lungeTime * 0.3) return;
    this.lungeAge = 0;
  }

  /**
   * GOOPLIATH's telegraphs are his own BODY — a distinct silhouette per
   * attack, stretched so the whip lands exactly ON the detonation: the
   * spinning BACKFIST coils through a sweep's whole charge, BOTH ARMS rear
   * up into the clap for the seesaw, a straight CROSS thrusts down the beam
   * line, and the nova surges up out of an UPPERCUT. (The floor decals stay
   * — the gesture is the far tell, the floor the near one.)
   */
  private goopTelegraph(kind: AttackKind, chargeTime: number, seat: number): void {
    const goop = this.goop;
    if (!goop) return;
    const name: GoopAttackName =
      kind === 'sweep'
        ? 'backfist'
        : kind === 'seesaw'
          ? 'clap'
          : kind === 'beam'
            ? 'cross'
            : kind === 'volley'
              ? 'jab'
              : 'uppercut';
    // The gel clock runs slow (GOOPLIATH.timeScale): rescale its native
    // telegraph so wind-up + charge share one clock and the strike phase
    // begins as the first zone resolves.
    goop.tempoScale = Math.max(0.4, (chargeTime * GOOPLIATH.timeScale) / GOOP_ATTACKS[name].telegraph);
    goop.throwAttack(name, Math.random() < 0.5 ? 'left' : 'right', this.goopSwingTarget(seat, _v));
  }

  /** Where a gesture swing aims: a SHORT lunge toward the marked seat, capped
   *  at gestureReach body-units from his centre. He never stretches across
   *  the arena — the floor zones carry the danger, and a limb that spans the
   *  gap balloons the raymarch bounds (the attack-time frame spike). */
  private goopSwingTarget(seat: number, out: Vector3): Vector3 {
    const root = this.goopRoot!.position;
    this.seatPoint(seat, 0, 0, 0, out);
    out.sub(root);
    out.y = 0;
    const len = out.length() || 1;
    out.multiplyScalar((this.goopScale * GOOPLIATH.gestureReach) / len).add(root);
    out.y = 1.6; // aimed at head height, so the swing still reads as AT you
    return out;
  }

  /** My head's local X (for arm choice when I'm the one being hunted). */
  private headX(): number {
    this.playerHead(_head);
    return _head.x;
  }

  /**
   * The ghost hammer: a translucent accent block + glow hanging over a slam
   * disc. advanceAttack lowers it with the countdown; the crash replaces it.
   * `seat` places it over the TARGET's platform (raid) — y is world-safe
   * because every seat stands at floor height.
   */
  private makeHammerMarker(x: number, z: number, seat: number): Group {
    const s = this.def.scale;
    const g = new Group();
    // The ghost box is CAPPED like the disc it marks — a raid giant would
    // otherwise hang a near-metre block over the pad, reading as a wall you
    // can't possibly step clear of when the true kill zone is far tighter.
    const side = Math.min(0.24 * s, 0.62);
    const block = new Mesh(
      new BoxGeometry(side, side * 0.83, side),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.45,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    g.add(block);
    const halo = glowSprite(this.def.accent, Math.min(0.5 * s, 1.3));
    halo.position.y = -0.05 * s;
    g.add(halo);
    this.seatPoint(seat, x, 0, z, _v);
    g.position.set(_v.x, this.markerStartY(), _v.z);
    this.scene.add(g);
    return g;
  }

  /** Where a ghost hammer starts its descent (well above head height). */
  private markerStartY(): number {
    return 2.1 + this.def.scale * 0.35;
  }

  /** The volley's windup tell: a glow swelling at the pod muzzle while the
   *  shot cooks (advanceAttack scales it with the charge fill). */
  private makeMuzzleGlow(side: -1 | 1): Group {
    const g = new Group();
    g.add(glowSprite(this.def.accent, 0.34));
    this.podPos(side, _v);
    g.position.copy(_v);
    g.scale.setScalar(0.4);
    this.scene.add(g);
    return g;
  }

  /** Aim one beam zone (and its telegraph) at the TARGET, offset sideways.
   *  Beam zones live in MY world — a remote target's head comes off the pose
   *  bus, so every client rakes the strip through the same fighter. */
  private aimBeam(zone: Zone & { kind: 'beam' }, tg: Telegraph, offset: number, seat: number): void {
    this.playerHeadOf(seat, _head);
    // Offsets are lateral in the target's platform frame; approximate with my
    // world X for my own platform, and with the raw head point for a remote
    // one (their strip still lands beside them — the exact axis is cosmetic).
    const px = seat === this.mySeatId() ? clamp(_head.x + offset, -OCTAGON_HALF_WIDTH, OCTAGON_HALF_WIDTH) : _head.x + offset;
    const pz = seat === this.mySeatId() ? clamp(_head.z, -OCTAGON_HALF_DEPTH + 0.1, OCTAGON_HALF_DEPTH - 0.1) : _head.z;
    // Direction from the boss through that point, flattened to XZ.
    const rootPos = this.bossRootPos();
    _v.set(px - rootPos.x, 0, pz - rootPos.z).normalize();
    zone.x = px;
    zone.z = pz;
    zone.dx = _v.x;
    zone.dz = _v.z;
    // Group origin at the NEAR (player-side) end; local −Z runs back
    // toward the titan.
    tg.group.position.set(px + _v.x * 1.5, CAMPAIGN.decalY, pz + _v.z * 1.5);
    tg.group.rotation.y = Math.atan2(_v.x, _v.z); // local −Z → −dir
  }

  private advanceAttack(delta: number): void {
    const a = this.attack!;
    a.time += delta;

    // VULTURE's law: the beam strips FOLLOW their marks until the late lock —
    // dodging early just tells it where you were.
    if (a.tracks && a.time < a.chargeTime * CAMPAIGN.beamLockAt) {
      for (let i = 0; i < a.zones.length; i++) {
        const zone = a.zones[i];
        const tg = a.telegraphs[i];
        if (zone.kind === 'beam' && tg) this.aimBeam(zone, tg, a.beamOffsets[i] ?? 0, a.zoneSeats[i] ?? a.seats[0]);
      }
    }

    // THE RECITAL's blocks fly on the attack clock (their landing IS the
    // step's detonation), and the recital's furniture — quarter lines, the
    // fading step marks — reads the overall charge.
    for (const bf of a.blockfalls) bf?.update(a.time, delta);
    for (const d of a.dressing) d.update(clamp(a.time / a.chargeTime, 0, 1), this.time);
    // THE RECITAL's notes, on the attack clock: the lesson's as each
    // quarter lights, the recital's ahead of each landing (sfx.recitalNote).
    for (const c of a.cues) {
      if (c.fired || a.time < c.at) continue;
      c.fired = true;
      sfx.recitalNote(c.corner, c.hold, c.lesson);
    }

    // Each zone runs its OWN countdown to its own detonation — a marching
    // drumline or a staggered volley reads as a sequence of beats, not one.
    let allDone = true;
    for (let i = 0; i < a.zones.length; i++) {
      if (a.resolved[i]) continue;
      const dueAt = a.chargeTime + a.staggers[i];
      if (a.time >= dueAt) {
        a.resolved[i] = true;
        a.telegraphs[i]?.dispose();
        a.telegraphs[i] = null;
        // The bolt lands as the zone goes off — the strike visual takes over.
        a.bolts[i]?.dispose();
        a.bolts[i] = null;
        // The ghost hammer's hover spot feeds the crash, then it's gone.
        const m = a.markers[i] ?? null;
        this.disposeMarker(m);
        a.markers[i] = null;
        // A landing block crushes NOW — hand its short afterlife to the
        // strike pool so disposing the attack never cuts the crush short.
        const bf = a.blockfalls[i] ?? null;
        if (bf) {
          a.blockfalls[i] = null;
          bf.land();
          let prev = 0;
          this.strikes.push({
            age: 0,
            life: 0.6,
            update(age) {
              bf.update(0, age - prev);
              prev = age;
            },
            dispose() {
              bf.dispose();
            },
          });
        }
        this.detonate(a.kind, a.zones[i], a.zoneSeats[i] ?? a.seats[0], a.thrown[i] === 1);
      } else {
        // A grammar cascade's later steps carry a one-charge WINDOW: the
        // telegraph opens (and its fill runs) only that long before its own
        // landing — the return's read opens as the first pair fires.
        const window = Math.min(a.windows[i] ?? dueAt, dueAt);
        const remaining = dueAt - a.time;
        const fill = clamp(1 - remaining / window, 0, 1);
        // THE DELIVERY: the blow leaves the fist early enough to land on
        // the beat, then flies on its own clock until the zone detonates.
        if (a.thrown[i] === 0 && remaining <= this.throwTravel()) this.throwAt(a, i, remaining);
        const bolt = a.bolts[i];
        if (bolt && !bolt.update(delta)) {
          bolt.dispose();
          a.bolts[i] = null;
        }
        const tg = a.telegraphs[i];
        if (tg) {
          tg.update(fill, this.time);
          // The seesaw shows only the IMMINENT beat and the one after — five
          // panes at once made "which side is next" a shrug; two reads as
          // "THIS side now, THAT side next".
          if (a.zones[i].kind === 'half') tg.group.visible = dueAt - a.time < GOOPLIATH.seesawGap * 1.9;
          else if (a.windows[i] !== undefined) tg.group.visible = remaining <= window;
        }
        const m = a.markers[i];
        const zone = a.zones[i];
        if (m && zone.kind === 'shot') {
          // The muzzle glow rides its pod (the titan sways) and swells.
          this.podPos(zone.side, _v);
          m.position.copy(_v);
          m.scale.setScalar(0.4 + fill * 1.1);
        } else if (m) {
          // Lower the ghost hammer with the countdown — a spinning descent.
          m.position.y = this.markerStartY() * (1 - fill * fill) + 0.55;
          m.rotation.y += delta * 3;
        }
        allDone = false;
      }
    }

    if (allDone && a.time >= a.chargeTime + (a.staggers[a.zones.length - 1] ?? 0) + 0.4) {
      this.disposeAttack();
      this.cooldown = this.attackCooldown();
    }
  }

  /** Seconds until the next attack: enrage quickens it, and every closed
   *  crown loop quickens GOLIATH further — the last loop is a storm. */
  private attackCooldown(): number {
    let mult = this.enraged ? CAMPAIGN.enrageCooldownMult : 1;
    if (this.def.weakPattern === 'crown') {
      mult *= Math.pow(CAMPAIGN.crownHaste, Math.floor(this.cycleIdx / CROWN_RING.length));
    }
    if (this.def.weakPattern === 'body') {
      // GOOPLIATH escalates with damage, not loops — the 300-hit fight winds
      // itself up continuously toward finalHaste instead of plateauing.
      mult *= GOOPLIATH.finalHaste + (1 - GOOPLIATH.finalHaste) * this.bossHpFrac();
    }
    // Difficulty is the outer multiplier: EASY dawdles, BLAZING presses. The
    // pressure lives in the GAP, never the windup (chargeTime is its own knob).
    mult *= this.diff.cooldown;
    // FLOOR the compounding: enrage × (crown/finalHaste) × difficulty could
    // otherwise stack to ~0.2, spamming attacks so fast that the seesaw/surge
    // floods (slabs + particles) pile up and drag the frame — this was the
    // "blazing GOOPLIATH is laggier" tell. Cap the fastest cadence; the gel
    // itself renders no differently, so the effect density was the cost.
    mult = Math.max(0.5, mult);
    return rand(this.def.cooldownMin, this.def.cooldownMax) * mult;
  }

  /** EASY: tally a landed hit toward the stun meter; cross the threshold and
   *  the boss reels — its charging attack drops and its fire holds for a beat.
   *  Authority-side only; guests learn of it from the rst `stn` flag. */
  private tallyStun(): void {
    if (!this.diff.stun || this.phase !== 'fight' || this.stunTimer > 0) return;
    this.stunMeter += 1;
    if (this.stunMeter < BOSS_STUN.hits) return;
    this.stunMeter = 0;
    this.stunTimer = BOSS_STUN.duration;
    this.disposeAttack(); // whatever was charging, it reels NOW
    this.cooldown = this.attackCooldown() + 0.3;
    this.flinch = 0.6;
    this.hud.title('STUNNED', '', this.accentCss());
    this.cardTimer = 1.2;
    if (this.goopStage) {
      if (this.goop) this.goop.sim.agitation = 1;
      sfx.gooWobble(1);
    } else {
      sfx.armorClank();
    }
  }

  /** Live boss health fraction (0..1). */
  private bossHpFrac(): number {
    const boss = this.ensureBoss();
    return (boss.getValue(Health, 'current') ?? 1) / (boss.getValue(Health, 'max') ?? 1);
  }

  /** How many halves the seesaw floods this swing — grows by health quarter:
   *  fresh he rocks the platform twice; in the last quarter, five times. */
  private seesawStages(): number {
    const table = GOOPLIATH.seesawStages;
    const frac = this.bossHpFrac();
    const idx = frac > 0.75 ? 0 : frac > 0.5 ? 1 : frac > 0.25 ? 2 : 3;
    // BLAZING rocks one extra half per swing, at every health quarter.
    const extra = this.activeDifficulty() === 'blazing' ? 1 : 0;
    return (table[Math.min(idx, table.length - 1)] ?? 2) + extra;
  }

  /** A zone goes off: strike visual + sound on the TARGET's platform, and
   *  damage only if the zone is MINE and I'm in it. (A volley zone
   *  "detonating" is its LAUNCH — the shot judges itself in updateShots.) */
  private detonate(kind: AttackKind | GrammarKind, zone: Zone, seat: number, thrown = false): void {
    const mine = seat === this.mySeatId();
    const hit = mine && this.zoneTouchesPlayer(zone);

    // A thrown zone already swung its arm when the bolt left the fist.
    if (!thrown) this.swingFor(kind, zone);

    // THE ENCORE's zones detonate by SHAPE (one grammar move mixes several).
    if (zone.kind === 'lane' || zone.kind === 'rail') {
      sfx.beamBlast();
      this.spawnStripStrike(zone, seat);
    } else if (zone.kind === 'gate') {
      sfx.slamImpact();
      sfx.beamBlast();
      this.spawnGateStrike(zone, seat);
    } else if (zone.kind === 'ring') {
      sfx.slamImpact();
      sfx.beamBlast();
      this.spawnRingStrike(zone, seat);
    } else if (zone.kind === 'quad') {
      sfx.slamImpact(); // the block crush (advanceAttack) carries the visual
    } else if (zone.kind === 'sweep' && (GRAMMAR_KINDS as readonly string[]).includes(kind)) {
      // The duckdonut's blade / the swept recital — the classic cut.
      sfx.sweepWhoosh();
      this.spawnBladeSweep(zone.y, this.attack!.arm, seat);
      this.startLungeAtPrey();
    } else if (kind === 'slam') {
      sfx.slamImpact();
      if (zone.kind === 'circle') this.spawnFistCrash(zone.x, zone.z, seat);
    } else if (kind === 'sweep') {
      sfx.sweepWhoosh();
      if (zone.kind === 'sweep') this.spawnBladeSweep(zone.y, this.attack!.arm, seat);
      // (GOOPLIATH already coiled through the charge — his backfist telegraph
      // whips through on this beat; see goopTelegraph.) The chassis steps
      // into the cut — the scythe is its reach.
      this.startLungeAtPrey();
    } else if (kind === 'beam') {
      sfx.beamBlast();
      if (zone.kind === 'beam') this.spawnBeamColumn(zone);
    } else if (kind === 'nova') {
      sfx.beamBlast();
      sfx.slamImpact();
      if (zone.kind === 'nova') this.spawnNovaWave(zone.angle, zone.halfAngle, seat);
      // (GOOPLIATH's uppercut telegraph surges the wave out on this beat.)
    } else if (kind === 'seesaw' || kind === 'surge') {
      if (this.goop) sfx.gooSlam();
      else sfx.slamImpact();
      if (zone.kind === 'half') this.spawnHalfFlood(zone.side, seat, zone.axis);
    } else if (zone.kind === 'shot') {
      this.launchShot(zone.side, seat);
    }

    if (hit && this.invuln <= 0) {
      this.invuln = 0.7;
      this.damagePlayer(CAMPAIGN.attackDamage);
    }
  }

  /**
   * The body's half of a strike: which arm(s) swing through and in what
   * shape. Fires at the detonation — or, for a THROWN zone, as the bolt
   * leaves the fist (throwAt), so the follow-through and the throw are one
   * motion and the blow flies out of the swing rather than after it.
   */
  private swingFor(kind: AttackKind | GrammarKind, zone: Zone): void {
    const a = this.attack;
    if (!a) return;
    // The gesture keeps its promise: a grammar landing SWINGS the arm(s)
    // its windup raised (campaign/gestures.ts) — once per landing beat, not
    // once per seat, so a raid's five-deck chord is one swing, one sound.
    if ((GRAMMAR_KINDS as readonly string[]).includes(kind)) {
      const gshape = kind === 'recital' && zone.kind === 'quad'
        ? 'conduct' // the recital's landings are conducted — the body never points at the answer
        : gestureShapeOf(kind, zone);
      if (gshape && a.time - this.swingAt > 0.05) {
        this.swingAt = a.time;
        const focus = gestureFocusOf(zone);
        this.swingShape = gshape;
        this.swingFocus = focus;
        const both = gshape === 'x' || gshape === 'scissor' || gshape === 'press' || gshape === 'ring';
        const arm: 0 | 1 = focus.side === 0 ? a.arm : armFor(focus.side);
        if (both) this.strikeSwing[0] = this.strikeSwing[1] = 0.6;
        else this.strikeSwing[arm] = 0.6;
        if (gshape === 'press') sfx.clap(); // the gauntlets meet either side of the gap
        else if (gshape === 'ring') sfx.fistBump(); // the overhead hands part with a DONK
      }
      return;
    }
    if (kind === 'slam') {
      this.swingShape = 'hammer';
      this.swingFocus = { side: 0, fwd: 0, arm: a.arm };
      this.strikeSwing[a.arm] = 0.6;
      // A multi-platform slam alternates fists, landing to landing — both
      // hoisted hammers visibly take their turns.
      if (a.seats.length > 1) a.arm = (a.arm === 0 ? 1 : 0) as 0 | 1;
    } else if (kind === 'sweep') {
      this.swingShape = 'scythe';
      this.swingFocus = { side: 0, fwd: 0, arm: a.arm };
      this.strikeSwing[a.arm] = 0.6;
      // The squad sweep: the titan whips through a FULL TURN while the blade
      // cascades around the arc — re-armed per landing so the spin carries
      // through the whole cut.
      if (this.raid() && a.seats.length > 1) {
        this.spinT = Math.max(this.spinT, 0.5);
        this.strikeSwing[a.arm === 0 ? 1 : 0] = 0.6; // both arms follow through
      }
    } else if (kind === 'beam') {
      // The cannon KICKS on the shot.
      this.swingShape = 'cannon';
      this.swingFocus = { side: 0, fwd: 0, arm: a.arm };
      this.strikeSwing[a.arm] = 0.6;
    } else if (kind === 'nova') {
      // The coil is THROWN wide.
      this.swingShape = 'coil';
      this.swingFocus = { side: 0, fwd: 0, both: true };
      this.strikeSwing[0] = this.strikeSwing[1] = 0.6;
    } else if (kind === 'seesaw' || kind === 'surge') {
      // The rig titans' tilt SLAPS the flooding half down and the shove
      // DRIVES; GOOPLIATH keeps his opening gesture as the only swing —
      // per-half limb slams re-ballooned the raymarch bounds on every beat
      // and read as random punching.
      if (!this.goop && zone.kind === 'half') {
        this.swingShape = kind === 'seesaw' ? 'tilt' : 'shove';
        this.swingFocus = zone.axis === 1 ? { side: 0, fwd: zone.side } : { side: zone.side, fwd: 0 };
        this.strikeSwing[0] = this.strikeSwing[1] = 0.6;
      }
    } else if (zone.kind === 'shot') {
      // The launcher JOLTS on every shot.
      this.swingShape = 'launcher';
      this.swingFocus = { side: 0, fwd: 0, both: true };
      this.strikeSwing[0] = this.strikeSwing[1] = 0.45;
    }
  }

  /** Any of the player's three body spheres inside the zone? */
  private zoneTouchesPlayer(zone: Zone): boolean {
    // The nova judges the HEAD alone (angular test) — body spheres trail the
    // head by design, and clipping someone who reached the wedge feels rigged.
    if (zone.kind === 'nova') {
      this.playerHead(_p);
      const ang = Math.atan2(_p.x, _p.z);
      const d = Math.abs(((ang - zone.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d > zone.halfAngle;
    }
    // THE RECITAL judges the HEAD's commitment, like the nova — the body
    // spheres trail the head by design, and a corner you clearly reached
    // must never clip you on a trailing hip.
    if (zone.kind === 'quad') {
      this.playerHead(_p);
      return grammarZoneHit(zone, _p.x, _p.z, 0);
    }
    for (const part of this.queries.playerParts.entities) {
      const obj = part.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_p);
      const r = part.getValue(Hitbox, 'radius') ?? 0.15;
      if (zone.kind === 'circle') {
        const d = Math.hypot(_p.x - zone.x, _p.z - zone.z);
        if (d <= zone.r + r * 0.7) return true;
      } else if (zone.kind === 'beam') {
        // Distance from the sphere to the beam line in XZ.
        const relX = _p.x - zone.x;
        const relZ = _p.z - zone.z;
        const along = relX * zone.dx + relZ * zone.dz;
        const perpX = relX - along * zone.dx;
        const perpZ = relZ - along * zone.dz;
        if (Math.hypot(perpX, perpZ) <= zone.halfW + r * 0.7) return true;
      } else if (zone.kind === 'sweep') {
        if (Math.abs(_p.y - zone.y) <= CAMPAIGN.sweepThickness + r * 0.6) return true;
      } else if (zone.kind === 'half') {
        // Seesaw/surge: any body sphere on the doomed half burns, with a thin
        // forgiveness strip on the centreline so the jump is never a coin
        // flip. (The player origin IS the platform centre.) Seesaw judges x,
        // surge judges z.
        const along = zone.axis === 1 ? _p.z : _p.x;
        if (along * zone.side > GOOPLIATH.seesawSafeLip) return true;
      } else if (zone.kind === 'lane' || zone.kind === 'rail' || zone.kind === 'gate' || zone.kind === 'ring') {
        // THE ENCORE's floor shapes — the grammar's own pure judge.
        if (grammarZoneHit(zone, _p.x, _p.z, r)) return true;
      }
    }
    return false;
  }

  /** Does a bare target-local floor point burn under `zone`'s law? The
   *  probe's check that a delivery never lands on safe ground — the same
   *  tests zoneTouchesPlayer runs, for a point with no body radius. */
  private pointBurns(zone: Zone, x: number, z: number): boolean {
    switch (zone.kind) {
      case 'nova': {
        const d = Math.abs(((Math.atan2(x, z) - zone.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return d > zone.halfAngle;
      }
      case 'circle':
        return Math.hypot(x - zone.x, z - zone.z) <= zone.r;
      case 'half':
        return (zone.axis === 1 ? z : x) * zone.side > GOOPLIATH.seesawSafeLip;
      case 'lane':
      case 'rail':
      case 'gate':
      case 'ring':
      case 'quad':
        return grammarZoneHit(zone, x, z, 0);
      default:
        return true;
    }
  }

  private damagePlayer(amount: number): void {
    const me = fighterAt(0);
    if (!me) return;
    me.setValue(Health, 'current', Math.max(0, (me.getValue(Health, 'current') ?? 0) - amount));
    sfx.hitTaken();
    feedback.playerHitFlash = 1;
    // The blow came from the boss's side of the arena.
    this.playerHead(_p);
    _v.set(this.bossRootPos().x - _p.x, 0.4, this.bossZ() - _p.z).normalize();
    feedback.srcX = _v.x;
    feedback.srcY = _v.y;
    feedback.srcZ = _v.z;
    // THE TAPE: a titan's strike is a body hit from its side of the pit.
    telemetry.hitTaken('body', 0, amount, false, -_v.x, -_v.z);
    pulseHand(this.world.session, 'left', 0.9, 140);
    pulseHand(this.world.session, 'right', 0.9, 140);
  }

  // --- strike visuals ----------------------------------------------------------

  private spawnFistCrash(x: number, z: number, seat: number): void {
    // The hammer LANDS: a solid accent block crashes the last half-metre in
    // a few frames, buries itself in the disc, and erupts — a floor flash,
    // a double burst and a spray of sparks. You SEE the platform get hit.
    // (x, z) are TARGET-local; transform once onto their platform.
    this.seatPoint(seat, x, 0, z, _v);
    const wx = _v.x;
    const wz = _v.z;
    const s = this.def.scale;
    const fist = new Mesh(
      new BoxGeometry(0.26 * s, 0.22 * s, 0.26 * s),
      new MeshBasicMaterial({ color: this.def.accent, transparent: true, opacity: 0.95 }),
    );
    this.scene.add(fist);
    const flash = glowSprite(0xfff3cf, 1.5 * s, 0.95);
    flash.position.set(wx, 0.12, wz);
    flash.visible = false;
    this.scene.add(flash);
    const startY = this.markerStartY() * 0.35 + 0.55; // pick up where the ghost left off
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.7,
      update(age) {
        const drop = Math.min(1, age / 0.08); // near-instant, brutal
        fist.position.set(wx, startY * (1 - drop) + 0.11 * s, wz);
        if (drop >= 1 && !burst) {
          burst = true;
          _v.set(wx, 0.12, wz);
          spawnFireImpact(world, _v, 1, 2.0);
          emberBurst(_v, 34, true);
          flash.visible = true;
        }
        if (burst) {
          const settle = Math.min(1, (age - 0.08) / 0.62);
          (fist.material as MeshBasicMaterial).opacity = 0.95 * (1 - settle);
          flash.material.opacity = 0.95 * (1 - settle) * (1 - settle);
          flash.scale.setScalar(1.5 * s * (1 + settle * 1.6));
        }
      },
      dispose() {
        fist.geometry.dispose();
        (fist.material as MeshBasicMaterial).dispose();
        fist.removeFromParent();
        flash.material.dispose();
        flash.removeFromParent();
      },
    });
  }

  private spawnBladeSweep(y: number, arm: 0 | 1, seat: number): void {
    // The SLICE: a tall glowing blade wall scythes across the whole TARGET
    // platform at the marked height, shedding sparks as it goes — a cut you
    // can watch travel, not a flicker. The travel runs along the target's
    // local X; a remote platform gets the same cut, transformed.
    const s = this.def.scale;
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    const yd = this.seatYawDelta(seat);
    const cos = Math.cos(yd);
    const sin = Math.sin(yd);
    const blade = new Mesh(
      new BoxGeometry(0.09, 0.4, OCTAGON_HALF_DEPTH * 2 + 0.7),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    blade.rotation.y = yd;
    this.scene.add(blade);
    const edge = glowSprite(this.def.accent, 0.5 * s);
    this.scene.add(edge);
    // THE DELIVERY's scythe: a lit haft from the striking fist to the blade
    // for the whole cut, so the blade is visibly the END OF THE ARM sweeping
    // your deck — not a wall that appears on it. (A unit cylinder along +y,
    // stretched and turned onto fist → blade every frame.)
    // GOOPLIATH's is a fat gel tendril (translucent, not lit) that goes
    // to blood with him.
    const gel = !!this.goop;
    const hr = gel ? DELIVERY.gooHaft : 0.04;
    const haft = new Mesh(
      new CylinderGeometry(hr * 0.75, hr * 1.25, 1, gel ? 10 : 8, 1, true),
      new MeshBasicMaterial({
        color: gel && this.enraged ? DELIVERY.gooBlood : this.def.accent,
        transparent: true,
        opacity: 0.75,
        blending: gel ? NormalBlending : AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(haft);
    const fistAt = (out: Vector3): Vector3 => this.fistPos(arm, out);
    const fist = new Vector3();
    const from = arm === 0 ? 1 : -1; // the striking arm's side (see yaw)
    const span = OCTAGON_HALF_WIDTH + 0.7;
    let emberClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.42,
      update(age) {
        const k = Math.min(1, age / 0.34); // slow enough to watch it travel
        const bx = from * span * (1 - 2 * k);
        // Target-local (bx, 0) → my world (rotY then translate).
        const wx = cx + bx * cos;
        const wz = cz - bx * sin;
        blade.position.set(wx, y, wz);
        edge.position.set(wx, y, wz);
        (blade.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k * k);
        fistAt(fist);
        _p.set(wx, y, wz).sub(fist);
        const len = _p.length();
        haft.visible = len > 0.05;
        if (haft.visible) {
          haft.position.copy(fist).addScaledVector(_p, 0.5);
          haft.quaternion.setFromUnitVectors(_up, _p.multiplyScalar(1 / len));
          haft.scale.set(1, len, 1);
          (haft.material as MeshBasicMaterial).opacity = 0.75 * (1 - k * k * k);
        }
        // Sparks shed along the cut.
        if (age > emberClock) {
          emberClock = age + 0.045;
          const zr = rand(-OCTAGON_HALF_DEPTH, OCTAGON_HALF_DEPTH);
          _v.set(cx + bx * cos + zr * sin, y - 0.1, cz - bx * sin + zr * cos);
          emberBurst(_v, 4, true);
        }
      },
      dispose() {
        blade.geometry.dispose();
        (blade.material as MeshBasicMaterial).dispose();
        blade.removeFromParent();
        edge.material.dispose();
        edge.removeFromParent();
        haft.geometry.dispose();
        (haft.material as MeshBasicMaterial).dispose();
        haft.removeFromParent();
      },
    });
  }

  private spawnBeamColumn(zone: Zone & { kind: 'beam' }): void {
    // A blinding column from the boss's eyes raking down the strip — the
    // titan's visor, or the gel's own hot amber stare.
    if (this.rig) this.rig.head.getWorldPosition(_v);
    else this.goop!.headWorld(_v);
    const from = _v.clone();
    const to = new Vector3(zone.x - zone.dx * 1.2, 0.05, zone.z - zone.dz * 1.2);
    const far = new Vector3(zone.x + zone.dx * 1.6, 0.05, zone.z + zone.dz * 1.6);
    const len = from.distanceTo(far);
    const beam = new Mesh(
      new CylinderGeometry(0.07, 0.12, len, 10),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.position.copy(from).add(far).multiplyScalar(0.5);
    beam.lookAt(far);
    beam.rotateX(Math.PI / 2); // cylinder axis onto the look direction
    this.scene.add(beam);
    const world = this.world;
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.35,
      update(age) {
        if (!burst) {
          burst = true;
          spawnFireImpact(world, to, 1);
          spawnFireImpact(world, far, 1);
        }
        (beam.material as MeshBasicMaterial).opacity = 0.9 * (1 - (age / 0.35) ** 2);
      },
      dispose() {
        beam.geometry.dispose();
        (beam.material as MeshBasicMaterial).dispose();
        beam.removeFromParent();
      },
    });
  }

  /** The nova lands: fire sweeps the TARGET's platform, sparing only the
   *  wedge. `angle` is target-local; the whole show is transformed onto
   *  their platform (the DECREE fires one of these per raider at once). */
  private spawnNovaWave(angle: number, halfAngle: number, seat: number): void {
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    const yd = this.seatYawDelta(seat);
    const cos = Math.cos(yd);
    const sin = Math.sin(yd);
    const ring = new Mesh(
      new CylinderGeometry(1, 1, 0.06, 32, 1, true),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2, // DoubleSide — the open tube must show both faces
      }),
    );
    ring.position.set(cx, 0.1, cz);
    this.scene.add(ring);
    const world = this.world;
    let burstClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.45,
      update(age) {
        const k = Math.min(1, age / 0.38);
        ring.scale.set(0.15 + k * CAMPAIGN.novaRadius, 1, 0.15 + k * CAMPAIGN.novaRadius);
        (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
        // Fire erupts along the expanding front — everywhere but the wedge.
        if (age > burstClock) {
          burstClock = age + 0.05;
          for (let i = 0; i < 3; i++) {
            const a = rand(-Math.PI, Math.PI);
            const d = Math.abs(((a - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (d <= halfAngle) continue; // the safe ground stays safe
            const rr = 0.15 + k * CAMPAIGN.novaRadius * 0.85;
            const lx = Math.sin(a) * rr;
            const lz = Math.cos(a) * rr;
            _v.set(cx + lx * cos + lz * sin, 0.12, cz - lx * sin + lz * cos);
            emberBurst(_v, 6, true);
            if (i === 0 && k > 0.4) spawnFireImpact(world, _v, 1, 0.8);
          }
        }
      },
      dispose() {
        ring.geometry.dispose();
        (ring.material as MeshBasicMaterial).dispose();
        ring.removeFromParent();
      },
    });
  }

  /** The seesaw/surge lands: a tide floods the doomed half — a slab of light,
   *  fire along the deck, and wet splats stamped where it hit. All target-
   *  local, transformed to the marked seat's platform. `axis` 0 = x split
   *  (seesaw), 1 = z split (surge) — the whole show turns a quarter turn. */
  /** A shared strip-of-fire landing: a glowing slab flashes over the strip
   *  and settles into the deck with a run of embers — the lane's and the
   *  rail's detonation (THE ENCORE's laser shapes). */
  private spawnStripStrike(zone: Zone & ({ kind: 'lane' } | { kind: 'rail' }), seat: number): void {
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    // Lane: a strip down local z at x (plus THE X's yaw). Rail: across at z.
    const lane = zone.kind === 'lane';
    const yd =
      this.seatYawDelta(seat) + (lane ? (zone.yaw ?? 0) : Math.PI / 2);
    const off = lane ? zone.x : zone.z;
    const halfW = lane ? zone.halfW : zone.halfD;
    const len = (lane ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) * 2 + 0.6;
    const cos = Math.cos(yd);
    const sin = Math.sin(yd);
    const slab = new Mesh(
      new BoxGeometry(halfW * 2, 0.6, len),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    slab.rotation.y = yd;
    // The strip's perpendicular offset, rotated into world (lane offsets run
    // local x; the rail's quarter-turn folds its z offset onto the same axis).
    const ox = lane ? off : -off;
    slab.position.set(cx + ox * cos, 0.3, cz - ox * sin);
    this.scene.add(slab);
    let burstClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.45,
      update(age) {
        const k = Math.min(1, age / 0.4);
        (slab.material as MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
        slab.scale.y = 1 - 0.6 * k;
        if (age > burstClock) {
          burstClock = age + 0.08;
          const along = rand(-len / 2 + 0.2, len / 2 - 0.2);
          _v.set(slab.position.x + along * sin, 0.12, slab.position.z + along * cos);
          emberBurst(_v, 4, true);
        }
      },
      dispose() {
        slab.geometry.dispose();
        (slab.material as MeshBasicMaterial).dispose();
        slab.removeFromParent();
      },
    });
  }

  /** The gate lands: everything EXCEPT the clear band goes up — two slabs
   *  slam the doomed sides, leaving the doorway dark and standing. */
  private spawnGateStrike(zone: Zone & { kind: 'gate' }, seat: number): void {
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    // axis 1 (the row gate) turns the whole picture a quarter, like its
    // telegraph — extents swap so the platform stays covered.
    const yd = this.seatYawDelta(seat) + (zone.axis ? Math.PI / 2 : 0);
    const cos = Math.cos(yd);
    const sin = Math.sin(yd);
    const span = (zone.axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.2;
    const depth = (zone.axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH) * 2 + 0.3;
    const at = zone.axis ? -zone.at : zone.at; // the quarter turn mirrors x
    const slabs: Mesh[] = [];
    for (const side of [-1, 1] as const) {
      // Each doomed stretch runs from the gap's edge to the deck rim.
      const edge = at + side * zone.half;
      const rim = side * span;
      const w = Math.max(0, (rim - edge) * side);
      if (w < 0.05) continue;
      const mid = (edge + rim) / 2;
      const slab = new Mesh(
        new BoxGeometry(w, 0.55, depth),
        new MeshBasicMaterial({
          color: this.def.accent,
          transparent: true,
          opacity: 0.7,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      slab.rotation.y = yd;
      slab.position.set(cx + mid * cos, 0.28, cz - mid * sin);
      this.scene.add(slab);
      slabs.push(slab);
    }
    let burst = false;
    this.strikes.push({
      age: 0,
      life: 0.45,
      update(age) {
        const k = Math.min(1, age / 0.4);
        if (!burst) {
          burst = true;
          for (const s of slabs) {
            _v.copy(s.position);
            _v.y = 0.15;
            emberBurst(_v, 10, true);
          }
        }
        for (const s of slabs) {
          (s.material as MeshBasicMaterial).opacity = 0.7 * (1 - k * k);
          s.scale.y = 1 - 0.6 * k;
        }
      },
      dispose() {
        for (const s of slabs) {
          s.geometry.dispose();
          (s.material as MeshBasicMaterial).dispose();
          s.removeFromParent();
        }
      },
    });
  }

  /** The donut's rim comes down: a ring wall at the safe disc's edge flares
   *  and collapses outward while the doomed rim burns — the middle lives. */
  private spawnRingStrike(zone: Zone & { kind: 'ring' }, seat: number): void {
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    const wall = new Mesh(
      new CylinderGeometry(zone.innerR, zone.innerR, 0.7, 40, 1, true),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.8,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    wall.position.set(cx, 0.35, cz);
    this.scene.add(wall);
    const world = this.world;
    const innerR = zone.innerR;
    let burstClock = 0;
    this.strikes.push({
      age: 0,
      life: 0.5,
      update(age) {
        const k = Math.min(1, age / 0.45);
        // The wall of fire sweeps OUT across the doomed rim and dies at it.
        wall.scale.setScalar(1 + k * 1.6);
        wall.scale.y = 1 - 0.5 * k;
        (wall.material as MeshBasicMaterial).opacity = 0.8 * (1 - k * k);
        if (age > burstClock) {
          burstClock = age + 0.07;
          const a = rand(0, Math.PI * 2);
          const r = innerR * (1 + k * 1.4) + rand(0, 0.15);
          _v.set(cx + Math.sin(a) * r, 0.12, cz + Math.cos(a) * r);
          emberBurst(_v, 4, true);
          if (k > 0.25 && k < 0.5) spawnFireImpact(world, _v, 1, 0.6);
        }
      },
      dispose() {
        wall.geometry.dispose();
        (wall.material as MeshBasicMaterial).dispose();
        wall.removeFromParent();
      },
    });
  }

  private spawnHalfFlood(side: -1 | 1, seat: number, axis: 0 | 1): void {
    this.seatPoint(seat, 0, 0, 0, _v);
    const cx = _v.x;
    const cz = _v.z;
    const yd = this.seatYawDelta(seat) + (axis ? -Math.PI / 2 : 0); // match the telegraph's turn
    const cos = Math.cos(yd);
    const sin = Math.sin(yd);
    // Extents in the (pre-rotation) local frame: w spans the SPLIT axis, d the
    // other — swapped for a surge so the platform stays covered after the turn.
    const w = (axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
    const halfOther = axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH;
    const d = halfOther * 2 + 0.3;
    const slab = new Mesh(
      new BoxGeometry(w, 0.5, d),
      new MeshBasicMaterial({
        color: this.def.accent,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    slab.rotation.y = yd;
    const lx = (side * w) / 2;
    slab.position.set(cx + lx * cos, 0.26, cz - lx * sin);
    this.scene.add(slab);
    const world = this.world;
    const fx = this.goopFx;
    let burstClock = 0;
    let splatted = false;
    this.strikes.push({
      age: 0,
      life: 0.5,
      update(age) {
        const k = Math.min(1, age / 0.42);
        (slab.material as MeshBasicMaterial).opacity = 0.55 * (1 - k * k);
        slab.scale.y = 1 - 0.7 * k; // the wave settles into the deck
        if (!splatted) {
          // Wet evidence stamped once, where the tide came down.
          splatted = true;
          for (let i = 0; i < 3; i++) {
            const sx = side * rand(0.15, w - 0.2);
            const sz = rand(-halfOther * 0.8, halfOther * 0.8);
            _v.set(cx + sx * cos + sz * sin, 0.02, cz - sx * sin + sz * cos);
            fx?.splat(_v, rand(0.3, 0.55));
          }
        }
        if (age > burstClock) {
          // Kept lean — this is the boss's busiest beat, and particle spam
          // here stacks on top of the gel's own swing cost.
          burstClock = age + 0.09;
          const sx = side * rand(0.1, w - 0.2);
          const sz = rand(-halfOther, halfOther);
          _v.set(cx + sx * cos + sz * sin, 0.12, cz - sx * sin + sz * cos);
          emberBurst(_v, 4, true);
          if (k > 0.3 && k < 0.55) spawnFireImpact(world, _v, 1, 0.7);
        }
      },
      dispose() {
        slab.geometry.dispose();
        (slab.material as MeshBasicMaterial).dispose();
        slab.removeFromParent();
      },
    });
  }

  private updateStrikes(delta: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.age += delta;
      if (s.age >= s.life) {
        s.dispose();
        this.strikes.splice(i, 1);
      } else {
        s.update(s.age);
      }
    }
  }

  // --- titan animation ---------------------------------------------------------

  /**
   * The gesture the body should be making NOW (campaign/gestures.ts): the
   * shape, focus and read fill of a grammar attack's next pending landing.
   * Null for the classic kinds (their windups live in animateTitan) and
   * with no attack. Between a cascade's steps — the next window not yet
   * open — fill is 0, so the arms ease home and wind up again for the next
   * read, which is exactly the rhythm RAVE RAID's bosses had.
   */
  private pendingGesture(): { shape: GestureShape; fill: number; focus: GestureFocus; seat: number } | null {
    const a = this.attack;
    if (!a) return null;
    if (!(GRAMMAR_KINDS as readonly string[]).includes(a.kind)) {
      // A CLASSIC kind: its own shape on the same joints (gestures.ts —
      // the slam's hammer, the sweep's scythe, the beam's cannon, the
      // volley's launcher, the nova's coil, the seesaw's tilt, the surge's
      // shove), read off the whole windup: the classic reads are one
      // charge, no cascade windows. The chosen arm and a multi-target
      // pair ride the focus; a flood's doomed half steers the tilt/shove.
      const shape = CLASSIC_SHAPE[a.kind];
      if (!shape) return null;
      const fill = clamp(a.time / a.chargeTime, 0, 1);
      const focus: GestureFocus = { side: 0, fwd: 0, arm: a.arm, both: a.seats.length > 1 };
      for (let i = 0; i < a.zones.length; i++) {
        const z = a.zones[i];
        if (a.resolved[i] || z.kind !== 'half') continue;
        if (z.axis === 1) focus.fwd = z.side;
        else focus.side = z.side;
        break;
      }
      return { shape, fill, focus, seat: a.seats[0] };
    }
    let best = -1;
    let bestDue = Infinity;
    for (let i = 0; i < a.zones.length; i++) {
      if (a.resolved[i]) continue;
      const due = a.chargeTime + a.staggers[i];
      if (due < bestDue) {
        bestDue = due;
        best = i;
      }
    }
    if (best < 0) return null;
    const zone = a.zones[best];
    if (a.kind === 'recital' && zone.kind === 'quad' && a.lesson) {
      const seat = a.zoneSeats[best] ?? a.seats[0];
      if (a.time < a.chargeTime) {
        // THE LESSON: the king points at each taught quarter as it lights
        // (a palm for a hold), then conducts the breath before the recital.
        const i = Math.floor(a.time / a.lesson.stepSecs);
        const p = zone.pattern[i];
        if (i < a.lesson.steps && p !== undefined) {
          // Up within the slot's first third and HELD to its end: the arm
          // sweeps from quarter to quarter (the ease carries it across).
          const fill = clamp(a.time / (0.3 * a.lesson.stepSecs), 0, 1);
          return { shape: 'teach', fill, focus: gestureFocusOf({ kind: 'quad', corner: p, hold: zone.holds[i] }), seat };
        }
        return { shape: 'conduct', fill: 1, focus: { side: 0, fwd: 0 }, seat };
      }
      // THE RECITAL: conducted. The body never points at the answer; a
      // hold shows the palm, and the fill runs per step.
      const window = Math.min(a.windows[best] ?? bestDue, bestDue);
      const fill = clamp(1 - (bestDue - a.time) / window, 0, 1);
      return { shape: 'conduct', fill, focus: { side: 0, fwd: 0, hold: zone.hold }, seat };
    }
    const shape = gestureShapeOf(a.kind, zone);
    if (!shape) return null;
    const window = Math.min(a.windows[best] ?? bestDue, bestDue);
    const fill = clamp(1 - (bestDue - a.time) / window, 0, 1);
    return { shape, fill, focus: gestureFocusOf(zone), seat: a.zoneSeats[best] ?? a.seats[0] };
  }

  private animateTitan(delta: number): void {
    const rig = this.rig!;
    const fighting = this.phase === 'fight';
    // A grammar move's gesture, once per frame: the pose drives the arms,
    // the root's lean and lift, and where the head looks.
    const gest = fighting ? this.pendingGesture() : null;
    const temper = gestureTemper(this.def.style);
    const pose = gest ? grammarGesture(gest.shape, gest.fill, gest.focus, this.time / (this.def.beat ?? 0.5), temper.amp) : null;

    // Idle drift + hover bob — fight only: the entrance and the fall own
    // the root transform outright (a sway lerp would drag the vulture's
    // swoop back to centre, and the flinch snap would erase the fortress's
    // roll-in). Enraged machines pace.
    if (fighting) {
      // Last frame's lunge comes off first, so the sway eases the true x.
      rig.root.position.x -= this.lungeOff.x;
      const swayRate = this.enraged ? 0.85 : 0.45;
      const sway = Math.sin(this.time * swayRate) * this.def.swayAmp;
      rig.root.position.x += (sway - rig.root.position.x) * Math.min(1, delta * 1.6);
      rig.root.position.y = (Math.sin(this.time * 1.1) * 0.04 + (pose?.rise ?? 0)) * this.def.scale;
    }

    // Flinch: the whole chassis rocks back when the core takes fire.
    this.flinch = Math.max(0, this.flinch - delta);
    if (fighting) {
      rig.root.position.z = this.bossZ() + (this.flinch > 0 ? -0.18 * (this.flinch / 0.35) : 0);
    }

    // THE DELIVERY's step: every throw carries the whole chassis in along
    // its facing and back — the blow comes from a body that MEANT it.
    // (rotation.y faces (−sin ry, −cos ry).)
    this.stepLunge(delta, fighting, rig.root.position, -Math.sin(rig.root.rotation.y), -Math.cos(rig.root.rotation.y));

    // RAID: the whole machine squares up to whoever it's hunting — the body
    // yaw eases toward the CENTROID of the marked platforms (one raider: dead
    // at them; the whole squad: the middle of the arc), so everyone can READ
    // where the next strike is going. A squad sweep overrides everything
    // with a full-turn lash while the blade cascades. Solo keeps the π yaw.
    if (fighting && this.raid()) {
      if (this.spinT > 0) {
        this.spinT -= delta;
        rig.root.rotation.y += delta * RAID.sweepSpinRate;
      } else {
        const seats = this.attack?.seats ?? [this.faceSeat];
        let cx = 0;
        let cz = 0;
        for (const s of seats) {
          this.seatPoint(s, 0, 0, 0, _p);
          cx += _p.x;
          cz += _p.z;
        }
        cx /= seats.length;
        cz /= seats.length;
        const targetYaw = Math.atan2(-(cx - rig.root.position.x), -(cz - rig.root.position.z));
        let dy = targetYaw - rig.root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        rig.root.rotation.y += dy * Math.min(1, delta * 3.2);
      }
    }

    // The body LEANS into a gesture (pitch toward the player is +X under the
    // π yaw) — a hair, eased, and only in the fight: the entrance and the
    // fall own the root transform outright.
    if (fighting) {
      rig.root.rotation.x += ((pose?.lean ?? 0) - rig.root.rotation.x) * Math.min(1, delta * 5);
    }

    // The head tracks its prey (lookAt aims +Z; the visor lives on −Z, flip)
    // — unless the gesture says LOOK THERE: the pointing shapes turn the
    // gaze from the player toward the marked spot as the read fills, so the
    // titan visibly eyes the lane / the corner / the gap before it burns.
    this.playerHeadOf(fighting ? this.faceSeat : this.mySeatId(), _head);
    if (gest && pose && pose.gaze > 0) {
      this.seatPoint(gest.seat, gest.focus.side * 0.6, 1.0, gest.focus.fwd * 0.5, _v);
      _head.lerp(_v, pose.gaze * gest.fill * 0.8);
    }
    rig.head.lookAt(_head.x, _head.y, _head.z);
    rig.head.rotateY(Math.PI);

    // VULTURE's wings are REACTIVE once the fight starts: mantled at rest,
    // snapping open with every telegraph (riding the charge), flaring on a
    // flinch, and carrying a restless flutter when enraged. The entrance
    // ceremony owns them before this (held at full span in entrancePose).
    if (rig.wings.length > 0 && fighting) {
      const charge = this.attack ? clamp(this.attack.time / this.attack.chargeTime, 0, 1) : 0;
      const target = Math.max(charge * 0.85, this.flinch > 0 ? 0.6 : 0, this.enraged ? 0.3 : 0);
      // Snap open fast, settle back slow — a bird's flare, not a servo.
      this.wingSpread += (target - this.wingSpread) * Math.min(1, delta * (target > this.wingSpread ? 10 : 3));
      const flutter = Math.sin(this.time * 2.3) * 0.02 + (this.enraged ? Math.sin(this.time * 11) * 0.05 : 0);
      const spread = clamp(this.wingSpread + flutter, 0, 1);
      for (const w of rig.wings) {
        w.group.rotation.y = w.side * (0.35 - 0.3 * spread);
        w.group.rotation.z = w.side * (0.5 - 0.35 * spread);
        w.wrist.rotation.z = w.side * (0.55 - 0.45 * spread);
      }
    }

    // Whatever is vulnerable BLINKS — a hard on/off wink, not a breath, so
    // it reads as a signal: the head's visor tell, the chest core, the low
    // emblem. Beams still superheat the eye while they cook; enrage keeps
    // the eye furious throughout.
    const lit = fighting ? this.litPoints() : [];
    const wink = this.time % 0.5 < 0.3 ? 1 : 0;
    const beamCharging = this.attack?.kind === 'beam' ? clamp(this.attack.time / this.attack.chargeTime, 0, 1) : 0;
    // The eye blink is the loudest tell in the fight: near-dark on the off
    // beat, a flare on the on beat — a hard strobe you can't miss.
    rig.visorMat.emissiveIntensity =
      (lit.includes('head') ? 0.25 + wink * 4.6 : 0.7) +
      beamCharging * 3.2 +
      (this.enraged ? 1.6 + Math.sin(this.time * 10) * 0.6 : 0);
    // Emissive intensity alone can't blacken a PAINTED lamp: the eye's base
    // colour keeps it lit by the room whatever the glow does (PISTONKAISER's
    // amber read as "the same shade of yellow" on and off beat). Shade the
    // paint WITH the glow — near-black on the off beat, full accent on the
    // flare — so the blink is unmissable on every chassis.
    _eyeAccent.setHex(this.def.accent);
    _eyeShade
      .setHex(0x0c0d11)
      .lerp(_eyeAccent, clamp(rig.visorMat.emissiveIntensity / 3.2, 0.06, 1));
    rig.visorMat.color.copy(_eyeShade);
    // The eye lamps SCALE with the blink too, like the core's pulse — colour
    // alone still hides on small lamps (PISTONKAISER's flat face especially).
    const headLit = lit.includes('head');
    for (const eye of rig.eyes) eye.scale.setScalar(headLit ? 1 + wink * 0.3 : 1);

    // Beam charge: a flare orb WELLS UP around the whole head while the laser
    // cooks — swelling past the skull, throbbing harder near firing — and the
    // arena key light surges with it, so the wind-up reads from anywhere.
    const eyeFx = rig.eyeFx;
    if (beamCharging > 0) {
      eyeFx.visible = true;
      const throb = 1 + Math.sin(this.time * 26) * (0.1 + 0.22 * beamCharging);
      eyeFx.scale.setScalar((0.5 + beamCharging * 2.6) * throb);
      (eyeFx.material as MeshStandardMaterial).opacity = 0.35 + beamCharging * 0.5;
      if (fighting) this.light.intensity = 5 + beamCharging * 8 * throb;
    } else {
      eyeFx.visible = false;
      if (fighting) this.light.intensity = 5; // settle after the surge
    }
    const coreLit = lit.includes('core');
    rig.coreMat.emissiveIntensity = coreLit ? 0.5 + wink * 2.8 : 0.25;
    rig.core.scale.setScalar(coreLit ? 1 + wink * 0.16 : 1);
    const lowLit = lit.includes('low');
    rig.lowMat.emissiveIntensity = lowLit ? 0.5 + wink * 2.8 : 0.2;
    rig.low.scale.setScalar(lowLit ? 1 + wink * 0.18 : 1);
    for (const [i, spot] of (['shoulderL', 'shoulderR'] as const).entries()) {
      const on = lit.includes(spot);
      // The shoulder lamps sit small and off to the sides, so they get the
      // LOUDEST strobe of all the tells — near-dark to a hard flare, and a
      // big scale pulse — or GOLIATH's ring stop is easy to miss.
      rig.shoulderMats[i].emissiveIntensity = on ? 0.2 + wink * 6.0 : 0.2;
      rig.shoulders[i].scale.setScalar(on ? 1 + wink * 0.55 : 1);
    }

    // Pods glow while a volley cooks.
    const volleying = this.attack?.kind === 'volley';
    for (const mat of rig.podMats) {
      mat.emissiveIntensity += ((volleying ? 2.4 : 0.2) - mat.emissiveIntensity) * Math.min(1, delta * 6);
    }

    // Arms: wind up with the charge, whip through on the strike, ease home.
    // The sweep winds OUT wide and whips ACROSS; the slam hoists sky-high
    // and hammers DOWN — two silhouettes you can tell apart at a glance.
    for (const i of [0, 1] as const) {
      const arm = rig.arms[i];
      this.strikeSwing[i] = Math.max(0, this.strikeSwing[i] - delta);
      let targetX = arm.restX;
      let targetZ = arm.restZ;
      // The joints past the shoulder — ELBOW, WRIST, the hand's CURL — are
      // absolute targets, at rest unless a gesture or a strike says
      // otherwise (gestures.ts ARM_REST).
      let elbow: number = ARM_REST.elbow;
      let wrist: number = ARM_REST.wrist;
      let curl: number = ARM_REST.curl;
      // EVERY kind is a gesture now (gestures.ts): the shape's windup
      // pose, blended under any live follow-through — a cascade's step
      // fires while the next read opens, and the strike decays into the
      // next windup instead of cutting it. The classics' multi-target
      // windups (a two-fisted hoist over a pair of marked platforms, the
      // wide double wind-out before the squad sweep's full-turn lash) ride
      // the focus's `both`.
      const swingK = this.strikeSwing[i] > 0 ? this.strikeSwing[i] / 0.6 : 0;
      // A strike OWNS the arms its follow-through moves. The others — the
      // hand bracing the cannon's elbow, the scythe's counterweight, the
      // hoisted pair's idle twin — used to be handed a rest target the
      // instant the landing fired, and snapped home at strike speed: the
      // "hands teleport back to their sides". They come home from where
      // their windup left them now, over the swing, at the easy rate.
      const ft = swingK > 0 ? grammarFollowThrough(this.swingShape, swingK, i, this.swingFocus)[i] : null;
      const owned =
        !!ft &&
        (Math.abs(ft.x) > 1e-6 ||
          Math.abs(ft.z) > 1e-6 ||
          Math.abs(ft.elbow - ARM_REST.elbow) > 1e-6 ||
          Math.abs(ft.wrist - ARM_REST.wrist) > 1e-6 ||
          Math.abs(ft.curl - ARM_REST.curl) > 1e-6);
      if (pose) {
        const w = pose.arms[i];
        this.lastWind[i] = { x: w.x, z: w.z, elbow: w.elbow, wrist: w.wrist, curl: w.curl };
        let px = w.x;
        let pz = w.z;
        elbow = w.elbow;
        wrist = w.wrist;
        curl = w.curl;
        if (ft && owned) {
          px = px * (1 - swingK) + ft.x * swingK;
          pz = pz * (1 - swingK) + ft.z * swingK;
          elbow = elbow * (1 - swingK) + ft.elbow * swingK;
          wrist = wrist * (1 - swingK) + ft.wrist * swingK;
          curl = curl * (1 - swingK) + ft.curl * swingK;
        }
        targetX = arm.restX + px;
        targetZ = arm.restZ + pz;
      } else if (ft && owned) {
        // A landing's follow-through with no windup left to blend under
        // (the move's last beat): the gesture keeps its promise.
        targetX = arm.restX + ft.x;
        targetZ = arm.restZ + ft.z;
        elbow = ft.elbow;
        wrist = ft.wrist;
        curl = ft.curl;
      } else if (swingK > 0) {
        // Not this arm's strike: down from the windup, over the swing.
        const w = this.lastWind[i];
        targetX = arm.restX + w.x * swingK;
        targetZ = arm.restZ + w.z * swingK;
        elbow = ARM_REST.elbow + (w.elbow - ARM_REST.elbow) * swingK;
        wrist = ARM_REST.wrist + (w.wrist - ARM_REST.wrist) * swingK;
        curl = ARM_REST.curl + (w.curl - ARM_REST.curl) * swingK;
      } else if (fighting) {
        // Idle: the elbows breathe and the hands work open and shut a
        // little — a machine ticking over, not a mannequin.
        elbow = ARM_REST.elbow + 0.06 * Math.sin(this.time * 1.3 + i * 2.1);
        curl = ARM_REST.curl + 0.08 * Math.sin(this.time * 0.7 + i);
      }
      // Each chassis snaps at its own speed (the press is all servo) — but
      // only the arm a strike owns snaps; everything else, and the walk
      // home after a move, takes the easy rate.
      const rate = this.strikeSwing[i] > 0.45 && owned ? 26 : pose || swingK > 0 ? 7 : 4;
      const ease = Math.min(1, delta * rate * (pose ? temper.snap : 1));
      // The pose meets the rig through gestures.ts (rigPitch / rigFold), which
      // turns the language's reaches and folds TOWARD the player.
      const pitch = rigPitch(arm.restX, targetX - arm.restX);
      arm.pivot.rotation.x += (pitch - arm.pivot.rotation.x) * ease;
      arm.pivot.rotation.z += (targetZ - arm.pivot.rotation.z) * ease;
      arm.elbow.rotation.x += (rigFold(elbow) - arm.elbow.rotation.x) * ease;
      arm.wrist.rotation.x += (rigFold(wrist) - arm.wrist.rotation.x) * ease;
      this.curl[i] += (curl - this.curl[i]) * ease;
      for (const d of arm.digits) d.node.rotation.x = d.open + (d.closed - d.open) * this.curl[i];
    }
    // THE CLEARANCE GUARD (armGuard.ts): whatever the easing above left
    // mid-flight — the snapping strike arm crossing its ambling twin, a
    // swung-through follow-through handed into THE X — the two fists never
    // fuse on the midline. A no-op on every pose the language holds.
    keepArmsApart(rig.arms, this.def.scale, this.armGuardMemo);
  }

  /**
   * Advance THE DELIVERY's step and put it on `root` along the facing
   * (fx, fz): x comes off first (the caller's sway eased the bare x — see
   * animateTitan) and z is added on top of whatever the caller set this
   * frame. The titan sets its root z every frame; the gel never does, so
   * the gel also takes last frame's z back off (animateGoop).
   */
  private stepLunge(delta: number, fighting: boolean, root: Vector3, fx: number, fz: number, side = 0): void {
    if (this.lungeAge >= 0) {
      this.lungeAge += delta;
      if (this.lungeAge >= DELIVERY.lungeTime) this.lungeAge = -1;
    }
    const target = this.lungeAge >= 0 ? lungeEnvelope(this.lungeAge / DELIVERY.lungeTime) : 0;
    this.lungeCur += (target - this.lungeCur) * Math.min(1, delta * 18);
    this.lungeOff.set(0, 0, 0);
    if (fighting && this.lungeCur > 1e-3) {
      const reach = Math.min(DELIVERY.lunge * this.def.scale, this.goop ? DELIVERY.gooSurge : DELIVERY.lungeMax) * this.lungeCur;
      const len = Math.hypot(fx, fz) || 1;
      // `side`: a sideways shift (m, along the facing's right hand) that
      // rides the same envelope — GOOPLIATH's rock toward the burning half.
      const s = side * this.lungeCur;
      this.lungeOff.set((fx / len) * reach - (fz / len) * s, 0, (fz / len) * reach + (fx / len) * s);
      root.x += this.lungeOff.x;
      root.z += this.lungeOff.z;
    }
  }

  /** The clearance guard's memory (armGuard.ts) — which way it last pushed. */
  private readonly armGuardMemo: GuardMemo = { dir: 0 };

  // --- GOOPLIATH animation --------------------------------------------------------

  /**
   * Drive the gel boss: face the hunted seat, tick the sim on its slowed
   * giant clock (GOOPLIATH.timeScale — a 4-5x body jiggling at man-speed
   * reads as a miniature), and keep the mess pools breathing. The creature's
   * own idle motion, hit reactions and flavour swings do the rest — no
   * chassis choreography needed.
   */
  private animateGoop(delta: number): void {
    const goop = this.goop!;
    const root = this.goopRoot!;
    this.goopFx?.update(delta);
    const fighting = this.phase === 'fight';

    // THE HEAVE (surgeAt): his whole body lurches toward the part of the
    // deck each beat burns, and sinks into it — gel throwing its weight,
    // not a hand letting go. Nothing else sets his root per frame, so last
    // frame's heave comes off before this frame's goes on.
    root.position.sub(this.lungeOff);
    // Forward at the fighter he's hunting; sideways toward the heave's mark,
    // so the seesaw visibly rocks him half to half, not just nods him in.
    this.playerHeadOf(fighting ? this.faceSeat : this.mySeatId(), _head);
    const fx = _head.x - root.position.x;
    const fz = _head.z - root.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const across = ((this.surgeAim.x - root.position.x) * -fz + (this.surgeAim.z - root.position.z) * fx) / fl;
    const side = clamp(across * DELIVERY.gooSway, -DELIVERY.gooSwayMax, DELIVERY.gooSwayMax);
    this.stepLunge(delta, fighting, root.position, fx, fz, side);
    if (fighting) {
      const dip = DELIVERY.gooDip * this.goopScale * this.lungeCur;
      this.lungeOff.y = -dip;
      root.position.y -= dip;
    }

    // Square up to whoever he's hunting. The steering APIs live in the scaled
    // parent's space (the parent never rotates — the creature owns its yaw).
    this.playerHeadOf(fighting ? this.faceSeat : this.mySeatId(), _head);
    _p.copy(_head).sub(root.position).divideScalar(root.scale.x || 1);
    goop.faceToward(_p);

    // A mid-swing limb stretches the raymarch's bounding box across far more
    // of the view — exactly when frame time spikes — so the step budget
    // drops for the swing and snaps back with the limb.
    goop.qualityOverride = goop.isPunching ? GOOPLIATH.attackQuality : GOOPLIATH.quality;

    // THE TIDE RISES in colour too: the gel palette runs to blood as the
    // enrage takes hold (a ~1.4 s bleed-in, not a light switch).
    goop.enrage += ((this.enraged ? 1 : 0) - goop.enrage) * Math.min(1, delta * 2.2);

    goop.update(delta * GOOPLIATH.timeScale, _head);

    if (fighting) {
      // Aim assist rides the head — cosmetic help only; ANY landing counts.
      goop.headWorld(campaign.aimPoint);
      campaign.coreOpen = false;
      // The arena key light surges while a laser cooks (the titan version
      // of this lives in animateTitan).
      const a = this.attack;
      const beamCharging = a?.kind === 'beam' ? clamp(a.time / a.chargeTime, 0, 1) : 0;
      this.light.intensity = 5 + beamCharging * 8;
    }
  }

  // --- weak-point hitboxes -------------------------------------------------------

  private ensureHitboxes(): void {
    // Every weak-point sphere drains the titan's OWN pool — in a raid slot 1
    // is a living raider, and CollisionSystem must never route boss damage
    // through a fighter's Health.
    const owner = this.ensureBoss();
    if (this.boxes.body) {
      this.sizeHitboxes();
      return;
    }
    const make = (): Entity => {
      const e = this.world.createTransformEntity(new Object3D(), { persistent: true });
      e.addComponent(Hitbox, { radius: 0.2, team: 1, owner, damageScale: 0 });
      return e;
    };
    this.boxes.body = make();
    this.boxes.pelvis = make();
    this.boxes.head = make();
    this.boxes.core = make();
    this.boxes.shoulderL = make();
    this.boxes.shoulderR = make();
    this.boxes.pods = [make(), make()];
    this.sizeHitboxes();
  }

  private sizeHitboxes(): void {
    const s = this.def.scale;
    // The armour sphere hugs the VISIBLE chassis (the trunk is only ~0.3·s
    // wide) — an inflated armour sphere used to eat balls out of the air
    // before they could ever reach the core, which made the "hit the core"
    // prompt a lie. The WEAK POINTS are the opposite: fat, BULBOUS spheres
    // that stand proud of the plate from any bearing, not just dead ahead.
    // CollisionSystem awards the best overlapping hitbox by damageScale, so
    // a lit weak point always beats the armour it bulges out of. Raids grow
    // them further still (weakMult): the titan squares up to its current
    // target, so a side seat plays the whole fight at an angle.
    const w = this.raid() ? RAID.weakMult : 1;
    this.boxes.body?.setValue(Hitbox, 'radius', 0.32 * s);
    this.boxes.pelvis?.setValue(Hitbox, 'radius', 0.25 * s * w);
    this.boxes.head?.setValue(Hitbox, 'radius', 0.28 * s * w);
    this.boxes.core?.setValue(Hitbox, 'radius', 0.28 * s * w);
    this.boxes.shoulderL?.setValue(Hitbox, 'radius', 0.23 * s * w);
    this.boxes.shoulderR?.setValue(Hitbox, 'radius', 0.23 * s * w);
    for (const pod of this.boxes.pods) pod.setValue(Hitbox, 'radius', 0.19 * s * w);
  }

  /** Glue the spheres to the rig and apply the head↔core cycle every frame. */
  private placeHitboxes(): void {
    const rig = this.rig;
    if (!rig || this.phase === 'idle') return;
    if (this.phase !== 'fight') {
      this.parkHitboxes();
      return;
    }
    const s = this.def.scale;
    const root = rig.root.position;
    const lit = this.litPoints();
    const volleying = this.attack?.kind === 'volley' && this.def.weakPattern !== 'crown';

    // While ANYTHING is flashing, the armour + every UNLIT sphere go PASS-THROUGH
    // (−1, ignored by CollisionSystem) instead of solid armour (0). Otherwise the
    // cluster of scale-0 spheres around the chest ate throws aimed at the lit
    // spot above them — you'd throw at the flashing head and the chest plate
    // would eat the ball. With NOTHING lit they stay solid (0), so a mistimed
    // throw at an invulnerable titan still clanks off and is spent.
    const anyLit = lit.length > 0 || volleying;
    const off = anyLit ? -1 : 0;

    rig.head.getWorldPosition(_v);
    this.boxes.head?.object3D?.position.copy(_v);
    this.boxes.head?.setValue(Hitbox, 'damageScale', lit.includes('head') ? CAMPAIGN.headScale : off);

    rig.core.getWorldPosition(_v);
    this.boxes.core?.object3D?.position.copy(_v);
    this.boxes.core?.setValue(Hitbox, 'damageScale', lit.includes('core') ? CAMPAIGN.coreScale : off);

    this.boxes.body?.object3D?.position.set(root.x, root.y + 1.05 * s, root.z);
    this.boxes.body?.setValue(Hitbox, 'damageScale', off);
    // The pelvis sphere doubles as the LOW-BLOW target when the pattern
    // calls it; otherwise it's armour like the trunk.
    rig.low.getWorldPosition(_v);
    this.boxes.pelvis?.object3D?.position.copy(_v);
    this.boxes.pelvis?.setValue(Hitbox, 'damageScale', lit.includes('low') ? CAMPAIGN.lowScale : off);

    // Shoulder emblems — the crown circuit's ring stops.
    rig.shoulders[0].getWorldPosition(_v);
    this.boxes.shoulderL?.object3D?.position.copy(_v);
    this.boxes.shoulderL?.setValue(Hitbox, 'damageScale', lit.includes('shoulderL') ? CAMPAIGN.podScale : off);
    rig.shoulders[1].getWorldPosition(_v);
    this.boxes.shoulderR?.object3D?.position.copy(_v);
    this.boxes.shoulderR?.setValue(Hitbox, 'damageScale', lit.includes('shoulderR') ? CAMPAIGN.podScale : off);

    // Pods pay bonus during a volley — except on the crown, where stray pod
    // hits would skip ring stops out of order.
    this.boxes.pods.forEach((pod, i) => {
      const side = i === 0 ? -1 : 1;
      pod.object3D?.position.set(root.x + side * 0.37 * s, root.y + 1.44 * s, root.z);
      pod.setValue(Hitbox, 'damageScale', volleying ? CAMPAIGN.podScale : off);
    });

    // Aim assist rides the live point (crown: whichever ring stop blinks).
    if (lit.includes('core')) rig.core.getWorldPosition(campaign.aimPoint);
    else if (lit.includes('head')) rig.head.getWorldPosition(campaign.aimPoint);
    else if (lit.includes('shoulderL')) rig.shoulders[0].getWorldPosition(campaign.aimPoint);
    else if (lit.includes('shoulderR')) rig.shoulders[1].getWorldPosition(campaign.aimPoint);
    else rig.low.getWorldPosition(campaign.aimPoint);
    campaign.coreOpen = lit.includes('core');
  }

  private parkHitboxes(): void {
    const all = [
      this.boxes.body,
      this.boxes.pelvis,
      this.boxes.head,
      this.boxes.core,
      this.boxes.shoulderL,
      this.boxes.shoulderR,
      ...this.boxes.pods,
    ];
    for (const e of all) {
      e?.object3D?.position.set(0, -100, 0);
      e?.setValue(Hitbox, 'damageScale', 0);
    }
  }

  // --- endings -------------------------------------------------------------------

  private toVictory(): void {
    this.phase = 'victory';
    titanView.outcome = 'victory';
    this.t = 0;
    this.outroStep = 0;
    this.fellX = this.rig?.root.position.x ?? 0; // die where it stood, mid-sway included
    match.phase = 'matchOver';
    this.disposeAttack();
    this.disposeShots();
    campaign.coreOpen = false;
    this.parkHitboxes();

    app.stats.wins += 1;
    saveStats();
    const solo = this.goopSolo(); // the DEDICATED gel fight (breaker / sealed entry)
    const stageGoop = this.goopStage; // THIS boss is the gel (incl. a blazing run's slot)
    const run = this.runMode();
    const lastStage = !run || app.campaignStage === this.runLen - 1;

    // Coins + XP at the flat per-game rate — DOUBLE on a first fell. The
    // dedicated GOOPLIATH fights stay OFF every board (coins only, own flags);
    // a blazing run merely PASSING THROUGH his slot marks him felled too but
    // still reports the run like any stage.
    let firstClear = false;
    if (solo) {
      firstClear = this.raid() ? !campaignProgress.raidGoopliathCleared : !campaignProgress.goopliathCleared;
      if (firstClear) {
        if (this.raid()) campaignProgress.raidGoopliathCleared = true;
        else campaignProgress.goopliathCleared = true;
        saveCampaignProgress();
      }
      addCoins(CURRENCY.perGame * (firstClear ? 2 : 1));
    } else if (this.raid()) {
      firstClear = lastStage && !campaignProgress.raidCleared;
      if (firstClear) {
        campaignProgress.raidCleared = true;
        saveCampaignProgress();
      }
      reportCampaign(true, firstClear);
    } else {
      // A solo campaign run or single stage: mark the felled boss. Titan stages
      // set their card's cleared flag; a blazing run's goop slot sets his.
      const rs = this.lineup()[clamp(app.campaignStage, 0, this.lineup().length - 1)];
      if (stageGoop) {
        firstClear = !campaignProgress.goopliathCleared;
        if (firstClear) {
          campaignProgress.goopliathCleared = true;
          saveCampaignProgress();
        }
        addCoins(CURRENCY.perGame * (firstClear ? 2 : 1)); // off the boards
      } else {
        const ti = rs.kind === 'titan' ? rs.index : app.campaignStage;
        firstClear = campaignProgress.cleared[ti] !== true;
        if (firstClear) {
          campaignProgress.cleared[ti] = true;
          saveCampaignProgress();
        }
        reportCampaign(true, firstClear);
      }
    }

    // Clearing a RUN opens the next difficulty (Normal→Hard→Blazing).
    const unlocked = run && lastStage ? bankDifficultyClear(this.activeDifficulty()) : null;

    // Felling the KING crowns you: the CHAMPION pad joins your locker.
    // Strictly GOLIATH now. The old gate was `lastStage && !stageGoop`, and a
    // single titan bout is its own last stage — so felling RUSTHOOK in a
    // one-off line-up bout handed out the crown. Keyed to the boss instead of
    // the bout shape, any first GOLIATH fell crowns (line-up bout, run stage,
    // raid finale) and nothing else does. (The tide crowns no one — that pad
    // is the KING's bounty.)
    // It joins the locker and waits there: the pad you stand on is yours to
    // choose, so the crown is never put on for you.
    const crowned = this.def.name === 'GOLIATH' && !platformOwned('champion');
    if (crowned) {
      ownPlatform('champion');
      playCash();
    }

    // The dedicated CAMPAIGN goop fight banks the drop badge at its picked
    // difficulty (raids bank theirs in the raid branch below) — so hard and
    // blazing achievements are earnable against the tide solo too.
    if (app.campaignMode === 'goopliath' && lastStage) {
      reportRunClear('goopliath', this.activeDifficulty());
    }

    // Two more earned pads. TIDEBREAKER: fell GOOPLIATH with a raid squad
    // (every raider banks it). BLAZING: finish any run, raid, or the blazing
    // goop fight with the blazing breaker thrown — single titan bouts always
    // run normal (activeDifficulty), so they can never trip this.
    const tidebroke = solo && this.raid() && lastStage && !platformOwned('tidebreaker');
    if (tidebroke) {
      ownPlatform('tidebreaker');
      setPlatformSkin('tidebreaker');
      playCash();
    }
    const blazed = lastStage && this.activeDifficulty() === 'blazing' && !platformOwned('blazing');
    if (blazed) {
      ownPlatform('blazing');
      setPlatformSkin('blazing');
      playCash();
    }
    const padTag = tidebroke && blazed ? ' · 2 PLATFORMS UNLOCKED' : tidebroke || blazed ? ' · PLATFORM UNLOCKED' : '';

    // Mid-run fells chain straight to the next boss after a short collapse.
    this.advanceAfterVictory = run && !lastStage;
    this.victoryDelay = this.advanceAfterVictory ? CAMPAIGN.runVictoryDelay : CAMPAIGN.victoryDelay;

    if (this.advanceAfterVictory) {
      this.hud.title('FELLED', this.stageName(app.campaignStage + 1), this.accentCss());
      sfx.roundEnd(true); // the full fanfare waits for the end of the run
      if (!stageGoop) sfx.bossRoar(this.def.scale * 1.0);
      return;
    }

    const unlockTag = unlocked ? ` · ${DIFFICULTY[unlocked].label} UNLOCKED` : '';
    if (this.raid() && lastStage) {
      // The raid is BEATEN. EVERY RAIDER posts the run — on their own row,
      // under their own uid, which is the only row the rules let them write
      // (net/leaderboard.ts reportRun). It used to be the host alone, "the
      // one record for the squad", from the days a run was one shared row;
      // on a board of personal bests that left everyone else's row blank,
      // and a raid dealt from THE CLUB's room of one — a raid with no mesh
      // and so no host — posted for nobody at all.
      if (!solo) {
        reportRun('raid', this.runClock, this.squadNames(), this.activeDifficulty(), app.raidHardcore);
      }
      // A GOOPLIATH raid races its OWN board — one long fight is a different
      // race from a five-titan run. (Hardcore means nothing to a single
      // fight, so the tide's rows never wear the HC mark.)
      if (solo && this.raid()) {
        reportRun('goopliath', this.runClock, this.squadNames(), this.activeDifficulty(), false);
      }
      // Every raider banks the clear badge (easy earns nothing); a hardcore
      // titan raid burns the shield red.
      reportRunClear(solo ? 'goopliath' : 'raid', this.activeDifficulty(), !solo && app.raidHardcore);
      this.hud.title(
        solo ? 'THE TIDE RECEDES' : 'RAID CLEARED',
        (solo
          ? `GOOPLIATH FELLED · ${fmtRunTime(this.runClock)}`
          : app.raidHardcore
            ? `HARDCORE · ${fmtRunTime(this.runClock)}`
            : fmtRunTime(this.runClock)) +
          unlockTag +
          padTag,
        '#d9a832',
      );
    } else if (run && lastStage) {
      // The run is complete: the clock goes on the boards.
      const hardcore = app.campaignMode === 'hardcore';
      const record = recordRunTime(hardcore, this.runClock);
      reportRun('gauntlet', this.runClock, [myName()], this.activeDifficulty(), hardcore);
      reportRunClear('gauntlet', this.activeDifficulty(), hardcore); // the profile badge
      if (!hardcore && !campaignProgress.hardcoreUnlocked) {
        campaignProgress.hardcoreUnlocked = true;
        saveCampaignProgress();
      }
      this.hud.title(
        hardcore ? 'HARDCORE' : 'GAUNTLET',
        `${fmtRunTime(this.runClock)}${record ? ' · NEW RECORD' : ''}${unlockTag}${padTag}`,
        this.accentCss(),
      );
    } else {
      // A single stage: no payout readout — just the fell (and the crown).
      this.hud.title(
        stageGoop ? 'GOOPLIATH FELLED' : 'TITAN FELLED',
        stageGoop ? 'the tide recedes' : crowned ? 'CHAMPION PLATFORM UNLOCKED' : '',
        this.accentCss(),
      );
    }
    playVictory(); // stops the battle score and rings the end-of-game sting
    sfx.matchEnd(true);
    // The gel's own KO splat (deathPose → setKo) is the tide's death bellow.
    if (!stageGoop) sfx.bossRoar(this.def.scale * 1.0);
  }

  private toDefeat(): void {
    this.phase = 'defeat';
    titanView.outcome = 'defeat';
    this.t = 0;
    match.phase = 'matchOver';
    this.disposeAttack();
    this.disposeShots();
    campaign.coreOpen = false;
    this.parkHitboxes();

    app.stats.losses += 1;
    saveStats();
    // A dedicated GOOPLIATH fight stays off the boards — coins only.
    if (this.goopSolo()) addCoins(CURRENCY.perGame);
    else reportCampaign(false, false); // the consolation rate, same as a bot loss
    if (this.goopStage) {
      // The tide takes everyone eventually.
      this.hud.title('DISSOLVED', this.raid() ? 'the squad is spent' : '', '#e8352a');
    } else if (this.raid()) {
      // The WIPE: every raider down. The titan stands over the squad.
      this.hud.title('RAID OVER', `${app.campaignStage} of ${this.runLen}`, '#e8352a');
    } else if (this.runMode()) {
      // A run dies where you do — no continues, back to the line-up.
      this.hud.title('RUN OVER', `${app.campaignStage} of ${this.runLen}`, '#e8352a');
    } else {
      this.hud.title('SCRAPPED', '', '#e8352a');
    }
    playVictory(); // stops the battle score and rings the end sting
    sfx.matchEnd(false);
    if (!this.goopStage) sfx.bossRoar(this.def.scale * 1.2); // it laughs, kind of
  }

  /**
   * RAID GOLIATH's false death — the set piece. The king falls exactly like
   * a kill... then, after a beat of stillness, he SHAKES, the bespoke anthem
   * kicks in, and he rises over six seconds while his health bar refills —
   * timed so the second fight lands ON the drop. Phase 2: the crown walked
   * in REVERSE, enrage locked on for the duration.
   */
  private toResurrect(): void {
    this.phase = 'resurrect';
    this.t = 0;
    this.outroStep = 0;
    this.fellX = this.rig?.root.position.x ?? 0; // the false kill also falls in place
    match.phase = 'roundOver'; // collisions + rim drain off while he's down
    this.disposeAttack();
    this.disposeShots();
    campaign.coreOpen = false;
    this.parkHitboxes();
    stopBattleTrack();
    this.hud.title('GOLIATH FALLS', '', this.accentCss());
    sfx.matchEnd(true); // it SOUNDS like the win it isn't
    sfx.bossRoar(this.def.scale * 1.0);
  }

  /** The resurrection timeline (every client, clock-synced via rst):
   *  fall (3.2 s) → still → shake → the anthem + a 6 s rise with the bar. */
  private resurrect(delta: number): void {
    const rig = this.rig!;
    const boss = this.ensureBoss();
    const max = boss.getValue(Health, 'max') ?? 1;
    const fallEnd = 3.2;
    const stillEnd = fallEnd + RAID.resStillTime;
    const shakeEnd = stillEnd + RAID.resShakeTime;
    const riseEnd = shakeEnd + RAID.resRiseTime;

    if (this.t < fallEnd) {
      // The kill everyone believes: the king's own kneel-hold-fall.
      this.deathPose(clamp(this.t / fallEnd, 0, 1));
      this.light.intensity = Math.max(0, 5 * (1 - this.t / fallEnd));
      return;
    }
    if (this.t < stillEnd) {
      this.deathPose(1); // face-down iron. Silence.
      if (this.t - delta < fallEnd) this.hud.title('', '');
      return;
    }
    if (this.t < shakeEnd) {
      // ...a tremor runs through the wreck.
      this.deathPose(1);
      const k = (this.t - stillEnd) / RAID.resShakeTime;
      rig.root.position.x += Math.sin(this.time * 34) * 0.02 * (0.4 + k);
      rig.root.position.y += Math.abs(Math.sin(this.time * 27)) * 0.012 * k;
      if (this.t - delta < stillEnd) sfx.armorClank();
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.3;
        _v.set(rig.root.position.x + rand(-0.5, 0.5) * this.def.scale, 0.15, this.bossZ() + rand(-0.4, 0.4));
        emberBurst(_v, 6, true);
      }
      return;
    }
    if (this.t < riseEnd) {
      // THE ANTHEM. He gets back up over six seconds, health refilling in
      // step — the fight resumes on the drop.
      if (this.t - delta < shakeEnd) {
        startFinaleTrack();
        this.hud.title('HE RISES', '', '#d9a832');
        sfx.titanRise();
        sfx.bossRoar(this.def.scale * 1.2);
      }
      const k = clamp((this.t - shakeEnd) / RAID.resRiseTime, 0, 1);
      this.deathPose(1 - k); // the fall, run backward — up off the deck
      boss.setValue(Health, 'current', max * k); // the bar climbs with him
      this.lastBossHp = max * k;
      this.light.intensity = 5 * k;
      this.light.color.setHex(0xd9a832); // the second life burns gold
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.1;
        _v.set(
          rig.root.position.x + rand(-0.8, 0.8) * this.def.scale,
          rand(0.1, 0.5),
          this.bossZ() + rand(-0.5, 0.5),
        );
        emberBurst(_v, 10, true);
      }
      return;
    }

    // ON THE DROP: second life. Reverse crown, enrage locked, full pool.
    if (this.isAuthority()) {
      this.p2 = true;
      this.enraged = true;
      this.cycleIdx = 0;
      this.hitsOnPoint = 0;
      boss.setValue(Health, 'current', max);
      this.lastBossHp = max;
      this.syncedHp = max;
      this.cooldown = 1.2; // he opens SWINGING
      this.lastKind = null;
      this.startFight(true); // keep the anthem rolling — no battle-loop reset
      this.hud.title('FIGHT', '', '#d9a832');
      this.cardTimer = 0.9;
    }
    // Guests hold the risen pose one echo longer — the host's rst (ph 2,
    // p2 1) lands within ~0.3 s and flips them into the second fight.
  }

  private outro(delta: number): void {
    if (this.phase === 'victory') {
      // Each chassis dies its own death (see deathPose), shedding fire — the
      // gel sheds DROPLETS instead: goo, not sparks, to the very end.
      const k = clamp(this.t / Math.min(3.2, this.victoryDelay), 0, 1);
      this.deathPose(k);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0 && k < 1) {
        if (this.def.style === 'goop') {
          this.emberTimer = 0.14;
          _v.set(
            this.bossRootPos().x + rand(-0.7, 0.7) * this.def.scale,
            rand(0.1, 0.5) * this.def.scale,
            this.bossZ() + rand(-0.5, 0.5),
          );
          _p.set(rand(-0.5, 0.5), 1, rand(-0.5, 0.5)).normalize();
          this.goopFx?.burst(_v, _p, 5, 2.2);
        } else {
          this.emberTimer = 0.16;
          _v.set(
            this.bossRootPos().x + rand(-0.6, 0.6) * this.def.scale,
            rand(0.4, 1.4) * this.def.scale,
            this.bossZ() + rand(-0.3, 0.3),
          );
          emberBurst(_v, 12, true);
          spawnFireImpact(this.world, _v, 1);
        }
      }
      this.light.intensity = Math.max(0, 5 * (1 - k));
      if (this.t >= this.victoryDelay) {
        if (this.advanceAfterVictory) {
          // Raid guests hold the collapse until the HOST's stage-change echo
          // flips them (applyRaidState → stageSetup) — advancing on two
          // clocks would let a fast guest hop stages and get yanked back.
          if (this.isAuthority()) this.advanceRun();
        } else {
          this.finish();
        }
      }
    } else {
      // Defeat: it looms and powers down the show.
      this.light.intensity = Math.max(0, 5 - this.t);
      if (this.t >= CAMPAIGN.defeatDelay) this.finish();
    }
  }

  /**
   * The fall, per chassis — k runs 0 (killing blow) → 1 (down). Owns the
   * full root transform for the collapse; sign conventions under the π yaw:
   * +X pitch tips the face DOWN toward the player, −X tips it backward.
   * Laterally everything hangs off `fellX` — the sway position the killing
   * blow caught it at — so the wreck drops where it STOOD, no centre snap.
   */
  private deathPose(k: number): void {
    if (this.def.style === 'goop') {
      // The tide lets go: one KO splat and the body POURS itself flat — the
      // gel sim owns the whole collapse, no transform choreography needed.
      if (k > 0.02 && this.goop && !this.goop.isKo) this.goop.setKo(true);
      return;
    }
    const rig = this.rig!;
    const h = rig.height;
    const z = this.bossZ();
    const fx = this.fellX;
    const root = rig.root;
    switch (this.def.style) {
      case 'hook': {
        // RUSTHOOK keels over SIDEWAYS — a slow list past the point of no
        // return, then the crash.
        const lean = k < 0.45 ? (k / 0.45) * 0.3 : 0.3 + ((k - 0.45) / 0.55) ** 2 * 1.15;
        root.rotation.z = lean;
        root.position.set(fx + lean * 0.5, -h * 0.3 * k * k, z);
        if (k >= 0.95 && this.outroStep === 0) {
          this.outroStep = 1;
          sfx.slamImpact();
        }
        break;
      }
      case 'piston': {
        // The press pancakes STRAIGHT DOWN, one jolt at a time, until the
        // chassis is a stack of plates.
        const steps = 4;
        const seg = Math.floor(k * steps);
        const jolt = Math.min(1, (k * steps - seg) / 0.35);
        const e = Math.min(1, (seg + jolt) / steps);
        root.scale.y = 1 - 0.55 * e;
        root.position.set(fx, 0, z);
        if (seg > this.outroStep && k < 1) {
          this.outroStep = seg;
          sfx.slamImpact();
        }
        break;
      }
      case 'vulture': {
        // Shot out of its hover: topples BACKWARD, rolling off one wing.
        root.rotation.x = -0.85 * k * k;
        root.rotation.z = 0.7 * k * k;
        root.position.set(fx - 0.4 * k, -h * 0.45 * k * k, z - 0.5 * k);
        break;
      }
      case 'fortress': {
        // Scuttled at anchor — sinks listing back into the floor, rattling
        // as the magazine cooks off.
        const e = k * k;
        root.rotation.z = -0.3 * e;
        root.position.set(fx + Math.sin(this.time * 26) * 0.02 * (1 - k), -(h + 0.5) * e, z);
        break;
      }
      default: {
        // GOLIATH kneels, HOLDS — long enough to mean it — then falls
        // forward at the player's feet.
        if (k < 0.35) {
          const e = k / 0.35;
          root.rotation.x = 0.12 * e;
          root.position.set(fx, -h * 0.16 * e, z);
        } else if (k < 0.6) {
          root.rotation.x = 0.12;
          root.position.set(fx, -h * 0.16, z);
        } else {
          const e = ((k - 0.6) / 0.4) ** 2;
          root.rotation.x = 0.12 + 0.75 * e;
          root.position.set(fx, -h * (0.16 + 0.38 * e), z);
          if (this.outroStep === 0) {
            this.outroStep = 1;
            sfx.bossRoar(this.def.scale * 0.9); // the last breath as he goes
          }
        }
        break;
      }
    }
  }

  private finish(): void {
    if (this.raid()) {
      // The raid room is spent (locked + started) — leave the mesh and land
      // back at the raid browser, win or wipe.
      mesh.cancel();
      app.lobbyMode = 'raid';
      app.lobbyView = 'browser';
      app.state = 'menu';
      this.teardown();
      return;
    }
    // Back to the titan line-up, not the main arc — win or lose, the
    // gauntlet is where you pick your next fight (or your rematch).
    app.campaignOpen = true;
    app.state = 'menu';
    this.teardown();
  }

  // --- helpers ---------------------------------------------------------------------

  private refreshHud(delta: number): void {
    this.hudTimer -= delta;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.15;
    const boss = this.ensureBoss();
    const me = fighterAt(0);
    // The gauntlet clock is a speedrun readout; a raid shows no timer.
    const clock = this.runMode() && !this.raid() ? fmtRunTime(this.runClock) : '';
    this.hud.setBoss(this.def.name, this.accentCss(), clock);
    this.hud.setBars(
      (boss.getValue(Health, 'current') ?? 0) / (boss.getValue(Health, 'max') ?? 1),
      (me?.getValue(Health, 'current') ?? 0) / (me?.getValue(Health, 'max') ?? 1),
      this.p2 ? '#d9a832' : this.accentCss(),
    );
    // The squad readout: every OTHER raider's name + bar, dimmed when down.
    if (this.raid()) {
      const rows: Array<{ name: string; frac: number }> = [];
      for (const seat of this.occupiedSeats()) {
        if (seat === mesh.mySeat) continue;
        const li = localIndexOf(seat);
        const e = li > 0 ? fighterAt(li) : undefined;
        rows.push({
          name: mesh.names[seat] || `RAIDER ${seat + 1}`,
          frac: (e?.getValue(Health, 'current') ?? 0) / (e?.getValue(Health, 'max') ?? 1),
        });
      }
      this.hud.setSquad(rows);
    } else {
      this.hud.setSquad([]);
    }
  }

  private accentCss(): string {
    // GOOPLIATH enraged: name plate and health bar run to blood with the
    // gel itself (setBoss/setBars re-key on the accent, so the HUD flips
    // the moment THE TIDE RISES).
    if (this.goopStage && this.enraged) return '#ff3b2e';
    return `#${this.def.accent.toString(16).padStart(6, '0')}`;
  }

  private bossZ(): number {
    // A raid's pit sits at the wide ring radius; the solo pit keeps the
    // classic duel gap.
    return -(this.raid() ? RAID_RING_RADIUS : ARENA_GAP) - this.def.zOffset;
  }

  private playerHead(out: Vector3): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) headObj.getWorldPosition(out);
    else out.set(0, 1.6, 0);
  }
}
