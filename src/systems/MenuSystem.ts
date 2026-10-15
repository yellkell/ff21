/**
 * Drives the lobby: draws controller laser pointers, raycasts the menu
 * panels for hover/click, runs the actions (Aim Training, quick match,
 * vs bot, shoot-back toggle), and shows/hides the right scene pieces per
 * app state. During a bout or training the menu hides and the pointers
 * disappear — your hands are for punching.
 *
 * The A button summons a small waist-height action panel (A again dismisses
 * it): FORFEIT mid-training; at the end of a bout, RETURN — plus REMATCH in
 * online bouts, where the panel pops up by itself for the decision.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection, CanvasTexture } from 'three';
import { app, saveDifficulty, saveEnvironment, saveOnlyBots, saveShootBack, type AppState, type ArcadeMode } from '../menu/appState.js';
import { bootIntroActive } from '../experience/introGate.js';
import { DIFFICULTY_ORDER, type Difficulty, PAINT } from '../config.js';
import { difficultyUnlocked } from '../campaign/campaignState.js';
import {
  clearProfileKeyboardHint,
  createActionPanel,
  createMenu,
  flashProfileKeyboardHint,
  profileHintActive,
  resetNewsScroll,
  scrollNews,
  tickCoinRollup,
  type ActionButton,
  type ActionPanel,
  type Menu,
  type MenuAction,
  type PanelId,
  NW,
  NH,
  renderNewsPage,
} from '../menu/menu.js';
import { createNameKeyboard, type NameKeyboard } from '../menu/keyboard.js';
import { installWrap, wrapNav, type Wrap } from '../menu/wrap.js';
import { clearReportSent, markReportSent, musicVolFromU, setCreditsOpen, sfxVolFromU } from '../menu/settingsFace.js';
// MENUS 3: the modals are kit faces now, each in its own module.
import { lockerFace, LOCKER_H, LOCKER_W } from '../menu/lockerFace.js';
import {
  bank,
  cancelCheckout,
  cancelRecovery,
  claimPurchases,
  loadPacks,
  openCheckout,
  protect,
  redeemCode,
  startCheckout,
  startRecovery,
  whoami,
} from '../net/bank.js';
import { campaignFace, campaignModal, CAMP_H, CAMP_W } from '../menu/campaignFace.js';
import { lobbyFace, LOBBY_H, LOBBY_W } from '../menu/lobbyFace.js';
import { ballsClick, ballsDrag, ballsFace, ballsFaceKey, ballsHit, BALLS_H, BALLS_W } from '../menu/ballsFace.js';
import { profilePop } from '../menu/profilePop.js';
import { audienceStands } from '../arena/desert/audience.js';
import { audienceView } from './AudienceSystem.js';
import { crowd } from '../audio/crowd.js';
import { currentVoiceContext, VOICE_RULES, voiceAllowed, hearAllowed } from '../net/voiceRules.js';
import { applyGhost, applyLook, bay, handLift, handPlace, handReturn, installPaintDevHook, myLook, paintState, togglePaintHiddenAll, undoLast, unitAt, type PaintPart } from '../avatar/paint.js';
import { pulseHand } from '../input/haptics.js';
import type { GearMap } from '../avatar/gearAtlas.js';
import { applyGear, cleanGear, GEAR, gearDef, type GearSlot, wornGear } from '../avatar/gear.js';
import { installGrammarDevHook } from '../campaign/grammar.js';
import { botGradeLine, botLive, installBotBrainDevHook } from '../combat/botBrain.js';
import { KitMenuPanel } from '../menu/wrap.js';
import type { PanelButton } from '../ui/kit/panel.js';
import { BAY_H, BAY_W, bayClick, bayFace, bayFaceKey, bayFaceState } from '../menu/paintbay.js';
import {
  avatarOwned,
  clearShopPreview,
  customization,
  myAvatarSkin,
  ownAvatar,
  ownPlatform,
  platformOwned,
  setAvatarColor,
  setAvatarSkin,
  setPlatformSkin,
  setShopPreview, gearOwned, gearWith, myGear, myPackedGear, ownGear, setGear, toggleGear } from '../menu/customization.js';
import { canAfford, coins, spendCoins } from '../menu/wallet.js';
import { playCash, preloadCash } from '../audio/cash.js';
import { setMenuMusicActive, toggleMusicMuted } from '../audio/menuMusic.js';
import { setMusicVolume } from '../audio/musicVolume.js';
import { handoffToLobby } from '../audio/battleMusic.js';
import { startLobbyWatch, stopLobbyWatch } from '../net/lobbyWatch.js';
import { setVoiceEnabled, voiceEnabled } from '../audio/voicePref.js';
import { buildBoxer, setAvatarAccent, solveTorso, type BoxerRig } from '../avatar/boxer.js';
import {
  AVATAR_SKINS,
  DECK_SHELVES,
  type DeckShelf,
  OPPONENT_DEFAULT_PLATFORM,
  PLATFORM_SKINS,
  PLATFORMS_OPEN,
  applyAvatarSkin,
  applyPlatformSkin,
  platformSkin,
  resolveAvatarSkin,
  shownPlatform,
} from '../avatar/skins.js';
import { match } from '../combat/matchState.js';
import { applyArenaLayout, tintPlatform } from '../arena/arena.js';
import { localLayout } from '../combat/layout.js';
import { mesh } from '../net/mesh.js';
import { UI } from '../ui/industrial.js';
import { net } from '../net/client.js';
import { tvServerUrl } from '../config.js';
import { inviteShare } from '../menu/lobbyFace.js';
import { startQueueWatch, stopQueueWatch } from '../net/queueWatch.js';
import { startRaidWatch, stopRaidWatch } from '../net/raidWatch.js';
import { startRankedWatch, stopRankedWatch } from '../net/rankedWatch.js';
import { startPubWatch, stopPubWatch } from '../net/pubWatch.js';
import { PUB_REGIONS } from '../pub/config.js';
import {
  boardScroll,
  hasCustomName,
  leaderboard,
  leaderboardRows,
  myNote,
  myStats,
  refreshLeaderboard,
  rival,
  sendReport,
  scrollLeaderboard,
  setLeaderboardTab,
  setRunView,
  type RunViewTier,
  setPlayerName,
  setPlayerNote,
  setProfileView,
  type LeaderboardTab,
  syncLookMirror,
} from '../net/leaderboard.js';
import { gazette, markGazetteRead, refreshGazette, type GazetteArticle } from '../net/gazette.js';
import { hueToColor, teamColor, WATCHER_SLOT } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { requestRaveEntry, requestVenueEntry } from '../experience/clubNavigation.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
const _magnetU = new Vector3();
const _magnetV = new Vector3();
const _head = new Vector3();
const _fwd = new Vector3();
const BOARD_SCROLL_DEADZONE = 0.55;
const BOARD_SCROLL_INITIAL_REPEAT = 0.28;
const BOARD_SCROLL_REPEAT = 0.12;
/** THE READER's canvas: the page at 2× (menu.ts NW × NH) plus a row for
 *  CLOSE under it. */
const READER_W = NW * 2;
const READER_H = NH * 2 + 120;

/** THE READER's face: the front page, large, and the way back. Tapping the
 *  page itself puts it back too — the same press that held it up. */
function readerFace(): { title: string; body: (g: CanvasRenderingContext2D, hover: string | null) => void; buttons: PanelButton[] } {
  return {
    title: '',
    buttons: [
      { id: 'reader-close', label: '', ghost: true, x: 0, y: 0, w: READER_W, h: NH * 2 },
      { id: 'reader-close', label: 'CLOSE', x: READER_W / 2 - 300, y: NH * 2 + 20, w: 600, h: 80, small: true },
    ],
    body: (g) => {
      g.drawImage(renderNewsPage(2), 0, 0, READER_W, NH * 2);
    },
  };
}

/** Pixels of newspaper body scrolled per thumbstick step (~2.5 lines). */
const NEWS_SCROLL_STEP = 76;

/** Panels a fresh boxer may use BEFORE running the tutorial: read the paper,
 *  flip passthrough, tweak settings. Everything else — every fight, the
 *  loadout, the shop — clanks like sealed armour until the tutorial has been
 *  run once (app.tutorialDone; the tutorial button itself is always live). */
function preTutorialAllowed(action: MenuAction | null): boolean {
  if (!action) return false;
  if (action === 'start-tutorial' || action === 'rename' || action === 'edit-note') return true;
  // Tabs, the paper, settings and the profile card all answer before the
  // tutorial; the ladder, the fights, the bay and the shop clank.
  return /^(wrap:tab-|open-gazette|gazette-close|gazette-reader|reader-close|open-settings|settings-|credits-back|sfx-|music-|toggle-mute|toggle-voice|toggle-hide-paint|profile-|badge-|lb-)/.test(action);
}

interface Pointer {
  line: Line;
  dot: Mesh;
}

/**
 * THE MAGNET's law: when the pointer misses the gear, a CONE of rays
 * round it is cast at the gear alone — two rings of eight, at these
 * half-angles (degrees; the outer is ~5 cm across at the mirror) — and
 * the nearest gear surface any of them finds wins, unless it sits deeper
 * than the pointer's own hit by more than the slack (m): gear behind the
 * body stays behind the body.
 */
const BAY_MAGNET_RINGS = [0.7, 1.5];
const BAY_MAGNET_SLACK = 0.06;

/**
 * THE STEADY HAND. The paint lands where the ray meets the body, and a
 * hand held out at arm's length shakes — a degree of tremor is two
 * centimetres on the blank. The bay aims with its own copy of each ray,
 * eased toward the real one at a rate that climbs with how far apart
 * they are: a tremor is soaked up, a deliberate sweep is followed at
 * once (a one-euro filter, in spirit). `base` is the rate at rest (per
 * second), `chase` how much each radian of gap adds to it.
 */
const BAY_STEADY = { base: 18, chase: 1600 };
/** THE TRIGGER'S JOLT: pulling a trigger tugs the controller, so a mark
 *  lands where the ray was this long BEFORE the pull registered (ms). */
const BAY_PULL_LEAD = 70;
/** Where the mirror stands: at home beside the LOCKER and STORE, and
 *  brought in to arm's reach while you paint — two metres off, a degree of
 *  aim was four centimetres of body. */
const MIRROR_HOME = { x: -0.75, z: -2.0 };
const MIRROR_PAINT = { x: -0.42, z: -1.22 };
/** How fast the thumbstick spins the blank in the bay (rad/s at full tilt),
 *  and turns a held mark (turns/s). */
const BAY_SPIN_RATE = 2.4;
const BAY_TWIST_RATE = 0.3;
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class MenuSystem extends createSystem({}) {
  private menu!: Menu;
  private wrap!: Wrap;
  private paintVersionSeen = 0;
  private bayPanel!: KitMenuPanel;
  /** The kit modals (MENUS 3) — ticked with the wrap so their hovers ease. */
  private modals: KitMenuPanel[] = [];
  /** Last loadout state the ball panel was drawn at (its own repaint key). */
  private ballsKey = '';
  private bayKey = '';
  private bayMeshes: Object3D[] = [];
  /** THE MAGNET: the gear on the mirror, the only thing the cone is cast
   *  at — a cuff is a five-centimetre ring two metres off, a horn a
   *  curled tube two centimetres wide, a mohawk spike seven millimetres. */
  private bayGear: Mesh[] = [];
  private magnetRay = new Raycaster();
  /** What the ghost last showed (a key of the held pose + the spot). */
  private bayGhostKey = '';
  private bayGhostOn = false;
  /** Each hand's steadied aim (THE STEADY HAND) and its recent spots on
   *  the body (THE TRIGGER'S JOLT). */
  private bayAimRay = {
    left: { o: new Vector3(), d: new Vector3(), live: false },
    right: { o: new Vector3(), d: new Vector3(), live: false },
  };
  private bayTrail: Record<'left' | 'right', Array<{ t: number; part: PaintPart; u: number; v: number; map?: GearMap }>> = { left: [], right: [] };
  /** Which hands' rays are on the body this frame. */
  private bayOnBody = { left: false, right: false };
  /** The blank's turn as shown (eased toward bayFaceState.yaw). */
  private mirrorTurn = 0;
  private mirrorShown = false;
  private twistWas = { left: false, right: false };
  private frameDt = 1 / 72;
  /** Last lobby-ness handed to the music (null = never) — see applyState(). */
  private musicInLobby: boolean | null = null;
  private ray = new Raycaster();
  private hovered: PanelId | null = null;
  private hoveredAction: MenuAction | null = null;
  private lastState: AppState | null = null;
  private pointers: Record<'left' | 'right', Pointer> = {} as Record<'left' | 'right', Pointer>;
  private redrawTimer = 0;
  /** Last customisation version the panels were drawn at — a chip pick or a
   *  colour-bar drag repaints them at once rather than on the 0.5 s tick. */
  private lastSkinDraw = 0;
  private panel!: ActionPanel;
  private panelKey = '';
  private wasMatchOver = false;
  /** FORFEIT tapped once — the button row shows ✕ / ✓ until answered. */
  private confirmForfeit = false;
  private keyboard!: NameKeyboard;
  /** The action waiting behind the name keyboard. */
  private kbPending: MenuAction | null = null;
  /** What the keyboard is taking: your callsign, your profile note, a
   *  safety report, or THE BANK's email (to protect, or to recover) and
   *  its six-digit recovery code. */
  private kbMode: 'name' | 'note' | 'report' | 'protect' | 'recover' | 'code' = 'name';
  private mirror?: { group: Group; rig: BoxerRig };
  /** THE PODIUM: your blank standing beside the YOU wing, always on show
   *  in the lobby — the avatar IS the menu's centrepiece now. */
  private podium?: Group;
  private skinVersion = 0;
  /** The opponent pad is modelling a STORE platform try-on (needs restoring). */
  private oppPadPreviewed = false;
  private boardScrollCooldown = 0;
  private boardScrollDir = 0;
  private newsScrollCooldown = 0;
  private newsScrollDir = 0;
  /** The board a ladder profile was opened from — BACK returns there. */
  private ladderFrom: LeaderboardTab = 'ranked';
  private draggingHue = false;
  private accentHue = Number.NaN;
  private accentLight = Number.NaN;
  /** Cached red glow group behind the FIRE FIGHT banner (pulsed in the lobby). */
  private bannerGlow?: Group;
  /** Which hand+panel currently owns a slider scrub. A scrub may only START on
   *  a fresh trigger press over the track, so a trigger held from opening the
   *  panel (or clicking elsewhere) can't hijack a slider as the ray crosses it. */
  private sliderGrab: { hand: 'left' | 'right'; panel: PanelId } | null = null;
  /** The hand scrubbing the loadout's BEND slider on the ACTION panel
   *  (between rounds), held until its trigger opens. */
  private loadoutGrab: 'left' | 'right' | null = null;
  /** Cached raycast target list — rebuilt only when panel visibility flips
   *  (modal open/close), not re-filtered/mapped every frame. */
  private rayTargets: Object3D[] = [];
  /** Reused intersect scratch so the two casts per frame allocate nothing. */
  private hits: Intersection[] = [];
  /** Snapshot of the live lobby data behind the freshness tick — the panels
   *  only repaint (canvas redraw + texture upload ×8) when one of these
   *  actually changed, not blindly twice a second. */
  private lastLive: unknown[] = [];
  /** Monotonic token for lobby-join attempts — see the lobby-join handler. */
  private lobbyJoinSeq = 0;

  /** Everything the lobby panels draw that can change WITHOUT a local click:
   *  network watches, fetches, the mesh lobby, the profile-hint timer. Click,
   *  hover, scroll and skin changes all repaint through their own paths. */
  private liveDirty(): boolean {
    const cur: unknown[] = [
      app.searching,
      app.netStatus,
      app.venueStatus, // the CLUB door's wait, read out while it's held
      app.pubCount,
      // Fresh object every 8 s poll — stringify so identical counts don't repaint.
      JSON.stringify(app.pubRegionCounts),
      app.lobbyRooms,
      app.rankedRooms,
      app.raidsOpen, // the RAID button's live badge

      app.privateCode, // arrives async while hosting a private match
      leaderboard.ranked, // all boards are replaced together per fetch
      leaderboard.status,
      gazette.article,
      gazette.status,
      gazette.unread,
      mesh.joined,
      mesh.full,
      mesh.names.join('|'),
      coins.balance,
      bank.version, // a checkout opening, paying, failing — the BANK board's face
      profileHintActive(), // flips false when the hint expires — one repaint clears it
    ];
    const last = this.lastLive;
    let dirty = last.length !== cur.length;
    if (!dirty) {
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] !== last[i]) {
          dirty = true;
          break;
        }
      }
    }
    this.lastLive = cur;
    return dirty;
  }

  init(): void {
    this.menu = createMenu(this.scene);
    // THE WRAP: the kit panels replace the legacy train/duel/info plates in
    // place (same ids, same slots) — see menu/wrap.ts. The second argument
    // lets the headless dev hook (__ff2.wrap.act) fire real actions.
    this.wrap = installWrap(this.menu, (a) => this.run(a));
    // THE PAINT BAY: a kit modal panel beside the locker mirror. Local
    // pb:* ids settle in bayClick; real actions go through run().
    // The PAINT tab of the one customization plate: the same size and
    // place as the LOCKER and the STORE, so the tabs swap faces, not rooms.
    this.bayPanel = new KitMenuPanel('paintbay', 0.94, 0.94 * (BAY_H / BAY_W), BAY_W, BAY_H, bayFace, (id) => {
      if (!bayClick(id)) this.run(id as MenuAction);
    });
    this.bayPanel.mesh.position.set(0.5, 1.52, -1.1);
    this.bayPanel.mesh.rotation.y = -0.3;
    this.bayPanel.mesh.visible = false;
    this.menu.panels.push(this.bayPanel);
    this.menu.group.add(this.bayPanel.mesh);
    // THE MODALS (MENUS 3), all on the kit: the locker and the store, the
    // titan line-up, the arcade lobby and the ball loadout. Same panel ids
    // as the plates they replace, so every bit of the visibility and
    // routing machinery below is untouched — only the faces changed.
    // (The STORE's paint racks answer their `pb:*` ids in paintbay.ts.)
    this.addModal('custom', 0.94, 0.94, LOCKER_W, LOCKER_H, () => lockerFace(true), [0.5, 1.52, -1.1], -0.3);
    this.addModal('shop', 0.94, 0.94, LOCKER_W, LOCKER_H, () => lockerFace(false), [0.5, 1.52, -1.1], -0.3, (id) => bayClick(id));
    this.addModal('campaign', 1.5, 1.5 * (CAMP_H / CAMP_W), CAMP_W, CAMP_H, campaignFace, [0, 1.5, -1.2], 0);
    this.addModal('lobby', 1.05, 1.05 * (LOBBY_H / LOBBY_W), LOBBY_W, LOBBY_H, lobbyFace, [0, 1.5, -1.18], 0);
    // THE READER: the Gazette held up large, straight ahead, where the slab
    // was. The page renders at 2× so the type is sharp at reading distance;
    // the thumbstick scrolls it as it does on the wing, and tapping the page
    // (or CLOSE) puts it back.
    this.addModal('reader', 1.2, 1.2 * (READER_H / READER_W), READER_W, READER_H, readerFace, [0, 1.5, -1.12], 0);
    // The loadout hangs out on the RIGHT, clear of the mirror on the left,
    // and answers its own `ball:*` ids before anything global.
    // …and settles its own scrub: the BEND slider on its ADVANCED face.
    this.addModal('balls', 0.8, 0.8, BALLS_W, BALLS_H, ballsFace, [1.32, 1.18, -0.66], -0.6, (id) => ballsClick(id), ballsDrag);
    // THE MODALS, readable headlessly: what each one is offering, and its
    // canvas, so a probe can walk every face without a headset.
    // __ff2.bank — THE BANK's probe verbs (tools/bank-check.mjs): the
    // board's live state, and a claim on demand.
    (window.__ff2 as unknown as Record<string, unknown>).bank = {
      state: () => ({
        status: bank.status,
        mode: bank.mode,
        packs: bank.packs.map((p) => p.id),
        checkout: bank.checkout
          ? { id: bank.checkout.id, state: bank.checkout.state, short: bank.checkout.short, paid: bank.checkout.paid, note: bank.checkout.note }
          : null,
        coins: coins.balance,
      }),
      claim: () => claimPurchases(),
    };
    (window.__ff2 as unknown as Record<string, unknown>).modals = {
      buttons: (id: string): string[] => {
        const p = this.menu.panels.find((x) => x.id === id) as KitMenuPanel | undefined;
        return p?.kit?.buttonIds() ?? [];
      },
      live: (id: string): string[] => {
        const p = this.menu.panels.find((x) => x.id === id) as KitMenuPanel | undefined;
        return p?.kit?.liveButtons() ?? [];
      },
      snap: (id: string): string => {
        const p = this.menu.panels.find((x) => x.id === id) as KitMenuPanel | undefined;
        if (!p?.kit) return '';
        p.redraw(null);
        return (p.kit.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
      },
      /** A button's plate on a panel, in canvas pixels — and what a press
       *  at a canvas pixel would actually hit, which is not always the
       *  button drawn there (the store's BUY sits on its tile's ghost). */
      rect: (id: string, button: string): { x: number; y: number; w: number; h: number } | null => {
        const p = this.menu.panels.find((x) => x.id === id) as KitMenuPanel | undefined;
        return p?.kit?.rectOf(button) ?? null;
      },
      at: (id: string, x: number, y: number): string | null => {
        const p = this.menu.panels.find((x) => x.id === id) as KitMenuPanel | undefined;
        return p?.kit?.buttonAtPx(x, y) ?? null;
      },
      up: (id: string): boolean => this.menu.panels.find((x) => x.id === id)?.mesh.visible === true,
      /** The action panel's status line right now (the bot's grade, a
       *  forfeit prompt, a rematch call) — '' when no panel applies. */
      status: (): string => this.panelContent()?.status ?? '',
    };
    installPaintDevHook(); // __ff2.paint — THE PAINT's dev/probe verbs
    // THE AUDIENCE (DESIGN §3.2), drivable headlessly: take a place on the
    // terrace, put a watcher on the wire, read the room's roar.
    (window.__ff2 as unknown as Record<string, unknown>).audience = {
      stands: (): number => audienceStands().length,
      where: () => audienceView.mine,
      bodies: (): number => audienceView.bodies,
      roar: () => ({ mine: crowd.myRoar, room: crowd.roomRoar, level: crowd.level }),
      /** Enter the current bout as a watcher (or stand down again). */
      watch: (on: boolean, seat = 4): void => {
        mesh.watching = on;
        if (on) {
          mesh.capacity = 2;
          mesh.mySeat = seat;
        }
        app.spectating = on;
        app.mySlot = on ? WATCHER_SLOT : 0;
        app.arcade = '1v1';
        app.state = on ? 'playing' : 'menu';
      },
      /** Put a watcher on the wire, as the mesh would. */
      wire: (seat: number, x: number, y: number, z: number, roar: number): void => {
        mesh.watchers.set(seat, { x, y, z, qx: 0, qy: 0, qz: 0, qw: 1, roar, at: performance.now() });
      },
      clear: (): void => mesh.watchers.clear(),
      /** Is my own pedestal still under me? (A watcher's is not.) */
      pad: (): boolean => this.scene.getObjectByName('player-platform')?.visible !== false,
      /** Bodies actually standing in the scene at the rail. */
      inScene: (): number => {
        let n = 0;
        this.scene.traverse((o) => {
          if (o.name === 'terrace-watcher') n++;
        });
        return n;
      },
      /** The whole local roster as a watcher sees it: me, then every fighter. */
      roster: (): number[] => localLayout().map((s) => s.canonical),
    };
    // WHO HEARS WHOM (net/voiceRules.ts), readable headlessly.
    (window.__ff2 as unknown as Record<string, unknown>).voice = {
      context: currentVoiceContext,
      rules: VOICE_RULES,
      allowed: voiceAllowed,
      hear: hearAllowed,
      ranked: (on: boolean): void => {
        app.fromRanked = on;
      },
    };
    installGrammarDevHook(); // __ff2.grammar — THE ENCORE's pure move grammar
    installBotBrainDevHook(); // __ff2.bot — THE BOT LADDER, and the live bout's brain
    // Probe-only: drive the bay panel's own click path (wallet included).
    (window.__ff2 as unknown as Record<string, unknown>).bayClick = (id: string): void => {
      if (!bayClick(id)) this.run(id as MenuAction);
    };
    // Probe-only: dump a rig's baked part canvas for inspection.
    /** What the named rig piece is wearing right now (the headless checks
     *  ask whether your own gloves got their cuffs). */
    (window.__ff2 as unknown as Record<string, unknown>).worn = (rootName: string): string[] => {
      const obj = this.scene.getObjectByName(rootName);
      return obj ? wornGear(obj) : [];
    };
    /** THE MAGNET, tried headlessly: aim from the player's eye at the
     *  named piece's centre, tilted off it by `offDeg` (a miss the width
     *  of a finger at the mirror), and say what the bay would paint. */
    (window.__ff2 as unknown as Record<string, unknown>).bayAim = (part: string, offDeg: number): string | null => {
      const piece = this.bayGear.find((m) => m.userData.paintPart === part);
      if (!piece) return null;
      // Aim at the piece's nearest point to the eye — on its surface, where
      // a finger would point. (A merged piece's centre can sit inside the
      // head: the middle of a PAIR of horns is between them.)
      const origin = new Vector3(0, 1.6, 0);
      const pos = piece.geometry.getAttribute('position');
      const centre = new Vector3();
      const v = new Vector3();
      let best = Infinity;
      const step = Math.max(1, Math.floor(pos.count / 3000));
      for (let i = 0; i < pos.count; i += step) {
        piece.localToWorld(v.fromBufferAttribute(pos, i));
        const d = v.distanceToSquared(origin);
        if (d < best) {
          best = d;
          centre.copy(v);
        }
      }
      const dir = centre.clone().sub(origin).normalize();
      const side = new Vector3(0, 1, 0).cross(dir).normalize();
      dir.addScaledVector(side, Math.tan((offDeg * Math.PI) / 180)).normalize();
      this.ray.set(origin, dir);
      this.hits.length = 0;
      const direct = this.ray.intersectObjects(this.bayMeshes, false, this.hits)[0];
      const directPart = direct ? String(direct.object.userData?.paintPart ?? '') : '';
      const on = this.bayAim(direct ? { ...direct } : undefined, origin, dir);
      return on ? String(on.object.userData?.paintPart ?? '') + (directPart && directPart !== String(on.object.userData?.paintPart) ? ` (over ${directPart})` : '') : null;
    };
    // THE GEAR ATLAS, headless: the paintable gear on the mirror, a spot
    // on each piece's surface (the middle triangle's centre, in its atlas
    // UVs), and which placed mark (index) is under that spot.
    const gearSpot = (i: number): { part: PaintPart; u: number; v: number; map?: GearMap } | null => {
      const m = this.bayGear[i];
      const uv = m?.geometry.getAttribute('uv');
      const idx = m?.geometry.getIndex();
      if (!m || !uv) return null;
      const tri = Math.floor((idx ? idx.count : uv.count) / 6) * 3;
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(tri + k) : tri + k;
        u += uv.getX(vi) / 3;
        v += uv.getY(vi) / 3;
      }
      return { part: m.userData.paintPart as PaintPart, u, v, map: m.userData.paintMap as GearMap | undefined };
    };
    (window.__ff2 as unknown as Record<string, unknown>).bayGearProbe = {
      count: (): number => this.bayGear.length,
      spot: (i: number) => {
        const s = gearSpot(i);
        return s ? { part: s.part, u: s.u, v: s.v } : null;
      },
      at: (i: number): number => {
        const s = gearSpot(i);
        return s ? unitAt(s.part, s.u, s.v, s.map) : -2;
      },
      /** Where the mirror's hips are, in its own frame (gear is placed off them). */
      hips: (): number[] => this.mirror?.rig.body.position.toArray() ?? [],
      /** The mirror's two hands (left, right), in its own frame. */
      gloves: (): number[][] => this.mirror?.rig.gloves.map((g) => g.position.toArray()) ?? [],
      /** Aim at the mirror's gear from `from` toward `to` (its own frame):
       *  what the ray hits, and which placed mark (index) is under it. */
      hit: (from: number[], to: number[]) => {
        const g = this.mirror?.group;
        if (!g) return null;
        g.updateMatrixWorld(true);
        const o = g.localToWorld(new Vector3(from[0], from[1], from[2]));
        const t = g.localToWorld(new Vector3(to[0], to[1], to[2]));
        this.magnetRay.set(o, t.sub(o).normalize());
        const h = this.magnetRay.intersectObjects(this.bayGear, false)[0];
        if (!h?.uv) return null;
        const part = h.object.userData.paintPart as PaintPart;
        const map = h.object.userData.paintMap as GearMap | undefined;
        return { part, u: h.uv.x, v: h.uv.y, at: unitAt(part, h.uv.x, h.uv.y, map) };
      },
    };
    (window.__ff2 as unknown as Record<string, unknown>).paintSnap = (rootName: string, part: string): string => {
      const obj = this.scene.getObjectByName(rootName);
      let url = '';
      obj?.traverse((o) => {
        const store = o.userData?.paintStore as { canvas: HTMLCanvasElement } | undefined;
        if (o.userData?.paintPart === part && store && !url) url = store.canvas.toDataURL('image/png');
      });
      return url;
    };
    this.buildPodium();
    this.panel = createActionPanel(this.scene);
    this.keyboard = createNameKeyboard(this.scene);
    this.pointers.left = this.makePointer();
    this.pointers.right = this.makePointer();
    preloadCash(); // the shop money sting, ready before the first buy

    this.applyState();
  }

  /** A five-digit `?join=` code from the boot URL — taken once the lobby is
   *  standing, then dropped from the address so a reload doesn't rejoin. */
  private bootJoin = ((): string => {
    try {
      const j = new URLSearchParams(location.search).get('join') ?? '';
      return /^\d{5}$/.test(j) ? j : '';
    } catch {
      return '';
    }
  })();

  /** THE JOIN LINK (DESIGN §8.1): booted with ?join=CODE, the lobby types
   *  the code itself and walks into whatever the host opened. */
  private takeBootJoin(): void {
    if (!this.bootJoin || app.state !== 'menu') return;
    const code = this.bootJoin;
    this.bootJoin = '';
    try {
      const u = new URL(location.href);
      u.searchParams.delete('join');
      history.replaceState(null, '', u.toString());
    } catch {
      /* the address stays — harmless */
    }
    app.codeEntry = code;
    app.duelView = 'keypad';
    app.netStatus = `joining room ${code}…`;
    this.joinByCode(code);
  }

  /** THE BOT's write path (DESIGN §8.2): POST this room's code to the room
   *  server's /tv/invite; the bot posts a card with the join link. */
  private postInvite(): void {
    const code = app.privateCode;
    if (!code || inviteShare.state === 'sending') return;
    inviteShare.code = code;
    inviteShare.state = 'sending';
    const http = tvServerUrl().replace(/^ws/, 'http').replace(/\/tv\/?$/, '') + '/tv/invite';
    const cap = mesh.capacity || 2;
    const open = Math.max(0, cap - mesh.occupants.slice(0, cap).filter(Boolean).length);
    void fetch(http, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, mode: app.lobbyMode ?? '1v1', name: myStats().name, open }),
    })
      .then((r) => r.json() as Promise<{ posted?: boolean; reason?: string }>)
      .then((r) => {
        inviteShare.state = r.posted ? 'posted' : 'failed';
        inviteShare.reason = r.reason ?? '';
      })
      .catch(() => {
        inviteShare.state = 'failed';
        inviteShare.reason = 'unreachable';
      });
  }

  update(delta: number): void {
    this.takeBootJoin();
    this.frameDt = Math.min(0.1, Math.max(1 / 240, delta));
    // THE MIRROR: comes in to arm's reach for the PAINT tab and turns to
    // the bay's facing, easing both ways; home beside the other two faces.
    this.updateMirrorPose(delta);
    if (app.state !== this.lastState) this.applyState();
    this.applyOwnSkins();
    this.pulseBannerGlow();
    // Advance the wrap's kit transitions (hover eases, press flashes, the
    // halo breath) every frame — a no-op while nothing moves.
    this.wrap.tick(delta);
    this.bayPanel?.tick(delta, 0);
    for (const m of this.modals) if (m.mesh.visible) m.tick(delta, 0);
    // The loadout answers its own clicks, so nothing else knows to repaint it.
    const bk = ballsFaceKey();
    if (bk !== this.ballsKey) {
      this.ballsKey = bk;
      this.redrawPanel('balls');
    }

    // The BOOT INTRO owns the view: the lobby is live behind the black shade,
    // so without this the pointers sweep panels nobody can see — chirping the
    // hover zap through the whole sequence and able to click things blind.
    if (bootIntroActive()) {
      this.hidePointers();
      return;
    }

    if (app.state === 'training' || app.state === 'playing') {
      this.updateActionPanel();
      return;
    }

    // The name keyboard owns the pointers while it's up.
    if (this.keyboard.isOpen()) {
      this.updateKeyboard();
      return;
    }

    // ARCADE LOBBY lifecycle (2v2 / ffa / raid): the room list is only watched
    // while the browser face is up (and we're not already seated). Every mode
    // AUTO-LAUNCHES when the room fills — the HOST stamps the room doc's
    // `started` flag (single writer) and EVERYONE enters together off that
    // mirrored flag. FFA can also start short-handed via the START button
    // (handled in the action switch), which flips the same flag.
    const lm = app.lobbyMode;
    if (lm && app.lobbyView === 'browser' && !mesh.joined) {
      startLobbyWatch(lm, (rooms) => {
        app.lobbyRooms = rooms;
      });
    } else {
      stopLobbyWatch();
    }
    if (lm && mesh.joined && mesh.isHost() && mesh.full && !mesh.started) {
      mesh.startLobby(); // room full — go
    }
    if (lm && mesh.joined && mesh.started) {
      this.launchLobby();
      return;
    }

    // Customisation, the campaign line-up, the arcade lobby and the paint
    // bay are modal: the lobby arc swaps out for the open panel. (The
    // paper and settings are TABS on the wings now — MENUS 2.) The shop is
    // a sub-modal of customisation: while it's up the customise plate (and
    // its mirror/loadout) step aside for the shop face.
    const shopOpen = customization.open && customization.shopOpen && !app.paintBayOpen;
    const modalCustom = customization.open && !customization.shopOpen && !app.paintBayOpen;
    const modalCampaign = app.campaignOpen;
    const modalLobby = app.lobbyMode !== null;
    const modalReader = app.readerOpen;
    const arcUp = !customization.open && !modalCampaign && !modalLobby && !app.paintBayOpen && !modalReader;
    let visChanged = this.rayTargets.length === 0; // first frame: build the list
    for (const p of this.menu.panels) {
      let show: boolean;
      switch (p.id) {
        case 'profilecard':
          show = arcUp && profilePop.open; // dropped out of the chip
          break;
        case 'custom': // the LOCKER
        case 'balls':
          show = modalCustom;
          break;
        case 'shop':
          show = shopOpen;
          break;
        case 'campaign':
          show = modalCampaign;
          break;
        case 'lobby':
          show = modalLobby;
          break;
        case 'paintbay':
          show = app.paintBayOpen;
          break;
        case 'reader':
          show = modalReader;
          break;
        default:
          // The arc (train/duel/info) and the profile chip: the lobby's
          // face, gone while any modal is open.
          show = arcUp;
          break;
      }
      if (p.mesh.visible !== show) {
        p.mesh.visible = show;
        visChanged = true;
        // A panel entering the screen repaints NOW with current data — the
        // freshness tick no longer paints unconditionally, so anything that
        // changed while it was hidden (redrawAll skips hidden panels) would
        // otherwise linger stale.
        if (show) p.redraw(null);
      }
    }
    // The mirror stands beside both the customise plate AND the shop, so avatar
    // changes preview live wherever you pick them.
    if (this.mirror) this.mirror.group.visible = customization.open || app.paintBayOpen;
    // The podium shows with the lobby arc and steps aside for every modal
    // (the locker brings its own mirror); it turns like a display stand.
    if (this.podium) {
      this.podium.visible = arcUp;
      this.podium.userData.beat = (this.podium.userData.beat ?? 0) + 1;
      if (arcUp) this.podium.rotation.y += delta * 0.3;
    }

    // Lobby / queueing: hover + click the panels.
    let hover: PanelId | null = null;
    let hoverAction: MenuAction | null = null;
    let boardPointed = false;
    let boardScrollAxis = 0;
    let newsPointed = false;
    let newsScrollAxis = 0;
    let dragged = false;
    let clicked = false;
    if (visChanged) {
      this.rayTargets = this.menu.panels.filter((p) => p.mesh.visible).map((p) => p.mesh);
      // THE PAINT BAY raycasts the body itself: the mirror's paint
      // surfaces join the targets so the ray lands ON the blank.
      if (app.paintBayOpen) this.rayTargets.push(...this.bayMeshes);
    }
    if (app.paintBayOpen) this.resetBayPointers();
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, this.rayTargets);
      // THE PAINT BAY: anything that is not a panel — the blank, the
      // gear, or the air beside them — goes through THE MAGNET, which
      // may find a piece the pointer itself just missed.
      if (app.paintBayOpen && !(hit && this.menu.panels.some((p) => p.mesh === hit.object))) {
        this.bayPoint(hand);
        continue;
      }
      // On a panel: the steadied aim starts fresh when it comes back.
      if (app.paintBayOpen) this.bayAimRay[hand].live = false;
      if (!hit) continue;
      const panel = this.menu.panels.find((p) => p.mesh === hit.object);
      if (!panel) continue;
      // The TOWN wing scrolls with the thumbstick: ladder rows on LADDER,
      // the article on NEWS.
      if (panel.id === 'duel' && wrapNav.town === 'ladder') {
        boardPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(boardScrollAxis)) boardScrollAxis = axis;
      }
      if ((panel.id === 'duel' && wrapNav.town === 'news') || panel.id === 'reader') {
        newsPointed = true;
        const axis = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick)?.y ?? 0;
        if (Math.abs(axis) > Math.abs(newsScrollAxis)) newsScrollAxis = axis;
      }
      const action = hit.uv ? panel.hitTest(hit.uv.x, hit.uv.y) : null;
      if (action || !hoverAction) {
        hover = panel.id;
        hoverAction = action;
      }
      const gp = this.input.xr.gamepads[hand];
      const held = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = gp?.getButtonDown(InputComponent.Trigger) ?? false;
      // A scrub may only BEGIN on a fresh press over the track (`down`); once
      // grabbed it continues while held (`owns`), even as the ray wanders. This
      // stops a trigger still held from opening the panel — or from a click
      // elsewhere — from hijacking a slider the instant the ray sweeps over it.
      if (!held && this.sliderGrab?.hand === hand) this.sliderGrab = null;
      const owns = this.sliderGrab?.hand === hand && this.sliderGrab?.panel === panel.id;
      // Gate the drag branch on an ACTUAL track hit — a press off the track
      // (e.g. on the accent panel's DEFAULT button) then falls through to the
      // click/action branch below instead of being swallowed.
      if (hit.uv && panel.drag && (down || owns) && panel.drag(hit.uv.x, hit.uv.y, owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        dragged = true;
      } else if (hit.uv && action === 'sfx-vol' && (down || owns)) {
        if (down) {
          this.sliderGrab = { hand, panel: panel.id };
          sfx.uiClick(); // a tick at the new level so the scrub is audible
        }
        sfx.setSfxVolume(sfxVolFromU(hit.uv.x)); // scrub the SFX volume live
        dragged = true;
      } else if (hit.uv && action === 'music-vol' && (down || owns)) {
        if (down) this.sliderGrab = { hand, panel: panel.id };
        setMusicVolume(musicVolFromU(hit.uv.x)); // scrub the music volume live
        dragged = true;
      } else if (hit.uv && down) {
        if (!app.tutorialDone && !preTutorialAllowed(action)) {
          sfx.armorClank(); // sealed until the tutorial has been run once
        } else if (panel.click) {
          if (panel.click(hit.uv.x, hit.uv.y)) clicked = true;
        } else if (action) {
          this.run(action);
          // Wrap panels flash the pressed button (kit press feedback).
          (panel as { flash?: (id: string) => void }).flash?.(action);
        }
      }
    }
    const boardScrolled = this.updateBoardScroll(boardPointed, boardScrollAxis, delta);
    const newsScrolled = this.updateNewsScroll(newsPointed, newsScrollAxis, delta);
    const skinChanged = customization.version !== this.lastSkinDraw;
    if (skinChanged) this.lastSkinDraw = customization.version;
    const hoverChanged = hover !== this.hovered || hoverAction !== this.hoveredAction;
    if (hoverChanged) {
      // Repaint ONLY the panels whose hover visuals actually changed — the
      // one the pointer left and the one it landed on. This used to be a
      // redrawAll: every hover flicker re-rasterized all eight-plus visible
      // canvases (news alone is 720×900) and re-uploaded megabytes of
      // texture in one frame — a guaranteed dropped frame on Quest, which
      // reads as "screen tearing" while the head is moving. Hover happens
      // whenever a hand drifts, so the menu stuttered near-constantly.
      const prev = this.hovered;
      this.hovered = hover;
      this.hoveredAction = hoverAction;
      for (const p of this.menu.panels) {
        if (!p.mesh.visible || (p.id !== prev && p.id !== hover)) continue;
        p.redraw(p.id === hover ? hoverAction : null);
      }
      if (hover) sfx.uiHover(); // soft laser zap as the pointer lands
    }
    // A scroll repaints its own page, nothing else.
    if (boardScrolled || newsScrolled) this.redrawPanel(app.readerOpen ? 'reader' : 'duel');
    // A skin change can touch several faces (locker, shop, board avatar) —
    // it's a rare, single event, so the full repaint is fine. A slider scrub
    // bumps the version EVERY frame — the drag branch below repaints just the
    // locker faces instead.
    if (skinChanged && !dragged) this.menu.redrawAll(this.hovered, this.hoveredAction);

    // Self-contained panel click (e.g. the ball loadout tiles).
    if (clicked) {
      sfx.ensureAudio();
      sfx.uiClick();
      this.menu.redrawAll(this.hovered, this.hoveredAction);
    }

    // Live-update the accent slider; persist once the trigger is released.
    // While the scrub is held, only the LOCKER faces repaint per frame — the
    // board and the rest settle on the next freshness tick after release.
    if (dragged) {
      this.draggingHue = true;
      for (const p of this.menu.panels) {
        if (!p.mesh.visible) continue;
        if (p.id === 'custom' || p.id === 'balls' || p.id === 'shop' || p.id === this.sliderGrab?.panel) {
          p.redraw(p.id === this.hovered ? this.hoveredAction : null);
        }
      }
    } else if (this.draggingHue) {
      this.draggingHue = false;
    }

    // THE PAINT BAY's own freshness + hand upkeep.
    if (app.paintBayOpen) {
      const key = bayFaceKey();
      if (key !== this.bayKey) {
        this.bayKey = key;
        this.bayPanel.redraw(this.hovered === 'paintbay' ? this.hoveredAction : null);
      }
      this.bayUpkeep();
    }

    // Freshness tick for live text (queue status, pub counts, room lists…):
    // check the live data every 0.5 s but repaint ONLY when something changed.
    // An idle lobby uploads no panel textures at all.
    this.redrawTimer -= delta;
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.5;
      // The wing opens on the paper now, so an edition that lands while the
      // page is already on the wall is read the moment it is drawn — the
      // pip is for an edition you have NOT got in front of you.
      if (wrapNav.town === 'news' && gazette.unread && gazette.article) markGazetteRead();
      if (this.liveDirty()) this.menu.redrawAll(this.hovered, this.hoveredAction);
    }

    // Coins banked during a bout roll up the moment you're back at the menu —
    // redraw just the readout each frame while the digits are still climbing.
    if (tickCoinRollup(delta)) this.redrawPanel('profile');

    // (The old pre-tutorial "TUTORIAL plate breathes" per-frame repaint is
    // gone: on the wrap the sealed lobby's call to action is the kit's
    // primary CTA — its glow needs no canvas re-upload, and a full-frame
    // 1024² repaint every frame is exactly what the kit's repaint
    // discipline exists to avoid.)
  }

  /**
   * Build one modal as a kit panel and hang it in the lobby group, hidden.
   * `local` gets first refusal on a pressed id (the loadout settles its own);
   * anything it declines goes to the global dispatcher.
   */
  private addModal(
    id: PanelId,
    wM: number,
    hM: number,
    pxW: number,
    pxH: number,
    face: () => { title: string; body: (g: CanvasRenderingContext2D, hover: string | null) => void; buttons: PanelButton[] },
    pos: [number, number, number],
    rotY: number,
    local?: (id: string) => boolean,
    drag?: KitMenuPanel['drag'],
  ): void {
    const panel = new KitMenuPanel(id, wM, hM, pxW, pxH, face, (pressed) => {
      if (local?.(pressed)) return;
      this.run(pressed as MenuAction);
    });
    if (drag) panel.drag = drag;
    panel.mesh.position.set(pos[0], pos[1], pos[2]);
    panel.mesh.rotation.y = rotY;
    panel.mesh.visible = false;
    this.menu.panels.push(panel);
    this.menu.group.add(panel.mesh);
    this.modals.push(panel);
  }

  /** Repaint one panel by id, preserving its live hover highlight. */
  private redrawPanel(id: PanelId): void {
    this.menu.panels.find((p) => p.id === id)?.redraw(this.hovered === id ? this.hoveredAction : null);
  }

  private updateBoardScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.boardScrollCooldown = Math.max(0, this.boardScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.boardScrollCooldown = 0;
      this.boardScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.boardScrollDir;
    if (!changedDir && this.boardScrollCooldown > 0) return false;

    this.boardScrollDir = dir;
    this.boardScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollLeaderboard(dir);
  }

  /** The newspaper body scrolls the same way as the leaderboard — stepped
   *  thumbstick with a repeat cooldown — but in pixels rather than rows. */
  private updateNewsScroll(pointing: boolean, axisY: number, delta: number): boolean {
    this.newsScrollCooldown = Math.max(0, this.newsScrollCooldown - delta);
    if (!pointing || Math.abs(axisY) < BOARD_SCROLL_DEADZONE) {
      this.newsScrollCooldown = 0;
      this.newsScrollDir = 0;
      return false;
    }

    const dir = axisY > 0 ? 1 : -1;
    const changedDir = dir !== this.newsScrollDir;
    if (!changedDir && this.newsScrollCooldown > 0) return false;

    this.newsScrollDir = dir;
    this.newsScrollCooldown = changedDir ? BOARD_SCROLL_INITIAL_REPEAT : BOARD_SCROLL_REPEAT;
    return scrollNews(dir * NEWS_SCROLL_STEP);
  }

  private run(action: MenuAction): void {
    sfx.ensureAudio();
    sfx.uiClick();
    // THE PROFILE card folds on any action that isn't its own.
    if (!action.startsWith('profile-') && !action.startsWith('badge-') && action !== 'rename' && action !== 'edit-note') {
      profilePop.open = false;
    }
    // The first leaderboard-relevant act (a training run, a 1v1 queue, or a
    // bot bout — bot wins score now too) claims a callsign: the keyboard pops
    // once, prefilled with the auto name, and the pending action resumes after
    // OK. Saved forever after, shared by both boards.
    if (
      (action === 'start-training' ||
        action === 'quick-match' ||
        action === 'ranked-host' ||
        action.startsWith('ranked-join-') ||
        action === 'lobby-host' ||
        action === 'lobby-vsbots' ||
        action.startsWith('lobby-join-') ||
        action.startsWith('lobby-watch-')) &&
      !hasCustomName()
    ) {
      this.kbPending = action;
      this.kbMode = 'name';
      this.keyboard.open(myStats().name);
      return;
    }
    switch (action) {
      case 'start-tutorial':
        // The guided basics: a normal vs-bot duel that TutorialSystem paces
        // with pop-ups and a half-health bot. No callsign needed first.
        app.tutorial = true;
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.mode = 'bot';
        app.state = 'playing';
        app.quickDuel = false; // the graduation bout keeps the standard format
        break;
      case 'start-training':
        app.arcade = '1v1';
        app.state = 'training';
        break;
      case 'open-campaign':
        app.campaignOpen = true;
        break;
      case 'campaign-close':
        app.campaignOpen = false;
        campaignModal.pending = null; // never reopen onto a stale pop-up
        break;
      case 'open-raid':
        // Rejoining the modal mid-lobby (e.g. after a look around) lands you
        // back in your squad room, not the browser.
        this.openLobby('raid');
        break;
      case 'arcade-2v2':
        // The BATTLE panel's 2V2 button now opens the shared lobby modal (make
        // a room, join one, or drop onto bots). ONLY PLAY BOTS shortcuts
        // straight to a bot brawl since online play is off.
        if (app.onlyBots) this.startBotBrawl('2v2');
        else this.openLobby('2v2');
        break;
      case 'arcade-ffa':
        if (app.onlyBots) this.startBotBrawl('ffa');
        else this.openLobby('ffa');
        break;
      case 'lobby-close':
        // Closing the modal is leaving the queue outright — no ghost seats
        // holding lobbies open for squads that wandered off.
        app.lobbyMode = null;
        app.lobbyView = 'browser';
        app.privateCode = ''; // a coded room is spent the moment you walk out
        mesh.cancel();
        break;
      case 'lobby-host':
        if (app.onlyBots || !app.lobbyMode) break; // lobbies are online affairs
        app.lobbyView = 'lobby';
        void mesh.hostLobby(app.lobbyMode, myStats().name, (s) => (app.netStatus = s));
        break;
      case 'lobby-vsbots':
        // Skip the lobby entirely — a pure bot brawl of the open mode.
        if (app.lobbyMode && app.lobbyMode !== 'raid') this.startBotBrawl(app.lobbyMode);
        break;
      case 'lobby-hardcore':
        if (mesh.isHost()) mesh.setRaidHardcore(!mesh.raidHardcore);
        break;
      case 'lobby-goopliath':
        if (mesh.isHost()) mesh.setRaidGoopliath(!mesh.raidGoopliath);
        break;
      case 'lobby-start':
        // FFA host launching short-handed — flip the room's started flag; the
        // lifecycle block above carries everyone (host + guests) into the bout.
        if (mesh.isHost()) mesh.startLobby();
        break;
      case 'lobby-leave':
        mesh.cancel();
        app.lobbyView = 'browser';
        app.privateCode = '';
        break;
      case 'lobby-discord':
        // SHARE (DESIGN §8.2): the bot posts this room's join link. Once
        // per room — the relay refuses a repeat, and the button says so.
        this.postInvite();
        break;
      case 'campaign-speedrun':
      case 'campaign-hardcore':
        // The timed runs arm the pick-your-damage pop-up instead of firing
        // straight away — START launches, CANCEL (or any stray click) closes.
        campaignModal.pending = action === 'campaign-hardcore' ? 'hardcore' : 'gauntlet';
        break;
      case 'campaign-launch-cancel':
        campaignModal.pending = null;
        break;
      case 'campaign-launch-start': {
        // Launch the armed fight (a run from stage I, or the goop) at the
        // difficulty the pop-up's chips picked (diff-<tier> saved it).
        const kind = campaignModal.pending;
        campaignModal.pending = null;
        if (!kind) break;
        app.mode = 'campaign';
        app.campaignMode = kind;
        app.campaignStage = 0;
        app.arcade = '1v1';
        app.state = 'playing';
        break;
      }
      case 'campaign-goopliath':
        // The sealed entry beneath the line-up: GOOPLIATH's own single, very
        // long fight — arms the same pick-your-damage pop-up as the runs.
        campaignModal.pending = 'goopliath';
        break;
      case 'toggle-shootback':
        app.shootBack = !app.shootBack;
        saveShootBack();
        break;
      case 'toggle-onlybots':
        app.onlyBots = !app.onlyBots;
        saveOnlyBots();
        break;
      case 'toggle-voice':
        // Lives on the SETTINGS tab — flip it and repaint the wing.
        setVoiceEnabled(!voiceEnabled());
        this.redrawPanel('info');
        break;
      case 'ranked-match':
        if (app.onlyBots) break; // disabled — no online play in only-bots mode
        // RANKED now opens the server browser: host your own room or join a
        // listed one. applyState() starts the room-list watch.
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'browser';
        app.fromRanked = false;
        break;
      case 'ranked-host':
        if (app.onlyBots) break;
        // Open a public room named after you and wait — you STAY on the server
        // list, with your own room shown in it (unclickable).
        app.arcade = '1v1';
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'browser';
        app.rankedHost = true;
        app.fromRanked = true;
        app.state = 'queueing';
        net.hostRanked(myStats().name);
        break;
      case 'ranked-back':
        net.cancel();
        app.duelView = 'root';
        app.fromRanked = false;
        break;
      case 'ranked-cancel':
        // Bail out of a host/join and drop back onto the server list.
        net.cancel();
        app.state = 'menu';
        app.duelView = 'browser';
        break;
      case 'quick-match':
        // Drop straight onto a bot. Normally we keep hunting for a human in the
        // background (swap to the live bout if one turns up) — but ONLY PLAY BOTS
        // skips that, so it stays a pure bot bout.
        app.arcade = '1v1';
        app.quickDuel = true; // quick match runs best of three
        app.mode = 'bot';
        app.state = 'playing';
        // net.queue() sets this too, but ONLY PLAY BOTS never queues — and a
        // quick match against the bot is still a quick match, so it is still
        // best of three.
        app.quickDuel = true;
        if (!app.onlyBots) net.queue();
        break;
      case 'cancel-queue':
        net.cancel();
        // A private BRAWL is being reserved on the MESH, not the duel transport,
        // so net.cancel() alone would leave the room behind holding a code
        // nobody is ever going to use. Narrow on purpose: this is only the
        // private 2v2/FFA hosting face, never a live arcade lobby.
        if (app.duelView === 'hosting' && app.privateMode !== '1v1') {
          mesh.cancel();
          app.privateCode = '';
        }
        app.state = 'menu';
        app.duelView = 'root';
        app.codeEntry = '';
        break;
      case 'private-open':
        app.quickDuel = false; // ranked / private keep best of five
        app.duelView = 'private';
        break;
      case 'private-mode-1v1':
        app.privateMode = '1v1';
        break;
      case 'private-mode-2v2':
        app.privateMode = '2v2';
        break;
      case 'private-mode-ffa':
        app.privateMode = 'ffa';
        break;
      case 'private-create':
        app.duelView = 'hosting';
        app.privateCode = '';
        app.state = 'queueing';
        // 1V1 is the ordinary duel over the 1v1 transport, untouched. 2V2 and
        // FFA need four seats, which is the arcade MESH's job — so those open a
        // coded mesh room and hand over to the normal lobby lifecycle.
        if (app.privateMode === '1v1') net.createPrivate();
        else this.hostPrivateBrawl(app.privateMode);
        break;
      case 'private-enter':
        app.duelView = 'keypad';
        app.codeEntry = '';
        break;
      case 'private-back':
        net.cancel();
        app.duelView = app.duelView === 'keypad' ? 'private' : 'root';
        app.codeEntry = '';
        break;
      case 'kp-del':
        app.codeEntry = app.codeEntry.slice(0, -1);
        break;
      case 'kp-join':
        if (app.codeEntry.length === 5) {
          app.state = 'queueing';
          this.joinByCode(app.codeEntry);
        }
        break;
      case 'env-desert':
        app.environment = 'desert';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-cove':
        app.environment = 'cove';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-neon':
        app.environment = 'neon';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-saltflats':
        app.environment = 'saltflats';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'env-factory':
        app.environment = 'factory';
        saveEnvironment();
        this.restartForEnvironmentMode();
        break;
      case 'lb-battle':
        // The BATTLE tab opens onto 1V1 unless a brawl board is already showing.
        setLeaderboardTab(
          leaderboard.tab === 'duo' || leaderboard.tab === 'ffa' ? leaderboard.tab : 'ranked',
        );
        break;
      case 'lb-ranked':
        setLeaderboardTab('ranked');
        break;
      case 'lb-xp':
        setLeaderboardTab('xp');
        break;
      case 'lb-arcade': {
        // ARCADE opens onto its currently-showing sub-board, else AIM.
        const arcadeSubs = ['training', 'gauntlet', 'raid', 'goopliath'] as const;
        setLeaderboardTab(
          (arcadeSubs as readonly string[]).includes(leaderboard.tab) ? leaderboard.tab : 'training',
        );
        break;
      }
      case 'lb-training':
        setLeaderboardTab('training');
        break;
      case 'lb-gauntlet':
        setLeaderboardTab('gauntlet');
        break;
      case 'lb-raid':
        setLeaderboardTab('raid');
        break;
      case 'lb-goopliath':
        setLeaderboardTab('goopliath');
        break;
      case 'lb-view-normal':
      case 'lb-view-hard':
      case 'lb-view-blazing':
        setRunView({ tier: action.slice(8) as RunViewTier });
        break;
      case 'lb-view-hc':
        setRunView({ hc: !leaderboard.runView.hc });
        break;
      case 'lb-duo':
        setLeaderboardTab('duo');
        break;
      case 'lb-ffa':
        setLeaderboardTab('ffa');
        break;
      case 'profile-back':
        // Back to the board the name was tapped on.
        setLeaderboardTab(this.ladderFrom);
        break;
      case 'profile-toggle':
        profilePop.open = !profilePop.open;
        break;
      case 'profile-close':
        profilePop.open = false;
        break;
      case 'edit-note':
        this.kbPending = null;
        this.kbMode = 'note';
        flashProfileKeyboardHint();
        this.menu.redrawAll(this.hovered, this.hoveredAction);
        this.keyboard.open(myNote(), 'ENTER NOTE', 48); // matches setPlayerNote's cap
        return;
      case 'rename':
        this.kbPending = null;
        this.kbMode = 'name';
        this.keyboard.open(myStats().name);
        return;
      case 'open-gazette':
        // The NEWS tab: open the paper, and the moment you do the edition
        // counts as read — the red pip on the tab clears.
        wrapNav.town = 'news';
        resetNewsScroll();
        markGazetteRead();
        void refreshGazette(true);
        break;
      case 'gazette-close':
        wrapNav.town = 'town';
        app.readerOpen = false;
        break;
      case 'gazette-reader':
        // Tap the page on the wing: hold it up large, straight ahead. The
        // scroll carries over — you keep your place in the article.
        wrapNav.town = 'news';
        markGazetteRead();
        app.readerOpen = true;
        break;
      case 'reader-close':
        app.readerOpen = false;
        break;
      case 'open-settings':
        wrapNav.you = 'settings';
        break;
      case 'settings-credits':
        setCreditsOpen(true);
        this.redrawPanel('info');
        break;
      case 'credits-back':
        setCreditsOpen(false);
        this.redrawPanel('info');
        break;
      case 'settings-close':
        // Back to the YOU tab.
        wrapNav.you = 'you';
        clearReportSent(); // next visit gets a fresh report button
        setCreditsOpen(false); // reopening lands on settings, not credits
        break;
      case 'settings-report':
        // The safety report: typed on the callsign keyboard, filed to the
        // backend (net/leaderboard sendReport) — the reporter never sees an
        // address and never leaves the game.
        this.kbMode = 'report';
        this.keyboard.open('', 'REPORT A PLAYER OR PROBLEM', 64);
        break;
      case 'toggle-mute':
        // Flip the music mute (persisted) and repaint the wing's breaker.
        toggleMusicMuted();
        this.redrawPanel('info');
        break;
      case 'toggle-hide-paint':
        // HIDE PAINT, globally: every other body renders bare base tone.
        // Remote bake keys watch paintPrefs.version, so live rigs repaint on
        // the spot; your own paint stays yours.
        togglePaintHiddenAll();
        this.redrawPanel('info');
        break;
      case 'open-pub':
        // THE CLUB: the venue's floor, in-session, under a curtain.
        this.gotoVenue();
        break;
      case 'pub-back':
        app.infoView = 'root';
        break;
      case 'open-rave':
        // RAVE RAID's foyer, in-session: same wallet, same name, same body
        // — its rail's FIRE FIGHT entry brings you back here the same way.
        requestRaveEntry(this.world);
        break;
      case 'base-white':
        setAvatarSkin('blank'); // applyOwnSkins swaps every rig next frame
        break;
      case 'base-black':
        setAvatarSkin('onyx');
        break;
      case 'open-paintbay':
        // The PAINT tab: the plate stays open, its face swaps to the bay.
        customization.open = true;
        customization.shopOpen = false;
        clearShopPreview(); // paint what you own, not what you're trying on
        app.paintBayOpen = true;
        this.ensureMirror();
        this.collectBayMeshes();
        this.bayKey = '';
        break;
      case 'paintbay-close':
      case 'custom-close':
        // CLOSE on any face closes the whole plate.
        this.leavePaint();
        customization.open = false;
        customization.shopOpen = false;
        clearShopPreview(); // the try-on goes back on the rack
        break;
      case 'open-custom':
        // Opens onto the LOCKER (your inventory + colours).
        this.leavePaint();
        customization.open = true;
        customization.shopOpen = false;
        this.ensureMirror();
        break;
      case 'open-shop':
        this.leavePaint();
        customization.open = true;
        customization.shopOpen = true;
        if (customization.tab === 'bank' || customization.tab === 'colour') customization.tab = 'platforms';
        this.ensureMirror();
        break;
      case 'open-locker':
        this.leavePaint();
        customization.open = true;
        customization.shopOpen = false;
        clearShopPreview();
        break;
      case 'tab-paint':
        customization.tab = 'paint';
        break;
      case 'tab-avatars':
        customization.tab = 'avatars';
        break;
      case 'tab-platforms':
        customization.tab = 'platforms';
        break;
      case 'tab-colour':
        customization.tab = 'colour';
        break;
      case 'tab-arena':
        customization.tab = 'arena';
        break;
      case 'tab-gear':
        customization.tab = 'gear';
        break;
      // THE BANK (net/bank.ts): the store's third chip, and the door to it
      // from the YOU wing's purse.
      case 'tab-bank':
        customization.tab = 'bank';
        void loadPacks();
        if (!bank.account.known) void whoami();
        break;
      case 'open-bank':
        this.leavePaint();
        customization.open = true;
        customization.shopOpen = true;
        customization.tab = 'bank';
        this.ensureMirror();
        void loadPacks();
        if (!bank.account.known) void whoami();
        break;
      case 'bank-open':
        if (!openCheckout()) sfx.armorClank(); // the browser refused the tab
        break;
      case 'bank-cancel':
      case 'bank-done':
        cancelCheckout();
        break;
      // THE ACCOUNT: the keyboard takes the email (to protect this uid, or
      // to have a recovery link sent) and the six-digit code off the phone.
      case 'bank-protect':
        this.kbPending = null;
        this.kbMode = 'protect';
        this.keyboard.open(bank.lastEmail, 'THE EMAIL YOU PAID WITH', 64, { email: true });
        return;
      case 'bank-recover':
        this.kbPending = null;
        this.kbMode = 'recover';
        this.keyboard.open(bank.recovery.email, 'THE EMAIL YOU PROTECTED WITH', 64, { email: true });
        return;
      case 'bank-code':
        this.kbPending = null;
        this.kbMode = 'code';
        this.keyboard.open('', 'THE CODE FROM YOUR PHONE', 6, { digits: true });
        return;
      case 'bank-recover-cancel':
        cancelRecovery();
        break;
      case 'gear-head':
      case 'gear-body':
      case 'gear-hands':
      case 'gear-face':
      case 'gear-shoulders':
        customization.tab = 'gear';
        customization.gearSlot = action.slice(5) as GearSlot;
        break;
      case 'av-uncolor':
        setAvatarColor(-1); // back to the skin's own palette
        break;
      default:
        // diff-<tier>: the campaign difficulty picker sets the run difficulty
        // (persisted). raiddiff-<tier>: the raid host mirrors it to the squad.
        // hitTest only returns unlocked tiers, so no re-check is needed.
        // shelf-<material>: the PLATFORMS board's shelf.
        if (action.startsWith('shelf-')) {
          const shelf = action.slice('shelf-'.length);
          if (DECK_SHELVES.some(([id]) => id === shelf)) {
            customization.tab = 'platforms';
            customization.platformShelf = shelf as DeckShelf;
          }
          break;
        }
        // bank-pack-<id>: open a checkout for that pack of iron-dollars.
        if (action.startsWith('bank-pack-')) {
          void startCheckout(action.slice('bank-pack-'.length));
          break;
        }
        if (action.startsWith('raiddiff-')) {
          const tier = action.slice('raiddiff-'.length) as Difficulty;
          if (mesh.isHost() && (DIFFICULTY_ORDER as string[]).includes(tier)) mesh.setRaidDifficulty(tier);
          break;
        }
        if (action.startsWith('diff-')) {
          const tier = action.slice('diff-'.length) as Difficulty;
          if ((DIFFICULTY_ORDER as string[]).includes(tier) && difficultyUnlocked(tier)) {
            app.difficulty = tier;
            saveDifficulty();
          }
          break;
        }
        // campaign-N: a single titan bout at stage N (sealed cards never
        // hit-test, so any N that lands here is unlocked).
        if (action.startsWith('campaign-')) {
          app.mode = 'campaign';
          app.campaignMode = 'single';
          app.campaignStage = Number(action.slice('campaign-'.length)) || 0;
          app.arcade = '1v1';
          app.state = 'playing';
          break;
        }
        // shop-buy-gr-N: the BUY button on a previewed GEAR tile; shop-gr-N:
        // a LOCKER tap wears/removes a piece you own, a STORE tap tries an
        // unowned piece on the mirror.
        if (action.startsWith('shop-buy-gr-')) {
          const def = GEAR[Number(action.slice('shop-buy-gr-'.length))];
          if (def && !gearOwned(def.id)) {
            this.buyOrWearGear(def.id, def.price);
            if (gearOwned(def.id)) clearShopPreview();
          }
          break;
        }
        if (action.startsWith('shop-gr-')) {
          const def = GEAR[Number(action.slice('shop-gr-'.length))];
          if (!def) break;
          if (customization.shopOpen && !gearOwned(def.id)) setShopPreview('gear', def.id);
          else this.buyOrWearGear(def.id, def.price);
          break;
        }
        // shop-buy-av-N / shop-buy-pf-N: the BUY button on a previewed STORE
        // tile — the actual purchase.
        if (action.startsWith('shop-buy-av-')) {
          const skin = AVATAR_SKINS[Number(action.slice('shop-buy-av-'.length))];
          if (skin && !skin.locked && !avatarOwned(skin.id)) {
            this.buyOrEquipAvatar(skin.id, skin.price ?? 0);
            if (avatarOwned(skin.id)) clearShopPreview(); // bought — it's really yours now
          }
          break;
        }
        if (action.startsWith('shop-buy-pf-')) {
          const skin = PLATFORM_SKINS[Number(action.slice('shop-buy-pf-'.length))];
          if (PLATFORMS_OPEN && skin && !skin.earnedBy && !platformOwned(skin.id)) {
            this.buyOrEquipPlatform(skin.id, skin.price ?? 0);
            if (platformOwned(skin.id)) clearShopPreview();
          }
          break;
        }
        // shop-av-N / shop-pf-N: a LOCKER tap equips what you own; a STORE tap
        // on an unowned skin TRIES IT ON — the mirror (or your pad) models it
        // and the tile grows its BUY button. Nothing is spent on a tap.
        if (action.startsWith('shop-av-')) {
          const skin = AVATAR_SKINS[Number(action.slice(8))];
          if (!skin || skin.locked) break;
          if (customization.shopOpen && !avatarOwned(skin.id)) setShopPreview('avatar', skin.id);
          else this.buyOrEquipAvatar(skin.id, skin.price ?? 0);
          break;
        }
        if (action.startsWith('shop-pf-')) {
          const skin = PLATFORM_SKINS[Number(action.slice(8))];
          if (!skin || !PLATFORMS_OPEN) break; // paused (avatar/skins.ts)
          if (customization.shopOpen && !platformOwned(skin.id)) {
            // Even the earned-only CHAMPION pad can be tried on — its tile
            // just never grows a BUY button (the campaign awards it).
            setShopPreview('platform', skin.id);
          } else if (!skin.earnedBy || platformOwned(skin.id)) {
            this.buyOrEquipPlatform(skin.id, skin.price ?? 0);
          }
          break;
        }
        // kp-0 … kp-9: append a digit (max five) on the join keypad.
        if (action.startsWith('kp-') && app.codeEntry.length < 5) {
          const d = action.slice(3);
          if (d >= '0' && d <= '9') app.codeEntry += d;
        } else if (action.startsWith('lb-row-')) {
          // Open the clicked player's profile.
          const row = leaderboardRows()[boardScroll() + Number(action.slice(7))];
          if (row) {
            this.ladderFrom = leaderboard.tab;
            setProfileView(row);
          }
        } else if (action.startsWith('pub-go-')) {
          // Pick a pub region, remember it, then hop to the pub page.
          const id = action.slice(7);
          const region = PUB_REGIONS.find((r) => r.id === id);
          if (region) {
            localStorage.setItem('ibb-pub-server', region.url);
            app.infoView = 'root';
            this.gotoVenue();
          }
        } else if (action.startsWith('ranked-join-')) {
          // Join a listed ranked room by its doc id (stay on the list, showing
          // a brief "joining…" while we connect).
          app.arcade = '1v1';
          app.quickDuel = false; // ranked / private keep best of five
          app.duelView = 'browser';
          app.rankedHost = false;
          app.fromRanked = true;
          app.state = 'queueing';
          net.joinRanked(action.slice('ranked-join-'.length));
        } else if (action.startsWith('lobby-watch-')) {
          // THE TERRACE (DESIGN §3.2). A watcher takes a seat past the
          // fighters' band: they travel with the squad when the room
          // launches and are dealt onto the audience ground instead of a
          // platform. A full lobby — even one already fighting — still
          // answers, because turning up to watch is the point.
          if (!app.onlyBots && app.lobbyMode) {
            const roomId = action.slice('lobby-watch-'.length);
            app.netStatus = 'taking a place on the terrace…';
            const seq = ++this.lobbyJoinSeq;
            const attempt = mesh.joinLobby(app.lobbyMode, roomId, myStats().name, (s) => (app.netStatus = s), true);
            void Promise.race([attempt, new Promise<false>((r) => setTimeout(() => r(false), 15_000))])
              .then((ok) => {
                if (seq !== this.lobbyJoinSeq) return;
                if (ok) {
                  app.lobbyView = 'lobby';
                } else {
                  mesh.cancel();
                  app.lobbyView = 'browser';
                  app.netStatus = 'the terrace is full';
                }
              })
              .catch(() => {
                if (seq !== this.lobbyJoinSeq) return;
                mesh.cancel();
                app.lobbyView = 'browser';
                app.netStatus = 'could not take a place, try again';
              });
          }
        } else if (action.startsWith('lobby-join-')) {
          // Claim a seat in a listed lobby; a race with a final joiner drops
          // you back on the (fresh) list. The lobby view opens ONLY once the
          // claim actually lands: entering it optimistically stranded players
          // in a nameless empty room whenever the claim hung or the network
          // died mid-join (a wedged Quest write stream does exactly this) —
          // "it put me in the lobby but there are no names, not even mine".
          if (!app.onlyBots && app.lobbyMode) {
            const roomId = action.slice('lobby-join-'.length);
            app.netStatus = 'joining the lobby…';
            // Token so a second click while this claim is in flight makes this
            // one a bystander — mesh.joinLobby close()s the older attempt
            // itself, and a stale handler must not cancel() the newer one.
            const seq = ++this.lobbyJoinSeq;
            const attempt = mesh.joinLobby(app.lobbyMode, roomId, myStats().name, (s) => (app.netStatus = s));
            const timeout = new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), 15_000),
            );
            const failed = (): void => {
              if (seq !== this.lobbyJoinSeq) return; // a newer attempt owns the mesh
              mesh.cancel(); // a late success must still free the seat
              app.lobbyView = 'browser';
              app.netStatus = 'could not join, try again';
            };
            void Promise.race([attempt, timeout])
              .then((ok) => {
                if (seq !== this.lobbyJoinSeq) return;
                if (ok) app.lobbyView = 'lobby';
                else failed(); // hung, refused, or lost the race for the seat
              })
              .catch(failed);
          }
        }
        break;
    }
    this.applyState();
  }

  /**
   * Shop tap on a platform tile: if it's already owned, equip it; otherwise
   * buy it (debit the wallet, mark it owned) and equip it. Can't afford it →
   * nothing changes (the wallet refuses the spend).
   */
  /** A gear tap: own it → wear it (or take it off); else buy it and wear it. */
  private buyOrWearGear(id: string, price: number): void {
    if (!gearOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return;
      ownGear(id);
      playCash();
      const def = gearDef(id);
      if (def) setGear(def.slot, id); // a fresh buy goes straight on
      return;
    }
    toggleGear(id);
  }

  private buyOrEquipPlatform(id: string, price: number): void {
    if (!platformOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return; // can't afford — no-op
      ownPlatform(id);
      playCash(); // the money sting on a fresh purchase
    }
    setPlatformSkin(id); // applyOwnSkins repaints the pad next frame
  }

  /**
   * Shop tap on an avatar tile: own it → equip; else buy it (debit, mark owned,
   * cash sting) and equip. Can't afford → nothing changes.
   */
  private buyOrEquipAvatar(id: string, price: number): void {
    if (!avatarOwned(id)) {
      if (!canAfford(price) || !spendCoins(price)) return; // can't afford — no-op
      ownAvatar(id);
      playCash();
    }
    setAvatarSkin(id); // applyOwnSkins repaints the rig + mirror next frame
  }

  /** Walk onto the venue's floor without leaving the XR session. The
   *  navigation bridge falls back to the rave's own page when no shared
   *  shell has installed handlers. */
  private gotoVenue(): void {
    requestVenueEntry(this.world);
  }

  /** Passthrough and opaque rendering need different Quest compositor modes.
   *  End only when the player explicitly crosses that boundary; the landing
   *  button immediately offers the matching AR/VR re-entry. */
  private restartForEnvironmentMode(): void {
    const session = this.world.session as XRSession | undefined;
    if (!session) return;
    const wantsOpaque = app.environment !== 'ar';
    const isOpaque = session.environmentBlendMode === 'opaque';
    if (wantsOpaque !== isOpaque) void session.end();
  }

  // --- customisation: the avatar mirror + live skin application ---------------

  /**
   * THE PODIUM — your blank on a plinth beside the YOU wing, slowly
   * turning, dressed live by applyOwnSkins (the 'podium-avatar' name is on
   * its roster). Parented to the menu group so bouts hide it for free;
   * per-frame visibility follows the lobby arc (modals swap it out for the
   * locker mirror).
   */
  private buildPodium(): void {
    if (this.podium) return;
    const rig = buildBoxer(0);
    const stand = new Group();
    stand.name = 'podium-avatar';
    for (const piece of rig.all) {
      piece.visible = true;
      stand.add(piece);
    }
    solveTorso(rig, new Vector3(0, 1.5, 0), new Quaternion(), 0, 0, _dir, _end);
    rig.gloves[0].position.set(-0.24, 1.05, -0.2);
    rig.gloves[1].position.set(0.24, 1.05, -0.2);
    // The plinth: a low dark drum with a primer top ring — display
    // furniture, not a platform.
    const drum = new Mesh(
      new CylinderGeometry(0.42, 0.48, 0.16, 24),
      new MeshStandardMaterial({ color: 0x15171b, metalness: 0.85, roughness: 0.35 }),
    );
    drum.position.y = 0.08;
    stand.add(drum);
    const ring = new Mesh(
      new CylinderGeometry(0.425, 0.425, 0.018, 24),
      new MeshStandardMaterial({ color: 0x98948b, metalness: 0.1, roughness: 0.8 }),
    );
    ring.position.y = 0.168;
    stand.add(ring);
    const podium = new Group();
    podium.name = 'podium-root';
    podium.add(stand);
    stand.position.y = 0.17; // the blank stands ON the plinth top
    podium.position.set(1.72, 0, -0.52);
    podium.rotation.y = -0.9; // opening pose; update() turns it slowly
    this.menu.group.add(podium);
    this.podium = podium;
    // Headless probes ask after the podium through the shared dev hook.
    const hook = window.__ff2 as (typeof window.__ff2 & { podium?: unknown }) | undefined;
    if (hook) {
      hook.podium = {
        up: () => podium.visible && this.menu.group.visible,
        raw: () => ({ pod: podium.visible, grp: this.menu.group.visible, custom: customization.open, beat: podium.userData.beat ?? 0 }),
        at: () => podium.position.toArray(),
        pieces: () => podium.children[0]?.children.length ?? 0,
        /** The gear the podium's blank is wearing right now. */
        gear: () => wornGear(podium),
      };
      // THE GAZETTE, drivable headlessly: inject an edition (the page never
      // needs Firestore to be probed), open/close it, and snap the page.
      (hook as unknown as { gazette?: unknown }).gazette = {
        inject: (art: Partial<GazetteArticle>) => {
          gazette.article = {
            edition: 999,
            dateline: 'PROBE DAY',
            headline: '',
            subhead: '',
            body: '',
            byline: 'The Gazette Desk',
            stats: [],
            records: [],
            todo: [],
            ...art,
          };
          gazette.status = '';
          gazette.welcomeFirst = false; // a probe's edition is the page, welcome or not
        },
        open: () => this.run('open-gazette'),
        scroll: (px: number) => scrollNews(px),
        close: () => this.run('gazette-close'),
        /** THE READER, held up and put back. */
        reader: (on: boolean) => this.run(on ? 'gazette-reader' : 'reader-close'),
        readerOpen: () => app.readerOpen,
        snap: (): string => {
          // The paper is a tab on the TOWN wing now — snap the wing.
          const p = this.menu.panels.find((x) => x.id === 'duel');
          if (!p) return '';
          p.redraw(null);
          const tex = (p.mesh.material as MeshBasicMaterial).map as CanvasTexture | null;
          return (tex?.image as HTMLCanvasElement | undefined)?.toDataURL('image/png') ?? '';
        },
      };
      // GEAR, drivable headlessly: a dev equip grants the piece (no coins)
      // so probes can dress the podium and watch it change.
      (hook as unknown as { gear?: unknown }).gear = {
        catalogue: () => GEAR.map((g) => g.id),
        worn: () => myGear(),
        equip: (id: string) => {
          ownGear(id);
          const d = gearDef(id);
          if (d) setGear(d.slot, id);
        },
        clear: (slot: GearSlot) => setGear(slot, ''),
        pack: () => myPackedGear(),
        clean: (s: string) => cleanGear(s),
      };
    }
    this.skinVersion = -1; // dress the new rig on the next applyOwnSkins
  }

  /**
   * The "mirror": your full boxer rig standing beside the customisation
   * panel in a relaxed guard, re-skinned live as you click chips — so you
   * see exactly how you'll look across the gap.
   */
  private ensureMirror(): void {
    if (this.mirror) return;
    const rig = buildBoxer(0);
    const group = new Group();
    group.name = 'mirror-avatar';
    for (const piece of rig.all) {
      piece.visible = true;
      group.add(piece);
    }
    // Static display pose: solve the torso once under a standing head, fists
    // up in a loose guard. Group-local coords, so place/turn the group only.
    solveTorso(rig, new Vector3(0, 1.5, 0), new Quaternion(), 0, 0, _dir, _end);
    rig.gloves[0].position.set(-0.22, 1.12, -0.28);
    rig.gloves[1].position.set(0.22, 1.12, -0.28);
    // Placed and turned every frame by updateMirrorPose.
    group.position.set(MIRROR_HOME.x, 0, MIRROR_HOME.z);
    group.rotation.y = Math.PI + Math.atan2(-group.position.x, -group.position.z);
    this.scene.add(group);
    this.mirror = { group, rig };
    this.skinVersion = -1; // force a re-apply so the mirror dresses correctly
    this.accentHue = Number.NaN;
    this.accentLight = Number.NaN;
  }

  /**
   * Re-skin everything that's YOURS whenever the picks change: the mirror,
   * your torso, both gloves and your platform. Visual only — PlayerBodyPart
   * hitboxes never move.
   */
  private applyOwnSkins(): void {
    const skinChanged = customization.version !== this.skinVersion;
    const accentChanged = app.accentHue !== this.accentHue || app.accentLight !== this.accentLight;
    const paintChanged = paintState.version !== this.paintVersionSeen;
    if (!skinChanged && !accentChanged && !paintChanged) return;
    // THE PAINT: bake your look onto every rig that is YOURS — your own
    // torso, the locker mirror, the podium. (Rivals' looks ride the wire
    // in paint P3; bots stay factory-blank on purpose.)
    if (paintChanged || skinChanged) {
      this.paintVersionSeen = paintState.version;
      const look = myLook();
      for (const name of ['player-torso', 'player-glove-left', 'player-glove-right', 'mirror-avatar', 'podium-avatar']) {
        const obj = this.scene.getObjectByName(name);
        if (obj) applyLook(obj, look);
      }
      // THE RECORD (paint P4): the doc mirror follows every look/tone change
      // (keyed inside — repeated calls with nothing new never write).
      syncLookMirror();
    }
    if (!skinChanged && !accentChanged) return;

    const names = ['player-torso', 'player-glove-left', 'player-glove-right', 'mirror-avatar', 'podium-avatar'];
    if (skinChanged) {
      this.skinVersion = customization.version;
      const av = myAvatarSkin(); // chosen shape + custom colour
      // A STORE try-on dresses the MIRROR only (your own body keeps what you
      // actually own) in the previewed shape — with your colour picks, so it
      // shows exactly what you'd get.
      const pv = customization.preview;
      const mirrorAv = pv?.kind === 'avatar' ? resolveAvatarSkin(pv.id, customization.colorHue, customization.colorLight) : av;
      // GEAR: your worn set on every rig that's yours; a STORE try-on
      // dresses the MIRROR alone in the previewed piece (its slot swapped).
      const gear = myGear();
      const mirrorGear = pv?.kind === 'gear' ? gearWith(pv.id) : gear;
      for (const name of names) {
        const obj = this.scene.getObjectByName(name);
        if (obj) applyAvatarSkin(obj, name === 'mirror-avatar' ? mirrorAv : av);
        // (the podium wears what you actually own, like your own body)
        if (obj) applyGear(obj, name === 'mirror-avatar' ? mirrorGear : gear, (name === 'mirror-avatar' ? mirrorAv : av).id === 'onyx' ? 'onyx' : 'white');
        // Fresh gear is a fresh paint surface: bake the look onto it now.
        if (obj) applyLook(obj, myLook());
      }
      if (app.paintBayOpen) this.collectBayMeshes();
      const pad = this.scene.getObjectByName('player-platform');
      if (pad) applyPlatformSkin(pad, shownPlatform(customization.platform));
      // A platform try-on models on the OPPONENT's pad across the gap — the
      // whole deck in view at once, no craning at your own feet. When the
      // try-on ends, the pad goes back to the house look the lobby paints
      // (full re-apply first: a premium slab tint or deck ornament would
      // survive a plain re-tint).
      const oppPad = this.scene.getObjectByName('opponent-platform');
      if (oppPad) {
        if (pv?.kind === 'platform') {
          applyPlatformSkin(oppPad, platformSkin(pv.id));
          this.oppPadPreviewed = true;
          oppPad.visible = true;
        } else if (this.oppPadPreviewed) {
          this.oppPadPreviewed = false;
          applyPlatformSkin(oppPad, OPPONENT_DEFAULT_PLATFORM);
          tintPlatform(oppPad, teamColor(1));
          oppPad.visible = app.state === 'playing';
        }
      }
      this.accentHue = Number.NaN;
    }

    const accent = hueToColor(app.accentHue, app.accentLight);
    for (const name of names) {
      const obj = this.scene.getObjectByName(name);
      if (obj) setAvatarAccent(obj, accent);
    }
    this.accentHue = app.accentHue;
    this.accentLight = app.accentLight;
  }

  /** Point + trigger types on the keyboard; OK saves and resumes the action. */
  private updateKeyboard(): void {
    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.keyboard.mesh]);
      const id = hit?.uv ? this.keyboard.hitTest(hit.uv.x, hit.uv.y) : null;
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        sfx.uiClick();
        const done = this.keyboard.press(id);
        if (done !== null) {
          if (this.kbMode === 'report') {
            // Empty OK = changed their mind; anything else files the report.
            if (done.trim().length > 0) {
              void sendReport(done);
              markReportSent();
            }
          } else if (this.kbMode === 'protect' || this.kbMode === 'recover') {
            // An email: empty OK backs out; a non-address stays up to be fixed.
            if (done.length > 0 && !done.includes('@')) return;
            if (done.length > 0) {
              if (this.kbMode === 'protect') void protect(done);
              else void startRecovery(done);
            }
          } else if (this.kbMode === 'code') {
            if (done.length > 0 && !/^\d{6}$/.test(done)) return; // six digits, or back out
            if (done.length > 0) void redeemCode(done);
          } else if (this.kbMode === 'note') {
            setPlayerNote(done); // empty clears the note
            clearProfileKeyboardHint();
          } else if (done.length > 0) {
            setPlayerName(done);
          } else {
            return; // a name is required — ignore empty OK, leave the keyboard up
          }
          this.kbMode = 'name';
          this.keyboard.close();
          const pending = this.kbPending;
          this.kbPending = null;
          if (pending) this.run(pending);
          else this.menu.redrawAll(this.hovered, this.hoveredAction);
          return;
        }
      }
    }
    this.keyboard.setHover(hover);
  }

  // --- the A-button action panel ---------------------------------------------

  /**
   * What the panel offers right now, or null when it has no business being
   * up (mid-bout — your hands are for punching, not menus).
   */
  /** The resign button — or, once tapped, its are-you-sure ✕ / ✓ pair. */
  private forfeitButtons(label: string): ActionButton[] {
    return this.confirmForfeit
      ? [
          { id: 'forfeit-no', label: '✕ NO', accent: UI.cool, half: 'l' },
          { id: 'forfeit-yes', label: `✓ ${label}`, accent: UI.danger, half: 'r' },
        ]
      : [{ id: 'forfeit', label, accent: UI.danger }];
  }

  private panelContent(): { title: string; buttons: ActionButton[]; status: string; loadout: boolean } | null {
    if (app.state === 'training') {
      return {
        title: 'AIM TRAINING',
        buttons: this.forfeitButtons('FORFEIT'),
        status: this.confirmForfeit ? 'end the session?' : '',
        loadout: true, // practice range — swap attachments whenever
      };
    }
    // A live titan bout can be conceded — souls fights run long, and the
    // campaign has no round clock to save you. PvE, so the loadout rides too.
    if (app.state === 'playing' && app.mode === 'campaign' && match.phase !== 'matchOver') {
      return {
        title: 'TITAN BOUT',
        buttons: this.forfeitButtons('CONCEDE'),
        status: this.confirmForfeit ? 'give up the bout?' : '',
        loadout: true,
      };
    }
    if (app.state === 'playing' && match.phase === 'matchOver') {
      const buttons: ActionButton[] = [];
      if (app.mode === 'net') {
        buttons.push({
          id: 'rematch',
          label: match.rematchMine ? 'WAITING…' : 'REMATCH',
          accent: UI.cool,
        });
      }
      buttons.push({ id: 'return', label: 'RETURN', accent: UI.danger });
      return {
        title: 'FIGHT OVER',
        buttons,
        status: match.rematchTheirs ? `${rival.name} wants a rematch` : '',
        loadout: false,
      };
    }
    // The round break (pre-fight hold, 3-2-1, the roundOver breather): every
    // mode gets the BALL LOADOUT here — resigning stays a bots-only luxury
    // (live opponents deserve a finished match; net bouts end at matchOver).
    if (app.state === 'playing' && (match.phase === 'roundOver' || match.phase === 'countdown')) {
      return {
        title: 'ROUND BREAK',
        buttons: app.mode === 'bot' ? this.forfeitButtons('FORFEIT') : [],
        status: this.confirmForfeit && app.mode === 'bot' ? 'give up the bout?' : this.botLine(),
        loadout: true,
      };
    }
    // Mid-round against bots (quick match still hunting, VS BOTS brawls):
    // resigning is allowed — nobody human is owed the rest of the fight. The
    // tutorial keeps its guided flow: no panel there.
    if (app.state === 'playing' && app.mode === 'bot' && match.phase === 'playing' && !app.tutorial) {
      return {
        title: 'BOT BOUT',
        buttons: this.forfeitButtons('FORFEIT'),
        status: this.confirmForfeit ? 'give up the bout?' : this.botLine(),
        loadout: false,
      };
    }
    return null;
  }

  /** The sparring partner's grade under a bot bout's panel title — which row
   *  of THE BOT LADDER the player's rank is serving them ("contender · gold
   *  grade"). Blank outside bot bouts and in the tutorial. */
  private botLine(): string {
    if (app.mode !== 'bot' || app.tutorial || !botLive.brain) return '';
    return botGradeLine(botLive.brain);
  }

  /** A toggles the panel; point + trigger clicks its buttons. */
  private updateActionPanel(): void {
    // The rematch decision pops the panel up by itself in online bouts.
    const over = app.state === 'playing' && match.phase === 'matchOver';
    if (over && !this.wasMatchOver && app.mode === 'net' && !this.panel.mesh.visible) {
      this.panel.mesh.visible = true;
      this.placePanel();
    }
    this.wasMatchOver = over;

    const content = this.panelContent();
    if (!content) {
      this.panel.mesh.visible = false;
      this.confirmForfeit = false;
      this.hidePointers();
      return;
    }

    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
      this.confirmForfeit = false; // dismissing or reopening disarms the ✕/✓
      if (this.panel.mesh.visible) this.placePanel();
      sfx.ensureAudio();
      sfx.uiClick();
    }
    if (!this.panel.mesh.visible) {
      this.hidePointers();
      return;
    }

    let hover: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, [this.panel.mesh]);
      const gp = this.input.xr.gamepads[hand];
      const held = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      if (!held && this.loadoutGrab === hand) this.loadoutGrab = null;
      if (!hit?.uv) continue;
      const id = this.panel.hitTest(hit.uv.x, hit.uv.y);
      const down = gp?.getButtonDown(InputComponent.Trigger) ?? false;
      const owns = this.loadoutGrab === hand;
      if (id && !owns) {
        hover = id;
        if (down) {
          this.runPanelAction(id);
          return;
        }
        continue;
      }
      // The loadout section: taps equip/clear attachments between rounds,
      // and the tile under the ray lights the same way it does in the lobby
      // (the panel forwards a `ball:*` hover straight to the loadout's own
      // painter — no action button ever carries that id).
      if (content.loadout) {
        const bh = this.panel.ballsHit(hit.uv.x, hit.uv.y);
        // The BEND slider scrubs here too: a press that lands on its track
        // grabs it, and the knob follows that hand while the trigger is held
        // (the same grab rule the lobby's sliders keep).
        if (bh && (down || owns) && ballsDrag(bh.u, bh.v, owns)) {
          if (down) this.loadoutGrab = hand;
          hover = 'ball:bend';
          this.panelKey = ''; // repaint with the knob where the ray put it
          continue;
        }
        const bid = bh ? ballsHit(bh.u, bh.v) : null;
        if (bid) hover = bid;
        if (down && bid && ballsClick(bid)) {
          sfx.uiClick();
          this.panelKey = ''; // repaint with the new equip state
        }
      }
    }

    // Redraw only when the content or hover actually changed.
    const key = `${content.title}|${content.buttons.map((b) => b.id + b.label).join(',')}|${content.status}|${content.loadout}|${hover}`;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panel.redraw(content.title, content.buttons, 'press A to dismiss', hover, content.status, content.loadout);
    }
  }

  /** Open the shared lobby modal for `mode`. Re-entering mid-lobby (e.g. after
   *  a look around) lands back in your seated room, not the browser. */
  private openLobby(mode: ArcadeMode): void {
    app.lobbyMode = mode;
    app.lobbyView = mesh.joined ? 'lobby' : 'browser';
  }

  /**
   * PRIVATE 2v2 / FFA: reserve a code, open the room, then hand straight over
   * to the ordinary arcade lobby lifecycle — seats fill, a full room
   * auto-launches, FFA can start short-handed, LEAVE tears it down. The room is
   * identical to a listed one except that it lives in `privateRooms`, so it
   * never appears in the browser and can only be reached by the code.
   */
  private hostPrivateBrawl(mode: ArcadeMode): void {
    void (async () => {
      try {
        const code = await mesh.hostPrivate(mode, myStats().name, (s) => {
          app.netStatus = s;
        });
        app.privateCode = code; // the lobby panel keeps it on screen
        app.lobbyMode = mode;
        app.lobbyView = 'lobby';
        app.state = 'menu';
        app.duelView = 'root';
      } catch {
        app.netStatus = 'could not open a private room';
        app.state = 'menu';
        app.duelView = 'private';
        app.privateCode = '';
      }
    })();
  }

  /**
   * Join by code without asking which format it is. A code belongs either to a
   * coded MESH room (2v2 / ffa — the doc carries its own mode) or to a 1v1 duel
   * room on the other transport, so try the mesh first and fall back to the
   * duel. That way a friend types five digits and lands in whatever the host
   * opened, which is the whole point of picking the format up front.
   */
  private joinByCode(code: string): void {
    void (async () => {
      const mode = await mesh.joinPrivate(code, myStats().name, (s) => {
        app.netStatus = s;
      });
      if (mode && mode !== '1v1') {
        app.privateCode = code;
        app.lobbyMode = mode;
        app.lobbyView = 'lobby';
        app.state = 'menu';
        app.duelView = 'root';
        app.codeEntry = '';
        return;
      }
      // Not a brawl code — let the duel transport try it (and own the error UI
      // when it isn't a valid code at all).
      net.joinPrivate(code);
    })();
  }

  /** VS BOTS / only-bots: drop straight into a bot brawl of `mode`, no mesh. */
  private startBotBrawl(mode: ArcadeMode): void {
    app.lobbyMode = null;
    app.lobbyView = 'browser';
    mesh.cancel();
    app.arcade = mode;
    app.mode = 'bot';
    app.state = 'playing';
  }

  /** The whole room drops into the bout together — the host flipped `started`
   *  on the room doc and every member launches off that mirrored signal. Raid
   *  enters the co-op titan run; 2v2 / ffa enter a live mesh brawl. */
  private launchLobby(): void {
    stopLobbyWatch();
    const mode = app.lobbyMode ?? 'raid';
    app.lobbyMode = null;
    app.lobbyRooms = [];
    app.privateCode = ''; // the invite code has done its job

    app.arcade = mode;
    // A WATCHER travels with the squad but never onto a platform: their
    // slot is the sentinel outside every layout (config.WATCHER_SLOT), so
    // every fighter renders where the arena actually put them and
    // AudienceSystem stands this headset on the terrace instead.
    app.spectating = mesh.watching;
    app.mySlot = mesh.watching ? WATCHER_SLOT : mesh.mySeat;
    if (mode === 'raid') {
      app.mode = 'campaign';
      app.campaignMode = 'raid';
      app.raidHardcore = mesh.raidHardcore;
      app.raidGoopliath = mesh.raidGoopliath;
      // Squad size snapshot — the boss is built for THIS many FISTS (2–5)
      // and stays that way even if someone drops mid-run. The terrace does
      // not count: watchers fill the tail of the same seat array and would
      // otherwise build a five-hand boss for a two-hand squad.
      app.raidSize = Math.min(5, Math.max(1, mesh.occupants.slice(0, mesh.capacity).filter(Boolean).length));
      app.difficulty = mesh.raidDifficulty; // the host's pick, mirrored to all
      app.campaignStage = 0;
    } else {
      // A live mesh brawl: seat 0 is match authority. MeshSystem's net rising
      // edge resets the per-bout pose/authority clocks.
      app.mode = 'net';
      app.side = mesh.isHost() ? 0 : 1;
    }
    app.state = 'playing';
    this.applyState();
  }

  private runPanelAction(id: string): void {
    sfx.uiClick();
    switch (id) {
      case 'forfeit':
        // Arm the are-you-sure ✕ / ✓ row — nothing ends on the first tap.
        this.confirmForfeit = true;
        this.panelKey = '';
        break;
      case 'forfeit-no':
        this.confirmForfeit = false;
        this.panelKey = '';
        break;
      case 'forfeit-yes':
      case 'return':
        this.confirmForfeit = false;
        this.panel.mesh.visible = false;
        // Ends a live net bout OR stops the bot-bout background search.
        if (app.state === 'playing') net.cancel();
        // A conceded raid leaves the squad (the room is spent) and lands at
        // the raid browser; a solo titan bout returns to the line-up.
        if (app.mode === 'campaign' && app.campaignMode === 'raid') {
          mesh.cancel();
          app.lobbyMode = 'raid';
          app.lobbyView = 'browser';
        } else if (app.mode === 'campaign') {
          app.campaignOpen = true;
        }
        app.state = 'menu'; // training tears down unsaved; bouts end here
        this.applyState();
        break;
      case 'rematch':
        if (!match.rematchMine) {
          match.rematchMine = true;
          net.send({ k: 'rematch' });
        }
        break;
    }
  }

  /** In front of you, off to the side, waist height — out of punching room. */
  private placePanel(): void {
    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    // right = forward × up
    const rx = -_fwd.z;
    const rz = _fwd.x;
    this.panel.mesh.position.set(
      _head.x + _fwd.x * 0.55 + rx * 0.38,
      1.08, // chest height — at 0.95 the loadout (and its button row) sat a shade too low
      _head.z + _fwd.z * 0.55 + rz * 0.38,
    );
    // Yawed squarely toward the head with a FIXED lectern lean — a constant
    // tilt, never derived from the head (lookAt/damped pitch baked in whatever
    // your head was doing when you pressed A, and dead vertical was too
    // straight to point at comfortably from standing eye level).
    const dx = _head.x - this.panel.mesh.position.x;
    const dz = _head.z - this.panel.mesh.position.z;
    this.panel.mesh.rotation.order = 'YXZ';
    this.panel.mesh.rotation.set(-0.24, Math.atan2(dx, dz), 0);
  }

  // --- controller pointers -------------------------------------------------

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0.85 }));
    line.name = 'menu-pointer';
    line.frustumCulled = false;
    const dot = new Mesh(new SphereGeometry(0.012, 12, 10), new MeshBasicMaterial({ color: 0xffc04d }));
    dot.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  /** Point the laser down the hand's ray, snap its end + dot to any hit. */
  /** Every paint surface on the mirror — the head, the body and whatever
   *  gear it wears — becomes a target for the bay's ray. Re-collected when
   *  the gear changes, since a fresh piece is a fresh canvas. */
  private collectBayMeshes(): void {
    this.bayMeshes = [];
    this.bayGear = [];
    this.mirror?.group.traverse((o) => {
      if (!o.userData?.paintPart) return;
      // A worn HEAD (avatar/heads.ts) hides the bare skull rather than
      // deleting it; hidden, it is not there to paint — and the frog's flat
      // crown would otherwise let the ray find the egg underneath.
      if (!o.visible) return;
      this.bayMeshes.push(o);
      if (String(o.userData.paintPart).startsWith('gear')) this.bayGear.push(o as Mesh);
    });
  }

  /**
   * THE MAGNET. The pointer's own hit stands if it is gear. Otherwise a
   * cone of rays round the pointer is cast at the gear alone and the
   * nearest gear surface any of them finds is taken — a real surface with
   * a real UV, whatever the piece's shape: a cuff's ring, a horn's curl,
   * a fin's edge, a spike. It loses only to a pointer hit that is closer
   * by more than the slack, so gear behind the body stays behind the
   * body. (Catch boxes and spheres came before this and each had a shape
   * they were wrong for; a fat ray has none.)
   */
  private bayAim(direct: Intersection | undefined, origin: Vector3, dir: Vector3): Intersection | undefined {
    if (direct && String(direct.object.userData?.paintPart ?? '').startsWith('gear')) return direct;
    if (!this.bayGear.length) return direct;
    // Two axes across the pointer.
    _end.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) _end.set(1, 0, 0);
    const u = _magnetU.crossVectors(dir, _end).normalize();
    const v = _magnetV.crossVectors(dir, u).normalize();
    let best: Intersection | undefined;
    for (const deg of BAY_MAGNET_RINGS) {
      const t = Math.tan((deg * Math.PI) / 180);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        _dir.copy(dir).addScaledVector(u, Math.cos(a) * t).addScaledVector(v, Math.sin(a) * t).normalize();
        this.magnetRay.set(origin, _dir);
        this.hits.length = 0;
        const h = this.magnetRay.intersectObjects(this.bayGear, false, this.hits)[0];
        if (h?.uv && (!best || h.distance < best.distance)) best = { ...h };
      }
    }
    if (!best) return direct;
    if (direct && best.distance > direct.distance + BAY_MAGNET_SLACK) return direct;
    return best;
  }

  /**
   * A hand's ray is in the bay and not on a panel: aim it (steadied — THE
   * STEADY HAND) at the blank and its gear (THE MAGNET), put the pointer's
   * dot where the paint would land, and hand any hit to bayBodyHit.
   * updatePointer has just set `this.ray` to this hand's raw ray.
   */
  private bayPoint(hand: 'left' | 'right'): void {
    const raw = this.ray.ray;
    const s = this.bayAimRay[hand];
    if (!s.live) {
      s.o.copy(raw.origin);
      s.d.copy(raw.direction);
      s.live = true;
    } else {
      const k = 1 - Math.exp(-this.frameDt * (BAY_STEADY.base + BAY_STEADY.chase * s.d.angleTo(raw.direction)));
      s.o.lerp(raw.origin, k);
      s.d.lerp(raw.direction, k).normalize();
    }
    this.ray.set(s.o, s.d);
    this.hits.length = 0;
    const first = this.ray.intersectObjects(this.bayMeshes, false, this.hits)[0];
    const on = this.bayAim(first ? { ...first } : undefined, s.o, s.d);
    const dot = this.pointers[hand].dot;
    if (!on?.object.userData?.paintPart || !on.uv) {
      this.bayTrail[hand].length = 0;
      return;
    }
    // The dot sits where the paint will land — the steadied spot, not the
    // shaking one.
    dot.position.copy(on.point);
    dot.visible = true;
    this.bayOnBody[hand] = true;
    this.bayBodyHit(hand, on);
  }

  /** Both pointers' dots back to plain (the bay recolours one over a mark
   *  it can lift), and no hand on the body until the rays say so. */
  private resetBayPointers(): void {
    for (const hand of ['left', 'right'] as const) {
      const dot = this.pointers[hand].dot;
      (dot.material as MeshBasicMaterial).color.setHex(0xffc04d);
      dot.scale.setScalar(1);
      this.bayOnBody[hand] = false;
    }
  }

  /** The ray is ON the blank in the paint bay: place or lift on the trigger. */
  private bayBodyHit(hand: 'left' | 'right', hit: Intersection): void {
    const part = hit.object.userData.paintPart as PaintPart;
    const u = hit.uv!.x;
    const v = hit.uv!.y;
    // A gear piece's atlas map (avatar/gearAtlas.ts): gear marks are
    // decals, measured in 3D on the piece.
    const map = hit.object.userData.paintMap as GearMap | undefined;
    bay.hover = { part, u, v };
    const now = performance.now();
    const trail = this.bayTrail[hand];
    trail.push({ t: now, part, u, v, map });
    while (trail.length > 1 && now - trail[0].t > 250) trail.shift();
    // Empty-handed over a mark: the dot turns blue and swells — this one
    // lifts.
    if (!bay.held && unitAt(part, u, v, map) >= 0) {
      const dot = this.pointers[hand].dot;
      (dot.material as MeshBasicMaterial).color.setHex(0x4fb7ff);
      dot.scale.setScalar(1.7);
    }
    const gp = this.input.xr.gamepads[hand];
    if (!(gp?.getButtonDown(InputComponent.Trigger) ?? false)) return;
    // THE TRIGGER'S JOLT: act where the ray was just before the pull.
    let at = trail[0];
    for (let i = trail.length - 1; i >= 0; i--) {
      if (now - trail[i].t >= BAY_PULL_LEAD) {
        at = trail[i];
        break;
      }
    }
    const session = this.world.session as Parameters<typeof pulseHand>[0];
    if (bay.held) {
      if (handPlace(at.part, at.u, at.v)) {
        // setLook → the real bake replaces the ghost
        this.bayGhostOn = false;
        this.bayGhostKey = '';
        sfx.uiClick();
        pulseHand(session, hand, 0.45, 28);
      } else {
        sfx.armorClank(); // the look is full
      }
    } else if (handLift(at.part, at.u, at.v, at.map)) {
      sfx.uiClick();
      pulseHand(session, hand, 0.3, 18);
    }
  }

  /**
   * The bay's per-frame upkeep after the pointers: the thumbstick (THE
   * MINUTELY on a held mark the ray is on — twist and size, grip for a
   * stripe's thickness, a tick at every eighth and a snap onto it when
   * released close; otherwise it spins the blank), B (send the hand back),
   * A / X (undo, empty-handed), and THE GHOST.
   */
  private bayUpkeep(): void {
    const dt = this.frameDt;
    const session = this.world.session as Parameters<typeof pulseHand>[0];
    for (const hand of ['left', 'right'] as const) {
      const gp = this.input.xr.gamepads[hand];
      const axes = gp?.getAxesValues(InputComponent.Thumbstick);
      const x = axes && Math.abs(axes.x) > 0.25 ? axes.x : 0;
      const y = axes && Math.abs(axes.y) > 0.25 ? axes.y : 0;
      const held = bay.held;
      if (held && this.bayOnBody[hand]) {
        if (x) {
          const before = held.angle;
          held.angle = (((held.angle + x * dt * BAY_TWIST_RATE) % 1) + 1) % 1;
          if (Math.floor(before * 8) !== Math.floor(held.angle * 8)) pulseHand(session, hand, 0.2, 12);
        }
        if (y) {
          const grip = gp?.getButtonPressed(InputComponent.Squeeze) ?? false;
          const k = grip && held.kind === 'stripe' ? 'wid' : 'len';
          held[k] = Math.max(0.03, Math.min(PAINT.maxSize, held[k] * Math.exp(-y * dt * 1.4)));
        }
        if (x || y) {
          this.twistWas[hand] = true;
        } else if (this.twistWas[hand]) {
          // Let go near an eighth: it clicks onto it.
          this.twistWas[hand] = false;
          const near = Math.round(held.angle * 8) / 8;
          if (Math.abs(held.angle - near) < 0.012) held.angle = ((near % 1) + 1) % 1;
          bay.version += 1; // the panel's hand icon catches up once, not every frame
        }
      } else if (x) {
        // THE TURN: the stick spins the blank to reach its back.
        bayFaceState.yaw -= x * dt * BAY_SPIN_RATE;
      }
    }
    const pads = this.input.xr.gamepads;
    if (bay.held && ((pads.left?.getButtonDown(InputComponent.B_Button) ?? false) || (pads.right?.getButtonDown(InputComponent.B_Button) ?? false))) {
      handReturn();
      sfx.uiClick();
    }
    if (!bay.held && ((pads.right?.getButtonDown(InputComponent.A_Button) ?? false) || (pads.left?.getButtonDown(InputComponent.X_Button) ?? false))) {
      if (undoLast()) sfx.uiClick();
    }
    // THE GHOST: the held mark, drawn over the look where the ray is —
    // redrawn only when the spot or the pose actually moved.
    const root = this.mirror?.group;
    if (root && bay.held && bay.hover) {
      const h = bay.held;
      const at = bay.hover;
      const key = `${h.kind}|${h.colour}|${h.angle.toFixed(4)}|${h.len.toFixed(4)}|${h.wid.toFixed(4)}|${at.part}|${at.u.toFixed(4)}|${at.v.toFixed(4)}`;
      if (key !== this.bayGhostKey) {
        this.bayGhostKey = key;
        applyGhost(root, { ...h, ...at });
        this.bayGhostOn = true;
      }
    } else if (root && this.bayGhostOn) {
      applyGhost(root, null);
      this.bayGhostOn = false;
      this.bayGhostKey = '';
    }
    bay.hover = null; // re-established by bayBodyHit next frame
  }

  /** Leaving the PAINT tab: nothing stranded in the hand, no ghost left on
   *  the mirror, and the blank turns back to face you. */
  private leavePaint(): void {
    if (!app.paintBayOpen) return;
    handReturn();
    app.paintBayOpen = false;
    if (this.mirror && this.bayGhostOn) applyGhost(this.mirror.group, null);
    this.bayGhostOn = false;
    this.bayGhostKey = '';
    bayFaceState.yaw = 0;
    this.mirrorTurn = wrapAngle(this.mirrorTurn); // unwind the short way
    this.resetBayPointers();
  }

  /** The mirror's place and turn, eased: home beside the LOCKER and STORE,
   *  at arm's reach for the PAINT tab, turned to the bay's facing. */
  private updateMirrorPose(delta: number): void {
    if (!this.mirror) return;
    const g = this.mirror.group;
    const shown = customization.open || app.paintBayOpen;
    const home = app.paintBayOpen ? MIRROR_PAINT : MIRROR_HOME;
    const targetTurn = app.paintBayOpen ? bayFaceState.yaw : 0;
    if (shown && !this.mirrorShown) {
      // Stepping into view: arrive in place rather than gliding in from wherever it was left.
      g.position.set(home.x, 0, home.z);
      this.mirrorTurn = targetTurn;
    } else {
      const k = 1 - Math.exp(-delta * 7);
      g.position.x += (home.x - g.position.x) * k;
      g.position.z += (home.z - g.position.z) * k;
      this.mirrorTurn += (targetTurn - this.mirrorTurn) * (1 - Math.exp(-delta * 10));
    }
    this.mirrorShown = shown;
    // Face the player at the rig origin (default forward is −Z), then turn.
    g.rotation.y = Math.PI + Math.atan2(-g.position.x, -g.position.z) + this.mirrorTurn;
    g.updateMatrixWorld(true);
  }

  private updatePointer(hand: 'left' | 'right', targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate(); // ray space points down −Z
    this.ray.set(_origin, _dir);
    this.hits.length = 0; // reuse the scratch — no per-cast array allocation
    const hit = this.ray.intersectObjects(targets, false, this.hits)[0];
    if (hit) _end.copy(hit.point);
    else _end.copy(_origin).addScaledVector(_dir, 1.6);
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    if (hit) {
      p.dot.position.copy(hit.point);
      p.dot.visible = true;
    } else {
      p.dot.visible = false;
    }
    return hit;
  }

  /** Breathe the red glow behind the FIRE FIGHT banner — a slow live pulse in
   *  opacity + scale while the banner is up. No-op out of the lobby (hidden). */
  private pulseBannerGlow(): void {
    const g = (this.bannerGlow ??= this.scene.getObjectByName('title-banner-glow') as Group | undefined);
    if (!g || !g.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 1.6); // ~0.25 Hz
    const s = 0.93 + pulse * 0.14; // 0.93 … 1.07
    g.scale.set(s, s, 1);
    // Breathe each layer's translucency around its base (haze 0.5, core 0.7).
    const base = [0.5, 0.7];
    g.children.forEach((child, i) => {
      const mat = (child as Mesh).material as MeshBasicMaterial;
      if (mat && base[i] !== undefined) mat.opacity = base[i] * (0.72 + pulse * 0.5); // ~0.72×…1.22×
    });
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  // --- visibility per state --------------------------------------------------

  private applyState(): void {
    const inLobby = app.state === 'menu' || app.state === 'queueing';
    // The terrace is a place you go for ONE bout: coming home to the lobby
    // makes you a fighter again (AudienceSystem hands the rig back to the
    // origin off the same flag).
    if (inLobby && app.spectating) app.spectating = false;
    this.menu.setVisible(inLobby);
    // Back in the lobby: hand the audio over — the victory sting rings out, then
    // (and only then) the lobby music fades up, so they never overlap. During a
    // bout / training the lobby music just pauses. Fired on the TRANSITION
    // only: applyState() runs after every lobby click (tab swaps included),
    // and re-running the handoff mid-fade used to yank the music to silence
    // and start the fade over — the locker ⇄ store warble.
    if (inLobby !== this.musicInLobby) {
      this.musicInLobby = inLobby;
      if (inLobby) handoffToLobby();
      else setMenuMusicActive(false);
    }
    // Fresh board standings + the day's Gasket Gazette whenever you land back
    // in the lobby (both throttled).
    if (inLobby) {
      void refreshLeaderboard();
      void refreshGazette();
    }

    // Live "N searching" (1V1 panel) and "X/12 in the pub" (pub door) counts —
    // only watched in the lobby.
    if (inLobby) {
      startQueueWatch((n) => {
        app.searching = n;
      });
      startPubWatch((counts) => {
        app.pubRegionCounts = counts;
        // Door badge shows the total across all reachable regions.
        const known = Object.values(counts).filter((c) => c >= 0);
        app.pubCount = known.length ? known.reduce((a, b) => a + b, 0) : -1;
      });
    } else {
      stopQueueWatch();
      app.searching = -1;
      stopPubWatch();
      app.pubCount = -1;
      app.pubRegionCounts = {};
      app.infoView = 'root';
    }

    // Returning to the lobby from a ranked bout drops you back on the server
    // list (onMatched left duelView at 'root'), so you can host or join again.
    if (inLobby && app.state === 'menu' && app.fromRanked && app.duelView === 'root') {
      app.duelView = 'browser';
    }
    // Watch the open ranked rooms across the whole lobby (not just inside the
    // browser) so the RANKED button can show a live "N open" count.
    if (inLobby) {
      startRankedWatch((rooms) => {
        app.rankedRooms = rooms;
      });
      // …and the forming raid squads, so the RAID button can badge them too.
      startRaidWatch((n) => {
        app.raidsOpen = n;
      });
    } else {
      stopRankedWatch();
      app.rankedRooms = [];
      stopRaidWatch();
      app.raidsOpen = -1;
    }

    // The action panel only lives inside training runs and bouts; the
    // keyboard only in the lobby.
    if (inLobby && this.panel) {
      this.panel.mesh.visible = false;
      this.panelKey = '';
      this.wasMatchOver = false;
    }
    if (!inLobby && this.keyboard) {
      this.keyboard.close();
      this.kbPending = null;
    }
    // Customisation (panel + mirror) and the profile card are lobby-only affairs.
    if (!inLobby) {
      customization.open = false;
      profilePop.open = false;
      if (this.mirror) this.mirror.group.visible = false;
    }

    // The title banner (and its live red glow) show only in the lobby.
    const banner = this.scene.getObjectByName('title-banner');
    if (banner) banner.visible = inLobby;
    const bannerGlow = this.scene.getObjectByName('title-banner-glow');
    if (bannerGlow) bannerGlow.visible = inLobby;
    // Outside a live bout, fall back to the classic duel layout so the lobby
    // and Aim Training show one opponent pad, not a leftover arcade cross,
    // and leave any arcade mesh room we were in. EXCEPT while a lobby modal
    // is up: an arcade LOBBY is a live mesh room parked in the menu state —
    // cancelling here would tear down the squad you just hosted or joined.
    if (app.state !== 'playing' && app.lobbyMode === null) {
      mesh.cancel();
      app.arcade = '1v1';
      app.mySlot = 0;
      applyArenaLayout(this.scene);
    }
    // The opponent's platform exists only in a fight: the lobby is just you in
    // the street (it reappears there solely as the stand for a platform
    // try-on, see the locker preview above).
    const oppPlatform = this.scene.getObjectByName('opponent-platform');
    if (oppPlatform) oppPlatform.visible = app.state === 'playing' || this.oppPadPreviewed;

    if (inLobby) this.menu.redrawAll(this.hovered, this.hoveredAction);
    this.lastState = app.state;
  }
}
