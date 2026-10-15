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
 *  - owns the SOCIAL panel (right Ⓐ on the club floor): everyone in the
 *    room, MUTE and BLOCK per dancer, your mic state, and the voice-chat
 *    master switch. The Horizon-store safety console, in house style.
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
import { DIFFICULTY, RING, hueToColor } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { preload } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { ballSpawnPos } from '../club/ball.js';
import { CLUB_NET } from '../club/config.js';
// MUTE and BLOCK are the safety console's to toggle now (ui/safety.ts owns
// both homes); the floor's own MUSIC switch stays here, because it belongs
// to the club and not to the ring.
import { clubMusicOn, socialBlocked, socialMuted, toggleClubMusic } from '../club/social.js';
import {
  clearVoiceSpeakers,
  isSpeaking,
  isVoiceCapturing,
  pushVoiceFrame,
  setVoiceSpeakerMuted,
  setVoiceSpeakerPosition,
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
import { bellView, FIGHTS, type BellMode } from '../club/bell.js';
import { coins } from '../../menu/wallet.js';
import { app, saveDifficulty } from '../../menu/appState.js';
import { DIFFICULTY as TIERS, DIFFICULTY_ORDER, type Difficulty } from '../../config.js';
import { difficultyUnlocked } from '../../campaign/campaignState.js';
import { font } from '../ui/fonts.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import {
  drawSafetyRows,
  safetyButtons,
  safetyClick,
  safetyKey,
  safetyRoster,
  voiceButtons,
  type SafetyLayout,
} from '../ui/safety.js';
import { PointerRay } from '../ui/pointer.js';

const TRACK_KEY = 'gdr-track';
/** The song list's window: rows are sized to be READ from a step back, so
 *  the shelf scrolls rather than shrinking every title to fit. */
const SONG_Y0 = 96;
const SONG_PITCH = 61;
const SONG_ROW_H = 55;
const SONG_VISIBLE = 12;

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

  private panel!: Panel;
  /** The song list, flown out beside the desk (see SONGS). */
  private songs!: Panel;
  /** THE BELL's two tabs (FF2 DESIGN §3.1): FIGHT calls one of the
   *  arena's fights, RAVE calls a record. FIGHT is only on offer where a
   *  host can open an arena room (raveBridge.openFightRoom) — the
   *  standalone rave page has no arena and shows the shelf alone. */
  private tab: 'fight' | 'rave' = raveBridge.openFightRoom ? 'fight' : 'rave';
  private fight: Exclude<BellMode, 'rave'> = '2v2';
  /** TITAN RAID run HARDCORE — no refit between titans. The desk's own
   *  toggle (the arena's lobby has the same one for a room hosted there);
   *  it rides the ball with the tier and the deal stamps it on the raid. */
  private hardcore = false;
  /** A fight call in flight: the arena is opening the room. */
  private calling = false;
  private callError = '';
  private songsOpen = false;
  private songsKey = '';
  /** First row of the song list's window. */
  private songScroll = 0;
  /** Thumbstick scroll needs a rest between steps or one flick runs the
   *  whole list past you. */
  private stickCool = 0;
  /** THE TIER LIST: the titan raid's difficulty, flown out beside the desk
   *  the way the records are — the row on the FIGHT tab opens it. */
  private tiers!: Panel;
  private tiersOpen = false;
  private tiersKey = '';
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hover: string | null = null;
  private paintKey = '';
  private clock = 0;

  init(): void {
    this.crowd.name = 'club-crowd';
    this.scene.add(this.crowd);

    // Inbound voice frames route straight to their spatial speaker.
    onVoice((id, frame) => pushVoiceFrame(id, frame));

    // With the board gone from the club floor, this panel is the floor's
    // whole console — the extra rows (difficulty, leave) earn it the height.
    this.panel = new Panel(0.6, 0.99, 700, 1155);
    this.panel.setShown(false, true);
    this.panel.group.rotation.order = 'YXZ';
    this.scene.add(this.panel.group);

    // THE SONG LIST, as a leaf off the desk: the ♪ row used to CYCLE, so
    // finding a record meant tapping through fourteen of them and reading
    // the label each time. It flies out to the left instead, whole, and
    // rides the desk (a child of its group) wherever the desk is placed.
    this.songs = new Panel(0.38, 0.777, 440, 900);
    this.songs.setShown(false, true);
    this.songs.group.position.set(-0.51, 0.107, 0.008);
    this.panel.group.add(this.songs.group);

    // THE TIER LIST, the same leaf on the FIGHT side: a TITAN RAID is a run
    // with a difficulty, and the tier picked here is the one the bell deals
    // to the whole squad. Top-aligned with the record list, shorter — four
    // tiers, not fourteen records.
    this.tiers = new Panel(0.38, 0.4, 440, 464);
    this.tiers.setShown(false, true);
    this.tiers.group.position.set(-0.51, 0.107 + 0.777 / 2 - 0.2, 0.008);
    this.panel.group.add(this.tiers.group);

    this.pointers = { left: new PointerRay(this.scene), right: new PointerRay(this.scene) };

    socialView.show = (on) => {
      this.panel.setShown(on);
      if (!on) {
        this.closeSongs();
        this.closeTiers();
      }
      if (on) this.place();
      this.paintKey = '';
    };
    socialView.snapTiers = () => (this.tiers.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    socialView.openTiers = (on) => this.openTiers(on);
    socialView.shown = () => this.panel.isShown;
    socialView.snapSongs = () => (this.songs.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    socialView.openSongs = (on) => this.openSongs(on);
    socialView.snapSocial = () => (this.panel.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    socialView.press = (id) => this.act(id);
  }

  update(delta: number): void {
    // The west door takes you out of the hall entirely: the floor's
    // figures, its crowd and its panel all belong to a room you aren't in.
    const inClub = (match.screen === 'lobby' || match.screen === 'tour') && !course.active;
    const inRoom = roomOpen();
    const liveSet = net.phase === 'live';

    this.syncRoster(inRoom || liveSet);
    this.crowd.visible = inClub && inRoom;

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
    this.songs.tick(delta, pulse);
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
    sendClubPose(d);
  }

  /** Scratch for the hands' quaternions on the way out. */
  private readonly handQ = new Quaternion();

  /* ── the SOCIAL panel ─────────────────────────────────────────────────── */

  private updatePanel(delta: number, allowed: boolean): void {
    if (!allowed && this.panel.isShown) this.panel.setShown(false);
    if (allowed && this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.setShown(!this.panel.isShown);
      if (this.panel.isShown) this.place();
      sfx.uiClick();
    }
    if (!this.panel.isShown) {
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
      // Every surface that is out — nearest hit wins, and the id says
      // which panel owns it ('song:' is the record list's, 'tier:' the
      // tier list's).
      const surfaces = [this.panel.mesh];
      if (this.songsOpen) surfaces.push(this.songs.mesh);
      if (this.tiersOpen) surfaces.push(this.tiers.mesh);
      const hit = this.ray.intersectObjects(surfaces, false)[0];
      const owner = hit?.object === this.songs.mesh ? this.songs : hit?.object === this.tiers.mesh ? this.tiers : this.panel;
      const id = hit?.uv ? owner.buttonAt(hit.uv.x, hit.uv.y) : null;
      if (hit?.object === this.songs.mesh) songHand = hand;
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
      this.songsKey = '';
      this.tiersKey = '';
    }
    if (clicked) {
      sfx.uiClick();
      this.act(clicked);
    }

    // Thumbstick scrolling on the song list — the stick of the hand that's
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
    if (this.songsOpen) this.paintSongs();
    if (this.tiersOpen) this.paintTiers();
  }

  /** Press one of the console's buttons — the trigger's path, and the
   *  headless finger's (socialView.press). */
  private act(id: string): void {
    const onList = id.startsWith('song:');
    const onTiers = id.startsWith('tier:');
    (onList ? this.songs : onTiers ? this.tiers : this.panel).press(id);
    if (onList) {
      const pick = id.slice(5);
      if (pick === 'up' || pick === 'down') {
        this.scrollSongs(pick === 'up' ? -SONG_VISIBLE : SONG_VISIBLE);
        return;
      }
      if (pick !== 'close') this.setTrack(pick === 'shuffle' ? '' : pick);
      this.closeSongs();
    } else if (onTiers) {
      // The titan raid's tier — the arena's own store, saved the way the
      // arena's picker saves it, so the RUN shelf and the desk agree. A
      // locked tier's row is not a button (paintTiers), so no re-check.
      const pick = id.slice(5);
      if (pick !== 'close' && (DIFFICULTY_ORDER as string[]).includes(pick)) {
        app.difficulty = pick as Difficulty;
        saveDifficulty();
      }
      this.closeTiers();
    } else if (id === 'raiddiff') {
      this.openTiers(!this.tiersOpen);
    } else if (id === 'raidhc') {
      this.hardcore = !this.hardcore;
    } else if (safetyClick(id)) {
      // MUTE, BLOCK, the mic and the voice master switch all belong to the
      // safety console (ui/safety.ts), which the mid-set card shares. Two
      // copies of a safety control is one you have to learn twice.
    } else if (id === 'music') {
      // THE MUSIC SWITCH. Local and persisted, like MUTE and BLOCK: the
      // floor keeps dancing to a record the room can still hear, and the
      // hush is waiting for you the next night too. MusicSystem reads the
      // preference every tick and closes the fader.
      toggleClubMusic();
    } else if (id === 'track') {
      this.openSongs(!this.songsOpen);
    } else if (id === 'tab-fight' || id === 'tab-rave') {
      this.tab = id === 'tab-fight' ? 'fight' : 'rave';
      this.callError = '';
      this.closeSongs();
      this.closeTiers();
    } else if (id.startsWith('fight-')) {
      const pick = FIGHTS.find((f) => f.id === id.slice(6));
      if (pick) this.fight = pick.id;
      if (this.fight !== 'raid') this.closeTiers();
    } else if (id === 'call') {
      if (this.tab === 'fight' && raveBridge.openFightRoom) this.callFight();
      else this.callFromHere();
    } else if (id === 'cancel') {
      cancelBall();
    } else if (id === 'start') {
      // Cut the wait: the relay deals whoever is on the ball right now.
      startBall();
    } else if (id === 'leave') {
      this.panel.setShown(false);
      this.closeSongs();
      this.closeTiers();
      leaveRoom();
    }
    this.paintKey = '';
  }

  /* ── TIERS: the list that flies out of the titan raid's row ───────────── */

  private openTiers(on: boolean): void {
    this.tiersOpen = on;
    this.tiers.setShown(on);
    this.tiersKey = '';
    this.paintKey = '';
    if (on) {
      this.closeSongs();
      this.paintTiers();
    }
  }

  private closeTiers(): void {
    if (this.tiersOpen) this.openTiers(false);
  }

  private paintTiers(): void {
    const cur = app.difficulty;
    const unlocked = DIFFICULTY_ORDER.map((t) => difficultyUnlocked(t));
    const key = `${cur}#${this.hover ?? ''}#${unlocked.join('')}`;
    if (key === this.tiersKey) return;
    this.tiersKey = key;

    const Y0 = 104;
    const PITCH = 74;
    const ROW_H = PITCH - 6;
    const CLOSE_Y = Y0 + DIFFICULTY_ORDER.length * PITCH + 8;
    // Ghost hit-areas over rows the body paints itself (name, blurb and the
    // lock on one plate); a locked tier gets no button at all.
    const buttons: PanelButton[] = [];
    DIFFICULTY_ORDER.forEach((t, i) => {
      if (!unlocked[i]) return;
      buttons.push({ id: `tier:${t}`, label: TIERS[t].label, ghost: true, x: 16, y: Y0 + i * PITCH, w: 408, h: ROW_H });
    });
    buttons.push({ id: 'tier:close', label: 'CLOSE', x: 16, y: CLOSE_Y, w: 408, h: 44, small: true });

    this.tiers.paint(
      '',
      (g) => {
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.font = font(600, 22);
        g.letterSpacing = '4px';
        g.fillStyle = UI.dim;
        g.fillText('TITAN RAID', 22, 50);
        g.letterSpacing = '0px';
        g.fillStyle = UI.lineFaint;
        g.fillRect(22, 76, 402, 2);

        DIFFICULTY_ORDER.forEach((t, i) => {
          const y = Y0 + i * PITCH;
          const selected = cur === t;
          const open = unlocked[i];
          const hov = open ? this.tiers.hoverOf(`tier:${t}`) : 0;
          g.beginPath();
          g.roundRect(16, y, 408, ROW_H, 9);
          g.fillStyle = selected ? UI.accentFaint : `rgba(255,255,255,${(0.03 + 0.05 * hov).toFixed(3)})`;
          g.fill();
          if (selected) {
            g.lineWidth = 2;
            g.strokeStyle = UI.accentDim;
            g.stroke();
            g.fillStyle = UI.accent;
            g.beginPath();
            g.roundRect(21, y + 8, 4, ROW_H - 16, 2);
            g.fill();
          }
          // The tier's own accent (the arena's), as a swatch by the name.
          g.fillStyle = open ? `#${TIERS[t].accent.toString(16).padStart(6, '0')}` : UI.faint;
          g.beginPath();
          g.arc(48, y + 26, 6, 0, Math.PI * 2);
          g.fill();
          g.textAlign = 'left';
          g.font = font(600, 23);
          g.letterSpacing = '1px';
          g.fillStyle = !open ? UI.faint : selected ? UI.textHi : UI.text;
          g.fillText(TIERS[t].label, 66, y + 26);
          g.letterSpacing = '0px';
          g.font = font(500, 17);
          g.fillStyle = open ? UI.dim : UI.faint;
          g.fillText(open ? TIERS[t].blurb : 'locked — clear the tier below', 66, y + 50, 350);
        });
      },
      buttons,
      this.hover,
    );
  }

  /* ── SONGS: the list that flies out of the ♪ row ──────────────────────── */

  private openSongs(on: boolean): void {
    this.songsOpen = on;
    this.songs.setShown(on);
    this.songsKey = '';
    this.paintKey = '';
    if (on) {
      this.revealCuedSong();
      this.paintSongs();
    }
  }

  private closeSongs(): void {
    if (this.songsOpen) this.openSongs(false);
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

  /** SHUFFLE, then the raid shelf alphabetically — the same order as the
   *  foyer's SELECT SONG, because the list is for FINDING a record. */
  private songRows(): { id: string; title: string; bpm: string }[] {
    const pool = [...tracksFor('raid')].sort((a, b) => a.title.localeCompare(b.title));
    return [
      { id: 'shuffle', title: 'SHUFFLE', bpm: '' },
      ...pool.map((t) => ({ id: t.id, title: t.title, bpm: `${Math.round(t.bpm)} BPM` })),
    ];
  }

  private songTop(total: number): number {
    return Math.max(0, Math.min(this.songScroll, total - SONG_VISIBLE));
  }

  private scrollSongs(by: number): void {
    const total = this.songRows().length;
    const next = Math.max(0, Math.min(this.songScroll + by, Math.max(0, total - SONG_VISIBLE)));
    if (next === this.songScroll) return;
    this.songScroll = next;
    this.songsKey = '';
  }

  /** Scroll the list so the cued record is inside the window. */
  private revealCuedSong(): void {
    const rows = this.songRows();
    const cur = match.preferredTrack || 'shuffle';
    const at = rows.findIndex((r) => r.id === cur);
    if (at < 0) return;
    const max = Math.max(0, rows.length - SONG_VISIBLE);
    if (at < this.songScroll) this.songScroll = Math.min(at, max);
    else if (at >= this.songScroll + SONG_VISIBLE) this.songScroll = Math.min(at - SONG_VISIBLE + 1, max);
  }

  private paintSongs(): void {
    const rows = this.songRows();
    const cur = match.preferredTrack || '';
    const top = this.songTop(rows.length);
    const key = `${cur}#${this.hover ?? ''}#${rows.length}#${top}`;
    if (key === this.songsKey) return;
    this.songsKey = key;

    const CLOSE_Y = 848;
    const scrolls = rows.length > SONG_VISIBLE;
    const shown = rows.slice(top, top + SONG_VISIBLE);
    // Ghost hit-areas: the body paints the rows itself so the title and the
    // BPM can share one line (the kit's label/sub would stack them). Only
    // the rows inside the window get one — a row scrolled out of sight is
    // not a row you can point at.
    const buttons: PanelButton[] = shown.map((r, i) => ({
      id: `song:${r.id}`,
      label: r.title,
      ghost: true,
      x: 16,
      y: SONG_Y0 + i * SONG_PITCH,
      w: 400,
      h: SONG_ROW_H,
    }));
    if (scrolls) {
      buttons.push({
        id: 'song:up',
        label: '▲',
        small: true,
        px: 20,
        disabled: top <= 0,
        x: 328,
        y: 26,
        w: 46,
        h: 44,
      });
      buttons.push({
        id: 'song:down',
        label: '▼',
        small: true,
        px: 20,
        disabled: top >= rows.length - SONG_VISIBLE,
        x: 378,
        y: 26,
        w: 46,
        h: 44,
      });
    }
    buttons.push({
      id: 'song:close',
      label: 'CLOSE',
      x: 16,
      y: CLOSE_Y,
      w: 408,
      h: 44,
      small: true,
    });

    this.songs.paint(
      '',
      (g) => {
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.font = font(600, 22);
        g.letterSpacing = '4px';
        g.fillStyle = UI.dim;
        g.fillText('SELECT SONG', 22, 48);
        g.letterSpacing = '0px';
        g.fillStyle = UI.lineFaint;
        g.fillRect(22, 80, 402, 2);

        shown.forEach((r, i) => {
          const y = SONG_Y0 + i * SONG_PITCH;
          const selected = cur === (r.id === 'shuffle' ? '' : r.id);
          const hov = this.songs.hoverOf(`song:${r.id}`);
          g.beginPath();
          g.roundRect(16, y, 400, SONG_ROW_H, 10);
          g.fillStyle = selected ? UI.accentFaint : `rgba(255,255,255,${(0.03 + 0.05 * hov).toFixed(3)})`;
          g.fill();
          if (selected) {
            g.lineWidth = 2;
            g.strokeStyle = UI.accentDim;
            g.stroke();
            g.fillStyle = UI.accent;
            g.beginPath();
            g.roundRect(21, y + 9, 4, SONG_ROW_H - 18, 2);
            g.fill();
          }
          const cy = y + SONG_ROW_H / 2 + 1;
          g.textAlign = 'left';
          g.font = font(600, 29);
          g.letterSpacing = '1px';
          g.fillStyle = selected ? UI.textHi : UI.text;
          g.fillText(r.title, 36, cy, 262);
          g.letterSpacing = '0px';
          g.textAlign = 'right';
          g.font = font(500, 18);
          g.fillStyle = UI.dim;
          g.fillText(r.bpm, 404, cy);
        });

        // The scrollbar: where the window sits on the whole shelf.
        if (scrolls) {
          const trackY = SONG_Y0;
          const trackH = SONG_VISIBLE * SONG_PITCH - (SONG_PITCH - SONG_ROW_H);
          const thumbH = Math.max(36, (trackH * SONG_VISIBLE) / rows.length);
          const thumbY = trackY + ((trackH - thumbH) * top) / (rows.length - SONG_VISIBLE);
          g.fillStyle = UI.lineFaint;
          g.beginPath();
          g.roundRect(422, trackY, 5, trackH, 2.5);
          g.fill();
          g.fillStyle = UI.dim;
          g.beginPath();
          g.roundRect(422, thumbY, 5, thumbH, 2.5);
          g.fill();
        }
      },
      buttons,
      this.hover,
    );
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

  /** THE BELL, a fight: ask the arena for a room, then send the ball up
   *  carrying its code. The ball only rises once the room exists — a
   *  deal into a room that isn't there would strand the squad. */
  private callFight(): void {
    const open = raveBridge.openFightRoom;
    const headObj = this.playerHeadEntity?.object3D;
    if (!open || !headObj || this.calling) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    const pos = ballSpawnPos(_v, _fwd);
    const mode = this.fight;
    // A TITAN RAID carries its tier — the desk's pick, as an index into the
    // arena's order — so the deal builds the same boss for the whole squad.
    const diff = mode === 'raid' ? Math.max(0, DIFFICULTY_ORDER.indexOf(app.difficulty)) : undefined;
    const hardcore = mode === 'raid' && this.hardcore;
    if (net.solo) {
      // A ROOM OF ONE: no arena room to open — the ball deals you into a
      // fight against the arena's own bots (net/session.ts soloCall).
      callBall(pos, { mode, code: '', diff, hardcore });
      return;
    }
    const me = net.members.find((m) => m.idx === net.myIdx);
    this.calling = true;
    this.callError = '';
    this.paintKey = '';
    open(mode, me?.name ?? '')
      .then((code) => {
        callBall(pos, { mode, code, diff, hardcore });
      })
      .catch((err: unknown) => {
        this.callError = err instanceof Error && err.message ? err.message : 'the arena could not open a room';
      })
      .finally(() => {
        this.calling = false;
        this.paintKey = '';
      });
  }

  /** In front of you at waist height with a lectern lean, facing you. */
  private place(): void {
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    _fwd.set(0, 0, -1).applyQuaternion(_camQ);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const m = this.panel.group;
    m.position.set(_cam.x + _fwd.x * 0.6, _cam.y - 0.42, _cam.z + _fwd.z * 0.6);
    m.rotation.set(-0.3, Math.atan2(_cam.x - m.position.x, _cam.z - m.position.z), 0);
    this.paintKey = '';
  }

  private paint(): void {
    const { rows: members, more } = safetyRoster(8);
    const music = clubMusicOn();
    const cued = trackById(match.preferredTrack);
    const ballUp = net.ball !== null;
    const mine = ballUp && net.ball!.callerIdx === net.myIdx;
    const setOut = net.gamePlayers.size > 0;
    const inRoom = roomOpen();
    const key =
      safetyKey(members, more) +
      `#${this.hover ?? ''}#${music ? 1 : 0}#${net.phase}#${cued?.id ?? ''}#${ballUp ? (mine ? `B${net.ball!.joins.size}` : 'b') : ''}#${setOut ? net.gamePlayers.size : 0}#${match.difficulty}#${this.songsOpen ? 1 : 0}#${net.crownIdx ?? ''}`;
    // The last take fades off the header after a while; quantised so the
    // fade costs a few repaints, not one a frame.
    const takeAge = performance.now() - bellView.paidAt;
    const takeShown = bellView.lastPay > 0 && takeAge < 20_000;
    const deskKey = `${key}#${this.tab}#${this.fight}#${this.calling ? 1 : 0}#${this.callError}#${coins.balance}#${takeShown ? bellView.lastPay : 0}#${app.difficulty}#${this.tiersOpen ? 1 : 0}#${this.hardcore ? 1 : 0}`;
    if (deskKey === this.paintKey) return;
    this.paintKey = deskKey;

    const ROW0 = 172;
    const ROW_H = 58;
    const rowsAt: SafetyLayout = { left: 28, right: 682, y: ROW0, rowH: ROW_H };
    const buttons: PanelButton[] = safetyButtons(members, rowsAt);

    // ── THE BELL: two tabs, one verb ──────────────────────────────────────
    // FIGHT picks one of the arena's fights; RAVE picks the record and its
    // chart. Either way the CTA is HOST — you are opening the room and the
    // floor can see the ball you just put up — and whoever touches the ball
    // rides along when the relay's clock hits zero.
    const fights = Boolean(raveBridge.openFightRoom);
    const tab = fights ? this.tab : 'rave';
    if (fights) {
      buttons.push({
        id: 'tab-fight',
        label: 'FIGHT',
        selected: tab === 'fight',
        x: 24,
        y: 644,
        w: 318,
        h: 44,
        small: true,
      });
      buttons.push({
        id: 'tab-rave',
        label: 'RAVE',
        selected: tab === 'rave',
        x: 358,
        y: 644,
        w: 318,
        h: 44,
        small: true,
      });
    }
    // With TITAN RAID lit the fight rows tighten to make room for its tier
    // row underneath; the other fights have no tiers and keep the height.
    const tiered = tab === 'fight' && this.fight === 'raid';
    if (tab === 'fight') {
      // The four fights, names only.
      FIGHTS.forEach((f, i) => {
        buttons.push({
          id: `fight-${f.id}`,
          label: f.label,
          selected: this.fight === f.id,
          x: 24 + (i % 2) * 334,
          y: 698 + Math.floor(i / 2) * (tiered ? 46 : 54),
          w: 318,
          h: tiered ? 42 : 48,
          small: true,
        });
      });
      if (tiered) {
        // THE TIER ROW: the titan raid's difficulty, opening onto the list
        // the way the ♪ row opens onto the records. It is the arena's own
        // pick (the RUN shelf's), and the bell deals it to the squad.
        buttons.push({
          id: 'raiddiff',
          label: `${this.tiersOpen ? '◂' : '▸'}  ◆ ${TIERS[app.difficulty].label}`,
          selected: this.tiersOpen,
          x: 24,
          y: 792,
          w: 408,
          h: 40,
          small: true,
        });
        // HARDCORE beside it: the raid lobby's breaker, on the floor. Lit in
        // the danger tone when armed, the way the lobby lights its own.
        buttons.push({
          id: 'raidhc',
          label: 'HARDCORE',
          selected: this.hardcore,
          tone: this.hardcore ? UI.danger : undefined,
          x: 440,
          y: 792,
          w: 236,
          h: 40,
          small: true,
        });
      }
    } else {
      buttons.push({
        id: 'track',
        // The chevron says the row opens onto something, rather than
        // advancing one notch per press.
        label: `${this.songsOpen ? '◂' : '▸'}  ♪ ${cued ? cued.title : 'SHUFFLE'}`,
        // No BPM under it. The kit stacks a `sub` below the label at a
        // fixed offset, which on a row this short hung the tempo outside
        // the plate — and the number is on the record list a tap away,
        // where it belongs when you are choosing between records.
        selected: this.songsOpen,
        x: 24,
        y: fights ? 698 : 652,
        w: 652,
        h: fights ? 58 : 74,
        small: true,
      });
      // DIFFICULTY: every ball off the tour calls EXPERT (DIFFICULTY.solo) —
      // one plate across the row the four choices used to share.
      buttons.push({
        id: 'expert',
        label: DIFFICULTY.labels[DIFFICULTY.solo],
        selected: true,
        x: 24,
        y: fights ? 764 : 740,
        w: 3 * 165 + 157,
        h: fights ? 40 : 54,
        small: true,
      });
    }
    const ctaY = tiered ? 838 : fights ? 810 : 808;
    const ctaH = tiered ? 56 : fights ? 72 : 74;
    if (mine) {
      // MY BALL IS UP, so the row splits: call it off, or drop the needle
      // now. The clock is a courtesy to a room still walking over, and a
      // room already standing at the ball should not have to watch it run
      // out — so the caller who can see everyone is in gets to say when.
      //
      // START carries the count it would deal, because that is the only
      // question the button raises: the ball fires with whoever has touched
      // in, and "just you" is a real and easy-to-miss answer.
      const aboard = net.ball!.joins.size + 1;
      buttons.push({
        id: 'cancel',
        label: 'CALL IT OFF',
        tone: UI.danger,
        x: 24,
        y: ctaY,
        w: 318,
        h: ctaH,
        small: true,
      });
      buttons.push({
        id: 'start',
        label: 'START',
        sub: aboard > 1 ? `${aboard} on the ${net.ball!.mode === 'rave' ? 'ring' : 'ball'}` : 'just you',
        primary: true,
        x: 358,
        y: ctaY,
        w: 318,
        h: ctaH,
        small: true,
      });
    } else {
      // The floor's one CTA. It says what it does and nothing else: the
      // subtitle used to explain the ball's whole ritual to a room that
      // can see the ball hanging in front of them.
      buttons.push({
        id: 'call',
        label: ballUp ? 'BALL IS UP' : setOut ? 'SET IS OUT' : this.calling ? 'OPENING A ROOM…' : 'HOST',
        // No explaining: the lit chip above says what is being called.
        sub: setOut ? `${net.gamePlayers.size} out` : this.callError || undefined,
        primary: true,
        disabled: ballUp || setOut || this.calling,
        x: 24,
        y: ctaY,
        w: 652,
        h: ctaH,
        small: true,
      });
    }

    // The desk's bottom lines, from the shared console — and on THIS floor
    // the voice switch is paired with MUSIC. The two things you HEAR here
    // are one decision made twice (quiet enough to talk, or loud enough to
    // dance), and reading them side by side is what makes "turn the music
    // down so we can chat" a single glance. The ring's card gets no music
    // switch: out there the record is the set's, not the floor's.
    buttons.push(...voiceButtons(24, fights ? 900 : 896, 652, { music: clubMusicOn() }));
    if (inRoom) {
      // The board's LEAVE moved in with the desk — the one door out of the
      // room that isn't a set.
      buttons.push({
        id: 'leave',
        label: 'LEAVE THE CLUB',
        tone: UI.danger,
        x: 24,
        y: 1036,
        w: 652,
        h: 64,
        small: true,
      });
    }

    this.panel.paint(
      '',
      (g) => {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(700, 42);
        g.letterSpacing = '3px';
        g.fillStyle = UI.textHi;
        g.fillText('THE ROOM', 28, 56);
        g.letterSpacing = '0px';
        if (inRoom) {
          // The code IS the invitation — it gets the data colour and the
          // wide tracking; everything around it stays quiet.
          g.font = font(600, 20);
          g.letterSpacing = '2px';
          g.fillStyle = UI.faint;
          g.fillText('ROOM', 28, 102);
          const rw = g.measureText('ROOM').width;
          g.font = font(700, 30);
          g.letterSpacing = '8px';
          g.fillStyle = UI.info;
          g.fillText(net.code, 28 + rw + 18, 102);
          const cw = g.measureText(net.code).width;
          g.font = font(500, 21);
          g.letterSpacing = '0.5px';
          g.fillStyle = UI.dim;
          g.fillText(`· ${net.members.length} on the floor`, 28 + rw + 18 + cw + 16, 102);
          g.font = font(500, 20);
          g.fillStyle = UI.faint;
          g.fillText('right Ⓐ closes', 28, 138);
          // THE WALLET, and what the last trip through the bell paid —
          // the floor is where the money shows, so a night here reads as
          // a night that earned.
          g.textAlign = 'right';
          g.font = font(700, 24);
          g.letterSpacing = '1px';
          g.fillStyle = UI.info;
          g.fillText(`$${coins.balance}`, 676, 102);
          if (takeShown) {
            g.font = font(600, 19);
            g.fillStyle = UI.accent;
            g.fillText(`+${bellView.lastPay} from the bell`, 676, 138);
          }
          g.textAlign = 'left';
        } else {
          g.font = font(500, 21);
          g.letterSpacing = '0.5px';
          g.fillStyle = UI.dim;
          g.fillText('host or join a room', 28, 102);
        }
        g.letterSpacing = '0px';

        drawSafetyRows(g, members, more, rowsAt, 'nobody else on the floor right now');

        // Section seams: the ball's console, the voice desk, the door.
        g.fillStyle = UI.lineFaint;
        g.fillRect(24, 634, 652, 2);
        g.fillRect(24, fights ? 890 : 884, 652, 2);
        if (inRoom) g.fillRect(24, 1024, 652, 2);
      },
      buttons,
      this.hover,
    );
  }
}
