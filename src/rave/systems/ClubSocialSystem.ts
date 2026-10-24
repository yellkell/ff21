/**
 * ClubSocialSystem — the people in the room, made present.
 *
 * While your room hangs on the club floor (hosting/joined), this system:
 *
 *  - streams YOUR spot — head + hands, club world space — at 12 Hz ('cp');
 *  - embodies every room-mate as a raver figure (the same slender rigs the
 *    raid uses, in their join colour) with a floating name tag that SWELLS
 *    while they talk, eased toward their streamed pose;
 *  - runs the voice room: auto-joins your mic on arrival (left Y mutes it),
 *    glues the audio listener to your head, and pins each dancer's voice to
 *    their figure — HRTF panners, distance falloff, a real hubbub. Voice
 *    carries within ONE PLACE only: the floor hears the floor, a set hears
 *    the set, and neither hears the other through the wall;
 *  - applies your safety lists every frame: a MUTED dancer goes silent, a
 *    BLOCKED one vanishes — figure, tag and voice, local only;
 *  - owns THE CLUB MENU (right Ⓐ on the club floor): the lobby's board
 *    format in the club's colours (club/clubMenu.ts, back from the Meta
 *    Quest build) — THE ROOM (everyone in it, MUTE and BLOCK per dancer),
 *    DISCO BALL (what the ball calls, and the call), SOUND (the mic, the
 *    voice-chat master switch, the floor's music) and LEAVE.
 *
 * When a set drops, the figures pack away (the raid's AvatarSystem takes
 * over on the ring) but the VOICE stays live among the dancers ON it,
 * pinned to each one's platform — so a raid keeps talking through the set
 * it's dancing while the party it left carries on without it.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RING, hueToColor } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { preload } from '../audio/music.js';
import { pickRaidTrack, trackById } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { ballSpawnPos } from '../club/ball.js';
import { CLUB_NET, inStillRoom } from '../club/config.js';
import { myHandFlags } from '../club/fingerGun.js';
// MUTE and BLOCK are the safety console's to toggle now (ui/safety.ts owns
// both homes); the floor's own MUSIC switch stays here, because it belongs
// to the club and not to the ring.
import { socialBlocked, socialMuted, toggleClubMusic } from '../club/social.js';
import { venueReady } from '../club/venue.js';
import {
  clearVoiceSpeakers,
  isSpeaking,
  isVoiceCapturing,
  pushVoiceFrame,
  setVoiceSpeakerMuted,
  setVoiceSpeakerPosition,
  setVoiceSpeakerWalled,
  startVoiceCapture,
  stopVoiceCapture,
  toggleVoiceMuted,
  updateVoiceListener,
  voiceEnabled,
} from '../club/voice.js';
import { buildDancer, type BlankDress, type DancerPose, type DancerRig } from '../game/blankDancer.js';
import { unpackLook } from '../../avatar/paint.js';
import { cleanGear } from '../../avatar/gear.js';
import { PoseMotion, type MotionTuning } from '../game/poseMotion.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { clubPoses, remotePoses, type RemotePose } from '../net/poses.js';
import {
  callBall,
  cancelBall,
  leaveRoom,
  memberHue,
  net,
  onVoice,
  seatByIdx,
  sendClubPose,
  sendVoice,
  startBall, inRoom as roomOpen } from '../net/session.js';
import { raveBridge } from '../bridge.js';
import { FIGHTS } from '../club/bell.js';
import { app, saveDifficulty } from '../../menu/appState.js';
import { DIFFICULTY_ORDER, type Difficulty } from '../../config.js';
import { difficultyUnlocked } from '../../campaign/campaignState.js';
import { font } from '../ui/fonts.js';
import { Panel } from '../../ui/kit/panel.js';
import { BOARD_H, BOARD_W, CLUB_LOOK, RailMarker } from '../../menu/board.js';
import { SONG_VISIBLE, clubMenuFace, clubMenuKey, revealCued, songRows, type ClubMenuState, type ClubTab, type FightMode } from '../club/clubMenu.js';
import { safetyClick } from '../ui/safety.js';
import { PointerRay } from '../ui/pointer.js';

const TRACK_KEY = 'gdr-track';
/** THE CLUB MENU's width at the lectern (m). */
const CLUB_MENU_W = 1.12;

/** Club figures track the wire critically damped — real people's motion
 *  carries its own character; the spring's job is continuity, not bounce.
 *  Head rate is the club's authored smoothing. */
const CLUB_MOTION: MotionTuning = { headRate: CLUB_NET.smoothing, handHz: 3.4, zeta: 1 };

const _v = new Vector3();
const _q = new Quaternion();
const _cam = new Vector3();
const _camQ = new Quaternion();
const _fwd = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
/** YXZ = the order a neck actually works in: swivel, then nod, then tilt. */
const _e = new Euler(0, 0, 0, 'YXZ');

interface ClubPuppet {
  idx: number;
  name: string;
  /** The hue this figure was built in — respawned if their pick changes. */
  hue: number;
  /** Their BODY off the wire (tone|gear|paint) — respawned if it changes. */
  body: string;
  rig: DancerRig;
  tag: Mesh;
  tagMat: MeshBasicMaterial;
  pose: DancerPose;
  /** The latest wire sample; the motion layer tracks it with critically
   *  damped hand springs (velocity-continuous over a 10 Hz stream). */
  tgt: DancerPose;
  motion: PoseMotion;
  /** False until their first club pose arrives — no gliding in from spawn. */
  live: boolean;
}

/** A name over a head, in their own colour. Exported because VOIDSTEP's
 *  riders wear the same tag as the club's dancers — one place they came
 *  from, one look. */
export function nameTagTexture(text: string, colorCss: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = font(700, 58);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorCss;
  g.shadowBlur = 24;
  g.fillStyle = colorCss;
  g.fillText(text, 256, 64, 470);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.font = font(700, 52);
  g.fillText(text, 256, 64, 460);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** One room-mate's live presence on the floor, published for the mirror.
 *  `pose` is the SAME object the puppet dances with (live reference, club
 *  world space); `shown` mirrors the figure's actual visibility — blocked
 *  dancers and dancers away on the ring are not shown, so they cast no
 *  reflection either. */
export interface FloorFigure {
  pose: DancerPose;
  hue: number;
  shown: boolean;
  /** The live puppet itself — the mirror SHADOWS it (twins of its meshes
   *  driven by its world matrices) rather than solving a second rig. */
  rig: DancerRig;
}

/** The club floor's figures by member idx (me excluded — I have no figure;
 *  ClubMirrorSystem builds my reflection from the headset directly). */
export const clubFloorFigures = new Map<number, FloorFigure>();

/** Headless/dev hook (wired into __gdr in main.ts): raise the SOCIAL panel
 *  without a controller. */
export const socialView: {
  show?: (on: boolean) => void;
  /** Is it actually up? `show(true)` off the club floor is refused, so the
   *  ask and the answer are not the same question. */
  shown?: () => boolean;
  snapSocial?: () => string;
  /** THE CLUB MENU's open rail tab, and the ids it offers. */
  tab?: () => ClubTab;
  buttons?: () => string[];
  snapSongs?: () => string;
  openSongs?: (on: boolean) => void;
  /** THE TIER list (the titan raid's difficulty), the songs' twin. */
  snapTiers?: () => string;
  openTiers?: (on: boolean) => void;
  /** Press any panel button by id — the headless finger for the floor's
   *  console. Named apart from menuView.act on purpose: __gdr.menu merges
   *  the two views into one namespace, and a shared name would hand every
   *  press to the board. */
  press?: (id: string) => void;
} = {};

export class ClubSocialSystem extends createSystem({}) {
  private crowd = new Group();
  private puppets = new Map<number, ClubPuppet>();
  private lastRosterKey = '';
  private sendT = 0;
  private voiceStarting = false;
  private voiceRetry = 0;

  /** THE CLUB MENU: one board (club/clubMenu.ts paints it). */
  private panel!: Panel;
  private board = new Group();
  private marker = new RailMarker();
  /** The board's own state; the room's comes off the session each paint. */
  private menu: ClubMenuState = {
    tab: 'room',
    // DISCO BALL's two tabs (FF2 DESIGN §3.1): FIGHT calls one of the
    // arena's fights, RAVE calls a record. FIGHT is only on offer where a
    // host can open an arena room (raveBridge.openFightRoom) — the
    // standalone rave page has no arena and shows the records alone.
    bellTab: raveBridge.openFightRoom ? 'fight' : 'rave',
    fights: Boolean(raveBridge.openFightRoom),
    fight: '2v2',
    // TITAN RAID run HARDCORE — no refit between titans; it rides the ball
    // with the tier and the deal stamps it on the raid.
    hardcore: false,
    // A fight call in flight: the arena is opening the room.
    calling: false,
    callError: '',
    songScroll: 0,
  };
  /** Thumbstick scroll needs a rest between steps or one flick runs the
   *  whole list past you. */
  private stickCool = 0;
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hover: string | null = null;
  private paintKey = '';
  private shown = false;
  private clock = 0;

  init(): void {
    this.crowd.name = 'club-crowd';
    this.scene.add(this.crowd);

    // Inbound voice frames route straight to their spatial speaker.
    onVoice((id, frame) => pushVoiceFrame(id, frame));

    // THE CLUB MENU: the board in front of you at the lectern, in the club's
    // own colours. The records and the raid's tiers live inline on its
    // DISCO BALL tab (they used to fly out of the desk as leaves).
    this.panel = new Panel(CLUB_MENU_W, CLUB_MENU_W * (BOARD_H / BOARD_W), BOARD_W, BOARD_H, { fill: CLUB_LOOK.pane });
    this.panel.setShown(false, true);
    this.board.rotation.order = 'YXZ';
    this.board.visible = false;
    this.board.add(this.panel.mesh);
    this.scene.add(this.board);

    this.pointers = { left: new PointerRay(this.scene), right: new PointerRay(this.scene) };

    socialView.show = (on) => this.show(on);
    socialView.shown = () => this.shown;
    socialView.tab = () => this.menu.tab;
    socialView.buttons = () => {
      this.paint();
      return this.panel.buttonIds();
    };
    const snap = (): string => {
      this.paintKey = '';
      this.paint();
      return (this.panel.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    };
    socialView.snapSocial = snap;
    // The old desk's leaves are DISCO BALL's two lists now: opening one opens the tab.
    socialView.openSongs = (on) => {
      if (on) this.openBell('rave');
    };
    socialView.snapSongs = snap;
    socialView.openTiers = (on) => {
      if (!on) return;
      this.openBell('fight');
      this.menu.fight = 'raid';
    };
    socialView.snapTiers = snap;
    socialView.press = (id) => this.act(id);
  }

  update(delta: number): void {
    // The west door takes you out of the hall entirely: the floor's
    // figures, its crowd and its panel all belong to a room you aren't in.
    const inClub = (match.screen === 'lobby' || match.screen === 'tour') && !course.active;
    const inRoom = roomOpen();
    const liveSet = net.phase === 'live';

    this.syncRoster(inRoom || liveSet);
    this.crowd.visible = inClub && inRoom && venueReady();

    // ── voice: capture + listener, whether on the floor or mid-set ──────
    this.voiceRetry = Math.max(0, this.voiceRetry - delta);
    if ((inRoom || liveSet) && voiceEnabled() && !isVoiceCapturing() && !this.voiceStarting && this.voiceRetry <= 0) {
      // Entering a room came from a button press, so the gesture gate is
      // usually warm; if the mic is refused we retry on a cadence (any
      // fresh trigger press clears the wait faster).
      this.voiceStarting = true;
      void startVoiceCapture(sendVoice).then((ok) => {
        this.voiceStarting = false;
        if (!ok) this.voiceRetry = 2.0;
      });
    }
    if (!inRoom && !liveSet && isVoiceCapturing()) {
      stopVoiceCapture();
      clearVoiceSpeakers();
    }
    if (inRoom || liveSet) {
      // Left Y flips your mic, club floor or mid-set alike.
      if (this.input.xr.gamepads.left?.getButtonDown(InputComponent.Y_Button)) {
        toggleVoiceMuted();
        sfx.uiClick();
        this.paintKey = '';
      }
      this.camera.getWorldPosition(_cam);
      this.camera.getWorldQuaternion(_camQ);
      updateVoiceListener(_cam, _camQ);
    }

    // ── my own spot on the floor, streamed to the room ──────────────────
    if (inClub && inRoom) {
      this.sendT -= delta;
      if (this.sendT <= 0) {
        this.sendT = 1 / CLUB_NET.poseRateHz;
        this.pumpClubPose();
      }
    }

    // ── the crowd ───────────────────────────────────────────────────────
    for (const p of this.puppets.values()) {
      const hidden = socialBlocked(p.name);
      // THE TWO ROOMS. A set and the club floor are different places, and
      // voice only carries within one: mid-set you hear the people dancing
      // it with you and not the party you left, and on the floor you hear
      // the floor and not a raid happening in another world. Spatial audio
      // needs somewhere to put a voice, and there is no honest answer for
      // "the club, from the ring" — it used to sing out of the stage, which
      // made a friend twenty metres away sound like they were in the set.
      //
      // The frames still arrive (the relay fans to the whole room); this is
      // a local gate, exactly like mute and block.
      // THE WEST DOOR is a third place under the same law. Out on the
      // circuit there is nowhere honest to put a voice from the hall — the
      // course is a storey of nothing away, and a friend at the bar would
      // either be silent or arrive out of the floor — so the floor goes
      // quiet with the record, and comes back with it.
      const ring = seatByIdx.get(p.idx);
      const theyDance = liveSet ? ring !== undefined : net.gamePlayers.has(p.idx);
      const elsewhere = theyDance !== liveSet || course.active;
      setVoiceSpeakerMuted(String(p.idx), hidden || elsewhere || socialMuted(p.name));

      if (liveSet) {
        // I'M on the ring. Fellow players' voices pin to their dancer on
        // their own platform. Anyone still on the floor is muted above and
        // needs no position at all.
        if (ring === undefined) continue;
        const root = platformRoot(ring);
        const pose = remotePoses.get(ring);
        if (root && pose) {
          _v.set(pose.hx, pose.hy, pose.hz);
          root.localToWorld(_v);
          setVoiceSpeakerPosition(String(p.idx), _v);
        }
        // No still room on the ring: nothing walls a fellow dancer off.
        setVoiceSpeakerWalled(String(p.idx), false);
        continue;
      }

      if (net.gamePlayers.has(p.idx)) {
        // They're away playing: their figure steps off the floor and their
        // voice goes with them (muted above) until the set folds back.
        p.rig.root.visible = false;
        const away = clubFloorFigures.get(p.idx);
        if (away) away.shown = false;
        p.tag.visible = false;
        continue;
      }
      if (!this.crowd.visible) continue;

      const netPose = clubPoses.get(p.idx);
      if (netPose && !p.live) {
        // First sighting: appear where they actually stand, no glide-in.
        p.live = true;
        this.wireTarget(p, netPose);
        p.motion.snap(p.pose, p.tgt);
      } else if (netPose) {
        this.wireTarget(p, netPose);
        p.motion.step(p.pose, p.tgt, delta, CLUB_MOTION);
      }
      p.rig.root.visible = p.live && !hidden;
      p.tag.visible = p.live && !hidden;
      const fig = clubFloorFigures.get(p.idx);
      if (fig) fig.shown = p.rig.root.visible;
      if (!p.live || hidden) continue;

      this.camera.getWorldPosition(_cam);
      // DETAIL by distance, like the ring — but re-tested each frame,
      // because a club floor is people WALKING rather than fixed decks.
      // The hall is 18 m end to end, so somebody at the far booths is as
      // far off as the other side of a full ring. (setDetail early-outs
      // unless the answer actually changed.)
      p.rig.setDetail(
        (p.pose.hx - _cam.x) ** 2 + (p.pose.hz - _cam.z) ** 2 <= RING.detailRadius ** 2,
      );
      // THE CROWN: the room's reigning winner wears it home. (setCrown
      // no-ops for the bare-headed majority; pose() below places it.)
      p.rig.setCrown(net.crownIdx === p.idx);
      p.rig.pose(p.pose);
      // Their voice speaks from their figure's head.
      _v.set(p.pose.hx, p.pose.hy, p.pose.hz);
      setVoiceSpeakerPosition(String(p.idx), _v);
      // THE STILL ROOM's wall: if one of you is inside it and the other
      // isn't, they're a murmur through it — the room stays still, and
      // what's said in it stays in it.
      setVoiceSpeakerWalled(String(p.idx), inStillRoom(p.pose.hx, p.pose.hz) !== inStillRoom(match.headX, match.headZ));
      // The name tag rides over the head, faces you, and swells a touch
      // while they hold the floor.
      p.tag.position.set(p.pose.hx, p.pose.hy + 0.38, p.pose.hz);
      p.tag.rotation.y = Math.atan2(_cam.x - p.pose.hx, _cam.z - p.pose.hz);
      const swell = isSpeaking(String(p.idx)) ? 1.14 : 1;
      p.tag.scale.set(swell, swell, 1);
    }

    // ── the SOCIAL panel ────────────────────────────────────────────────
    this.clock += delta;
    // The panel belongs to the SOCIAL FLOOR and nowhere else. It used to
    // open with no room too, on the theory that its empty state ("host or
    // join a room") was a signpost — but the foyer already has the board
    // for that, so all it did was put a second menu on a button in the
    // middle of the first one. Off the floor, right Ⓐ does nothing.
    this.updatePanel(delta, inClub && inRoom);
    const pulse = this.beatPulse();
    this.panel.tick(delta, pulse);
    // The rail's marker slides on its own clock: repaint while it moves.
    if (this.shown && this.marker.ease(delta)) this.panel.repaint();
  }

  /** The under-halo's beat envelope (the same curve the board uses) —
   *  ECLIPSE publishes match.beat on the floor; a house clock covers gaps. */
  private beatPulse(): number {
    const beat = Number.isFinite(match.beat) ? match.beat : this.clock / 0.86;
    const f = beat - Math.floor(beat);
    const att = Math.min(1, f / 0.06);
    const env = att * (1 - f) ** 3;
    return env * (Math.floor(beat) % 4 === 0 ? 1 : 0.5);
  }

  /* ── roster → puppets ─────────────────────────────────────────────────── */

  private syncRoster(connected: boolean): void {
    // The body is part of the key: a dancer who repaints between rooms
    // gets a fresh rig, exactly like a rename or a recolour does.
    const key = connected
      ? net.members
          .map((m) => `${m.idx}:${m.name}:${memberHue(m).toFixed(4)}:${m.tn ?? ''}:${m.gr ?? ''}:${m.lk ?? ''}`)
          .join('|') + `#${net.myIdx}`
      : '';
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;

    // Everyone but me, in the colour they dance in — their own pick if they
    // made one back in the foyer, otherwise the neon their slot handed out.
    const want = new Map<number, { name: string; hue: number; bodyKey: string; body: BlankDress }>();
    if (connected) {
      for (const m of net.members) {
        if (m.idx === net.myIdx) continue;
        // THE BODY off the roster — the mannequin they wear in the arena.
        want.set(m.idx, {
          name: m.name,
          hue: memberHue(m),
          bodyKey: `${m.tn ?? ''}|${m.gr ?? ''}|${m.lk ?? ''}`,
          body: { tone: m.tn === 'onyx' ? 'onyx' : 'white', gear: cleanGear(m.gr ?? ''), look: unpackLook(m.lk ?? '') },
        });
      }
    }
    // Despawn the departed — and anyone whose name, colour or BODY changed
    // under them: all three are baked into the rig (and the name and colour
    // into the tag). The body was in the roster key but not here, so a
    // dancer who re-geared or repainted mid-visit kept their old rig — on
    // the floor and in the mirror.
    for (const [idx, p] of [...this.puppets]) {
      const w = want.get(idx);
      if (!w || w.name !== p.name || Math.abs(w.hue - p.hue) > 1e-4 || w.bodyKey !== p.body) {
        p.rig.dispose();
        p.tag.removeFromParent();
        p.tagMat.map?.dispose();
        p.tagMat.dispose();
        this.puppets.delete(idx);
        clubFloorFigures.delete(idx);
      }
    }
    // Spawn the new (parked invisible until their first pose arrives).
    for (const [idx, { name, hue, bodyKey, body }] of want) {
      const existing = this.puppets.get(idx);
      if (existing) continue;
      // No glowsticks on the floor: the club is a room you talk in, and a
      // baton of light in every fist read as a rave that never stopped.
      const rig = buildDancer(hue, { ...body, sticks: false });
      rig.root.visible = false;
      this.crowd.add(rig.root);
      const tagMat = new MeshBasicMaterial({
        map: nameTagTexture(name, `#${hueToColor(hue, 0.62).toString(16).padStart(6, '0')}`),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const tag = new Mesh(new PlaneGeometry(0.72, 0.18), tagMat);
      tag.renderOrder = 24;
      tag.visible = false;
      this.crowd.add(tag);
      const pose: DancerPose = {
        hx: 0, hy: 1.55, hz: 3.8, yaw: 0, pitch: 0, roll: 0,
        lx: -0.3, ly: 1.0, lz: 3.7, rx: 0.3, ry: 1.0, rz: 3.7,
        slump: 0,
      };
      this.puppets.set(idx, {
        idx, name, hue, body: bodyKey, rig, tag, tagMat, pose,
        tgt: { ...pose }, motion: new PoseMotion(), live: false,
      });
      // The mirror watches the same pose object the puppet dances with.
      clubFloorFigures.set(idx, { pose, hue, shown: false, rig });
    }
    this.paintKey = ''; // roster changed → repaint the panel
  }

  /** Copy the latest wire sample into the puppet's target pose; the motion
   *  layer does the smoothing (and the sanitising — a bad sample can no
   *  longer poison a figure). */
  private wireTarget(p: ClubPuppet, s: RemotePose): void {
    const t = p.tgt;
    // The hands' turn, when the frame has it; w = 0 says "guess".
    if (s.lq) {
      [t.lqx, t.lqy, t.lqz, t.lqw] = s.lq;
    } else t.lqw = 0;
    if (s.rq) {
      [t.rqx, t.rqy, t.rqz, t.rqw] = s.rq;
    } else t.rqw = 0;
    // …and their grip, when the frame has it; missing says "at rest".
    if (s.lg) [t.lt, t.lg] = s.lg;
    else t.lt = t.lg = undefined;
    if (s.rg) [t.rt, t.rg] = s.rg;
    else t.rt = t.rg = undefined;
    // …and their touch + shots: a grab, or a finger gun that fires.
    t.lf = s.lf;
    t.rf = s.rf;
    t.hx = s.hx;
    t.hy = s.hy;
    t.hz = s.hz;
    t.yaw = s.hyaw;
    t.pitch = s.hpitch;
    t.roll = s.hroll;
    t.lx = s.lx;
    t.ly = s.ly;
    t.lz = s.lz;
    t.rx = s.rx;
    t.ry = s.ry;
    t.rz = s.rz;
  }

  private pumpClubPose(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    // Yaw comes out of the Y term unchanged (see NetworkSystem.pumpPose);
    // nod and tilt ride the tail so short frames still decode.
    _e.setFromQuaternion(_q, 'YXZ');
    const d: number[] = [_v.x, _v.y, _v.z, _e.y];
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldPosition(_o);
        d.push(_o.x, _o.y, _o.z);
      } else {
        d.push(_v.x + (hand === 'left' ? -0.25 : 0.25), Math.max(0.6, _v.y - 0.6), _v.z - 0.1);
      }
    }
    d.push(_e.x, _e.z);
    // THE HANDS' TURN: each controller's world quaternion, so a palm held
    // up on the floor is a palm held up in the glass and on every other
    // headset. The arena's gloves are built on exactly this (glove world
    // = ray quaternion × HAND_ADDUCTION), so the figure can wear it as is.
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldQuaternion(this.handQ);
        d.push(this.handQ.x, this.handQ.y, this.handQ.z, this.handQ.w);
      } else {
        d.push(0, 0, 0, 0);
      }
    }
    // THE FINGERS' SQUEEZE: trigger and grip per hand, so a fist made on
    // the floor closes on every other headset. (The glass reads your own
    // controllers directly — ClubMirrorSystem.readMyPose — rather than
    // waiting for this frame to come back.) Two decimals is all a finger
    // needs, and half the bytes of a raw float.
    for (const hand of ['left', 'right'] as const) {
      const gp = this.input.xr.gamepads[hand];
      d.push(
        Math.round((gp?.getButtonValue(InputComponent.Trigger) ?? 0) * 100) / 100,
        Math.round((gp?.getButtonValue(InputComponent.Squeeze) ?? 0) * 100) / 100,
      );
    }
    // THE FINGER GUNS: each hand's touch and shots fired, one small
    // integer apiece (club/fingerGun.ts) — so grip-without-trigger is a gun
    // on every other headset, and its BANG lands there however short the
    // hammer's fall was between two frames.
    d.push(myHandFlags[0], myHandFlags[1]);
    sendClubPose(d);
  }

  /** Scratch for the hands' quaternions on the way out. */
  private readonly handQ = new Quaternion();

  /* ── the SOCIAL panel ─────────────────────────────────────────────────── */

  private updatePanel(delta: number, allowed: boolean): void {
    if (!allowed && this.shown) this.show(false);
    if (allowed && this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.show(!this.shown);
      sfx.uiClick();
    }
    if (!this.shown) {
      this.pointers.left.hide();
      this.pointers.right.hide();
      return;
    }

    // Pointer: either controller ray; trigger clicks the hovered button.
    let hover: string | null = null;
    let clicked: string | null = null;
    let songHand: 'left' | 'right' | null = null;
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) {
        p.hide();
        continue;
      }
      rayObj.getWorldPosition(_o);
      rayObj.getWorldQuaternion(_q);
      _d.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.ray.set(_o, _d);
      this.ray.far = 3;
      const hit = this.ray.intersectObject(this.panel.mesh, false)[0];
      const id = hit?.uv ? this.panel.buttonAt(hit.uv.x, hit.uv.y) : null;
      if (id?.startsWith('song:')) songHand = hand;
      p.update(delta, _o, hit ? hit.point : null, Boolean(id));
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        clicked = id;
        p.click();
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
      this.paintKey = '';
    }
    if (clicked) {
      sfx.uiClick();
      this.act(clicked);
    }

    // Thumbstick scrolling on the record list — the stick of the hand that's
    // POINTING at it, a row per flick, held deflection repeats on a
    // cadence. The ▲▼ page by a screenful; this is the fine adjustment.
    this.stickCool = Math.max(0, this.stickCool - delta);
    const axes = songHand ? this.input.xr.gamepads[songHand]?.getAxesValues(InputComponent.Thumbstick) : undefined;
    const sy = axes?.y ?? 0;
    const flick = Math.abs(sy) > 0.6 ? (sy > 0 ? 1 : -1) : 0;
    if (flick !== 0 && this.stickCool <= 0) {
      this.stickCool = 0.16;
      this.scrollSongs(flick);
    } else if (flick === 0) {
      this.stickCool = 0;
    }

    this.paint();
  }

  /** Raise or put away THE CLUB MENU. */
  private show(on: boolean): void {
    this.shown = on;
    this.board.visible = on;
    this.panel.setShown(on);
    if (on) this.place();
    this.paintKey = '';
  }

  /** DISCO BALL, on one of its two tabs (the records scrolled to the cued one). */
  private openBell(tab: 'fight' | 'rave'): void {
    this.menu.tab = 'bell';
    this.menu.bellTab = this.menu.fights ? tab : 'rave';
    if (this.menu.bellTab === 'rave') this.menu.songScroll = revealCued(this.menu.songScroll);
    this.paintKey = '';
  }

  /** Press one of the board's buttons — the trigger's path, and the
   *  headless finger's (socialView.press). */
  private act(id: string): void {
    this.panel.press(id);
    if (id === 'tab-room' || id === 'tab-bell' || id === 'tab-sound' || id === 'tab-leave') {
      const tab = id.slice(4) as ClubTab;
      if (tab === 'bell') this.openBell(this.menu.bellTab);
      else this.menu.tab = tab;
    } else if (id.startsWith('song:')) {
      const pick = id.slice(5);
      if (pick === 'up' || pick === 'down') this.scrollSongs(pick === 'up' ? -SONG_VISIBLE : SONG_VISIBLE);
      else this.setTrack(pick === 'shuffle' ? '' : pick);
    } else if (id.startsWith('tier:')) {
      // The titan raid's tier — the arena's own store, saved the way the
      // arena's picker saves it, so the RUN shelf and the board agree. A
      // locked tier's row is not a button, so no re-check.
      const pick = id.slice(5);
      if ((DIFFICULTY_ORDER as string[]).includes(pick) && difficultyUnlocked(pick as Difficulty)) {
        app.difficulty = pick as Difficulty;
        saveDifficulty();
      }
    } else if (id === 'raidhc') {
      this.menu.hardcore = !this.menu.hardcore;
    } else if (safetyClick(id)) {
      // MUTE, BLOCK, the mic and the voice master switch all belong to the
      // safety console (ui/safety.ts), which the mid-set card shares.
    } else if (id === 'music') {
      // THE MUSIC SWITCH. Local and persisted, like MUTE and BLOCK: the
      // floor keeps dancing to a record the room can still hear.
      toggleClubMusic();
    } else if (id === 'tab-fight' || id === 'tab-rave') {
      this.openBell(id === 'tab-fight' ? 'fight' : 'rave');
      this.menu.callError = '';
    } else if (id.startsWith('fight-')) {
      const pick = FIGHTS.find((f) => f.id === id.slice(6));
      if (pick) this.menu.fight = pick.id as FightMode;
    } else if (id === 'call') {
      if (this.menu.bellTab === 'fight' && raveBridge.openFightRoom) this.callFight();
      else this.callFromHere();
    } else if (id === 'cancel') {
      cancelBall();
    } else if (id === 'start') {
      // Cut the wait: the relay deals whoever is on the ball right now.
      startBall();
    } else if (id === 'leave') {
      this.show(false);
      this.menu.tab = 'room';
      leaveRoom();
    }
    this.paintKey = '';
  }

  /** Take a record (or '' for SHUFFLE). The pick rides the ball when I call
   *  one — same store the foyer's board uses, so the two always agree. */
  private setTrack(id: string): void {
    match.preferredTrack = id;
    try {
      localStorage.setItem(TRACK_KEY, id);
    } catch {
      /* fine */
    }
    preload(trackById(id) ?? pickRaidTrack(match.seed));
  }

  private scrollSongs(by: number): void {
    const total = songRows().length;
    const next = Math.max(0, Math.min(this.menu.songScroll + by, Math.max(0, total - SONG_VISIBLE)));
    if (next === this.menu.songScroll) return;
    this.menu.songScroll = next;
    this.paintKey = '';
  }

  /** Send the ball up just ahead of me, and warm my record for the drop. */
  private callFromHere(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    callBall(ballSpawnPos(_v, _fwd));
    preload(trackById(match.preferredTrack) ?? pickRaidTrack(match.seed));
  }

  /** DISCO BALL, a fight: ask the arena for a room, then send the ball up
   *  carrying its code. The ball only rises once the room exists — a
   *  deal into a room that isn't there would strand the squad. */
  private callFight(): void {
    const open = raveBridge.openFightRoom;
    const headObj = this.playerHeadEntity?.object3D;
    if (!open || !headObj || this.menu.calling) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    const pos = ballSpawnPos(_v, _fwd);
    const mode = this.menu.fight;
    // A TITAN RAID carries its tier — the board's pick, as an index into the
    // arena's order — so the deal builds the same boss for the whole squad.
    const diff = mode === 'raid' ? Math.max(0, DIFFICULTY_ORDER.indexOf(app.difficulty)) : undefined;
    const hardcore = mode === 'raid' && this.menu.hardcore;
    if (net.solo) {
      // A ROOM OF ONE: no arena room to open — the ball deals you into a
      // fight against the arena's own (net/session.ts soloCall).
      callBall(pos, { mode, code: '', diff, hardcore });
      return;
    }
    const me = net.members.find((m) => m.idx === net.myIdx);
    this.menu.calling = true;
    this.menu.callError = '';
    this.paintKey = '';
    open(mode, me?.name ?? '')
      .then((code) => {
        callBall(pos, { mode, code, diff, hardcore });
      })
      .catch((err: unknown) => {
        this.menu.callError = err instanceof Error && err.message ? err.message : 'the arena could not open a room';
      })
      .finally(() => {
        this.menu.calling = false;
        this.paintKey = '';
      });
  }

  /** In front of you, a little below the eyes, with a lectern lean, facing you. */
  private place(): void {
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    _fwd.set(0, 0, -1).applyQuaternion(_camQ);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const m = this.board;
    m.position.set(_cam.x + _fwd.x * 0.82, _cam.y - 0.3, _cam.z + _fwd.z * 0.82);
    m.rotation.set(-0.22, Math.atan2(_cam.x - m.position.x, _cam.z - m.position.z), 0);
    this.paintKey = '';
  }

  private paint(): void {
    const key = `${clubMenuKey(this.menu)}#${this.hover ?? ''}`;
    if (key === this.paintKey) return;
    this.paintKey = key;
    const face = clubMenuFace(this.menu, (id) => this.panel.hoverOf(id), this.marker);
    this.panel.paint('', face.body, face.buttons, this.hover);
  }
}
