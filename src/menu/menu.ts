/**
 * The lobby: three smoked-steel plates on a shallow arc in front of the
 * player — industrial robot-wars styling, translucent so your room stays
 * visible through them. Centre = AIM TRAINING (the headline mode), left =
 * 1V1 (quick match + vs bot), right = stats & connection info. A fourth
 * plate hangs BEHIND the player: the Firebase leaderboard (1V1 score / aim
 * training tabs) — lobby only, gone the moment a bout or run starts. Each
 * panel is a canvas texture on a plane; MenuSystem raycasts the controllers
 * for hover + click and maps the hit UV to an action zone.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
  SRGBColorSpace,
} from 'three';
import { app } from './appState.js';
import { coins } from './wallet.js';
import { GAME_TITLE, type ArcadeMode } from '../config.js';
import { frontPage, type GazetteArticle } from '../net/gazette.js';
import { PUB_MAX_PLAYERS } from '../pub/protocol.js';
import { PUB_REGIONS } from '../pub/config.js';
import { UI, buttonPlate, hazardStrip, plate, stencilFont } from '../ui/industrial.js';
import { KIT } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { BALLS_CONTENT_H, BALLS_H, BALLS_W, renderBallsPanel } from './ballsFace.js';

export type PanelId =
  | 'train'
  | 'duel'
  | 'info'
  /** THE READER: the paper held up large in front of you (MenuSystem). */
  | 'reader'
  /** THE PAINT BAY (a kit panel modal — src/menu/paintbay.ts). */
  | 'paintbay'
  /** THE PROFILE pop-out above the YOU wing: the chip, and the card it drops. */
  | 'profile'
  | 'profilecard'
  | 'custom'
  | 'loadout'
  | 'balls'
  /** The platform shop (a sub-modal of customisation). */
  | 'shop'
  /** The ARCADE campaign line-up — the titan gauntlet (modal over the lobby). */
  | 'campaign'
  /** The shared arcade LOBBY (room browser / squad room) for 2v2 / ffa / raid
   *  — modal over the lobby. */
  | 'lobby';

export type MenuAction =
  | 'start-tutorial'
  | 'start-training'
  | 'arcade-2v2'
  | 'arcade-ffa'
  /** Open / close the campaign line-up; start a stage / a timed run. */
  | 'open-campaign'
  | 'campaign-close'
  | 'campaign-speedrun'
  | 'campaign-hardcore'
  /** The pick-your-damage launch pop-up the run buttons open. */
  | 'campaign-launch-start'
  | 'campaign-launch-cancel'
  /** The sealed entry beneath the line-up: GOOPLIATH's own fight. */
  | 'campaign-goopliath'
  | `campaign-${number}`
  /** Run difficulty picker — campaign (local) and raid (host, mirrored). */
  | `diff-${string}`
  | `raiddiff-${string}`
  /** Open the shared arcade lobby modal for a networked mode (2v2 / ffa / raid). */
  | 'open-raid'
  /** The arcade lobby: browse rooms, make one, join one, drop onto bots, host
   *  controls (raid hardcore, ffa short-handed start). */
  | 'lobby-close'
  | 'lobby-host'
  | 'lobby-vsbots'
  | 'lobby-hardcore'
  /** RAID host breaker: swap the titan run for the GOOPLIATH fight. */
  | 'lobby-goopliath'
  | 'lobby-start'
  | 'lobby-leave'
  /** SHARE: the Discord bot posts this room's join link (DESIGN §8.2). */
  | 'lobby-discord'
  | `lobby-join-${string}`
  /** Take a WATCHER seat in a listed lobby — travel with the squad and
   *  stand on the audience ground (DESIGN §3.2). */
  | `lobby-watch-${string}`
  | 'toggle-shootback'
  | 'toggle-onlybots'
  | 'toggle-voice'
  /** HIDE PAINT — render every other player's body bare (docs/paint.md §6). */
  | 'toggle-hide-paint'
  | 'ranked-match'
  /** RANKED server browser: host your own room, go back to the mode list, or
   *  cancel a host/join and return to the browser. Joining a listed room is
   *  `ranked-join-${docId}`. */
  | 'ranked-host'
  | 'ranked-back'
  | 'ranked-cancel'
  | `ranked-join-${string}`
  | 'quick-match'
  | 'cancel-queue'
  | 'private-open'
  | 'private-create'
  | 'private-enter'
  | 'private-back'
  /** Private-match FORMAT, picked before the code is reserved. */
  | 'private-mode-1v1'
  | 'private-mode-2v2'
  | 'private-mode-ffa'
  | 'kp-del'
  | 'kp-join'
  | `kp-${number}`
  /** Arena-backdrop picker (SETTINGS » ARENA): the desert / THE COVE. */
  | 'env-desert'
  | 'env-cove'
  | 'env-neon'
  | 'env-saltflats'
  | 'env-factory'
  | 'tab-arena'
  /** Leaderboard top tab: BATTLE fronts the 1v1 / 2v2 / ffa boards. */
  | 'lb-battle'
  | 'lb-ranked'
  | 'lb-xp'
  | 'lb-arcade'
  | 'lb-training'
  | 'lb-duo'
  | 'lb-ffa'
  /** ARCADE PvE run-time sub-boards. */
  | 'lb-gauntlet'
  | 'lb-raid'
  | 'lb-goopliath'
  /** The run boards' view strip: one difficulty, and HC ONLY. */
  | 'lb-view-normal'
  | 'lb-view-hard'
  | 'lb-view-blazing'
  | 'lb-view-hc'
  | `lb-row-${number}`
  /** THE PROFILE pop-out (MENUS 2): the chip toggles the card; CLOSE folds it. */
  | 'profile-toggle'
  | 'profile-close'
  | 'edit-note'
  | 'profile-back'
  | 'rename'
  /** Hover-only: a profile trophy chip / clear badge — shows its tooltip. */
  | `badge-${string}`
  | 'open-pub'
  | 'pub-back'
  /** ARCADE → RAVE RAID (the rave page, src/rave/). */
  | 'open-rave'
  | `pub-go-${string}`
  | 'open-custom'
  | 'custom-close'
  /** Dragging the armour-colour hue bar (continuous — MenuSystem reads the UV). */
  | 'av-color'
  /** Dragging the armour lightness/darkness bar. */
  | 'av-light'
  /** Reset the armour colour to the skin's default palette. */
  | 'av-uncolor'
  /** The body's ONE choice: start all white, or all black. */
  | 'base-white'
  | 'base-black'
  /** The customization plate's PAINT tab (menu/paintbay.ts), and CLOSE
   *  from it — which closes the whole plate, like the other two faces'. */
  | 'open-paintbay'
  | 'paintbay-close'
  /** The header tabs: LOCKER (what you own) · STORE (what you don't) ·
   *  PAINT (the paint tab above). */
  | 'open-shop'
  | 'open-locker'
  /** Switch the shop / locker tab. */
  | 'tab-avatars'
  | 'tab-platforms'
  | 'tab-gear'
  | 'gear-head'
  | 'gear-body'
  | 'gear-hands'
  | 'gear-face'
  | 'gear-shoulders'
  | 'tab-colour'
  /** The STORE's paint racks (its `pb:buy-*` ids route through paintbay.ts). */
  | 'tab-paint'
  /** The PLATFORMS board's shelves (avatar/skins.ts DECK_SHELVES). */
  | `shelf-${string}`
  /** THE BANK: iron-dollars for money (net/bank.ts). `tab-bank` is the
   *  store's chip; `open-bank` walks there from the YOU wing's purse. */
  | 'tab-bank'
  | 'open-bank'
  | `bank-pack-${string}`
  | 'bank-open'
  | 'bank-cancel'
  | 'bank-done'
  /** THE ACCOUNT: protect this headset's uid with an email; recover one
   *  protected elsewhere (the keyboard takes the email, then the code). */
  | 'bank-protect'
  | 'bank-recover'
  | 'bank-code'
  | 'bank-recover-cancel'
  /** Tap an avatar tile (equip) or a platform tile (buy if unowned, else equip). */
  | `shop-av-${number}`
  | `shop-pf-${number}`
  /** Tap a GEAR tile (wear / take off if owned; try on in the STORE). */
  | `shop-gr-${number}`
  /** The BUY button on a previewed (tried-on) STORE tile. */
  | `shop-buy-av-${number}`
  | `shop-buy-pf-${number}`
  | `shop-buy-gr-${number}`
  /** Open / close the Gasket Gazette. */
  | 'open-gazette'
  | 'gazette-close'
  /** Hold the paper up large in front of you, and put it back on the wing. */
  | 'gazette-reader'
  | 'reader-close'
  /** Open / close the SETTINGS modal (the gear disc left of the paper). */
  | 'open-settings'
  | 'settings-close'
  | 'settings-report'
  | 'settings-credits'
  | 'credits-back'
  /** Toggle the lobby/battle music mute (now inside the SETTINGS modal). */
  | 'toggle-mute'
  /** Dragging the SFX / music volume sliders (continuous — MenuSystem reads UV). */
  | 'sfx-vol'
  | 'music-vol';

const PW = 512;
const PH = 400;
// The ARCADE panel holds TUTORIAL / CAMPAIGN / RAID / AIM TRAINING plus its
// three breaker toggles (shoot-back, only-play-bots, voice-chat) — the
// 2V2 / FFA brawls live on the BATTLE panel.
const TRAIN_H = PH + 80;
// The 1V1 panel grows a little downward so the "searching for an opponent…"
// line sits inside the frame instead of hanging off the bottom edge.
const DUEL_H = PH + 48;
// The leaderboard plate is taller than the lobby panels so the whole top 10
// fits at once — its own canvas (same width, more height) and a physical size
// scaled to match, so the text keeps the lobby's pixel density (no stretch).
const PROFILE_KEYBOARD_HINT_MS = 4500;

let profileKeyboardHintUntil = 0;

export function flashProfileKeyboardHint(): void {
  profileKeyboardHintUntil = performance.now() + PROFILE_KEYBOARD_HINT_MS;
}

export function clearProfileKeyboardHint(): void {
  profileKeyboardHintUntil = 0;
}

/** Whether the "turn around to the keyboard" hint is still on screen — the
 *  freshness tick watches this so its expiry triggers the clearing repaint. */
export function profileHintActive(): boolean {
  return performance.now() < profileKeyboardHintUntil;
}

export interface MenuPanel {
  id: PanelId;
  mesh: Mesh;
  redraw: (hoverAction: MenuAction | null) => void;
  /** Map a hit UV (u right, v up) to an action, or null. */
  hitTest: (u: number, v: number) => MenuAction | null;
  /**
   * Continuous control (e.g. a slider): called every frame the trigger is
   * held over the panel. Returns true if the hit landed on the control (the
   * caller then redraws and suppresses the click action). `grabbed` is true
   * once the caller has seen a press land on the control and the trigger is
   * still down — the control may then follow the ray off its own track.
   */
  drag?: (u: number, v: number, grabbed?: boolean) => boolean;
  /**
   * Self-contained click on trigger-down (mutates + persists its own state).
   * Returns true if it handled the hit, so the caller redraws + clicks the
   * relay sound instead of running a global MenuAction.
   */
  click?: (u: number, v: number) => boolean;
}

export interface Menu {
  group: Group;
  panels: MenuPanel[];
  setVisible: (v: boolean) => void;
  redrawAll: (hoverId: PanelId | null, hoverAction: MenuAction | null) => void;
}

/** The shared panel skeleton: smoked plate, hazard chip, stencil title. The
 *  taller leaderboard plate passes its own width/height. */
function panelBg(
  ctx: CanvasRenderingContext2D,
  hover: boolean,
  accent: string,
  title: string,
  w = PW,
  h = PH,
): void {
  ctx.clearRect(0, 0, w, h);
  plate(ctx, 8, 8, w - 16, h - 16, {
    cut: 26,
    fill: hover ? 'rgba(14,15,20,0.6)' : UI.ink,
    stroke: hover ? accent : UI.steel,
  });
  hazardStrip(ctx, 36, 34, 52, 16, UI.amber);
  ctx.textAlign = 'left';
  // Pin the baseline: the canvas ctx is REUSED across repaints, and hover
  // paths leave different textBaseline behind — an inherited baseline made
  // the title hop up and down as the pointer moved.
  ctx.textBaseline = 'middle';
  ctx.font = stencilFont(40);
  ctx.fillStyle = accent;
  ctx.fillText(title, 104, 44);
  ctx.strokeStyle = hover ? accent : UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 72);
  ctx.lineTo(w - 36, 72);
  ctx.stroke();
  ctx.textAlign = 'center';
}

interface PanelOpts {
  cw?: number;
  ch?: number;
  drag?: MenuPanel['drag'];
  click?: MenuPanel['click'];
}

function makePanel(
  id: PanelId,
  wMeters: number,
  hMeters: number,
  draw: (ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null) => void,
  hitTest: MenuPanel['hitTest'],
  opts: PanelOpts = {},
): MenuPanel {
  const { cw = PW, ch = PH, drag, click } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = `menu-panel:${id}`;
  const redraw = (hoverAction: MenuAction | null): void => {
    draw(ctx, hoverAction);
    texture.needsUpdate = true;
  };
  return { id, mesh, redraw, hitTest, drag, click };
}

/** Centre — ARCADE: the guided TUTORIAL, the single-player titan CAMPAIGN and
 *  AIM TRAINING, plus the three breaker toggles. (2V2 / FFA now live on the
 *  BATTLE panel with the rest of the fights.) */
function drawTrain(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.emberBright, 'ARCADE', PW, TRAIN_H);
  // Until the tutorial has been RUN once, everything but the tutorial itself
  // is sealed (MenuSystem's pre-tutorial gate) — draw it that way.
  const locked = !app.tutorialDone;

  // TUTORIAL sits at the top — the very first thing a new boxer should tap.
  // Until it's been completed it breathes ember (MenuSystem repaints this
  // panel every frame while locked) so there's no hunting for the next step.
  const pulse = locked ? 0.5 + 0.5 * Math.sin(performance.now() / 320) : 0;
  buttonPlate(ctx, 70, 80, PW - 140, 54, 'TUTORIAL', UI.emberBright, hoverAction === 'start-tutorial', false, pulse);
  // The single-player CAMPAIGN — the titan gauntlet — right below it.
  buttonPlate(ctx, 70, 140, PW - 140, 54, 'CAMPAIGN', UI.danger, !locked && hoverAction === 'open-campaign', locked);
  // The RAID — up to five raiders, five titans, one lobby.
  buttonPlate(ctx, 70, 200, PW - 140, 54, 'RAID', '#b26bff', !locked && hoverAction === 'open-raid', locked);
  // Live "N OPEN" badge on the RAID plate — squads forming right now, so you
  // can see there's a raid to join without opening the browser (RANKED's pill).
  if (!locked && app.raidsOpen > 0) {
    const label = `${app.raidsOpen} OPEN`;
    ctx.font = '800 16px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 34, pillH = 24;
    const px = PW - 70 - pillW, py = 215;
    plate(ctx, px, py, pillW, pillH, { cut: 8, fill: 'rgba(178,107,255,0.22)', stroke: '#b26bff', rivets: false });
    ctx.fillStyle = '#d3a5ff';
    ctx.beginPath();
    ctx.arc(px + 14, py + pillH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 24, py + pillH / 2 + 1);
    ctx.textAlign = 'center';
  }
  buttonPlate(ctx, 70, 260, PW - 140, 54, 'AIM TRAINING', UI.ember, !locked && hoverAction === 'start-training', locked);
  if (locked) {
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,192,77,0.78)';
    ctx.fillText('you must complete the tutorial to advance', PW / 2, 334);
  }

  // Two industrial breaker switches: targets-shoot-back, then only-play-bots.
  const breaker = (text: string, on: boolean, hot: boolean, py: number, onFill: string, onStroke: string): void => {
    ctx.font = '700 21px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = hot ? UI.emberBright : UI.textDim;
    ctx.fillText(text, 64, py + 23);
    const pw = 96, ph = 34, px = PW - 64 - pw;
    plate(ctx, px, py, pw, ph, {
      cut: 10,
      fill: on ? onFill : hot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.12)',
      stroke: hot ? UI.emberBright : on ? onStroke : UI.steelDim,
      rivets: false,
    });
    ctx.fillStyle = on ? onStroke : UI.steelDim;
    const kw = pw / 2 - 10;
    ctx.fillRect(on ? px + pw - kw - 6 : px + 6, py + 6, kw, ph - 12);
  };
  breaker('targets shoot back', app.shootBack, hoverAction === 'toggle-shootback', 348, 'rgba(79,183,255,0.25)', UI.cool);
  breaker('only play bots', app.onlyBots, hoverAction === 'toggle-onlybots', 398, 'rgba(255,176,0,0.25)', UI.amber);
}

function hitTrain(_u: number, v: number): MenuAction | null {
  // v: 0 bottom → 1 top (canvas y = (1-v)*TRAIN_H).
  const y = (1 - v) * TRAIN_H;
  if (y >= 80 && y <= 134) return 'start-tutorial';
  if (y >= 140 && y <= 194) return 'open-campaign';
  if (y >= 200 && y <= 254) return 'open-raid';
  if (y >= 260 && y <= 314) return 'start-training';
  if (y >= 346 && y <= 384) return 'toggle-shootback';
  if (y >= 396 && y <= 434) return 'toggle-onlybots';
  return null;
}

/** Left — BATTLE. Every live fight: the 1v1 modes (Ranked / Quick / Private)
 *  and the 2V2 / FFA brawls — or the private-match sub-flow. */
function drawDuel(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.cool, 'BATTLE', PW, DUEL_H);
  switch (app.duelView) {
    case 'private':
      return drawPrivateMenu(ctx, hoverAction);
    case 'hosting':
      return drawHosting(ctx, hoverAction);
    case 'keypad':
      return drawKeypad(ctx, hoverAction);
    case 'browser':
      return drawBrowser(ctx, hoverAction);
    default:
      return drawDuelRoot(ctx, hoverAction);
  }
}

function hitDuel(u: number, v: number): MenuAction | null {
  switch (app.duelView) {
    case 'private':
      return hitPrivateMenu(u, v);
    case 'hosting':
      return hitHosting(v);
    case 'keypad':
      return hitKeypad(u, v);
    case 'browser':
      return hitBrowser(v);
    default:
      return hitDuelRoot(v);
  }
}

function drawDuelRoot(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  const queueing = app.state === 'queueing';
  const rankedAction = queueing ? 'cancel-queue' : 'ranked-match';
  // Every live fight is sealed until the tutorial has been run once.
  const locked = !app.tutorialDone;
  // RANKED is disabled while ONLY PLAY BOTS is on (no online queue allowed).
  const rankedOff = (app.onlyBots && !queueing) || locked;

  // RANKED — opens the server browser (host your own room, or join a listed
  // one). Greyed + dead while ONLY PLAY BOTS is on.
  buttonPlate(
    ctx, 70, 74, PW - 140, 58,
    queueing ? 'CANCEL' : 'RANKED',
    queueing ? UI.amber : UI.cool,
    !rankedOff && hoverAction === rankedAction,
    rankedOff,
  );

  // Live "N open" badge on the RANKED plate — how many servers are up to join.
  if (!queueing && !rankedOff && app.rankedRooms.length > 0) {
    const label = `${app.rankedRooms.length} OPEN`;
    ctx.font = '800 16px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 34, pillH = 24;
    const px = PW - 70 - pillW, py = 82;
    plate(ctx, px, py, pillW, pillH, { cut: 8, fill: 'rgba(79,183,255,0.22)', stroke: UI.cool, rivets: false });
    ctx.fillStyle = UI.coolBright;
    ctx.beginPath();
    ctx.arc(px + 14, py + pillH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.coolBright;
    ctx.fillText(label, px + 24, py + pillH / 2 + 1);
    ctx.textAlign = 'center';
  }

  // QUICK MATCH — drops you straight onto a bot, but keeps hunting; a human who
  // turns up pulls you into the live bout.
  buttonPlate(ctx, 70, 138, PW - 140, 58, 'QUICK MATCH', UI.ember, !locked && hoverAction === 'quick-match', locked);
  // PRIVATE — share a 5-digit code with a friend.
  buttonPlate(ctx, 70, 202, PW - 140, 54, 'PRIVATE', UI.coolBright, !locked && hoverAction === 'private-open', locked);

  // The BRAWLS — 2V2 and FFA — sit below a faint divider: same live-fight hub,
  // one section for duels, one for the free-for-alls.
  ctx.strokeStyle = UI.steelDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, 268);
  ctx.lineTo(PW - 70, 268);
  ctx.stroke();
  buttonPlate(ctx, 70, 280, PW - 140, 50, '2V2', UI.cool, !locked && hoverAction === 'arcade-2v2', locked);
  buttonPlate(ctx, 70, 336, PW - 140, 50, 'FFA', UI.amber, !locked && hoverAction === 'arcade-ffa', locked);

  if (queueing) {
    ctx.textAlign = 'center';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText('searching for an opponent…', PW / 2, 404);
  } else if (locked) {
    // The same seal note the ARCADE panel carries — greyed plates alone
    // never said WHY everything was dead.
    ctx.textAlign = 'center';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,192,77,0.78)';
    ctx.fillText('you must complete the tutorial to advance', PW / 2, 404);
  }
}

function hitDuelRoot(v: number): MenuAction | null {
  const y = (1 - v) * DUEL_H;
  if (y >= 70 && y <= 136) {
    if (app.state === 'queueing') return 'cancel-queue';
    return app.onlyBots ? null : 'ranked-match'; // ranked disabled in only-bots mode
  }
  if (y >= 138 && y <= 198) return 'quick-match';
  if (y >= 202 && y <= 258) return 'private-open';
  if (y >= 280 && y <= 332) return 'arcade-2v2';
  if (y >= 336 && y <= 388) return 'arcade-ffa';
  return null;
}

/** The private-match format row: pick 1V1 / 2V2 / FFA, then reserve a code. */
const PRIV_MODES: { mode: ArcadeMode; label: string; action: MenuAction; seats: string }[] = [
  { mode: '1v1', label: '1V1', action: 'private-mode-1v1', seats: '2' },
  { mode: '2v2', label: '2V2', action: 'private-mode-2v2', seats: '4' },
  { mode: 'ffa', label: 'FFA', action: 'private-mode-ffa', seats: '4' },
];
const PRIV_CHIP_Y = 100;
const PRIV_CHIP_H = 52;

function drawPrivateMenu(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.font = '600 19px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  // Kept short deliberately: at 19px anything much past ~42 characters runs off
  // both edges of a 512-wide panel.
  ctx.fillText('pick a format, then create or enter a code', PW / 2, 84);

  // FORMAT chips. The host chooses before any code exists, because the code is
  // reserved against a room of that shape; a joiner needs none of this, since
  // the code carries its own mode.
  const gap = 10;
  const chipW = (PW - 128 - gap * 2) / 3;
  PRIV_MODES.forEach(({ mode, label, action, seats }, i) => {
    const cx = 64 + i * (chipW + gap);
    const on = app.privateMode === mode;
    const hot = hoverAction === action;
    plate(ctx, cx, PRIV_CHIP_Y, chipW, PRIV_CHIP_H, {
      cut: 8,
      fill: on ? hexToRgba(UI.coolBright, 0.28) : 'rgba(150,150,170,0.10)',
      stroke: on || hot ? UI.coolBright : UI.steelDim,
      rivets: false,
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = on ? UI.coolBright : UI.text;
    ctx.fillText(label, cx + chipW / 2, PRIV_CHIP_Y + PRIV_CHIP_H / 2 - 8);
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = on ? 'rgba(159,226,255,0.85)' : UI.textDim;
    ctx.fillText(`${seats} players`, cx + chipW / 2, PRIV_CHIP_Y + PRIV_CHIP_H / 2 + 13);
    ctx.textBaseline = 'alphabetic';
  });

  buttonPlate(ctx, 64, 170, PW - 128, 72, 'CREATE MATCH', UI.cool, hoverAction === 'private-create');
  buttonPlate(ctx, 64, 252, PW - 128, 62, 'ENTER CODE', UI.amber, hoverAction === 'private-enter');
  buttonPlate(ctx, 150, 324, PW - 300, 52, 'BACK', UI.steel, hoverAction === 'private-back');
}

function hitPrivateMenu(u: number, v: number): MenuAction | null {
  const y = (1 - v) * DUEL_H;
  if (y >= PRIV_CHIP_Y - 4 && y <= PRIV_CHIP_Y + PRIV_CHIP_H + 4) {
    const x = u * PW;
    const gap = 10;
    const chipW = (PW - 128 - gap * 2) / 3;
    for (let i = 0; i < PRIV_MODES.length; i++) {
      const cx = 64 + i * (chipW + gap);
      if (x >= cx && x <= cx + chipW) return PRIV_MODES[i].action;
    }
    return null;
  }
  // Bands kept strictly disjoint (chips end 156, create 164–248, enter 250–318,
  // back 322–380) so no row can shadow the next one's top edge.
  if (y >= 164 && y <= 248) return 'private-create';
  if (y >= 250 && y <= 318) return 'private-enter';
  if (y >= 322 && y <= 380) return 'private-back';
  return null;
}

function drawHosting(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('YOUR MATCH CODE', PW / 2, 116);
  const code = app.privateCode || '·····';
  ctx.font = stencilFont(72);
  ctx.fillStyle = UI.coolBright;
  ctx.fillText(code.split('').join(' '), PW / 2, 188);
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,226,255,0.85)';
  ctx.fillText(app.privateCode ? 'share it · waiting for them…' : 'allocating…', PW / 2, 250);
  buttonPlate(ctx, 110, 296, PW - 220, 70, 'CANCEL', UI.amber, hoverAction === 'cancel-queue');
}

function hitHosting(v: number): MenuAction | null {
  const y = (1 - v) * DUEL_H;
  return y >= 290 && y <= 372 ? 'cancel-queue' : null;
}

// RANKED server browser — a GO button (host your own room) over a list of the
// active rooms, each with a "1/2" seat pill you can click to join.
const BROWSER_ROWS = 3; // visible rows (rare to have more than a couple)
const BROWSER_ROW_Y0 = 182;
const BROWSER_ROW_H = 40;
const BROWSER_ROW_STEP = 46;

function drawBrowser(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  // Once you've pressed GO (or clicked a room) you're waiting on a match — the
  // top button becomes CANCEL and the list rows go unclickable, but you stay on
  // the list so you can see your own room sitting in it.
  const waiting = app.state === 'queueing' && app.fromRanked;

  buttonPlate(
    ctx, 64, 82, PW - 128, 60,
    waiting ? 'CANCEL' : 'GO',
    waiting ? UI.amber : UI.ember,
    hoverAction === (waiting ? 'ranked-cancel' : 'ranked-host'),
  );

  if (waiting) {
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.9)';
    ctx.fillText(app.rankedHost ? 'waiting for an opponent…' : 'joining…', PW / 2, 164);
  } else {
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.textDim;
    ctx.fillText('ACTIVE SERVERS', 66, 166);
    ctx.textAlign = 'center';
  }

  const rooms = app.rankedRooms;
  if (rooms.length === 0) {
    if (!waiting) {
      ctx.font = '600 19px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(159,226,255,0.7)';
      ctx.fillText('no open servers yet — press GO to host one', PW / 2, 244);
    }
  } else {
    const shown = Math.min(rooms.length, BROWSER_ROWS);
    for (let i = 0; i < shown; i++) {
      const room = rooms[i];
      const mine = room.id === app.rankedRoomId; // our own room — not clickable
      const y = BROWSER_ROW_Y0 + i * BROWSER_ROW_STEP;
      const hot = !waiting && hoverAction === `ranked-join-${room.id}`;
      plate(ctx, 64, y, PW - 128, BROWSER_ROW_H, {
        cut: 10,
        fill: mine ? 'rgba(79,183,255,0.16)' : hot ? 'rgba(255,176,0,0.16)' : 'rgba(150,150,170,0.10)',
        stroke: mine ? UI.cool : hot ? UI.amber : UI.steelDim,
        rivets: false,
      });
      ctx.font = '800 21px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = mine ? UI.coolBright : hot ? UI.amber : UI.text;
      const name = room.host.toUpperCase().slice(0, 14) + (mine ? ' · YOU' : '');
      ctx.fillText(name, 82, y + BROWSER_ROW_H / 2 + 1);

      // "1/2" occupancy pill — a listed room always has its host waiting in it.
      const label = '1/2';
      ctx.font = '800 17px system-ui, sans-serif';
      const pillW = ctx.measureText(label).width + 28;
      const pillH = 24;
      const px = PW - 82 - pillW;
      const py = y + BROWSER_ROW_H / 2 - pillH / 2;
      plate(ctx, px, py, pillW, pillH, { cut: 8, fill: 'rgba(79,183,255,0.20)', stroke: UI.cool, rivets: false });
      ctx.fillStyle = UI.coolBright;
      ctx.textAlign = 'center';
      ctx.fillText(label, px + pillW / 2, py + pillH / 2 + 1);
    }
    if (rooms.length > shown) {
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = UI.textDim;
      ctx.fillText(`+${rooms.length - shown} more…`, PW / 2, BROWSER_ROW_Y0 + shown * BROWSER_ROW_STEP + 6);
    }
  }

  // BACK to the mode menu — only when you haven't committed to a room yet.
  if (!waiting) {
    buttonPlate(ctx, 150, 326, PW - 300, 48, 'BACK', UI.steel, hoverAction === 'ranked-back');
  }
}

function hitBrowser(v: number): MenuAction | null {
  const waiting = app.state === 'queueing' && app.fromRanked;
  const y = (1 - v) * DUEL_H;
  if (y >= 78 && y <= 146) return waiting ? 'ranked-cancel' : 'ranked-host';
  if (waiting) return null; // rows + BACK are inert while you wait in a room
  const rooms = app.rankedRooms;
  const shown = Math.min(rooms.length, BROWSER_ROWS);
  for (let i = 0; i < shown; i++) {
    const ry = BROWSER_ROW_Y0 + i * BROWSER_ROW_STEP;
    if (y >= ry - 3 && y <= ry + BROWSER_ROW_H + 3) return `ranked-join-${rooms[i].id}` as MenuAction;
  }
  if (y >= 322 && y <= 380) return 'ranked-back';
  return null;
}

// Keypad geometry, shared by draw + hit-test.
const KP = { x: 56, y: 150, gap: 9, cols: 3, rows: 4, w: PW - 112, h: 218 };
const KP_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['DEL', '0', 'JOIN'],
];

function kpCell(r: number, c: number): { x: number; y: number; w: number; h: number } {
  const cw = (KP.w - KP.gap * (KP.cols - 1)) / KP.cols;
  const ch = (KP.h - KP.gap * (KP.rows - 1)) / KP.rows;
  return { x: KP.x + c * (cw + KP.gap), y: KP.y + r * (ch + KP.gap), w: cw, h: ch };
}

function drawKeypad(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  if (app.state === 'queueing') {
    buttonPlate(ctx, 70, 150, PW - 140, 92, 'CANCEL', UI.amber, hoverAction === 'cancel-queue');
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,226,255,0.85)';
    ctx.fillText(`joining ${app.codeEntry}…`, PW / 2, 300);
    return;
  }

  buttonPlate(ctx, 36, 84, 96, 34, 'BACK', UI.steel, hoverAction === 'private-back');

  const bad = app.netStatus.includes('not found') || app.netStatus.includes('expired') || app.netStatus.includes('already');
  const slots = Array.from({ length: 5 }, (_, i) => app.codeEntry[i] ?? '·').join(' ');
  ctx.font = stencilFont(40);
  ctx.fillStyle = bad ? UI.danger : UI.coolBright;
  ctx.fillText(slots, PW / 2 + 28, 104);

  const ready = app.codeEntry.length === 5;
  for (let r = 0; r < KP.rows; r++) {
    for (let c = 0; c < KP.cols; c++) {
      const key = KP_KEYS[r][c];
      const cell = kpCell(r, c);
      const accent = key === 'JOIN' ? (ready ? UI.cool : UI.steelDim) : key === 'DEL' ? UI.amber : UI.text;
      buttonPlate(ctx, cell.x, cell.y, cell.w, cell.h, key, accent, false);
    }
  }
}

function hitKeypad(u: number, v: number): MenuAction | null {
  const x = u * PW;
  const y = (1 - v) * DUEL_H;
  if (app.state === 'queueing') return y >= 140 && y <= 250 ? 'cancel-queue' : null;
  if (y >= 80 && y <= 122 && x <= 140) return 'private-back';
  for (let r = 0; r < KP.rows; r++) {
    for (let c = 0; c < KP.cols; c++) {
      const cell = kpCell(r, c);
      if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) {
        const key = KP_KEYS[r][c];
        if (key === 'DEL') return 'kp-del';
        if (key === 'JOIN') return 'kp-join';
        return `kp-${Number(key)}` as MenuAction;
      }
    }
  }
  return null;
}

/** Right — doors out of the lobby: the PUB social area + customisation. */
function drawInfo(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  if (app.infoView === 'pubpick') return drawPubPicker(ctx, hoverAction);
  return drawInfoRoot(ctx, hoverAction);
}

function hitInfo(_u: number, v: number): MenuAction | null {
  if (app.infoView === 'pubpick') return hitPubPicker(v);
  return hitInfoRoot(v);
}

function drawInfoRoot(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.text, GAME_TITLE);

  buttonPlate(ctx, 70, 104, PW - 140, 96, 'IRON BALLS CLUB', UI.cool, hoverAction === 'open-pub');

  // Live headcount riding the top-right of the PUB plate — the mirror of the
  // 1V1 panel's searcher badge, but the total occupancy across pub regions.
  if (app.pubCount > 0) {
    const label = `${app.pubCount}/${PUB_MAX_PLAYERS * PUB_REGIONS.length}`;
    ctx.font = '800 18px system-ui, sans-serif';
    const pillW = ctx.measureText(label).width + 38;
    const pillH = 28;
    const px = PW - 70 - pillW;
    const py = 92;
    plate(ctx, px, py, pillW, pillH, {
      cut: 8,
      fill: 'rgba(79,183,255,0.22)',
      stroke: UI.cool,
      rivets: false,
    });
    ctx.fillStyle = UI.coolBright; // a "live" dot
    ctx.beginPath();
    ctx.arc(px + 16, py + pillH / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = UI.coolBright;
    ctx.fillText(label, px + 28, py + pillH / 2 + 1);
    ctx.textAlign = 'center';
  }

  buttonPlate(ctx, 70, 226, PW - 140, 96, 'LOCKER', UI.ember, hoverAction === 'open-custom');

  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = UI.textDim;
  ctx.fillText('Check out the leaderboard behind you', PW / 2, 366);
}

function hitInfoRoot(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  if (y >= 96 && y <= 208) return 'open-pub';
  if (y >= 218 && y <= 330) return 'open-custom';
  return null;
}

/** The pub-region picker — pick EU or USA, each with its live `X/12` headcount,
 *  shown when you tap IRON BALLS CLUB. One plate per region, then BACK. */
function drawPubPicker(ctx: CanvasRenderingContext2D, hoverAction: MenuAction | null): void {
  panelBg(ctx, false, UI.text, 'PICK A CLUB');

  const accents = [UI.cool, UI.ember, UI.amber, UI.coolBright];
  const top = 96;
  const gap = 12;
  const h = Math.min(96, (260 - gap * (PUB_REGIONS.length - 1)) / PUB_REGIONS.length);
  PUB_REGIONS.forEach((region, i) => {
    const y = top + i * (h + gap);
    const action = `pub-go-${region.id}` as MenuAction;
    buttonPlate(ctx, 70, y, PW - 140, h, region.label, accents[i % accents.length], hoverAction === action);

    // Live `X/12` headcount pill on the right of each region plate.
    const count = app.pubRegionCounts[region.id];
    if (typeof count === 'number' && count >= 0) {
      const label = `${count}/${PUB_MAX_PLAYERS}`;
      ctx.font = '800 18px system-ui, sans-serif';
      const pillW = ctx.measureText(label).width + 38;
      const pillH = 28;
      const px = PW - 86 - pillW;
      const py = y + h / 2 - pillH / 2 - 14;
      plate(ctx, px, py, pillW, pillH, {
        cut: 8,
        fill: 'rgba(79,183,255,0.22)',
        stroke: UI.cool,
        rivets: false,
      });
      ctx.fillStyle = UI.coolBright;
      ctx.beginPath();
      ctx.arc(px + 16, py + pillH / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = UI.coolBright;
      ctx.fillText(label, px + 28, py + pillH / 2 + 1);
      ctx.textAlign = 'center';
    }
  });

  buttonPlate(ctx, 150, 320, PW - 300, 50, 'BACK', UI.steel, hoverAction === 'pub-back');
}

function hitPubPicker(v: number): MenuAction | null {
  const y = (1 - v) * PH;
  const top = 96;
  const gap = 12;
  const h = Math.min(96, (260 - gap * (PUB_REGIONS.length - 1)) / PUB_REGIONS.length);
  for (let i = 0; i < PUB_REGIONS.length; i++) {
    const ry = top + i * (h + gap);
    if (y >= ry - 8 && y <= ry + h + 4) return `pub-go-${PUB_REGIONS[i].id}` as MenuAction;
  }
  if (y >= 312 && y <= 378) return 'pub-back';
  return null;
}


// --- the A-button action panel -----------------------------------------------

export interface ActionButton {
  id: string;
  label: string;
  accent: string;
  /** Two consecutive 'l','r' buttons share one row at half width — the
   *  forfeit confirm's ✕ / ✓ pair. Omit for an ordinary full-width row. */
  half?: 'l' | 'r';
}

export interface ActionPanel {
  mesh: Mesh;
  /** Redraw with the given content; the layout is remembered for hitTest.
   *  `loadout` appends the BALL LOADOUT section (equip attachments between
   *  rounds — the tutorial's console taught the panel, this is its home). */
  redraw: (
    title: string,
    buttons: ActionButton[],
    hint: string,
    hoverId: string | null,
    status?: string,
    loadout?: boolean,
  ) => void;
  /** Map a hit UV to the id of the button under it, or null. */
  hitTest: (u: number, v: number) => string | null;
  /** Map a hit UV into the loadout section's own (u,v), or null if outside
   *  it / not shown — feed the result to clickBalls(). */
  ballsHit: (u: number, v: number) => { u: number; v: number } | null;
}

// The panel is as wide as the BALL LOADOUT's own canvas is square, so the
// loadout blits in at a clean scale; tall enough for header + loadout +
// two buttons. Content shorter than the canvas leaves transparent pixels
// below the frame — the plate is drawn to fit what's on it.
const FW = 640;
const FH = 1180;
const AM = 40; // side margin
const LOAD_W = FW - AM * 2; // the loadout blits to this width…
const LOAD_H = (LOAD_W * BALLS_CONTENT_H) / BALLS_W; // …at its own aspect
const BTN_H = 96;
const BTN_STEP = 112;

/** A kit plate: the same face the wrap's and the keyboard's buttons wear. */
function kitPlate(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  tone: string,
  hot: boolean,
): void {
  g.beginPath();
  g.roundRect(x, y, w, h, 16);
  g.fillStyle = hot ? KIT.plateHover : KIT.plate;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = hot ? tone : KIT.line;
  g.stroke();
  if (hot) {
    // The kit's edge tick on a hot plate.
    g.beginPath();
    g.roundRect(x + 8, y + 14, 4, h - 28, 2);
    g.fillStyle = tone;
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, 30);
  g.letterSpacing = '2px';
  g.fillStyle = hot ? KIT.textHi : tone;
  g.fillText(label, x + w / 2, y + h / 2 + 1);
  g.letterSpacing = '0px';
}

/**
 * The waist-height panel summoned with the A button: FORFEIT/CONCEDE where
 * resigning is allowed, REMATCH / RETURN at the end of a bout, and the BALL
 * LOADOUT during round breaks (and any time in training / campaign).
 *
 * It wears the house kit, and the loadout is not a copy of the lobby's — it
 * IS the lobby's, painted by menu/ballsFace.ts and blitted in, the same way
 * the tutorial's console hosts it. One loadout, three places.
 *
 * Starts hidden; MenuSystem owns placement, toggling and what the buttons do.
 */
export function createActionPanel(scene: Scene): ActionPanel {
  const canvas = document.createElement('canvas');
  canvas.width = FW;
  canvas.height = FH;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(0.56, (0.56 * FH) / FW),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  mesh.name = 'action-panel';
  mesh.visible = false;
  scene.add(mesh);

  let zones: Array<{ id: string; y0: number; y1: number; x0?: number; x1?: number }> = [];
  let ballsY: number | null = null; // top of the loadout section (canvas px)

  return {
    mesh,
    redraw: (title, buttons, hint, hoverId, status = '', loadout = false) => {
      // Height-to-content: the frame wraps exactly what's drawn, the rest of
      // the canvas stays transparent. The loadout sits ABOVE the buttons —
      // gear first, resign/return below where it can't be fat-fingered.
      // An l+r half pair shares one row, so count ROWS, not buttons.
      const buttonRows = buttons.reduce(
        (n, b, i) => n + (b.half === 'r' && buttons[i - 1]?.half === 'l' ? 0 : 1),
        0,
      );
      const buttonsH = buttonRows * BTN_STEP;
      const statusH = status ? 36 : 0;
      ballsY = loadout ? 100 : null;
      const buttonsY = loadout ? 100 + LOAD_H + 24 : 108;
      const contentH = buttonsY + buttonsH + statusH + 62;

      ctx.clearRect(0, 0, FW, FH);
      // The frame: the kit's smoked glass and its amber corner brackets.
      ctx.beginPath();
      ctx.roundRect(6, 6, FW - 12, contentH - 12, 26);
      ctx.fillStyle = KIT.panel;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hoverId && !hoverId.startsWith('ball:') ? KIT.lineHover : KIT.line;
      ctx.stroke();
      ctx.strokeStyle = KIT.accent;
      ctx.lineWidth = 3;
      for (const [x, y, dx, dy] of [
        [26, 26, 1, 1],
        [FW - 26, 26, -1, 1],
        [26, contentH - 26, 1, -1],
        [FW - 26, contentH - 26, -1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x + dx * 24, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * 24);
        ctx.stroke();
      }

      // The title, in the house face with the kit's tracking and its tick.
      ctx.fillStyle = KIT.accent;
      ctx.beginPath();
      ctx.roundRect(AM, 42, 5, 30, 2.5);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = font(700, 28);
      ctx.letterSpacing = '3px';
      ctx.fillStyle = KIT.accent;
      ctx.fillText(title, AM + 18, 57);
      ctx.letterSpacing = '0px';
      ctx.strokeStyle = KIT.lineFaint;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(AM, 88);
      ctx.lineTo(FW - AM, 88);
      ctx.stroke();

      if (ballsY !== null) {
        // THE LOBBY'S OWN BALL LOADOUT, blitted: painted off screen by the
        // kit (menu/ballsFace.ts) and scaled to this panel's width, so the
        // thing you equip between rounds is the thing you equipped in the
        // lobby — same tiles, same tabs, same face.
        const ballHover = hoverId && hoverId.startsWith('ball:') ? hoverId : null;
        // BARE: no frame of its own — this panel is already the frame — and
        // cropped to where the face's content ends.
        ctx.drawImage(
          renderBallsPanel(ballHover, true),
          0, 0, BALLS_W, BALLS_CONTENT_H,
          AM, ballsY, LOAD_W, LOAD_H,
        );
        // The section's name, in the slot the face's own title vacates when
        // it's blitted bare — so the tab strip has something to sit beside.
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = font(700, 22);
        ctx.letterSpacing = '3px';
        ctx.fillStyle = KIT.faint;
        ctx.fillText('BALL LOADOUT', AM + 30, ballsY + (LOAD_W / BALLS_W) * 65);
        ctx.letterSpacing = '0px';
      }

      zones = [];
      let y = buttonsY;
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        const rb = buttons[i + 1];
        if (b.half === 'l' && rb?.half === 'r') {
          // The ✕ / ✓ confirm pair: two half-width plates on one row.
          const bw = (FW - AM * 2 - 16) / 2;
          kitPlate(ctx, AM, y, bw, BTN_H, b.label, b.accent, hoverId === b.id);
          kitPlate(ctx, AM + bw + 16, y, bw, BTN_H, rb.label, rb.accent, hoverId === rb.id);
          zones.push({ id: b.id, y0: y - 6, y1: y + BTN_H + 6, x0: AM, x1: AM + bw });
          zones.push({ id: rb.id, y0: y - 6, y1: y + BTN_H + 6, x0: AM + bw + 16, x1: FW - AM });
          y += BTN_STEP;
          i++;
          continue;
        }
        kitPlate(ctx, AM, y, FW - AM * 2, BTN_H, b.label, b.accent, hoverId === b.id);
        zones.push({ id: b.id, y0: y - 6, y1: y + BTN_H + 6 });
        y += BTN_STEP;
      }

      ctx.textAlign = 'center';
      if (status) {
        ctx.font = font(600, 24);
        ctx.fillStyle = KIT.info;
        ctx.fillText(status, FW / 2, y + 14);
      }
      ctx.font = font(500, 22);
      ctx.fillStyle = KIT.faint;
      ctx.fillText(hint, FW / 2, contentH - 38);
      texture.needsUpdate = true;
    },
    hitTest: (u, v) => {
      const x = u * FW;
      const y = (1 - v) * FH;
      for (const z of zones) {
        if (y < z.y0 || y > z.y1) continue;
        if (z.x0 !== undefined && (x < z.x0 || x > (z.x1 ?? FW))) continue;
        return z.id;
      }
      return null;
    },
    ballsHit: (u, v) => {
      // Back into the loadout canvas's own UV — the section is a square blit
      // of it, so the map is the inverse of the drawImage above.
      if (ballsY === null) return null;
      const x = u * FW - AM;
      const y = (1 - v) * FH - ballsY;
      if (x < 0 || x > LOAD_W || y < 0 || y > LOAD_H) return null;
      // …and back into the loadout canvas's own UV, cropped height included.
      return { u: x / LOAD_W, v: 1 - ((y / LOAD_H) * BALLS_CONTENT_H) / BALLS_H };
    },
  };
}

/* ── a shared text helper (the tutorial's captions use it too) ── */
/** Word-wrap `text` into `maxW`, returning the count of lines drawn.
 *  Exported: the tutorial's caption plate wraps with the same algorithm. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  let cy = y;
  for (const line of wrapLines(ctx, text, maxW)) {
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
}

// --- THE GASKET GAZETTE -----------------------------------------------------
// The game's daily paper — results, records and what to play next
// (docs/gasket-gazette.md). The NEON DISTRICT edition: a holo newsfeed sheet
// in the menus' own glass — smoked translucent panel, cyan type that glows,
// hot-magenta accents, condensed headline type over a readable sans body,
// scanlines and corner brackets. MENUS 2: it renders on its own portrait
// canvas here and the TOWN wing's NEWS tab blits it (wrap.ts).

/** The page canvas — portrait, like a real front page. */
export const NW = 720;
export const NH = 900;
const NEWS_INK = '#dff8ff'; // body type: cyan-white
const NEWS_CYAN = '#3ff2ff';
const NEWS_HOT = '#ff3da6';
const NEWS_DIM = 'rgba(160,215,235,0.62)';
/** Headline type (condensed), body type (a plain sans that reads in-headset), data type. */
const NEWS_HEAD = 'Bahnschrift, "Roboto Condensed", "Arial Narrow", system-ui, sans-serif';
const NEWS_SERIF = 'Roboto, "Segoe UI", system-ui, sans-serif';
const NEWS_MONO = 'ui-monospace, Consolas, "Roboto Mono", monospace';
/** The article viewport's bottom edge (the page's lower margin). */
const NEWS_VIEW_BOTTOM = NH - 48;

/** A lit rule: a cyan hairline fading out at both ends (h >= 2 glows). */
function newsRule(ctx: CanvasRenderingContext2D, y: number, h = 3): void {
  ctx.save();
  const lit = h >= 2;
  const g = ctx.createLinearGradient(48, 0, NW - 48, 0);
  g.addColorStop(0, 'rgba(63,242,255,0)');
  g.addColorStop(0.12, lit ? NEWS_CYAN : 'rgba(63,242,255,0.55)');
  g.addColorStop(0.88, lit ? NEWS_CYAN : 'rgba(63,242,255,0.55)');
  g.addColorStop(1, 'rgba(63,242,255,0)');
  ctx.fillStyle = g;
  if (lit) {
    ctx.shadowColor = 'rgba(63,242,255,0.9)';
    ctx.shadowBlur = 8;
  }
  ctx.fillRect(48, y, NW - 96, Math.min(h, 2));
  ctx.restore();
}

/** Flow one paragraph, wrapped to `maxW`; returns the y past the last line.
 *  Pass `draw = false` to measure height only (for scroll clamping). */
function flowParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  draw = true,
): number {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  let cy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      if (draw) ctx.fillText(line, x, cy);
      line = w;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) {
    if (draw) ctx.fillText(line, x, cy);
    cy += lineH;
  }
  return cy;
}

// Body scroll (pixels): the news body scrolls under the fixed masthead/headline
// when an edition runs long, driven by the thumbstick like the leaderboard.
// drawNews sets the max each redraw; scrollNews clamps against it.
let newsScroll = 0;
let newsMaxScroll = 0;

/** Scroll the news body by `deltaPx`, clamped. Returns true if it moved. */
export function scrollNews(deltaPx: number): boolean {
  const before = newsScroll;
  newsScroll = Math.max(0, Math.min(newsMaxScroll, newsScroll + deltaPx));
  return newsScroll !== before;
}

/** Back to the top — called when the paper is opened. */
export function resetNewsScroll(): void {
  newsScroll = 0;
}

/** The masthead's mark: the fireball as a bent-glass neon sign — a magenta
 *  ring and a flame drawn as two glowing tubes (hot outer, cyan inner). */
function drawMastheadMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const tube = (path: () => void, color: string, w: number): void => {
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = w * 0.35;
    path();
    ctx.stroke();
  };
  tube(() => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }, NEWS_HOT, 3);
  const flame = (h: number, w: number, baseY: number) => (): void => {
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.bezierCurveTo(cx - w * 0.55, baseY - h * 0.12, cx - w * 0.42, baseY - h * 0.55, cx - w * 0.1, baseY - h * 0.62);
    ctx.bezierCurveTo(cx - w * 0.28, baseY - h * 0.8, cx + w * 0.02, baseY - h * 0.9, cx + w * 0.08, baseY - h);
    ctx.bezierCurveTo(cx + w * 0.42, baseY - h * 0.68, cx + w * 0.55, baseY - h * 0.3, cx, baseY);
    ctx.closePath();
  };
  const base = cy + r * 0.58;
  tube(flame(r * 1.15, r * 1.25, base), NEWS_HOT, 3);
  tube(flame(r * 0.58, r * 0.66, base - r * 0.06), NEWS_CYAN, 2.5);
  ctx.restore();
}

/** Where the scrolling article column begins (just below the dateline rule). */
const NEWS_CONTENT_TOP = 272;

/** A section's head: a heavy rule over a thin one, the label letterspaced
 *  between rules. Returns the y the section's content starts at. */
function newsSection(ctx: CanvasRenderingContext2D, label: string, y: number, draw: boolean): number {
  if (draw) {
    newsRule(ctx, y, 3);
    newsRule(ctx, y + 6, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = NEWS_HOT;
    ctx.font = `700 18px ${NEWS_MONO}`;
    ctx.letterSpacing = '5px';
    ctx.shadowColor = 'rgba(255,61,166,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(`// ${label}`, NW / 2, y + 32);
    ctx.shadowBlur = 0;
    ctx.letterSpacing = '0px';
    newsRule(ctx, y + 44, 1);
  }
  return y + 72;
}

/** Lay out the whole article — headline, subhead, the numbers, the body, the
 *  byline, THE RECORD BOOK and WHAT TO DO TODAY — from `top` downward,
 *  returning the y past the last line. `draw = false` measures only (for
 *  scroll clamping); the y arithmetic is identical either way so the
 *  measured height matches what's drawn. */
function layoutArticle(ctx: CanvasRenderingContext2D, art: GazetteArticle, top: number, draw: boolean): number {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 46px ${NEWS_HEAD}`;
  ctx.shadowColor = 'rgba(63,242,255,0.85)';
  ctx.shadowBlur = draw ? 12 : 0;
  let y = flowParagraph(ctx, art.headline.toUpperCase(), NW / 2, top, NW - 110, 50, draw);
  ctx.shadowBlur = 0;
  if (art.subhead) {
    ctx.fillStyle = NEWS_CYAN;
    ctx.font = `italic 23px ${NEWS_SERIF}`;
    y = flowParagraph(ctx, art.subhead, NW / 2, y + 2, NW - 150, 30, draw) + 6;
  }
  if (draw) newsRule(ctx, y + 6, 2);
  y += 34;

  // BY THE NUMBERS — a row of figures under the headline, ruled apart like
  // a stock table: the value large, what it counts in small capitals.
  if (art.stats.length) {
    const n = art.stats.length;
    const cellW = (NW - 100) / n;
    art.stats.forEach((st, i) => {
      const cx = 50 + cellW * (i + 0.5);
      if (draw) {
        ctx.textAlign = 'center';
        ctx.fillStyle = NEWS_HOT;
        ctx.font = `700 40px ${NEWS_HEAD}`;
        ctx.shadowColor = 'rgba(255,61,166,0.85)';
        ctx.shadowBlur = 12;
        ctx.fillText(st.value, cx, y + 26, cellW - 16);
        ctx.shadowBlur = 0;
        ctx.fillStyle = NEWS_DIM;
        ctx.font = `600 12px ${NEWS_MONO}`;
        ctx.letterSpacing = '2px';
        ctx.fillText(st.label.toUpperCase(), cx, y + 50, cellW - 12);
        ctx.letterSpacing = '0px';
        ctx.fillStyle = 'rgba(63,242,255,0.35)';
        if (i > 0) ctx.fillRect(50 + cellW * i, y - 10, 1, 68);
      }
    });
    y += 66;
    if (draw) newsRule(ctx, y, 1);
    y += 34;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = NEWS_INK;
  ctx.font = `22px ${NEWS_SERIF}`;
  for (const para of art.body.split(/\n\s*\n/)) y = flowParagraph(ctx, para, 50, y, NW - 100, 30, draw) + 12;

  ctx.textAlign = 'right';
  ctx.fillStyle = NEWS_CYAN;
  ctx.font = `600 17px ${NEWS_MONO}`;
  if (draw) ctx.fillText(`— ${art.byline}`, NW - 50, y + 8);
  ctx.fillStyle = NEWS_INK;
  y += 44;

  // THE RECORD BOOK — the hardest clears on the boards, set like a race
  // card: the feat left, the clock right, a dotted leader between, and the
  // squad on the line under it.
  if (art.records.length) {
    y = newsSection(ctx, 'THE RECORD BOOK', y, draw);
    for (const rec of art.records) {
      ctx.font = `700 20px ${NEWS_MONO}`;
      const timeW = ctx.measureText(rec.time).width;
      ctx.font = `700 20px ${NEWS_HEAD}`;
      const featMax = NW - 100 - timeW - 40;
      const featW = Math.min(featMax, ctx.measureText(rec.feat.toUpperCase()).width);
      if (draw) {
        ctx.fillStyle = NEWS_INK;
        ctx.textAlign = 'left';
        ctx.fillText(rec.feat.toUpperCase(), 50, y, featMax);
        ctx.textAlign = 'right';
        ctx.font = `700 20px ${NEWS_MONO}`;
        ctx.fillStyle = NEWS_CYAN;
        ctx.fillText(rec.time, NW - 50, y);
        // The leader: a row of dots from the feat to the clock.
        ctx.fillStyle = 'rgba(63,242,255,0.45)';
        for (let dx = 50 + featW + 10; dx < NW - 50 - timeW - 8; dx += 8) ctx.fillRect(dx, y - 4, 2, 2);
        ctx.fillStyle = NEWS_INK;
      }
      y += 26;
      if (rec.who) {
        ctx.textAlign = 'left';
        ctx.fillStyle = NEWS_DIM;
        ctx.font = `italic 18px ${NEWS_SERIF}`;
        y = flowParagraph(ctx, rec.who, 50, y, NW - 100, 24, draw);
        ctx.fillStyle = NEWS_INK;
      }
      y += 16;
    }
    y += 6;
  }

  // WHAT TO DO TODAY — numbered, each a bold title and a line or two on how.
  if (art.todo.length) {
    y = newsSection(ctx, 'WHAT TO DO TODAY', y, draw);
    art.todo.forEach((item, i) => {
      if (draw) {
        // The number in a lit magenta ring.
        ctx.strokeStyle = NEWS_HOT;
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,61,166,0.9)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(64, y - 7, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = `700 16px ${NEWS_MONO}`;
        ctx.fillText(String(i + 1), 64, y - 1);
        ctx.fillStyle = NEWS_INK;
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 22px ${NEWS_HEAD}`;
      y = flowParagraph(ctx, item.title, 92, y, NW - 142, 26, draw);
      if (item.text) {
        ctx.fillStyle = NEWS_INK;
        ctx.font = `19px ${NEWS_SERIF}`;
        y = flowParagraph(ctx, item.text, 92, y + 2, NW - 142, 26, draw);
      }
      ctx.fillStyle = NEWS_INK;
      y += 18;
    });
  }
  return y;
}

/** The Gasket Gazette front page. */
function drawNews(ctx: CanvasRenderingContext2D): void {
  // Smoked holo glass: translucent ink-blue, a tint washing down from the
  // masthead, scanlines, a lit edge and magenta corner brackets.
  ctx.clearRect(0, 0, NW, NH);
  ctx.fillStyle = 'rgba(5,9,22,0.84)';
  ctx.fillRect(0, 0, NW, NH);
  const tint = ctx.createLinearGradient(0, 0, 0, NH);
  tint.addColorStop(0, 'rgba(63,242,255,0.10)');
  tint.addColorStop(0.3, 'rgba(63,242,255,0.02)');
  tint.addColorStop(1, 'rgba(255,61,166,0.06)');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, NW, NH);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let sy = 0; sy < NH; sy += 3) ctx.fillRect(0, sy, NW, 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(63,242,255,0.75)';
  ctx.shadowColor = 'rgba(63,242,255,0.9)';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, NW - 28, NH - 28);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(63,242,255,0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(22, 22, NW - 44, NH - 44);
  ctx.strokeStyle = NEWS_HOT;
  ctx.lineWidth = 3;
  const BR = 26;
  for (const [bx, by, sx, sy] of [
    [10, 10, 1, 1],
    [NW - 10, 10, -1, 1],
    [10, NH - 10, 1, -1],
    [NW - 10, NH - 10, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(bx, by + sy * BR);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + sx * BR, by);
    ctx.stroke();
  }
  ctx.restore();

  const art = frontPage();

  // Masthead — the neon fireball crests the page, the title lit in cyan,
  // the katakana and the feed tag under it.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  drawMastheadMark(ctx, NW / 2, 62, 28);
  newsRule(ctx, 100);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 52px ${NEWS_HEAD}`;
  ctx.letterSpacing = '3px';
  ctx.shadowColor = 'rgba(63,242,255,0.95)';
  ctx.shadowBlur = 18;
  ctx.fillText('THE GASKET GAZETTE', NW / 2, 150);
  ctx.restore();
  ctx.fillStyle = NEWS_HOT;
  ctx.font = `600 15px ${NEWS_MONO}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('ガスケット新聞  //  RESULTS · RECORDS · WHAT TO PLAY', NW / 2, 177);
  ctx.letterSpacing = '0px';
  newsRule(ctx, 192, 2);

  // Dateline strip — edition number left, the date centred. Strip any
  // "GASKET TERRITORY —" / "GASKET COVE —" prefix (the oldest editions
  // stored one) so the date stays short and never collides.
  ctx.font = `600 15px ${NEWS_MONO}`;
  ctx.fillStyle = NEWS_CYAN;
  ctx.textAlign = 'left';
  ctx.fillText(art ? (art.edition > 0 ? `ED. ${String(art.edition).padStart(3, '0')}` : 'WELCOME') : 'ED. ---', 50, 216);
  // A live-feed pip on the right.
  ctx.textAlign = 'right';
  ctx.fillStyle = NEWS_HOT;
  ctx.fillText('● LIVE FEED', NW - 50, 216);
  let dateText = (art?.dateline || '').replace(/^\s*GASKET (TERRITORY|COVE)\s*[—–-]\s*/i, '').trim();
  if (!dateText) dateText = 'THE DAILY EDITION';
  ctx.textAlign = 'center';
  ctx.fillStyle = NEWS_INK;
  ctx.fillText(dateText.toUpperCase(), NW / 2, 216, NW - 340);
  newsRule(ctx, 228, 2);

  ctx.textAlign = 'center';
  if (!art) {
    ctx.font = `600 24px ${NEWS_MONO}`;
    ctx.fillStyle = NEWS_CYAN;
    ctx.fillText('> feed warming up_', NW / 2, NH / 2 - 40);
    ctx.fillStyle = NEWS_INK;
    ctx.font = `18px ${NEWS_SERIF}`;
    ctx.fillText('Check back after the next edition is filed.', NW / 2, NH / 2);
  } else {
    // The WHOLE article — headline, subhead, body, byline — scrolls together
    // as one column under the fixed masthead (thumbstick, like the leaderboard).
    const viewBottom = NEWS_VIEW_BOTTOM;
    const clipTop = 238; // just under the dateline rule, above the headline tops

    // Measure the full article height (no draw) to clamp the scroll.
    const contentBottom = layoutArticle(ctx, art, NEWS_CONTENT_TOP, false);
    newsMaxScroll = Math.max(0, contentBottom - viewBottom);
    if (newsScroll > newsMaxScroll) newsScroll = newsMaxScroll;

    // Draw the article in a scrolling viewport.
    ctx.save();
    ctx.beginPath();
    ctx.rect(28, clipTop, NW - 56, viewBottom - clipTop);
    ctx.clip();
    ctx.translate(0, -newsScroll);
    layoutArticle(ctx, art, NEWS_CONTENT_TOP, true);
    ctx.restore();

    // More-to-read chevrons in the right margin.
    const chevron = (yc: number, down: boolean): void => {
      ctx.fillStyle = 'rgba(63,242,255,0.8)';
      const xc = NW - 40;
      const s = 7;
      ctx.beginPath();
      if (down) {
        ctx.moveTo(xc - s, yc - s);
        ctx.lineTo(xc + s, yc - s);
        ctx.lineTo(xc, yc + s);
      } else {
        ctx.moveTo(xc - s, yc + s);
        ctx.lineTo(xc + s, yc + s);
        ctx.lineTo(xc, yc - s);
      }
      ctx.closePath();
      ctx.fill();
    };
    if (newsScroll > 0.5) chevron(clipTop + 8, false);
    if (newsScroll < newsMaxScroll - 0.5) chevron(viewBottom - 6, true);
  }

  ctx.textBaseline = 'middle';
}

/** The page's own canvas — rendered fresh on each call (the wing's redraw
 *  is the freshness clock) and handed back to be blitted. `scale` renders
 *  the same page at a multiple of its native pixels: the wing blits it at
 *  1×, THE READER holds it up at 2× so the type stays sharp held close. One
 *  canvas per scale, so the two never fight over a single bitmap. */
const newsCanvases = new Map<number, HTMLCanvasElement>();
export function renderNewsPage(scale = 1): HTMLCanvasElement {
  let canvas = newsCanvases.get(scale);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.round(NW * scale);
    canvas.height = Math.round(NH * scale);
    newsCanvases.set(scale, canvas);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawNews(ctx);
  return canvas;
}

// --- THE COIN WALLET + PLATFORM STORE ---------------------------------------
// A small readout sits beside the paper button: the iron-dollar symbol and your
// balance. Spend it in the STORE (the LOCKER's header tab) on new platforms —
// three launch pads are free, a couple of recolours cost 100, the gold pad 1000.

// The number shown on the lobby readout ROLLS UP to the real balance rather
// than snapping — so coins banked during a bout count up satisfyingly the
// moment you're back at the menu. `coinShown` is the live (fractional) display
// value; MenuSystem ticks it each lobby frame via tickCoinRollup.
let coinShown = coins.balance;

/**
 * Ease the displayed coin count toward the real balance. Returns true while
 * it's still rolling (so the caller keeps redrawing the readout), false once
 * it's landed. A min step makes small gains still visibly tick over.
 */
export function tickCoinRollup(dt: number): boolean {
  const target = coins.balance;
  const diff = target - coinShown;
  if (Math.abs(diff) < 0.5) {
    const landed = coinShown !== target;
    coinShown = target;
    return landed; // one last redraw to show the final integer
  }
  const step = diff * (1 - Math.exp(-7 * dt));
  // Guarantee forward progress so the digits keep moving on big jumps.
  coinShown += Math.abs(step) < 0.4 ? Math.sign(diff) * 0.4 : step;
  return true;
}

/** The current readout value (rounded) — also lets the shop/header agree. */
export function coinDisplayValue(): number {
  return Math.round(coinShown);
}

// The shop sells both cosmetics: AVATARS (the paid unlocks, plus a COMING SOON
// tile) on top, PLATFORMS (the paid pads) below. Two tidy grids of chips with
// the CLOSE button clear beneath them.

// ─────────────────────────── THE ARCADE LOBBY ───────────────────────────────
// One shared modal serving every networked arcade mode (2v2 / ffa / raid),
// switched by app.lobbyMode. Two faces: the BROWSER (open rooms you can join,
// plus MAKE LOBBY / VS BOTS) and a joined LOBBY (the room's seats, host
// controls, and the launch status). 2v2 and raid auto-launch when the room
// fills; a short-handed FFA host can START early. Matchmaking works like
// RANKED's server browser: hosting makes a VISIBLE room others can find.

// only what you own, to equip — plus a COLOUR tab carrying the base tone.
// Each tile shows a PICTURE of the skin: an animal silhouette (a shield for
// the knight) for avatars, a little coloured pad for platforms.

const PAN_W = 560;
// COLOUR-tab tracks (locker only): the armour hue track and the lightness
// track beneath it. (The hands' neon has no tracks — it is the house ember.)
const ARMOUR_BAR = { x: 40, y: 168, w: PAN_W - 210, h: 38 };
const ARMOUR_LIGHT_BAR = { x: 40, y: 250, w: PAN_W - 80, h: 38 };

/** A CSS hex colour ('#rrggbb') at the given alpha — breaker fill washes. */
function hexToRgba(css: string, a: number): string {
  const n = parseInt(css.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** u (0..1 across the panel) → hue (0..1) for the armour track. */
export function colorBarHue(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ARMOUR_BAR.x) / ARMOUR_BAR.w));
}
/** u → lightness (0..1) for the armour lightness track. */
export function colorBarLight(u: number): number {
  return Math.max(0, Math.min(1, (u * PAN_W - ARMOUR_LIGHT_BAR.x) / ARMOUR_LIGHT_BAR.w));
}

export function createMenu(scene: Scene): Menu {
  const group = new Group();
  group.name = 'lobby-menu';

  const train = makePanel('train', 0.86, 0.86 * (TRAIN_H / PW), drawTrain, hitTrain, { ch: TRAIN_H });
  const duel = makePanel('duel', 0.78, 0.62 * (DUEL_H / PH), drawDuel, hitDuel, { ch: DUEL_H });
  const info = makePanel('info', 0.78, 0.62, drawInfo, hitInfo);

  // Shallow arc in front of the player, tilted inward toward the centre.
  const y = 1.45;
  // Grow the taller ARCADE panel DOWNWARD: drop its centre by half the extra
  // height so its top stays level with the 1V1 panel.
  train.mesh.position.set(0, y - 0.86 * ((TRAIN_H - PH) / PW) / 2, -1.25);
  // Shift the centre down by half the extra height so the panel grows DOWNWARD
  // (its top edge stays put) — the new room lands under the searching line.
  duel.mesh.position.set(-0.84, y - 0.02 - 0.62 * ((DUEL_H - PH) / PH) / 2, -1.02);
  duel.mesh.rotation.y = 0.48;
  info.mesh.position.set(0.84, y - 0.02, -1.02);
  info.mesh.rotation.y = -0.48;

  // The MODALS (locker, store, campaign line-up, arcade lobby, ball
  // loadout) are kit panels now — MenuSystem builds and places them
  // (MENUS 3). This function owns the arc and nothing else.
  const panels = [train, duel, info];
  for (const p of panels) {
    p.redraw(null);
    group.add(p.mesh);
  }
  scene.add(group);

  return {
    group,
    panels,
    setVisible: (v) => {
      group.visible = v;
    },
    redrawAll: (hoverId, hoverAction) => {
      // Skip panels that aren't on screen — re-rendering a hidden canvas and
      // re-uploading its texture (the news page is 720×900) is pure waste. They
      // get a redraw the moment they're shown (applyState calls this again).
      for (const p of panels) {
        if (!p.mesh.visible) continue;
        p.redraw(p.id === hoverId ? hoverAction : null);
      }
    },
  };
}
