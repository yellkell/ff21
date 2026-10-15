/**
 * The EMBER tutorial — a voiced guide orb (a warm little ball of light, see
 * docs/tutorial-ember.md) walks the player through ignite → throw → recall →
 * a real block drill → a left/right footwork drill → the ball loadout, then a
 * graduation knockdown against a half-health bot.
 *
 * SAFETY: this rides a perfectly ordinary vs-bot duel (app.state 'playing',
 * mode 'bot') and adds NOTHING to any combat system. It only reads/writes
 * SHARED state the combat systems already use — health, the round timer, the
 * opponent command bus — and it does so ONLY while `app.tutorial` is true. In
 * every normal bout that flag is false and this system early-returns on the
 * first line, so the regular game is byte-for-byte untouched. Even the drills
 * observe combat from OUTSIDE: a hit is a health dip against the re-pinned
 * baseline, a block is the lobbed ball dying next to the player without one.
 *
 * How the "pause" works without freezing the engine: during the lesson beats
 * the system (a) clears the bot's queued attacks from the command bus before
 * FireballSystem drains them — so the bot stands and guards but never fires
 * (the drills' lobs are OUR commands, pushed after the purge) — (b) pins both
 * fighters' health (the bot to 55), and (c) keeps the round clock topped up so
 * the round never ends. The player can still orbit, throw and recall freely.
 * Registered just before FireballSystem so its command-bus edits land before
 * the balls are simulated.
 */

import { createSystem, type Entity, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { Fireball, BallState } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { match } from '../combat/matchState.js';
import { ballCommands, opponents } from '../combat/opponentBus.js';
import { app, saveTutorialDone } from '../menu/appState.js';
import { reportTutorial } from '../net/leaderboard.js';
import { playCash } from '../audio/cash.js';
import { startTutorialMusic, stopTutorialMusic } from '../audio/tutorialMusic.js';
import { CAMPAIGN, FIREBALL, MATCH, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH } from '../config.js';
import { UI, buttonPlate, plate, stencilFont } from '../ui/industrial.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst, spawnEmber } from '../fx/fire.js';
import * as sfx from '../audio/sfx.js';
import {
  preloadTutorVoice,
  sayTutorLine,
  setTutorVoicePosition,
  stopTutorVoice,
  tutorChime,
  tutorLineReady,
  tutorVoiceActive,
} from '../audio/tutorVoice.js';
import { updateVoiceListener } from '../pub/voice/playback.js';
import { goTelegraph, type Telegraph } from '../campaign/telegraphs.js';
import { LINES, PRAISE_POOL, type LineKey } from '../tutorial/script.js';
import { grantGraduationStripe } from '../avatar/paint.js';
import { customization } from '../menu/customization.js';
import { wrapLines, wrapText } from '../menu/menu.js';
import { BALLS_H, BALLS_W, ballsClick, ballsDrag, ballsHit, renderBallsPanel } from '../menu/ballsFace.js';

/** The bot's health in tutorial — deliberately low so a beginner can win. */
const TUT_BOT_HP = 55;

/** Where Ember drops below this HP she calls the finish. */
const BOT_WOBBLE_HP = 20;

type Beat =
  | 'attention'
  | 'ignite'
  | 'throw'
  | 'recall'
  | 'block'
  | 'move'
  | 'attach'
  | 'grad'
  | 'fight'
  /** Post-KO breather: the round is banked but held open while Ember's
   *  win/lose line (and its caption) plays out, then exit to menu. */
  | 'wrapup';

// --- Ember's marks (player platform at the origin, facing -Z at the bot) ----
/** The console: a fixed panel anchor off the player's right shoulder. It hosts
 *  the BEGIN button first and the BALL LOADOUT later, so the player learns
 *  where tutorial UI lives before the loadout ever appears. */
const CONSOLE_POS = new Vector3(1.05, 1.3, -0.55);
/** Her graduation-fight perch: up out of the way, still watching. */
const PERCH_POS = new Vector3(1.5, 2.5, -1.9);

// --- canvases ---------------------------------------------------------------
const CAP_W = 768;
/**
 * The caption plate's canvas. CAP_H is the plate's SHORTEST height, not its
 * only one: a line long enough to need a fifth row grows the plate rather
 * than running off the bottom of it (drawCaption). Ember's sign-off after
 * the graduation fight is the one that does — it sends you to the store and
 * then to the club in a single breath, and at the fixed height its last two
 * lines were simply not drawn.
 */
const CAP_H = 236;
/** How wide the plate stands in the world; the height follows the canvas. */
const CAP_WORLD = 0.68;
/** Where her words start, and how far apart the rows sit. */
const CAP_TEXT_Y = 102;
const CAP_LINE_H = 38;
/** Below the last row: the descender, then the plate's own bottom margin. */
const CAP_TAIL = 36;
/** Measured with, and drawn with — the two must not drift apart. */
const CAP_FONT = '600 31px system-ui, sans-serif';
const CON_W = 384;
const CON_H = 300;
const BEGIN_BTN = { x: 72, y: 206, w: 240, h: 64 };
/** What the console promises, in the seven beats she teaches. */
const CONSOLE_BEATS = 'IGNITE · THROW · RECALL · BLOCK · MOVE · LOADOUT · ONE ROUND';
/** Loadout console canvas: the lobby's 560x480 panel plus a READY footer. */
const LOAD_W = BALLS_W;
const LOAD_H = BALLS_H + 110;
const READY_BTN = { x: BALLS_W / 2 - 150, y: BALLS_H + 20, w: 300, h: 72 };

/** The footwork reps: one clean dodge each way (failures repeat the side —
 *  playtest said four scripted reps was a slog). */
const MOVE_REPS: ('L' | 'R')[] = ['L', 'R'];
/** How far (m) the head must travel along the called side to count. */
const DODGE_DIST = 0.35;

/** Ember's body: a fist-and-a-half of light (playtest: 0.17 read too small). */
const ORB_HALO = 0.26;
const ORB_CORE = 0.105;

/** The explain line a stalled beat replays (the 14 s "want that again?"). */
const NUDGE_LINE: Partial<Record<Beat, LineKey>> = {
  attention: 'begin',
  ignite: 'igniteRetry',
  throw: 'throwIt',
  recall: 'recall',
  block: 'block',
  move: 'move',
  attach: 'attachList',
};

const UP = new Vector3(0, 1, 0);
const _head = new Vector3();
const _headQ = new Quaternion();
const _fwd = new Vector3();
/** Gaze-pitch-free forward for PLACING things: a player staring down at
 *  their fist must not drag Ember (and her caption) to the floor with them. */
const _fwdFlat = new Vector3();
const _right = new Vector3();
const _v = new Vector3();
const _v2 = new Vector3();
const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();

interface Pointer {
  line: Line;
  dot: Mesh;
}

interface Panel {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  /** Its one big button's hover state — lives and dies with the panel. */
  hot: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the player's balls did since last frame — combat observed from outside. */
interface BallEvents {
  /** An orbit released too slowly (Orbit → Hover): the punch didn't commit. */
  softRelease: boolean;
  /** A return flight ended in the hand (Returning → Hover/Orbit). */
  caught: boolean;
  /** A DEAD ball was recalled (Dead → Returning) — too late for attachments. */
  lateRecallHand: 0 | 1 | null;
  /** An attachment (or curve) is visibly doing its thing right now. */
  effectLive: boolean;
  anyOrbit: boolean;
  anyFlying: boolean;
}

export class TutorialSystem extends createSystem({
  balls: { required: [Fireball] },
  combatants: { required: [Combatant, Health] },
}) {
  private active = false;
  /** The system's own clock (same idiom as FireballSystem). */
  private time = 0;
  private beat: Beat = 'attention';
  private beatT = 0;
  private sub = 0;
  private subT = 0;

  // --- Ember, the orb ---
  private orb: Group | null = null;
  private halo: Sprite | null = null;
  private core: Sprite | null = null;
  private orbPos = new Vector3();
  private orbTarget = new Vector3();
  private emberAcc = 0;
  private gazeT = 0;
  /** The attention drift path is anchored in WORLD space at tutorial start —
   *  chasing the player's live gaze made her a carrot on a stick, always 50°
   *  off-axis however fast they turned. */
  private attnFwd = new Vector3(0, 0, -1);
  /** Seconds the FIGHT banner has been up — we clear it ourselves, because
   *  pinning the round clock disables GameStateSystem's own 1.2 s fade. */
  private fightMsgT = 0;

  // --- speech + captions ---
  private caption: Panel | null = null;
  private captionText = '';
  private captionUntil = 0;
  private speakUntil = 0;
  private queue: LineKey[] = [];
  private lastPraise: LineKey | null = null;

  // --- console panels + laser pointers ---
  private console: Panel | null = null;
  private loadout: Panel | null = null;
  /** True while a trigger that closed on the loadout's BEND slider is still
   *  held — the knob follows the ray until it opens. */
  private bendGrabbed = false;
  private ray = new Raycaster();
  private pointers: Partial<Record<'left' | 'right', Pointer>> = {};

  // --- the drills' lobbed ball ---
  private lobPending = false;
  private lob: Entity | null = null;
  private lobHand: 0 | 1 = 0;
  private lobT = 0;
  private lobLastPos = new Vector3();

  // --- per-beat progress ---
  private thrown = false;
  private caughtDuringThrow = false;
  private softAt = -99;
  private blocks = 0;
  private lobSpeed = 2.4;
  private repIdx = 0;
  private sideFails = 0;
  private repAxis = new Vector3();
  private repStart = new Vector3();
  /** The green "stand HERE" half-deck cue, up while a footwork lob flies. */
  private zone: Telegraph | null = null;
  /** The current lob's planned flight time — drives the zone's charge fill. */
  private lobFlight = 1;
  private attachBase: [number, number, boolean, boolean] = [0, 0, false, false];
  private attachStage: 'pick' | 'test' = 'pick';
  private effectSeen = false;
  private lateAt = -99;
  private extraPraiseAt = -99;
  private saidFightHit = false;
  private saidFightTaken = false;
  private saidFightLow = false;

  // --- health baselines (hits are read as dips against last frame) ---
  private prevMyHp = 100;
  private prevBotHp = TUT_BOT_HP;

  // --- idle nudges ---
  private waitT = 0;
  private nudgeStage = 0;

  // Double-buffered so the per-frame collection never allocates.
  private prevBallState = new Map<Entity, number>();
  private ballStateScratch = new Map<Entity, number>();

  update(delta: number): void {
    this.time += delta;
    if (!app.tutorial) {
      if (this.active) this.end();
      return;
    }
    // The bout ended (forfeited, or the match machinery ran out) — leave.
    if (app.state !== 'playing') {
      this.end();
      app.tutorial = false;
      return;
    }
    if (!this.active) this.begin();

    this.beatT += delta;
    this.subT += delta;
    this.playerHead(_head, _headQ);
    _fwd.set(0, 0, -1).applyQuaternion(_headQ);
    _right.set(1, 0, 0).applyQuaternion(_headQ);
    _right.y = 0;
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    _right.normalize();
    _fwdFlat.copy(_fwd);
    _fwdFlat.y = 0;
    if (_fwdFlat.lengthSq() < 1e-4) _fwdFlat.set(0, 0, -1);
    _fwdFlat.normalize();

    // Hits are health dips against last frame's (pinned) baseline — combat
    // observed from outside, no hooks in CollisionSystem.
    const myHp = this.fighterHp(0);
    const botHp = this.fighterHp(1);
    const iWasHit = myHp < this.prevMyHp - 0.01;
    const botWasHit = botHp < this.prevBotHp - 0.01;

    // The trigger belongs to the game unless a beat (attention) or a console
    // click (this frame) claims it — re-asserted below, cleared by default so
    // a claim can never outlive the frame that made it.
    app.tutorialHoldFire = false;

    // We pin the round clock (lessons AND fight), which disables the game's
    // own FIGHT-banner fade (it waits for the clock to tick 1.2 s down) — so
    // fade it ourselves or the plate hangs mid-arena for the whole tutorial.
    if (match.message === 'FIGHT') {
      this.fightMsgT += delta;
      if (this.fightMsgT > 1.2) match.message = '';
    } else {
      this.fightMsgT = 0;
    }

    if (this.beat === 'fight') {
      this.capBotHealth();
      this.styleBot(); // still the rust bucket, just awake
      // KO is the only way out: the 60 s clock must never end the round
      // itself, or GameStateSystem's round/match machinery banks scores and
      // stats mid-tutorial.
      match.roundTimer = MATCH.roundTime;
      this.runFight(myHp, botHp, iWasHit, botWasHit);
    } else if (this.beat === 'wrapup') {
      this.runWrapup();
      this.styleBot();
    } else {
      // Lessons: keep the bout calm and frozen (see header).
      this.suppressBot();
      this.styleBot();
      this.pinHealth();
      match.roundTimer = MATCH.roundTime;
      this.runBeat(delta, this.collectBallEvents(), iWasHit, botWasHit);
    }

    if (!this.active) return; // a win/lose line just ended the tutorial
    this.upkeep(delta);
    this.prevMyHp = this.fighterHp(0);
    this.prevBotHp = this.fighterHp(1);
  }

  // --- the beat machine -------------------------------------------------

  private runBeat(delta: number, events: BallEvents, iWasHit: boolean, botWasHit: boolean): void {
    switch (this.beat) {
      case 'attention':
        this.runAttention();
        break;

      case 'ignite': {
        // She circles the throwing fist, tracing the orbit a ball will take.
        const grip = this.world.playerSpaceEntities.gripSpaces.right?.object3D;
        if (grip) {
          grip.getWorldPosition(this.orbTarget);
          if (this.beatT < 3.5) {
            this.orbTarget.x += Math.cos(this.beatT * 3.2) * 0.22;
            this.orbTarget.y += Math.sin(this.beatT * 3.2) * 0.22;
          } else {
            this.orbTarget.y += 0.28;
          }
        }
        if (events.anyOrbit) {
          this.say('igniteDone');
          this.goto('throw');
        }
        break;
      }

      case 'throw': {
        if (this.queue.length) {
          // Still praising the ignite (the rust-bucket line is queued behind
          // it) — she stays on the fist she's praising, and only flies over
          // as "See this rust bucket?" actually starts.
          const grip = this.world.playerSpaceEntities.gripSpaces.right?.object3D;
          if (grip) {
            grip.getWorldPosition(this.orbTarget);
            this.orbTarget.y += 0.28;
          }
        } else {
          // She hovers over the bot's head — a living target marker; her
          // voice coming from downrange IS the aim cue.
          this.orbTarget.copy(opponents[0].headPos);
          this.orbTarget.y += 0.5;
        }
        if (events.softRelease && this.time - this.softAt > 3.5) {
          this.softAt = this.time;
          this.say('throwSoft');
        }
        if (events.caught) this.caughtDuringThrow = true;
        if (!this.thrown && events.anyFlying) this.thrown = true;
        if (this.thrown && botWasHit) {
          this.say('throwDone');
          this.advanceFromThrow();
        } else if (this.thrown && !events.anyFlying) {
          // Landed without connecting — the throw still counts.
          this.sayPraise();
          this.advanceFromThrow();
        }
        break;
      }

      case 'recall': {
        this.podium();
        if (events.caught) {
          this.say('recallDone');
          this.goto('block');
        }
        break;
      }

      case 'block': {
        const res = this.resolveLob(delta, iWasHit);
        if (res === 'blocked') {
          this.blocks += 1;
          if (this.blocks === 1) {
            this.say('blockDone'); // "...again, a little faster this time."
            this.lobSpeed = 3.2;
          } else {
            this.say('blockTwo');
            this.goto('move');
          }
        } else if (res === 'hit' || res === 'missed') {
          this.say('blockRetry');
          // Ease off after a failure; the confirmation rep resumes at normal pace.
          this.lobSpeed = this.blocks === 0 ? 2.1 : 2.4;
        }
        // She won't let him throw until the shield exists.
        if (!this.lobLive() && this.speechIdle() && events.anyOrbit) {
          _v.copy(_head);
          _v.y -= 0.35; // mid-chest
          this.pushLob(0, _v, this.lobSpeed);
          this.say('blockIncoming');
        }
        // Talking happens from the podium; she only steps wide of the firing
        // line while a ball is actually coming.
        if (this.lobLive()) {
          this.orbTarget.copy(_head).addScaledVector(_fwdFlat, 0.9).addScaledVector(_right, -0.7);
          this.orbTarget.y = _head.y - 0.05;
        } else {
          this.podium();
        }
        break;
      }

      case 'move': {
        // The floor cue charges with the lob, exactly like a boss telegraph.
        this.zone?.update(Math.min(1, this.lobT / Math.max(0.3, this.lobFlight)), this.time);
        if (this.lobLive()) {
          const res = this.resolveLob(delta, iWasHit);
          if (res) {
            this.removeZone();
            let clean = false;
            if (res === 'missed') {
              // Did the whole body actually go the called way?
              _v.copy(_head).sub(this.repStart);
              _v.y = 0;
              clean = _v.dot(this.repAxis) >= DODGE_DIST;
            }
            if (clean) {
              this.sideFails = 0;
              this.repIdx += 1;
              if (this.repIdx >= MOVE_REPS.length) {
                this.say('moveDone');
                this.goto('attach');
              } else {
                this.sayPraise();
              }
            } else {
              // Hit, stood still, went the wrong way — or blocked when the
              // lesson was to MOVE. Same side again.
              this.sideFails += 1;
              this.say('moveRetry');
            }
          }
          // While the ball flies she marks the lane to step into — out on the
          // called side, forward of the player, inside their field of view.
          this.orbTarget.copy(_head).addScaledVector(this.repAxis, 1.1).addScaledVector(_fwdFlat, 1.1);
          this.orbTarget.y = _head.y;
        } else if (this.speechIdle()) {
          // Next rep: she darts to the called side as the visual cue.
          const side = MOVE_REPS[this.repIdx];
          this.repAxis.copy(_right);
          if (side === 'L') this.repAxis.negate();
          this.repStart.copy(_head);
          // Head-height lob; the bot throws with the hand across from the call.
          this.pushLob(side === 'L' ? 1 : 0, _v.copy(_head), this.sideFails >= 2 ? 2.3 : 2.6);
          this.say(side === 'L' ? 'moveLeft' : 'moveRight');
          // Light the called half of the deck green — "stand HERE", the same
          // language the titans use for their kill zones, inverted.
          this.showZone(this.repAxis.x >= 0 ? 1 : -1);
        } else if (this.repIdx === 0 && this.sideFails === 0) {
          // The explain line: a slow, gentle sway showing the two lanes —
          // around the podium spot, never leaving the reading zone (playtest:
          // any faster and she's distracting while the thesis lands).
          this.podium();
          this.orbTarget.addScaledVector(_right, Math.sin(this.beatT * 0.7) * 0.35);
        } else {
          // Between reps (praise, retry coaching): back to the podium.
          this.podium();
        }
        break;
      }

      case 'attach': {
        this.orbTarget.copy(this.attachStage === 'test' && !this.effectSeen ? opponents[0].headPos : CONSOLE_POS);
        this.orbTarget.y += this.attachStage === 'test' && !this.effectSeen ? 0.5 : 0.42;
        this.pollLoadout();
        if (this.beat !== ('attach' as Beat)) break; // READY was clicked — we're in 'grad' now
        // 'Picked one' means something is actually ON — a returning player
        // tapping their already-equipped tile to read it UN-equips, and the
        // test drill would dead-end with nothing to fire.
        const anyEquipped =
          (app.ballAttach[0] ?? 0) !== 0 || (app.ballAttach[1] ?? 0) !== 0 || !!app.ballArc[0] || !!app.ballArc[1];
        if (this.attachStage === 'pick' && this.attachChanged() && anyEquipped) {
          this.attachStage = 'test';
          this.say('attachTest');
        } else if (this.attachStage === 'test' && !this.effectSeen && !anyEquipped) {
          this.attachStage = 'pick'; // everything toggled back off — re-pick
        }
        if (this.attachStage === 'test') {
          if (!this.effectSeen && events.effectLive) {
            this.effectSeen = true;
            this.say('attachDone');
            this.queueLine('attachFree');
          } else if (this.effectSeen && events.effectLive && this.time - this.extraPraiseAt > 5) {
            this.extraPraiseAt = this.time;
            this.sayPraise();
          }
          const late = events.lateRecallHand;
          if (!this.effectSeen && late !== null && (app.ballAttach[late] ?? 0) !== 0 && this.time - this.lateAt > 6) {
            this.lateAt = this.time;
            this.say('attachLate');
          }
        }
        break;
      }

      case 'grad': {
        this.orbTarget.copy(PERCH_POS);
        if (this.speechIdle() && this.beatT > 2) this.goto('fight');
        break;
      }
      // 'fight' and 'wrapup' never reach runBeat — update() routes them to
      // runFight()/runWrapup().
    }
  }

  /** Throw beat done — skip the recall lesson if they already demonstrated a
   *  clean recall-and-catch while the throw beat was still up. */
  private advanceFromThrow(): void {
    if (this.caughtDuringThrow) {
      this.queueLine('recallDone');
      this.goto('block');
    } else {
      this.goto('recall');
    }
  }

  /** Beat 0 — she does NOT start in front of you. */
  private runAttention(): void {
    app.tutorialHoldFire = true;
    switch (this.sub) {
      case 0: {
        // Warm-up: she waits, a dim spark at her spawn point, until the
        // first line can actually SPEAK (or 3 s — captions carry it then).
        if (tutorLineReady(LINES.overHere.id) || this.subT > 3) {
          tutorChime();
          this.say('overHere');
          this.toSub(1);
        }
        break;
      }
      case 1: {
        // Drift across the periphery, ~10 o'clock toward 1 o'clock — along a
        // path FIXED in the room (attnFwd), so turning toward her actually
        // catches her instead of pushing her around your head.
        const k = Math.min(1, this.subT / 6);
        _dir.copy(this.attnFwd).applyAxisAngle(UP, 0.95 - k * 1.5);
        this.orbTarget.copy(_head).addScaledVector(_dir, 2.3);
        this.orbTarget.y = _head.y - 0.05;
        if (this.gazeT > 0.4) this.toSub(3);
        else if (this.subT > 4.5) {
          // Still nothing? Enough being coy — chime and swing straight into
          // their eyeline (playtest: lurking off-axis read as "behind me").
          tutorChime();
          this.toSub(3);
        }
        break;
      }
      case 3: {
        // Park at the podium, flare, say hello.
        this.podium();
        if (this.orbPos.distanceTo(this.orbTarget) < 0.35) {
          emberBurst(this.orbPos, 14);
          this.say('hello');
          this.toSub(4);
        }
        break;
      }
      case 4: {
        this.podium();
        if (this.speechIdle()) {
          // She glides to the console and the BEGIN panel fades in beneath
          // her — leading the eye there is the tutorial for where UI lives.
          this.say('begin');
          this.makeConsole();
          this.toSub(5);
        }
        break;
      }
      case 5: {
        this.orbTarget.copy(CONSOLE_POS);
        this.orbTarget.y += 0.35;
        const hit = this.console ? this.pollPanel(this.console.mesh, CON_W, CON_H) : null;
        const over = this.overRect(hit, BEGIN_BTN);
        if (this.console && over !== this.console.hot) {
          this.console.hot = over;
          this.drawConsole();
        }
        if (over && hit!.clicked) {
          sfx.uiClick();
          tutorChime();
          emberBurst(this.orbPos, 16);
          this.removePanel('console');
          // holdFire stays true THIS frame so FireballSystem (which runs
          // after us) can't turn the click's trigger edge into an ignite;
          // update()'s default-false releases it next frame.
          this.goto('ignite');
        }
        break;
      }
    }
  }

  /** The graduation fight: reactive one-shots from the perch, then the call. */
  private runFight(myHp: number, botHp: number, iWasHit: boolean, botWasHit: boolean): void {
    this.orbTarget.copy(PERCH_POS);
    if (botWasHit && !this.saidFightHit) {
      this.saidFightHit = true;
      this.say('fightHit');
    }
    if (iWasHit && !this.saidFightTaken) {
      this.saidFightTaken = true;
      this.say('fightTaken');
    }
    if (botHp <= BOT_WOBBLE_HP && botHp > 0 && !this.saidFightLow) {
      this.saidFightLow = true;
      this.say('fightLow');
    }
    // One clean knockdown graduates. GameStateSystem has already banked this
    // single round (it runs right after the KO frame's collision — the round
    // bell is unavoidable) but the match can never progress past it: wrapup
    // holds the round-over breather open, then exits to menu before anything
    // else runs. Match stats/ELO stay untouched — the only payout is the
    // deliberate one-time graduation gift in runWrapup.
    if (botHp <= 0 || myHp <= 0) {
      this.say(botHp <= 0 ? 'win' : 'lose');
      this.goto('wrapup');
    }
  }

  /** Hold the post-KO breather open while her sign-off (and caption) lands. */
  private runWrapup(): void {
    this.suppressBot();
    // GameStateSystem is in 'roundOver' counting down to the next round —
    // keep the breather from expiring so no fresh round starts under the line.
    match.resultTimer = Math.max(match.resultTimer, 1.0);
    // She leaves the perch and comes back to the podium for the goodbye.
    this.podium();
    if (this.speechIdle() || this.beatT > 12) {
      // Ran the whole thing, win or lose — that unseals the rest of the game
      // (MenuSystem's pre-tutorial gate) and, the FIRST time only, pays the
      // graduation gift: coins for the store she just plugged, plus XP.
      // A mid-run forfeit never gets here.
      if (!app.tutorialDone) {
        app.tutorialDone = true;
        saveTutorialDone();
        reportTutorial();
        playCash(); // the money sting — she DID say to get some drip
        // …and one stripe in the contrast tone, so every graduate has
        // touched the paint bay once (docs/paint.md §1).
        grantGraduationStripe(customization.avatar === 'onyx');
      }
      this.end(false); // her voice (if a clip is playing) finishes on its own
      app.tutorial = false;
      app.state = 'menu';
    }
  }

  private goto(beat: Beat): void {
    // A leftover drill ball (and its floor cue) must not carry across beats.
    if (this.lobLive()) ballCommands.push({ type: 'spend', slot: 0, hand: this.lobHand });
    this.lob = null;
    this.lobPending = false;
    this.removeZone();
    this.beat = beat;
    this.beatT = 0;
    this.toSub(0);
    this.waitT = 0;
    this.nudgeStage = 0;
    switch (beat) {
      case 'ignite':
        this.queueLine('ignite');
        break;
      case 'throw':
        this.thrown = false;
        this.caughtDuringThrow = false;
        // "See this rust bucket?" — he wakes up on cue.
        app.tutorialBotFrozen = false;
        this.queueLine('throwIt');
        break;
      case 'recall':
        this.queueLine('recall');
        break;
      case 'block':
        this.blocks = 0;
        this.lobSpeed = 2.4;
        this.queueLine('block');
        break;
      case 'move':
        this.repIdx = 0;
        this.sideFails = 0;
        this.queueLine('move');
        break;
      case 'attach':
        this.attachStage = 'pick';
        this.effectSeen = false;
        this.attachBase = [app.ballAttach[0] ?? 0, app.ballAttach[1] ?? 0, !!app.ballArc[0], !!app.ballArc[1]];
        this.queueLine('attach');
        this.queueLine('attachList');
        this.makeLoadout();
        break;
      case 'grad':
        // (holdFire stays up through the READY click's frame; update()'s
        // default-false releases it next frame.)
        this.removePanel('loadout');
        // The drills left the bot's balls dead on the floor across the arena
        // — call them home during the speech, so he visibly HOLDS his fire
        // when the fight starts instead of a ball materialising mid-throw.
        ballCommands.push({ type: 'recall', slot: 0, hand: 0 });
        ballCommands.push({ type: 'recall', slot: 0, hand: 1 });
        this.queueLine('grad');
        break;
      case 'fight':
        this.saidFightHit = false;
        this.saidFightTaken = false;
        this.saidFightLow = false;
        if (this.halo) this.halo.material.opacity = 0.55; // dimmed to a spark
        break;
    }
  }

  private toSub(sub: number): void {
    this.sub = sub;
    this.subT = 0;
  }

  private overRect(hit: { x: number; y: number } | null, r: Rect): boolean {
    return !!hit && hit.x >= r.x && hit.x <= r.x + r.w && hit.y >= r.y && hit.y <= r.y + r.h;
  }

  /** THE talking spot — where she greeted the player (dead ahead, 1.5 m, eye
   *  level). Playtest: that placement read perfectly; every explainer since
   *  uses it verbatim. Partially fronting the bot is fine — she's the lesson. */
  private podium(): void {
    this.orbTarget.copy(_head).addScaledVector(_fwdFlat, 1.5);
    this.orbTarget.y = _head.y;
  }

  // --- the lobbed drill ball ----------------------------------------------

  /** Lob one ball from the bot's hand at `target`, gravity-compensated so it
   *  arrives where aimed. Our push lands AFTER suppressBot()'s purge. */
  private pushLob(hand: 0 | 1, target: Vector3, speed: number): void {
    const from = opponents[0].handPos[hand].clone();
    _v2.copy(target).sub(from);
    const dist = _v2.length() || 1;
    const flight = dist / speed;
    const vel = _v2.normalize().multiplyScalar(speed);
    vel.y += 0.5 * FIREBALL.gravity * flight;
    ballCommands.push({ type: 'throw', slot: 0, hand, pos: from, vel: vel.clone() });
    this.lobPending = true;
    this.lob = null;
    this.lobHand = hand;
    this.lobT = 0;
    this.lobFlight = flight;
  }

  /** Light one half of the player's deck green: "stand HERE". */
  private showZone(side: -1 | 1): void {
    this.removeZone();
    this.zone = goTelegraph(side, OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH * 2);
    this.zone.group.position.set(0, CAMPAIGN.decalY, 0);
    this.scene.add(this.zone.group);
  }

  private removeZone(): void {
    this.zone?.dispose();
    this.zone = null;
  }

  private lobLive(): boolean {
    return this.lobPending || this.lob !== null;
  }

  /**
   * Watch the lobbed ball to its outcome — combat observed from outside:
   *  - 'hit'      the ball died AND the player's health dipped this frame
   *               (a dip alone isn't enough — the rim barrier also drains,
   *               and a clean 0.4 m side-step can cross it mid-drill);
   *  - 'blocked'  the ball died mid-air without hurting them. The only
   *               things that kill our lob mid-air are the player's own
   *               defence — a parry (anywhere along the flight: a returning
   *               ball counts) or a mid-air clash;
   *  - 'missed'   it sailed past the player, or fizzled out on the floor
   *               (which is NOT a block, however close — seated players'
   *               heads sit low enough that "near the head" would lie).
   */
  private resolveLob(delta: number, iWasHit: boolean): 'hit' | 'blocked' | 'missed' | null {
    if (!this.lobLive()) return null;
    this.lobT += delta;

    if (this.lobPending) {
      // FireballSystem turns our command into a Flying owner-1 ball this frame.
      for (const ball of this.queries.balls.entities) {
        if ((ball.getValue(Fireball, 'owner') ?? 0) !== 1) continue;
        if ((ball.getValue(Fireball, 'hand') ?? 0) !== this.lobHand) continue;
        if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
        this.lob = ball;
        this.lobPending = false;
        break;
      }
      if (this.lobPending) {
        if (this.lobT > 1.5) {
          this.lobPending = false;
          return 'missed'; // never spawned (shouldn't happen) — just re-throw
        }
        return null;
      }
    }

    const ball = this.lob!;
    let dead = !ball.active;
    if (ball.active) {
      const obj = ball.object3D;
      if (obj) obj.getWorldPosition(this.lobLastPos);
      dead = (ball.getValue(Fireball, 'state') ?? 0) === BallState.Dead;
    }

    if (dead) {
      this.lob = null;
      if (iWasHit) return 'hit'; // a body hit spends the ball the same frame
      const onFloor = this.lobLastPos.y <= FIREBALL.radius + 0.06;
      return onFloor ? 'missed' : 'blocked';
    }

    // Sailed past (a dodge, or a whiff): call it and tidy the ball away.
    // Judged against the FLAT forward — a downward glance must not tilt the
    // "behind the player" plane.
    _v.copy(this.lobLastPos).sub(_head);
    if (_v.dot(_fwdFlat) < -0.8 || this.lobT > 6) {
      ballCommands.push({ type: 'spend', slot: 0, hand: this.lobHand });
      this.lob = null;
      return 'missed';
    }
    return null;
  }

  // --- player-ball events ---------------------------------------------------

  private collectBallEvents(): BallEvents {
    const ev: BallEvents = {
      softRelease: false,
      caught: false,
      lateRecallHand: null,
      effectLive: false,
      anyOrbit: false,
      anyFlying: false,
    };
    // Reuse last frame's back buffer — a 90 Hz loop must not allocate a Map.
    const seen = this.ballStateScratch;
    seen.clear();
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'owner') ?? 0) !== 0) continue;
      if ((ball.getValue(Fireball, 'shard') ?? 0) === 1) continue;
      const state = ball.getValue(Fireball, 'state') ?? 0;
      const prev = this.prevBallState.get(ball);
      seen.set(ball, state);

      if (state === BallState.Orbit) ev.anyOrbit = true;
      if (state === BallState.Flying) ev.anyFlying = true;
      if (prev === BallState.Orbit && state === BallState.Hover) ev.softRelease = true;
      if (prev === BallState.Returning && (state === BallState.Hover || state === BallState.Orbit)) ev.caught = true;
      if (prev === BallState.Dead && state === BallState.Returning) {
        ev.lateRecallHand = (ball.getValue(Fireball, 'hand') ?? 0) as 0 | 1;
      }
      if (state === BallState.Returning && (ball.getValue(Fireball, 'attach') ?? 0) !== 0) ev.effectLive = true;
      if (state === BallState.Flying) {
        const c = ball.getVectorView(Fireball, 'curl');
        if (Math.hypot(c[0], c[1], c[2]) > 0.25) ev.effectLive = true; // a real curve in flight
      }
    }
    this.ballStateScratch = this.prevBallState;
    this.prevBallState = seen;
    return ev;
  }

  private attachChanged(): boolean {
    const [a0, a1, c0, c1] = this.attachBase;
    return (
      (app.ballAttach[0] ?? 0) !== a0 ||
      (app.ballAttach[1] ?? 0) !== a1 ||
      !!app.ballArc[0] !== c0 ||
      !!app.ballArc[1] !== c1
    );
  }

  // --- speech ---------------------------------------------------------------

  /** Speak now, hard-stopping the current line; caption mirrors the words.
   *  An interruption means the moment moved on, so pending lines drop too. */
  private say(key: LineKey): void {
    this.queue.length = 0;
    this.sayNow(key);
  }

  /** The actual speaking — used by say() and by the queue drain, which must
   *  NOT clear the queue (it would eat every follow-up line it's draining). */
  private sayNow(key: LineKey): void {
    const line = LINES[key];
    const dur = sayTutorLine(line.id, line.text);
    this.captionText = line.text;
    this.captionUntil = this.time + dur + 0.8;
    this.speakUntil = this.time + dur + 0.35;
    this.waitT = 0;
    this.drawCaption();
  }

  /** Speak once the current line (and anything queued before it) finishes. */
  private queueLine(key: LineKey): void {
    this.queue.push(key);
  }

  private speechIdle(): boolean {
    return this.queue.length === 0 && this.time >= this.speakUntil;
  }

  /** A small win that already had its scripted moment — rotate the pool. */
  private sayPraise(): void {
    const picks = PRAISE_POOL.filter((k) => k !== this.lastPraise);
    const key = picks[Math.floor(Math.random() * picks.length)];
    this.lastPraise = key;
    this.say(key);
  }

  // --- per-frame upkeep: orb, captions, panels, nudges ------------------------

  private upkeep(delta: number): void {
    // Speech queue.
    if (this.queue.length && this.time >= this.speakUntil) this.sayNow(this.queue.shift()!);

    // Orb motion: critically-damped chase + idle bob.
    const k = 1 - Math.exp(-5.5 * delta);
    const wasAt = _v2.copy(this.orbPos);
    this.orbPos.lerp(this.orbTarget, k);
    if (this.orb) {
      this.orb.position.copy(this.orbPos);
      this.orb.position.y += Math.sin(this.time * 2.2) * 0.03;
      // She pulses brighter while she talks.
      const talking = tutorVoiceActive() || this.time < this.speakUntil;
      const pulse = talking ? 1 + 0.14 * Math.abs(Math.sin(this.time * 7)) : 1;
      this.halo?.scale.setScalar(ORB_HALO * pulse);
      this.core?.scale.setScalar(ORB_CORE * (talking ? 1 + 0.1 * Math.abs(Math.sin(this.time * 7 + 1)) : 1));
      // Ember trail while she's on the move.
      this.emberAcc += delta;
      if (this.emberAcc > 0.12 && wasAt.distanceTo(this.orbPos) > 0.02) {
        this.emberAcc = 0;
        spawnEmber(this.orb.position, 0.25);
      }
      setTutorVoicePosition(this.orb.position);
    }
    // The listener only matters while she's audible — no point scheduling
    // nine AudioParam ramps a frame through minutes of silence.
    if (tutorVoiceActive() || this.time < this.speakUntil) updateVoiceListener(_head, _headQ);

    // Gaze accumulator (attention beat).
    if (this.beat === 'attention') {
      _v.copy(this.orbPos).sub(_head).normalize();
      this.gazeT = _fwd.dot(_v) > 0.92 ? this.gazeT + delta : 0;
    }

    // Caption plate rides under the orb, facing the player.
    if (this.caption) {
      if (this.captionText && this.time > this.captionUntil) {
        this.captionText = '';
        this.drawCaption();
      }
      this.caption.mesh.visible = this.captionText !== '';
      if (this.caption.mesh.visible && this.orb) {
        this.caption.mesh.position.copy(this.orb.position);
        this.caption.mesh.position.y -= 0.3;
        this.caption.mesh.lookAt(_head);
        // Constant READABLE size: grow the plate with distance, so her lines
        // stay legible when she's marking the bot 3.5 m downrange.
        const s = Math.min(2.4, Math.max(1, this.caption.mesh.position.distanceTo(_head) / 1.5));
        this.caption.mesh.scale.setScalar(s);
      }
    }

    // Panels face the player.
    this.console?.mesh.lookAt(_head);
    this.loadout?.mesh.lookAt(_head);

    // Idle nudges: 14 s → the beat's explain line again; then → "no rush".
    if (this.beat !== 'fight' && this.beat !== 'grad' && this.speechIdle()) {
      this.waitT += delta;
      const replay = this.beat === 'attach' && this.attachStage === 'test' ? 'attachTest' : NUDGE_LINE[this.beat];
      if (this.nudgeStage === 0 && this.waitT > 14 && replay) {
        this.nudgeStage = 1;
        this.say(replay);
      } else if (this.nudgeStage === 1 && this.waitT > 16) {
        this.nudgeStage = 0;
        this.say('noRush');
      }
    }
  }

  // --- holding the bout calm ------------------------------------------------

  /** Strip the bot's queued attacks before FireballSystem drains them, drop
   *  its wind-up glow AND its raised guard — it stands idle, never throws and
   *  never slaps down the player's practice shots (a guarded throw during the
   *  attachment test would read as the PLAYER mistiming their recall). The
   *  drills' lobs are pushed AFTER this purge, so they survive. */
  private suppressBot(): void {
    ballCommands.length = 0;
    opponents[0].orbiting[0] = false;
    opponents[0].orbiting[1] = false;
    opponents[0].blocking[0] = false;
    opponents[0].blocking[1] = false;
  }

  /** The tutorial bot IS the rust bucket: paint its neon rusty orange-brown
   *  through the pose-accent channel OpponentSystem honours for the tutorial.
   *  (His statue stillness lives in BotSystem's app.tutorialBotFrozen branch
   *  — BotSystem runs before the avatar renders, so only IT can hold him.) */
  private styleBot(): void {
    opponents[0].accentHue = 0.07; // rusty orange-brown
    opponents[0].accentLight = 0.36;
  }

  private pinHealth(): void {
    const me = this.fighter(0);
    const bot = this.fighter(1);
    if (me) me.setValue(Health, 'current', me.getValue(Health, 'max') ?? 100);
    if (bot) bot.setValue(Health, 'current', TUT_BOT_HP);
  }

  /** Cap the bot at half health each frame (so refills between rounds hold the
   *  handicap) while leaving it fully damageable down to a knockout. */
  private capBotHealth(): void {
    const bot = this.fighter(1);
    if (bot) bot.setValue(Health, 'current', Math.min(bot.getValue(Health, 'current') ?? TUT_BOT_HP, TUT_BOT_HP));
  }

  // --- lifecycle --------------------------------------------------------------

  private begin(): void {
    this.active = true;
    this.makeOrb();
    this.makeCaption();
    preloadTutorVoice();

    // She spawns dim, small and OFF-STAGE: ~10 o'clock, edge of the eye.
    this.beat = 'attention';
    this.beatT = 0;
    this.playerHead(_head, _headQ);
    _fwd.set(0, 0, -1).applyQuaternion(_headQ);
    this.attnFwd.copy(_fwd);
    this.attnFwd.y = 0;
    if (this.attnFwd.lengthSq() < 1e-4) this.attnFwd.set(0, 0, -1);
    this.attnFwd.normalize();
    _dir.copy(this.attnFwd).applyAxisAngle(UP, 0.95);
    this.orbPos.copy(_head).addScaledVector(_dir, 2.5);
    this.orbPos.y = _head.y - 0.1;
    this.orbTarget.copy(this.orbPos);
    if (this.orb) this.orb.position.copy(this.orbPos);
    // Sub 0 holds the opening chime until her first clip is decoded (fresh
    // installs may still be fetching) — capped so it can never stall.
    this.toSub(0);
    this.gazeT = 0;

    app.tutorialBotFrozen = true; // a rusted statue until she names him

    this.prevMyHp = this.fighterHp(0);
    this.prevBotHp = this.fighterHp(1);
    startTutorialMusic(); // loops for the whole tutorial (lessons + graduation fight)
  }

  private end(stopVoice = true): void {
    if (stopVoice) stopTutorVoice(); // win/lose lines outlive the scene
    this.removeOrb();
    this.removePanel('console');
    this.removePanel('loadout');
    this.removeCaption();
    this.removePointers();
    this.removeZone();
    this.queue.length = 0;
    this.captionText = '';
    this.speakUntil = 0;
    this.prevBallState.clear();
    this.lob = null;
    this.lobPending = false;
    app.tutorialHoldFire = false;
    app.tutorialBotFrozen = false;
    this.waitT = 0;
    this.nudgeStage = 0;
    // Hand the bot's neon back to the team tint for whatever bout comes next.
    opponents[0].accentHue = -1;
    opponents[0].accentLight = 0.5;
    this.active = false;
    this.beat = 'attention';
    stopTutorialMusic(); // the lobby music fades back up on the way out
  }

  // --- queries --------------------------------------------------------------

  private fighter(slot: number): Entity | undefined {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) return e;
    }
    return undefined;
  }

  private fighterHp(slot: number): number {
    return this.fighter(slot)?.getValue(Health, 'current') ?? 1;
  }

  private playerHead(outPos: Vector3, outQuat: Quaternion): void {
    const obj = this.playerHeadEntity?.object3D;
    if (obj) {
      obj.getWorldPosition(outPos);
      obj.getWorldQuaternion(outQuat);
    }
  }

  // --- Ember's body -----------------------------------------------------------

  private makeOrb(): void {
    const orb = new Group();
    orb.name = 'ember-orb';
    this.halo = glowSprite(0xffc04d, ORB_HALO, 0.9);
    this.core = glowSprite(0xfff4dc, ORB_CORE, 1);
    this.halo.renderOrder = 22;
    this.core.renderOrder = 23;
    orb.add(this.halo, this.core);
    this.scene.add(orb);
    this.orb = orb;
  }

  private removeOrb(): void {
    if (!this.orb) return;
    this.scene.remove(this.orb);
    this.halo?.material.dispose(); // the radial texture is shared+cached — leave it
    this.core?.material.dispose();
    this.orb = null;
    this.halo = null;
    this.core = null;
  }

  // --- caption plate ----------------------------------------------------------

  private makeCaption(): void {
    this.caption = this.makePanel(CAP_W, CAP_H, CAP_WORLD, 'ember-caption');
    this.caption.mesh.visible = false;
    // The caption often overlaps the console panels (she hovers above them
    // while talking there). At the shared renderOrder, three.js sorted the
    // two by camera distance — so lifting your head flipped which drew on
    // top and the plate popped opaque. Pin the caption ABOVE the panels
    // (but under the orb's glow at 22) and keep it out of the depth buffer.
    this.caption.mesh.renderOrder = 21;
    (this.caption.mesh.material as MeshBasicMaterial).depthWrite = false;
  }

  private removeCaption(): void {
    if (!this.caption) return;
    this.disposePanel(this.caption);
    this.caption = null;
  }

  private drawCaption(): void {
    if (!this.caption) return;
    const ctx = this.caption.ctx;
    // MEASURE FIRST, in the font the words will actually be drawn in, then
    // give the plate the height that many rows need. Only ever taller than
    // CAP_H, never shorter: every other line she speaks keeps the plate it
    // has always had, and only the one that overflows gets a bigger one.
    ctx.font = CAP_FONT;
    const rows = this.captionText ? wrapLines(ctx, this.captionText, CAP_W - 68).length : 1;
    const capH = Math.max(CAP_H, CAP_TEXT_Y + (rows - 1) * CAP_LINE_H + CAP_TAIL);
    this.sizeCaption(capH);
    ctx.clearRect(0, 0, CAP_W, capH);
    if (this.captionText) {
      plate(ctx, 6, 6, CAP_W - 12, capH - 12, {
        cut: 14,
        fill: 'rgba(8,9,13,0.8)',
        stroke: 'rgba(255,192,77,0.55)',
        rivets: false,
      });
      // Her name tag: a lit ember notch, stencil, and a rule that fades
      // out to the right — the subtitle reads as one of the house's cards.
      ctx.fillStyle = UI.emberBright;
      ctx.shadowColor = UI.emberBright;
      ctx.shadowBlur = 12;
      ctx.fillRect(30, 26, 6, 30);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = stencilFont(26);
      ctx.fillStyle = UI.emberBright;
      ctx.fillText('EMBER', 46, 50);
      const rule = ctx.createLinearGradient(46, 0, CAP_W - 40, 0);
      rule.addColorStop(0, 'rgba(255,192,77,0.7)');
      rule.addColorStop(1, 'rgba(255,192,77,0)');
      ctx.fillStyle = rule;
      ctx.fillRect(46, 62, CAP_W - 86, 2);
      ctx.font = CAP_FONT;
      ctx.fillStyle = UI.text;
      wrapText(ctx, this.captionText, 34, CAP_TEXT_Y, CAP_W - 68, CAP_LINE_H);
    }
    this.caption.tex.needsUpdate = true;
  }

  /**
   * Re-cut the caption plate to a new height.
   *
   * Resizing a canvas throws its contents away and invalidates the texture
   * that was uploaded from it, so the texture is replaced rather than
   * flagged — and the plane is re-cut to match, or the same picture would
   * simply be squashed into the old plate's shape. Both are skipped when
   * the height has not moved, which is every line but one.
   */
  private sizeCaption(capH: number): void {
    if (!this.caption) return;
    const canvas = this.caption.ctx.canvas;
    if (canvas.height === capH) return;
    canvas.height = capH;
    this.caption.tex.dispose();
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    this.caption.tex = tex;
    const mat = this.caption.mesh.material as MeshBasicMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    this.caption.mesh.geometry.dispose();
    this.caption.mesh.geometry = new PlaneGeometry(CAP_WORLD, (CAP_WORLD * capH) / CAP_W);
  }

  // --- the console (BEGIN, then the ball loadout) ------------------------------

  private makePanel(cw: number, ch: number, worldW: number, name: string): Panel {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    const mesh = new Mesh(new PlaneGeometry(worldW, (worldW * ch) / cw), new MeshBasicMaterial({ map: tex, transparent: true }));
    mesh.name = name;
    mesh.renderOrder = 20;
    this.scene.add(mesh);
    return { mesh, ctx, tex, hot: false };
  }

  private disposePanel(p: Panel): void {
    this.scene.remove(p.mesh);
    p.tex.dispose();
    (p.mesh.material as MeshBasicMaterial).dispose();
    p.mesh.geometry.dispose();
  }

  private makeConsole(): void {
    if (this.console) return;
    this.console = this.makePanel(CON_W, CON_H, 0.44, 'tutorial-console');
    this.console.mesh.position.copy(CONSOLE_POS);
    this.drawConsole();
  }

  private drawConsole(): void {
    if (!this.console) return;
    const ctx = this.console.ctx;
    ctx.clearRect(0, 0, CON_W, CON_H);
    plate(ctx, 8, 8, CON_W - 16, CON_H - 16, { cut: 18, fill: 'rgba(10,12,16,0.92)', stroke: UI.emberBright });
    // The keying notch and the title, the way every card in the house opens.
    ctx.fillStyle = UI.emberBright;
    ctx.shadowColor = UI.emberBright;
    ctx.shadowBlur = 14;
    ctx.fillRect(30, 40, 7, 40);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = stencilFont(38);
    ctx.fillStyle = UI.emberBright;
    ctx.fillText('TUTORIAL', 50, 72);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    ctx.fillText('EMBER shows you the ropes.', 50, 106);
    // The seven beats, in the amber the console keys everything with.
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillStyle = UI.amberSoft;
    wrapText(ctx, CONSOLE_BEATS, 50, 140, CON_W - 100, 22);
    ctx.letterSpacing = '0px';
    ctx.font = '500 17px system-ui, sans-serif';
    ctx.fillStyle = UI.textDim;
    ctx.fillText('Graduate and the house pays fifty.', 50, 190);
    buttonPlate(ctx, BEGIN_BTN.x, BEGIN_BTN.y, BEGIN_BTN.w, BEGIN_BTN.h, 'BEGIN', UI.amber, this.console.hot);
    this.console.tex.needsUpdate = true;
  }

  private makeLoadout(): void {
    if (this.loadout) return;
    this.loadout = this.makePanel(LOAD_W, LOAD_H, 0.62, 'tutorial-loadout');
    this.loadout.mesh.position.copy(CONSOLE_POS);
    this.loadout.mesh.position.y += 0.06;
    this.drawLoadout();
  }

  private drawLoadout(): void {
    if (!this.loadout) return;
    const ctx = this.loadout.ctx;
    ctx.clearRect(0, 0, LOAD_W, LOAD_H);
    // The lobby's exact BALL LOADOUT panel, re-hosted: one implementation,
    // painted off screen by the kit and blitted here (menu/ballsFace.ts).
    ctx.drawImage(renderBallsPanel(null), 0, 0, BALLS_W, BALLS_H);
    buttonPlate(ctx, READY_BTN.x, READY_BTN.y, READY_BTN.w, READY_BTN.h, 'READY', UI.emberBright, this.loadout.hot);
    this.loadout.tex.needsUpdate = true;
  }

  /** Lasers + clicks on the loadout console (Beat 6). */
  private pollLoadout(): void {
    if (!this.loadout) return;
    const hit = this.pollPanel(this.loadout.mesh, LOAD_W, LOAD_H);
    const overReady = this.overRect(hit, READY_BTN);
    if (overReady !== this.loadout.hot) {
      this.loadout.hot = overReady;
      this.drawLoadout();
    }
    if (!hit?.held) this.bendGrabbed = false;
    // The BEND slider: a press on its track grabs it, and the knob rides the
    // ray for as long as the trigger stays down — a scrub is a held trigger
    // over the panel, so it claims the trigger every frame it lasts.
    if (hit && hit.y <= BALLS_H && (hit.clicked || this.bendGrabbed)) {
      if (ballsDrag(hit.x / BALLS_W, 1 - hit.y / BALLS_H, this.bendGrabbed)) {
        this.bendGrabbed = true;
        app.tutorialHoldFire = true;
        this.drawLoadout();
        return;
      }
    }
    if (!hit?.clicked) return;
    // The click's trigger edge must not double as an ignite: claim the
    // trigger for THIS frame only (FireballSystem runs after us; update()'s
    // default-false releases it next frame). Hovering alone never claims it —
    // a punch whose ray sweeps the panel on the release frame must still fly.
    app.tutorialHoldFire = true;
    if (overReady) {
      sfx.uiClick();
      this.goto('grad');
      return;
    }
    if (hit.y <= BALLS_H) {
      // Map into the lobby panel's own coordinate space and share its hit-test.
      const id = ballsHit(hit.x / BALLS_W, 1 - hit.y / BALLS_H);
      if (id && ballsClick(id)) {
        sfx.uiClick();
        this.drawLoadout();
      }
    }
  }

  /** Aim a laser from each hand at `mesh`; report the hover point (canvas px),
   *  whether a trigger clicked it this frame, and whether one is held on it
   *  (a scrub). A hand with its trigger down wins over one merely pointing. */
  private pollPanel(mesh: Mesh, cw: number, ch: number): { x: number; y: number; clicked: boolean; held: boolean } | null {
    if (!this.pointers.left) this.pointers.left = this.makePointer();
    if (!this.pointers.right) this.pointers.right = this.makePointer();
    let out: { x: number; y: number; clicked: boolean; held: boolean } | null = null;
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand]!;
      const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (!rayObj) {
        p.line.visible = false;
        p.dot.visible = false;
        continue;
      }
      rayObj.getWorldPosition(_origin);
      rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
      this.ray.set(_origin, _dir);
      const hit = this.ray.intersectObject(mesh, false)[0];
      _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.6));
      const pos = p.line.geometry.getAttribute('position');
      pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
      pos.setXYZ(1, _end.x, _end.y, _end.z);
      pos.needsUpdate = true;
      p.line.visible = true;
      if (hit?.uv) {
        p.dot.position.copy(hit.point);
        p.dot.visible = true;
        const clicked = this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger) ?? false;
        const held = this.input.xr.gamepads[hand]?.getButtonPressed(InputComponent.Trigger) ?? false;
        if (!out || clicked || (held && !out.held)) out = { x: hit.uv.x * cw, y: (1 - hit.uv.y) * ch, clicked, held };
      } else {
        p.dot.visible = false;
      }
    }
    return out;
  }

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'tutorial-pointer';
    line.frustumCulled = false;
    line.visible = false;
    line.renderOrder = 21;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    dot.renderOrder = 21;
    this.scene.add(line, dot);
    return { line, dot };
  }

  private removePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      if (!p) continue;
      this.scene.remove(p.line, p.dot);
      p.line.geometry.dispose();
      (p.line.material as LineBasicMaterial).dispose();
      p.dot.geometry.dispose();
      (p.dot.material as MeshBasicMaterial).dispose();
    }
    this.pointers = {};
  }

  private removePanel(which: 'console' | 'loadout'): void {
    const p = which === 'console' ? this.console : this.loadout;
    if (!p) return;
    this.disposePanel(p);
    if (which === 'console') this.console = null;
    else this.loadout = null;
    // Lasers only exist for a live console.
    if (!this.console && !this.loadout) {
      for (const hand of ['left', 'right'] as const) {
        const ptr = this.pointers[hand];
        if (ptr) {
          ptr.line.visible = false;
          ptr.dot.visible = false;
        }
      }
    }
  }
}
