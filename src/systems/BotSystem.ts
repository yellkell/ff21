/**
 * The practice bots. A bot does NOT move an entity — it writes an opponent pose
 * bus slot (head/hand poses) like a phantom player and queues ball commands, so
 * downstream (OpponentSystem, FireballSystem, CollisionSystem) treats it exactly
 * like a remote human. That keeps bot bouts and online bouts on one code path.
 *
 * The classic duel runs one bot; arcade 2v2 / FFA run one per other-fighter
 * slot. Each bot strafes and bobs on its own platform, reads incoming balls,
 * dodges or guards, winds a ball up and hurls it at its NEAREST enemy on a
 * cadence, then recalls it.
 *
 * HOW SHARP is THE BOT LADDER's call (combat/botBrain.ts, config.BOT_LADDER):
 * every bot in the bout runs one `BotBrain` blended from the player's XP
 * rank, resolved each frame so the MERCY ease and the dev override land live.
 * The brain's numbers drive everything below that varies by rank —
 *
 *  - OFFENCE: cadence, wind-up, ball speed and aim slop; AIM LAG (rookies
 *    throw at where your head WAS) versus LEAD (veterans throw at where it is
 *    GOING, off your head's velocity over the flight time); the low/high mix,
 *    bent by how much you actually duck; the PUNISH (a throw the instant both
 *    your fists are empty — you can't parry what you don't hold); the FEINT
 *    (a wind-up held past its beat, so an early dodge is wasted); and the
 *    DOUBLE TAP (the other fist follows within a beat).
 *  - DEFENCE: how far out it notices a ball and how long it hesitates; the
 *    odds it does anything at all; block versus dodge; the odds a rookie
 *    steps INTO the ball; a cornered bot that can't sidestep ducks instead;
 *    and the PRE-DODGE (a step the moment you spin up, before the ball
 *    leaves your hand).
 *  - FOOTWORK: strafe and bob speed, how much of the pad it uses and how
 *    often it moves, with a burst of speed on every dodge.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { Fireball, BallState } from '../components/Fireball.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { ballCommands, opponents } from '../combat/opponentBus.js';
import { fighterTeam } from '../combat/fighters.js';
import { localLayout, classicDuel } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { myStats } from '../net/leaderboard.js';
import { botLive, brainForSkill, mercyFor, skillForXp, type BotBrain } from '../combat/botBrain.js';
import { BOT, FIREBALL } from '../config.js';

const _head = new Vector3(); // local player's head
const _ballPos = new Vector3();
const _ballVel = new Vector3();
const _toBot = new Vector3(); // ball → bot, for the closing test
const _aim = new Vector3();
const _vel = new Vector3();
const _look = new Quaternion();
const _pitchQ = new Quaternion();
const _tmp = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _botHead = new Vector3();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Per-bot drift + cadence state. */
class Bot {
  targetX = 0;
  targetY = BOT.headY;
  targetZ = 0;
  x = 0;
  y = BOT.headY;
  z = 0;
  moveTimer = 1;
  throwTimer = 2;
  windupHand: 0 | 1 = 0;
  windup = -1; // <0 idle, else counts down to release
  recallTimers: [number, number] = [-1, -1];
  guardPhase = 0;
  // Defence: ONE dodge-or-block decision per ball approach (see move()).
  decideTimer = 0; // cooldown between threat decisions
  blockTimer = 0; // >0 → the guard hand is up
  blockHand: 0 | 1 = 0;
  blockAt = new Vector3(); // where the threatening ball was last seen
  /** Seconds since an incoming ball was first noticed (<0: none in sight) —
   *  the brain's reactDelay has to run out before it acts. */
  noticeTimer = -1;
  /** >0 → a dodge is fresh and footwork runs at burst speed. */
  burst = 0;
  /** Already answered the enemy's current spin-up (one pre-dodge per wind-up). */
  spinSeen = false;
  /** Already rolled the punish for the current empty-fists window. */
  punishArmed = false;
  /** >=0 → counting down to the other fist's DOUBLE TAP. */
  followUp = -1;
  /** The nearest enemy this frame is the local player (lead/lag apply). */
  targetIsPlayer = false;
  constructor(public readonly slot: number, interval: number) {
    this.reset(interval);
  }
  /** Fresh round: cold hands, staggered fire, nothing mid-flight. */
  reset(interval: number): void {
    this.throwTimer = interval * (0.7 + Math.random() * 0.8);
    this.windup = -1;
    this.followUp = -1;
    this.blockTimer = 0;
    this.noticeTimer = -1;
    this.burst = 0;
    this.spinSeen = false;
    this.punishArmed = false;
    this.recallTimers[0] = this.recallTimers[1] = -1;
  }
}

/** One remembered head position, for the rookie's AIM LAG. */
interface HeadSample {
  t: number;
  pos: Vector3;
}

export class BotSystem extends createSystem({
  balls: { required: [Fireball] },
  combatants: { required: [Combatant, Health] },
}) {
  private bots: Bot[] = [];
  private brain: BotBrain = brainForSkill(0);
  private wasBotBout = false;
  private lastReset = -1;

  // --- the player's read: head velocity, its recent trail, the duck habit ---
  private clock = 0;
  private headPrev = new Vector3();
  private headVel = new Vector3();
  private headTrail: HeadSample[] = [];
  /** Slow estimate of where the player's head sits when they're just standing. */
  private restY = BOT.headY;
  /** 0..1 — how much of the recent bout the player has spent ducked. */
  private duckFrac = 0;

  /** A bot is out once knocked to 0 health this round. */
  private dead(slot: number): boolean {
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'slot') ?? -1) === slot) return (e.getValue(Health, 'current') ?? 1) <= 0;
    }
    return false;
  }

  update(delta: number): void {
    const botBout = app.state === 'playing' && app.mode === 'bot';
    if (!botBout) {
      if (this.wasBotBout) {
        this.wasBotBout = false;
        this.bots.length = 0;
        botLive.brain = null;
      }
      return;
    }
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_head);

    if (!this.wasBotBout) {
      // A fresh bout: forget the last one's read of the player.
      this.wasBotBout = true;
      this.bots.length = 0;
      this.headTrail.length = 0;
      this.headPrev.copy(_head);
      this.headVel.set(0, 0, 0);
      this.restY = _head.y;
      this.duckFrac = 0;
      this.lastReset = match.resetCount;
      botLive.throws = 0;
    }
    this.resolveBrain();
    this.readPlayer(delta);

    const roster = localLayout();
    const roundFresh = match.resetCount !== this.lastReset;
    this.lastReset = match.resetCount;
    for (let slot = 1; slot < roster.length; slot++) {
      const i = slot - 1;
      const pose = opponents[i];
      if (!pose.active) continue;
      const bot = (this.bots[i] ??= new Bot(slot, this.brain.throwInterval));
      if (roundFresh) {
        bot.reset(this.brain.throwInterval);
        pose.orbiting[0] = pose.orbiting[1] = false;
      }
      // Knocked out: stop throwing/moving and go cold until the round resets.
      if (this.dead(slot)) {
        pose.orbiting[0] = pose.orbiting[1] = false;
        pose.blocking[0] = pose.blocking[1] = false;
        bot.windup = -1;
        bot.followUp = -1;
        continue;
      }
      const seat = roster[slot];
      const myTeam = seat.team;

      // TUTORIAL statue mode: through the opening lessons the sparring bot
      // stands rooted on his pad — posed and facing the player, but no
      // strafing, no wind-ups, no guard — until Ember names him awake.
      if (app.tutorialBotFrozen) {
        bot.windup = -1;
        bot.followUp = -1;
        bot.blockTimer = 0;
        pose.orbiting[0] = pose.orbiting[1] = false;
        pose.blocking[0] = pose.blocking[1] = false;
        this.pose(bot, seat.pos[0], seat.pos[2], _head, delta);
        continue;
      }

      this.move(bot, seat.pos[0], seat.pos[2], myTeam, delta);
      // Aim/face the nearest enemy; with none in range the bot just guards.
      const target = this.nearestEnemy(bot, seat.pos[0], seat.pos[2], myTeam);
      this.pose(bot, seat.pos[0], seat.pos[2], target, delta);
      if (match.phase === 'playing' && target) {
        this.fight(bot, target, delta);
      } else {
        bot.windup = -1;
        bot.followUp = -1;
        pose.orbiting[0] = pose.orbiting[1] = false;
      }
    }
  }

  /**
   * The brain for THIS frame: the player's XP rank (the tutorial always
   * spars the ROOKIE), a dev override if one is set, less the MERCY ease
   * while the player trails on rounds.
   */
  private resolveBrain(): void {
    const xp = myStats().xp;
    let base: number;
    let mercy = 0;
    if (app.tutorial) base = 0;
    else if (botLive.override !== null) base = botLive.override;
    else {
      base = skillForXp(xp);
      let won: number;
      let lost: number;
      if (classicDuel()) {
        won = match.myScore;
        lost = match.oppScore;
      } else {
        won = match.teamScores[0] ?? 0;
        lost = 0;
        for (let t = 1; t < match.teamScores.length; t++) lost += match.teamScores[t] ?? 0;
      }
      mercy = mercyFor(xp, won, lost);
    }
    const skill = clamp(base - mercy, 0, 1);
    if (!botLive.brain || botLive.brain.skill !== skill) this.brain = brainForSkill(skill);
    botLive.brain = this.brain;
    botLive.base = base;
    botLive.mercy = mercy;
  }

  /** Track the player's head: velocity (for LEAD), a short trail (for AIM
   *  LAG) and how much they duck (for the low/high read). */
  private readPlayer(delta: number): void {
    this.clock += delta;
    if (delta > 0) {
      _tmp.copy(_head).sub(this.headPrev).divideScalar(delta);
      // Smooth hard, and never trust a teleport-sized jump (a recentre).
      if (_tmp.lengthSq() < 36) this.headVel.lerp(_tmp, Math.min(1, delta * 12));
      else this.headVel.set(0, 0, 0);
    }
    this.headPrev.copy(_head);

    const trail = this.headTrail;
    trail.push({ t: this.clock, pos: _head.clone() });
    while (trail.length > 2 && this.clock - trail[0].t > BOT.headLagWindow) trail.shift();

    // Resting height eases slowly toward the head; standing back up pulls it
    // up fast so a long crouch never becomes the new "standing".
    const up = _head.y > this.restY;
    this.restY += (_head.y - this.restY) * Math.min(1, delta * (up ? 2.5 : 0.2));
    const ducked = _head.y < this.restY - 0.18 ? 1 : 0;
    this.duckFrac += (ducked - this.duckFrac) * Math.min(1, delta * 0.35);
  }

  /** Where the player's head was `lag` seconds ago (the oldest sample no
   *  older than that), into `out`. Falls back to the live head. */
  private laggedHead(lag: number, out: Vector3): void {
    if (lag <= 0.005 || this.headTrail.length === 0) {
      out.copy(_head);
      return;
    }
    const want = this.clock - lag;
    let pick = this.headTrail[0];
    for (const s of this.headTrail) {
      if (s.t <= want) pick = s;
      else break;
    }
    out.copy(pick.pos);
  }

  /** Nearest fighter on a different team (out param reused via _aim is unsafe —
   *  returns a fresh Vector3 or null). Sets `bot.targetIsPlayer`. */
  private nearestEnemy(bot: Bot, padX: number, padZ: number, myTeam: number): Vector3 | null {
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    let best: Vector3 | null = null;
    let bestD = Infinity;
    bot.targetIsPlayer = false;
    const consider = (pos: Vector3, player: boolean): void => {
      const d = pos.distanceToSquared(_botHead);
      if (d < bestD) {
        bestD = d;
        best = pos.clone();
        bot.targetIsPlayer = player;
      }
    };
    if (myTeam !== fighterTeam(0) && !this.dead(0)) consider(_head, true); // the local player, if up
    const roster = localLayout();
    for (let slot = 1; slot < roster.length; slot++) {
      if (slot === bot.slot) continue;
      const other = opponents[slot - 1];
      if (!other.active || roster[slot].team === myTeam || this.dead(slot)) continue;
      consider(other.headPos, false);
    }
    return best;
  }

  /** Pick a fresh spot on the pad to drift to. */
  private pickDrift(bot: Bot): void {
    const b = this.brain;
    const roam = BOT.padHalfWidth * b.roam;
    const r = Math.random();
    if (r < 0.2) bot.targetX = bot.x + (Math.random() * 0.5 - 0.25);
    else if (r < 0.45) bot.targetX = (Math.random() * 0.6 - 0.3) * b.roam;
    else bot.targetX = (Math.random() * 2 - 1) * roam;
    bot.targetX = clamp(bot.targetX, -roam, roam);

    const d = Math.random();
    if (d < 0.25) bot.targetY = BOT.headYMin + Math.random() * 0.2;
    else if (d < 0.4) bot.targetY = BOT.headYMax - Math.random() * 0.1;
    else bot.targetY = BOT.headY + (Math.random() * 0.24 - 0.12);
    bot.targetY = clamp(bot.targetY, BOT.headYMin, BOT.headYMax);

    bot.targetZ = clamp((Math.random() * 2 - 1) * 0.5 * b.roam, -0.5, 0.5);
    bot.moveTimer = (Math.random() < 0.3 ? 0.35 + Math.random() * 0.5 : 0.9 + Math.random() * 1.1) / b.restless;
  }

  /** Is any enemy of `myTeam` winding a throw (a ball in ORBIT)? */
  private enemySpinningUp(myTeam: number): boolean {
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Orbit) continue;
      if (fighterTeam(ball.getValue(Fireball, 'owner') ?? 0) === myTeam) continue;
      return true;
    }
    return false;
  }

  /**
   * The nearest enemy ball in flight that is inside the brain's notice range
   * AND closing on the bot. Leaves it in _ballPos. A ball sailing past wide
   * of the pad is not a threat — the sharper bots don't flinch at it.
   */
  private incomingThreat(myTeam: number): boolean {
    let found = false;
    let bestD = this.brain.reactDistance;
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'state') ?? 0) !== BallState.Flying) continue;
      if (fighterTeam(ball.getValue(Fireball, 'owner') ?? 0) === myTeam) continue;
      const obj = ball.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_tmp);
      const d = _tmp.distanceTo(_botHead);
      if (d >= bestD) continue;
      const v = ball.getVectorView(Fireball, 'velocity');
      _ballVel.set(v[0], v[1], v[2]);
      if (_ballVel.dot(_toBot.copy(_botHead).sub(_tmp)) <= 0) continue; // flying away
      bestD = d;
      _ballPos.copy(_tmp);
      found = true;
    }
    return found;
  }

  /** Strafe + duck targets, with reactive dodges off incoming enemy balls. */
  private move(bot: Bot, padX: number, padZ: number, myTeam: number, delta: number): void {
    const b = this.brain;
    bot.moveTimer -= delta;
    if (bot.moveTimer <= 0) this.pickDrift(bot);

    // PRE-DODGE: the enemy is spinning up — the sharper bots step now, once
    // per wind-up, before the ball has left the hand.
    const spinning = this.enemySpinningUp(myTeam);
    if (spinning && !bot.spinSeen) {
      bot.spinSeen = true;
      if (Math.random() < b.preDodge) {
        const roam = BOT.padHalfWidth * b.roam;
        const side = -Math.sign(bot.x) || (Math.random() < 0.5 ? -1 : 1);
        bot.targetX = clamp(side * roam * (0.4 + Math.random() * 0.6), -roam, roam);
        bot.moveTimer = 0.5 + Math.random() * 0.4;
        bot.burst = BOT.dodgeBurst * 0.6;
      }
    } else if (!spinning) bot.spinSeen = false;

    // Reactive defence: an enemy ball flying in close forces ONE decision per
    // approach — after the brain's hesitation, and only if it decides to act
    // at all — a sidestep-and-duck, or a raised GUARD (the glove lights and
    // CollisionSystem slaps the ball down on contact).
    bot.decideTimer = Math.max(0, bot.decideTimer - delta);
    bot.blockTimer = Math.max(0, bot.blockTimer - delta);
    bot.burst = Math.max(0, bot.burst - delta);
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    if (this.incomingThreat(myTeam)) {
      bot.noticeTimer = bot.noticeTimer < 0 ? 0 : bot.noticeTimer + delta;
      if (bot.blockTimer > 0) {
        bot.blockAt.copy(_ballPos); // keep the raised guard tracking the ball
      } else if (bot.decideTimer <= 0 && bot.noticeTimer >= b.reactDelay) {
        bot.decideTimer = BOT.decideEvery;
        if (Math.random() < b.defendChance) this.defend(bot, padX);
        // …else it just watches the ball come — a rookie's freeze.
      }
    } else {
      bot.noticeTimer = -1;
    }

    const gain = bot.burst > 0 ? BOT.dodgeBurstGain : 1;
    const stepX = b.moveSpeed * gain * delta;
    const dx = bot.targetX - bot.x;
    bot.x += Math.abs(dx) <= stepX ? dx : Math.sign(dx) * stepX;
    const stepY = b.duckSpeed * gain * delta;
    const dy = bot.targetY - bot.y;
    bot.y += Math.abs(dy) <= stepY ? dy : Math.sign(dy) * stepY;
    const stepZ = b.moveSpeed * 0.8 * gain * delta;
    const dz = bot.targetZ - bot.z;
    bot.z += Math.abs(dz) <= stepZ ? dz : Math.sign(dz) * stepZ;
  }

  /** One answer to the ball at _ballPos: a GUARD, or a dodge. */
  private defend(bot: Bot, padX: number): void {
    const b = this.brain;
    const ballX = _ballPos.x - padX;
    const near: 0 | 1 = ballX < bot.x ? 0 : 1;
    const guardHand: 0 | 1 = bot.windup >= 0 && bot.windupHand === near ? ((1 - near) as 0 | 1) : near;
    // A block needs a BALL IN THAT FIST (same law as the player's parry)
    // — with its fire away, the bot falls back to a dodge.
    if (Math.random() < b.blockChance && this.ballAtHand(bot.slot, guardHand)) {
      // BLOCK: plant the free hand between head and ball, hold it up.
      bot.blockTimer = BOT.blockHold;
      bot.blockAt.copy(_ballPos);
      bot.blockHand = guardHand;
      return;
    }
    // DODGE: sidestep away from the ball's line + duck under a high one /
    // stand over a low one. A rookie sometimes reads it backwards and steps
    // INTO it; a cornered bot with no room to the side ducks instead.
    const wrong = Math.random() < b.wrongWayChance;
    let away = Math.sign(bot.x - ballX) || (Math.random() < 0.5 ? -1 : 1);
    if (wrong) away = -away;
    const room = BOT.padHalfWidth - away * bot.x; // pad left in that direction
    if (room < 0.25 && !wrong) {
      bot.targetX = bot.x; // cornered: hold the line, go vertical
    } else {
      bot.targetX = clamp(bot.x + away * 0.6, -BOT.padHalfWidth, BOT.padHalfWidth);
    }
    const high = _ballPos.y > bot.y - 0.15;
    bot.targetY = (wrong ? !high : high) ? BOT.headYMin : BOT.headYMax;
    bot.targetZ = -0.5;
    bot.burst = BOT.dodgeBurst;
    bot.moveTimer = Math.max(bot.moveTimer, 0.45); // let the dodge land before drifting on
  }

  /** Write the phantom body onto the bot's bus slot, facing `target`. */
  private pose(bot: Bot, padX: number, padZ: number, target: Vector3 | null, delta: number): void {
    bot.guardPhase += delta;
    const pose = opponents[bot.slot - 1];
    _botHead.set(padX + bot.x, bot.y, padZ + bot.z);
    pose.headPos.copy(_botHead);

    // Face the target (or straight off the platform if there's none) as a
    // stable yaw + clamped pitch — no roll, no owl-necking.
    if (target) _tmp.copy(target).sub(_botHead);
    else _tmp.set(padX === 0 ? 0 : -padX, 0, padZ === 0 ? -1 : -padZ); // look toward centre
    const yaw = Math.atan2(-_tmp.x, -_tmp.z);
    const horiz = Math.hypot(_tmp.x, _tmp.z) || 1e-4;
    const pitch = clamp(Math.atan2(_tmp.y, horiz), -BOT.headPitchMax, BOT.headPitchMax);
    _look.setFromAxisAngle(UP, yaw).multiply(_pitchQ.setFromAxisAngle(RIGHT, pitch));
    pose.headQuat.slerp(_look, Math.min(1, delta * BOT.headTurnSpeed));

    // Forward/right in the floor plane for placing the guard relative to facing.
    _fwd.set(-_tmp.x, 0, -_tmp.z);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);

    for (const hand of [0, 1] as const) {
      const side = hand === 0 ? -1 : 1;
      const bob = Math.sin(bot.guardPhase * 2.4 + hand * 1.7) * 0.02;
      const winding = bot.windup >= 0 && bot.windupHand === hand;
      const blocking = bot.blockTimer > 0 && bot.blockHand === hand && !winding;
      if (blocking) {
        // The GUARD: snap this hand onto the line between head and the
        // incoming ball, a forearm's reach out — the lit glove is the shield.
        _tmp.copy(bot.blockAt).sub(_botHead);
        if (_tmp.lengthSq() < 1e-6) _tmp.copy(_fwd);
        _tmp.normalize();
        _tmp.multiplyScalar(BOT.blockReach).add(_botHead);
        pose.handPos[hand].lerp(_tmp, Math.min(1, delta * 16)); // snappier than the guard sway
      } else {
        const gy = bot.y - (winding ? 0.05 : 0.18) + bob;
        _tmp
          .set(_botHead.x, gy, _botHead.z)
          .addScaledVector(_right, side * (winding ? 0.34 : 0.22))
          .addScaledVector(_fwd, winding ? -0.16 : 0.18); // wind back, guard forward
        pose.handPos[hand].lerp(_tmp, Math.min(1, delta * 9));
      }
      pose.handQuat[hand].copy(pose.headQuat);
      pose.fisting[hand] = false;
      pose.blocking[hand] = blocking;
    }
  }

  /** True when this fighter's ball for `hand` is home in the fist (hover/orbit).
   *  Owner 0 is the local player — the PUNISH reads their fists this way. */
  private ballAtHand(owner: number, hand: 0 | 1): boolean {
    for (const ball of this.queries.balls.entities) {
      if ((ball.getValue(Fireball, 'owner') ?? 0) !== owner) continue;
      if ((ball.getValue(Fireball, 'hand') ?? 0) !== hand) continue;
      if ((ball.getValue(Fireball, 'shard') ?? 0) === 1) continue;
      const st = ball.getValue(Fireball, 'state') ?? 0;
      return st === BallState.Hover || st === BallState.Orbit;
    }
    return false;
  }

  /** Start a wind-up on `hand` (the orbit is the tell). */
  private windUp(bot: Bot, hand: 0 | 1, seconds: number): void {
    bot.windupHand = hand;
    bot.windup = seconds;
    opponents[bot.slot - 1].orbiting[hand] = true;
  }

  /** Cadenced wind-up → throw → recall, alternating fists — plus the PUNISH,
   *  the FEINT and the DOUBLE TAP the sharper brains earn. */
  private fight(bot: Bot, target: Vector3, delta: number): void {
    const b = this.brain;
    for (const hand of [0, 1] as const) {
      if (bot.recallTimers[hand] >= 0) {
        bot.recallTimers[hand] -= delta;
        if (bot.recallTimers[hand] < 0) ballCommands.push({ type: 'recall', slot: bot.slot - 1, hand });
      }
    }

    if (bot.windup >= 0) {
      bot.windup -= delta;
      if (bot.windup < 0) this.release(bot, target);
      return;
    }

    // DOUBLE TAP: the other fist follows the last throw within a beat, on a
    // short wind-up — if its ball is home.
    if (bot.followUp >= 0) {
      bot.followUp -= delta;
      if (bot.followUp < 0) {
        const other = (1 - bot.windupHand) as 0 | 1;
        if (this.ballAtHand(bot.slot, other)) this.windUp(bot, other, b.windup * 0.5);
      }
      return;
    }

    // PUNISH: both the player's fists are empty — they can't parry what they
    // don't hold. Rolled once per empty window; a hit brings the throw
    // forward to a fuse.
    if (bot.targetIsPlayer) {
      const empty = !this.ballAtHand(0, 0) && !this.ballAtHand(0, 1);
      if (empty && !bot.punishArmed) {
        bot.punishArmed = true;
        if (Math.random() < b.punish) bot.throwTimer = Math.min(bot.throwTimer, BOT.punishFuse);
      } else if (!empty) bot.punishArmed = false;
    }

    bot.throwTimer -= delta;
    if (bot.throwTimer <= 0) {
      // Alternate fists, but only wind up a ball that is actually home; with
      // both away (a fast cadence outrunning the recall) wait a beat.
      let hand = (1 - bot.windupHand) as 0 | 1;
      if (!this.ballAtHand(bot.slot, hand)) hand = bot.windupHand;
      if (!this.ballAtHand(bot.slot, hand)) {
        bot.throwTimer = 0.25;
        return;
      }
      bot.throwTimer = b.throwInterval * (0.8 + Math.random() * 0.5);
      // FEINT: hold the orbit past its beat — an early dodge is spent by the
      // time the ball actually leaves.
      const hold = Math.random() < b.feint ? BOT.feintHold : 0;
      this.windUp(bot, hand, b.windup + hold);
    }
  }

  private release(bot: Bot, target: Vector3): void {
    const b = this.brain;
    const hand = bot.windupHand;
    const pose = opponents[bot.slot - 1];
    pose.orbiting[hand] = false;

    const from = pose.handPos[hand].clone();
    _aim.copy(target);
    if (bot.targetIsPlayer) {
      // AIM LAG: a rookie throws at your ghost — where your head was a
      // moment ago. LEAD: a veteran throws at where it will be when the ball
      // arrives, off its velocity over the flight time (capped so a sprint
      // never sends the ball into the next county).
      this.laggedHead(b.aimLag, _aim);
      if (b.lead > 0) {
        const flight = _aim.distanceTo(from) / b.throwSpeed;
        _tmp.copy(this.headVel).multiplyScalar(b.lead * flight);
        if (_tmp.lengthSq() > 0.8 * 0.8) _tmp.setLength(0.8);
        _aim.add(_tmp);
      }
    }
    // Mix the target: most throws hunt the HEAD (aim true at it), the rest
    // dip for the LOWER BODY — duck the high ones, jump/step the low ones.
    // A brain that READS HABITS bends the mix toward where you actually sit:
    // a ducker's head is on the pelvis line, so low throws find it.
    const habit = clamp(this.duckFrac * 1.2, 0.1, 0.8);
    const lowChance = lerp(b.lowAimChance, habit, b.readsHabits);
    _aim.y -= Math.random() < lowChance ? BOT.lowAimDrop : 0;
    _aim.x += (Math.random() - 0.5) * 2 * b.aimError;
    _aim.y += (Math.random() - 0.5) * 2 * b.aimError;

    _vel.copy(_aim).sub(from);
    const dist = _vel.length();
    _vel.normalize().multiplyScalar(b.throwSpeed);
    _vel.y += 0.5 * FIREBALL.gravity * (dist / b.throwSpeed); // lead the arc

    ballCommands.push({ type: 'throw', slot: bot.slot - 1, hand, pos: from, vel: _vel.clone() });
    bot.recallTimers[hand] = b.recallDelay;
    botLive.throws += 1;

    // DOUBLE TAP: queue the other fist, if its ball is home to throw.
    const other = (1 - hand) as 0 | 1;
    if (Math.random() < b.doubleTap && this.ballAtHand(bot.slot, other)) bot.followUp = BOT.doubleTapGap;
  }
}
