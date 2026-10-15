/** FF2 lobby: player intent owns the top level; game families live under PLAY.
 * See docs/menu-research.md for the audit, evidence and navigation contract.
 * The three existing VR panels retain their physical sizes and ray targets.
 */

import type { Menu, MenuAction, MenuPanel, PanelId } from './menu.js';
import { renderNewsPage } from './menu.js';
import { Panel, KIT, type PanelButton, type PanelOpts } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { coins } from './wallet.js';
import { leaderboard, setLeaderboardTab } from '../net/leaderboard.js';
import { gazette } from '../net/gazette.js';
import { ladderFace } from './ladder.js';
import { settingsFace } from './settingsFace.js';
import { CARD_H, CARD_W, CHIP_H, CHIP_W, profileCardFace, profileChipFace } from './profilePop.js';
import { GAME_TITLE, warmRoomServer } from '../config.js';

/** One face of a wrap panel: everything Panel.paint needs. */
interface Face {
  title: string;
  body?: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** A kit panel wearing FF1's MenuPanel contract. `onClick` receives every
 *  pressed button id (a local namespace id or a real MenuAction) —
 *  defining MenuPanel.click keeps MenuSystem's pre-tutorial gate in front
 *  while letting the owner route ids itself. Exported: the paint bay (and
 *  every future kit modal) rides the same adapter. */
export class KitMenuPanel implements MenuPanel {
  readonly kit: Panel;
  readonly mesh;
  click?: (u: number, v: number) => boolean;
  /** A face with a slider sets this (MenuSystem.addModal): the scrub hook
   *  MenuSystem feeds the hit's UV every frame the trigger is held. */
  drag?: (u: number, v: number, grabbed?: boolean) => boolean;

  constructor(
    readonly id: PanelId,
    wM: number,
    hM: number,
    pxW: number,
    pxH: number,
    private face: () => Face,
    onClick?: (id: string) => void,
    opts: PanelOpts = {},
  ) {
    this.kit = new Panel(wM, hM, pxW, pxH, opts);
    this.mesh = this.kit.mesh;
    this.mesh.name = `menu-panel:${id}`;
    if (onClick) {
      this.click = (u: number, v: number): boolean => {
        const id = this.kit.buttonAt(u, v);
        if (!id) return false;
        this.kit.press(id);
        onClick(id);
        return true; // MenuSystem clicks the relay + redraws all panels
      };
    }
  }

  redraw(hoverAction: MenuAction | null): void {
    const f = this.face();
    this.kit.paint(f.title, f.body ?? (() => {}), f.buttons, hoverAction);
  }

  hitTest(u: number, v: number): MenuAction | null {
    return this.kit.buttonAt(u, v) as MenuAction | null;
  }

  tick(delta: number, pulse: number): void {
    this.kit.tick(delta, pulse);
  }
}

/* ── the wrap's tab state ─────────────────────────────────────────────── */

export type CenterTab = 'fight' | 'practice' | 'club';
export type PlayTab = 'duels' | 'titans' | 'rave';
export type TownTab = 'town' | 'ladder' | 'news';
export type YouTab = 'you' | 'store' | 'settings';

/** Which tab each panel is on. */
export const wrapNav = {
  center: 'fight' as CenterTab,
  play: 'duels' as PlayTab,
  // The wing opens on the PAPER: the day's edition — or the welcome, for a
  // newcomer — is the first thing on the wall, not a chip count.
  town: 'news' as TownTab,
  you: 'you' as YouTab,
};

/* ── shared bits ──────────────────────────────────────────────────────── */

const sealed = (): boolean => !app.tutorialDone;
const SEAL_SUB = 'sealed — run the tutorial';
const TAB_Y = 36;
const TAB_H = 76;

function note(text: string, y: number, W: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(500, 24);
    g.fillStyle = KIT.faint;
    g.fillText(text, W / 2, y);
  };
}

/** A sub-face's name, right-aligned in the tab strip (FIGHT › PRIVATE). */
function crumb(text: string, W: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = font(600, 26);
    g.letterSpacing = '3px';
    g.fillStyle = KIT.faint;
    g.fillText(text, W - 52, TAB_Y + TAB_H / 2 - 2);
    g.letterSpacing = '0px';
  };
}

const both =
  (...fns: Array<((g: CanvasRenderingContext2D, hover: string | null) => void) | undefined>) =>
  (g: CanvasRenderingContext2D, hover: string | null): void => {
    for (const f of fns) f?.(g, hover);
  };

/* Center: Play, Practice and Social. */

const CW = 1536; // canvas
const M = 96; // margin
const WIDE = CW - M * 2; // 1344
const COL = 656; // half column
const C2 = M + COL + 32; // right column x

const clubUp = (): boolean => wrapNav.center === 'club';

function centerTabs(): PanelButton[] {
  return [
    { id: 'wrap:tab-fight', label: 'PLAY', tab: true, x: 430, y: TAB_Y, w: 200, h: TAB_H, selected: wrapNav.center === 'fight' },
    { id: 'wrap:tab-practice', label: 'PRACTICE', tab: true, x: 660, y: TAB_Y, w: 260, h: TAB_H, selected: wrapNav.center === 'practice', disabled: sealed() || app.state === 'queueing' },
    { id: 'wrap:tab-club', label: 'SOCIAL', tab: true, x: 950, y: TAB_Y, w: 240, h: TAB_H, selected: clubUp(), disabled: sealed() || app.state === 'queueing', badge: !sealed() && app.pubCount > 0 },
  ];
}

function playTabs(): PanelButton[] {
  return (['duels', 'titans', 'rave'] as const).map((id, i) => ({
    id: `wrap:play-${id}`, label: id === 'rave' ? 'RAVE RAID' : id === 'duels' ? 'VERSUS' : 'TITANS',
    x: M + i * 456, y: 144, w: 432, h: 72, small: true,
    selected: wrapNav.play === id, disabled: app.state === 'queueing' && id !== 'duels',
  }));
}

const BACK: PanelButton = { id: 'wrap:back', label: 'BACK', x: M, y: 888, w: 320, h: 84, small: true };

function sealedFace(): Face {
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons: [
      {
        id: 'start-tutorial',
        label: 'TUTORIAL',
        sub: 'the guided basics — start here',
        x: M, y: 190, w: WIDE, h: 240,
        primary: true,
      },
      { id: 'quick-match', label: 'QUICK MATCH', sub: SEAL_SUB, x: M, y: 480, w: COL, h: 190, disabled: true },
      { id: 'open-pub', label: 'THE CLUB', sub: SEAL_SUB, x: C2, y: 480, w: COL, h: 190, disabled: true },
    ],
  };
}

function fightRoot(): Face {
  if (sealed()) return sealedFace();
  const queueing = app.state === 'queueing';
  const buttons: PanelButton[] = [
    queueing
      ? {
          id: 'cancel-queue',
          label: 'CANCEL SEARCH',
          sub: app.searching > 0 ? `${app.searching} in the queue` : 'searching…',
          x: M, y: 260, w: COL, h: 170,
          tone: KIT.danger,
        }
      : {
          id: 'quick-match',
          label: 'QUICK MATCH',
          sub: app.onlyBots ? '1v1 against a bot' : '1v1 - play a bot while finding a rival',
          x: M, y: 260, w: COL, h: 170,
          primary: true,
        },
    {
      id: 'ranked-match',
      label: 'RANKED',
      sub: app.onlyBots ? 'Turn off BOTS ONLY to play ranked' : 'Competitive 1v1 rooms',
      x: M, y: 460, w: COL, h: 170,
      disabled: app.onlyBots || queueing,
    },
    {
      id: 'private-open',
      label: 'CUSTOM GAMES',
      x: M, y: 660, w: COL, h: 170,
      disabled: queueing,
    },
    { id: 'arcade-2v2', label: '2V2', sub: 'Team battles', x: C2, y: 260, w: COL, h: 170, disabled: queueing },
    { id: 'arcade-ffa', label: 'FREE FOR ALL', sub: 'Four fighters - every player for themselves', x: C2, y: 460, w: COL, h: 170, disabled: queueing },
    {
      id: 'toggle-onlybots',
      label: 'BOTS ONLY',
      sub: 'Quick match / 2v2 / free for all',
      x: C2, y: 660, w: COL, h: 110,
      small: true,
      selected: app.onlyBots,
      toggle: true,
    },
  ];
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons,
  };
}

function privateFace(): Face {
  const modes = [
    { id: 'private-mode-1v1' as MenuAction, label: '1V1', mode: '1v1', seats: '2 seats' },
    { id: 'private-mode-2v2' as MenuAction, label: '2V2', mode: '2v2', seats: '4 seats' },
    { id: 'private-mode-ffa' as MenuAction, label: 'FFA', mode: 'ffa', seats: '4 seats' },
  ];
  const buttons: PanelButton[] = modes.map((m, i) => ({
    id: m.id,
    label: m.label,
    sub: m.seats,
    x: C2 + (i % 2) * (COL / 2 + 16), y: 170 + Math.floor(i / 2) * 150, w: COL / 2 - 16, h: 130,
    small: true,
    selected: app.privateMode === m.mode,
  }));
  buttons.push(
    {
      id: 'private-create',
      label: 'CREATE CODE',
      sub: 'reserve a room of that shape',
      x: M, y: 170, w: COL, h: 190,
      primary: true,
    },
    {
      id: 'private-enter',
      label: 'ENTER A CODE',
      sub: 'join whatever your mate opened',
      x: M, y: 400, w: COL, h: 150,
    },
    { ...BACK, id: 'private-back' },
  );
  return {
    title: GAME_TITLE,
    body: crumb('CUSTOM GAMES', CW),
    buttons,
  };
}

function keypadFace(): Face {
  const draft = app.codeEntry.padEnd(5, '·').split('').join(' ');
  const buttons: PanelButton[] = [
    { id: 'code-draft', label: draft, sub: 'the code', x: M, y: 200, w: COL, h: 170, display: true, px: 72 },
    {
      id: 'kp-join',
      label: 'JOIN',
      x: M, y: 430, w: COL, h: 170,
      primary: app.codeEntry.length === 5,
      disabled: app.codeEntry.length < 5,
    },
    { ...BACK, id: 'private-back' },
  ];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ''];
  const kw = 200;
  const kh = 130;
  keys.forEach((k, i) => {
    if (!k) return;
    const id = k === '⌫' ? 'kp-del' : `kp-${k}`;
    buttons.push({
      id: id as MenuAction,
      label: k,
      x: C2 + (i % 3) * (kw + 24), y: 160 + Math.floor(i / 3) * (kh + 20), w: kw, h: kh,
      px: 44,
      disabled: k === '⌫' && app.codeEntry.length === 0,
    });
  });
  return { title: GAME_TITLE, body: crumb('ENTER CODE', CW), buttons };
}

function hostingFace(): Face {
  return {
    title: GAME_TITLE,
    body: both(crumb('CUSTOM GAMES', CW), note('the room launches itself once the seats fill', 700, CW)),
    buttons: [
      {
        id: 'code-live',
        label: app.privateCode ? app.privateCode.split('').join(' ') : 'RESERVING…',
        sub: 'your code — shout it, ping it, text it',
        x: M + 240, y: 240, w: WIDE - 480, h: 240,
        display: true,
        px: 110,
        tone: KIT.accent,
      },
      { ...BACK, id: 'private-back', label: 'CANCEL', tone: KIT.danger },
    ],
  };
}

function browserFace(): Face {
  const hostingOwn = app.rankedRoomId !== '';
  const rows = app.rankedRooms.slice(0, 5);
  const buttons: PanelButton[] = rows.map((r, i) => ({
    id: `ranked-join-${r.id}` as MenuAction,
    label: r.host,
    sub: r.id === app.rankedRoomId ? 'your room — holding the door' : 'open — step in',
    x: M, y: 160 + i * 136, w: 800, h: 118,
    small: true,
    disabled: r.id === app.rankedRoomId || hostingOwn,
    selected: r.id === app.rankedRoomId,
  }));
  buttons.push(
    hostingOwn || app.rankedHost
      ? { id: 'ranked-cancel', label: 'STAND DOWN', sub: 'close your room', x: 968, y: 160, w: 472, h: 170, tone: KIT.danger }
      : { id: 'ranked-host', label: 'HOST A ROOM', sub: 'your name on the board', x: 968, y: 160, w: 472, h: 170, primary: true },
    { ...BACK, id: 'ranked-back' },
  );
  return {
    title: GAME_TITLE,
    body: both(crumb('RANKED', CW), rows.length === 0 ? note('no open rooms — put your name up', 500, CW) : undefined),
    buttons,
  };
}

function titansFace(): Face {
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons: [
      { id: 'open-campaign', label: 'CAMPAIGN', sub: 'Solo bosses, gauntlet and challenge runs', x: M, y: 280, w: COL, h: 230, primary: true },
      { id: 'open-raid', label: 'CO-OP RAID', sub: app.onlyBots ? 'Turn off BOTS ONLY to form a raid' : app.raidsOpen > 0 ? `${app.raidsOpen} squads forming` : 'Host or join a squad against the titans', x: C2, y: 280, w: COL, h: 230, disabled: app.onlyBots },
      { id: 'toggle-onlybots', label: 'BOTS ONLY', sub: 'Turn off for online ranked and raids', x: C2, y: 550, w: COL, h: 110, small: true, selected: app.onlyBots, toggle: true },
    ],
  };
}

function raveFace(): Face {
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons: [{ id: 'open-rave', label: 'ENTER RAVE RAID', sub: 'Tour, solo tracks and multiplayer', x: M + 180, y: 300, w: WIDE - 360, h: 240, primary: true }],
  };
}

function practiceFace(): Face {
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons: [
      { id: 'start-tutorial', label: 'TUTORIAL', sub: 'Replay the guided basics', x: M, y: 210, w: COL, h: 230 },
      { id: 'start-training', label: 'AIM TRAINING', sub: 'Target practice with optional return fire', x: C2, y: 210, w: COL, h: 230, primary: true },
      { id: 'toggle-shootback', label: 'SHOOT BACK', sub: 'Aim training only', x: C2, y: 480, w: COL, h: 110, small: true, selected: app.shootBack, toggle: true },
    ],
  };
}

/** Social destinations: gather in the venue or arrange a private game. */
function clubFace(): Face {
  // THE DOOR, HELD. ENTER CLUB no longer drops the curtain at once: the
  // arena first gets the venue's floor to answer — the room server sleeps
  // on a free tier and can take most of a minute to wake — and only then
  // crosses, so the black lifts on the club and never on the rave's foyer
  // (experience/ClubExperienceManager holdForTheFloor). While it waits,
  // this board says so, and the button is not a button.
  const waiting = app.venueStatus !== '';
  return {
    title: GAME_TITLE,
    body: !waiting && app.pubCount > 0 ? note(`${app.pubCount} in the club right now`, 650, CW) : () => {},
    buttons: [
      {
        id: 'open-pub',
        label: waiting ? 'WAKING THE HOUSE' : 'ENTER CLUB',
        sub: waiting ? app.venueStatus : 'Hang out, meet players and explore the venue',
        // A button the size of the board reads as the board. This is a
        // button: the same height as the ones on every other face, sitting
        // in the same first-row slot, just wider because it's alone.
        x: M, y: 240, w: COL, h: 240,
        primary: !waiting,
        // While the door is held it is a live readout, not a dead button
        // (the kit's `disabled` grey reads as broken; `display` reads as
        // data) — and the kit already refuses presses on a display chip.
        display: waiting,
        tone: waiting ? KIT.accent : undefined,
      },
      { id: 'private-open', label: 'CUSTOM GAMES', sub: 'Create or enter a code for 1v1, 2v2 or free for all', x: C2, y: 240, w: COL, h: 240, disabled: waiting },
    ],
  };
}

function centerFace(): Face {
  let face: Face;
  if (clubUp() && !sealed()) face = clubFace();
  else if (wrapNav.center === 'practice' && !sealed()) face = practiceFace();
  else {
    switch (app.duelView) {
      case 'private':
        face = privateFace();
        break;
      case 'keypad':
        face = keypadFace();
        break;
      case 'hosting':
        face = hostingFace();
        break;
      case 'browser':
        face = browserFace();
        break;
      default:
        face = sealed() ? sealedFace() : wrapNav.play === 'titans' ? titansFace() : wrapNav.play === 'rave' ? raveFace() : fightRoot();
    }
  }
  const families = !sealed() && wrapNav.center === 'fight' && app.duelView === 'root' ? playTabs() : [];
  return { ...face, buttons: [...centerTabs(), ...families, ...face.buttons] };
}

/* Left wing: Activity, Rankings and News. */

const LW = 832;

function townTabs(): PanelButton[] {
  const lock = sealed();
  return [
    { id: 'wrap:tab-town', label: 'ACTIVITY', tab: true, x: 36, y: TAB_Y, w: 230, h: TAB_H, selected: wrapNav.town === 'town' },
    { id: 'wrap:tab-ladder', label: 'RANKINGS', tab: true, x: 276, y: TAB_Y, w: 260, h: TAB_H, selected: wrapNav.town === 'ladder', disabled: lock },
    // The pip says "a new edition you haven't seen" — pointless while the
    // paper is the very thing on the wing (MenuSystem marks it read there).
    { id: 'wrap:tab-news', label: 'NEWS', tab: true, x: 546, y: TAB_Y, w: 190, h: TAB_H, selected: wrapNav.town === 'news', badge: gazette.unread && wrapNav.town !== 'news' },
  ];
}

function townBoard(): Face {
  const n = (v: number): string => (v >= 0 ? String(v) : '—');
  const chip = (id: string, label: string, sub: string, y: number, tone?: string): PanelButton => ({
    id, label, sub, x: 96, y, w: LW - 192, h: 150, display: true, px: 64, tone,
  });
  return {
    title: '',
    body: () => {},
    buttons: [
      chip('town-queue', n(app.searching), 'searching for a fight', 190, app.searching > 0 ? KIT.positive : undefined),
      chip('town-raids', n(app.raidsOpen), 'raid squads forming', 390, app.raidsOpen > 0 ? KIT.positive : undefined),
      chip('town-club', n(app.pubCount), 'in the club tonight', 590, app.pubCount > 0 ? KIT.accent : undefined),
    ],
  };
}

/** The Gasket Gazette, blitted onto the wing: the page renders on its own
 *  portrait canvas (menu.ts) and lands here scaled to fit under the strip;
 *  the thumbstick scrolls the article while the pointer is on the wing. */
function newsFace(): Face {
  // Same 4:5 as the page itself, and short enough under the strip that the
  // caption beneath it lands inside the wing's canvas rather than off it.
  const PW = 680;
  const PH = 850;
  return {
    title: '',
    // The whole page is one press: tap it and THE READER holds it up large
    // in front of you (MenuSystem 'gazette-reader'). A ghost, so the page
    // draws as a page and not as a button with a page on it.
    buttons: [{ id: 'gazette-reader', label: '', ghost: true, x: (LW - PW) / 2, y: 124, w: PW, h: PH }],
    body: (g, hover) => {
      const page = renderNewsPage();
      g.save();
      g.shadowColor = hover === 'gazette-reader' ? 'rgba(63,242,255,0.6)' : 'rgba(0,0,0,0.55)';
      g.shadowBlur = hover === 'gazette-reader' ? 34 : 24;
      g.drawImage(page, (LW - PW) / 2, 124, PW, PH);
      g.restore();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(500, 20);
      g.fillStyle = KIT.faint;
      g.fillText('tap the page to hold it up', LW / 2, 124 + PH + 22);
    },
  };
}

function townFace(): Face {
  let face: Face;
  if (wrapNav.town === 'ladder' && !sealed()) face = { title: '', ...ladderFace() };
  else if (wrapNav.town === 'news') face = newsFace();
  else face = townBoard();
  return { ...face, buttons: [...townTabs(), ...face.buttons] };
}

/* Right wing: Locker, Store and Settings. */

function youTabs(): PanelButton[] {
  return [
    { id: 'wrap:tab-you', label: 'LOCKER', tab: true, x: 36, y: TAB_Y, w: 230, h: TAB_H, selected: wrapNav.you === 'you' },
    { id: 'wrap:tab-store', label: 'STORE', tab: true, x: 276, y: TAB_Y, w: 190, h: TAB_H, selected: wrapNav.you === 'store', disabled: sealed() },
    { id: 'wrap:tab-settings', label: 'SETTINGS', tab: true, x: 476, y: TAB_Y, w: 300, h: TAB_H, selected: wrapNav.you === 'settings' },
  ];
}

function youBoard(): Face {
  const lock = sealed();
  return {
    title: '',
    body: () => {},
    buttons: [
      // ONE door to the customization plate — LOCKER · STORE · PAINT are
      // its tabs — and one to who you are.
      { id: 'open-custom', label: 'CUSTOMIZE', sub: lock ? SEAL_SUB : 'Locker · Store · Paint', x: 96, y: 190, w: 640, h: 260, primary: !lock, disabled: lock },
      { id: 'profile-toggle', label: 'CAREER PROFILE', sub: 'Rank, XP, achievements and identity', x: 96, y: 500, w: 640, h: 150, small: true },
    ],
  };
}

function storeBoard(): Face {
  return {
    title: '',
    body: () => {},
    buttons: [
      { id: 'open-shop', label: 'BROWSE THE STORE', sub: 'Gear, platforms and paint', x: 96, y: 190, w: 640, h: 210 },
      { id: 'open-bank', label: 'BANK', sub: 'Top up or recover your purchases', x: 96, y: 450, w: 640, h: 150, small: true },
      { id: 'store-balance', label: `$ ${coins.balance}`, sub: 'iron-dollars available', x: 96, y: 650, w: 640, h: 110, small: true, display: true },
    ],
  };
}

function youFace(): Face {
  const face: Face = wrapNav.you === 'settings' ? { title: '', ...settingsFace() }
    : wrapNav.you === 'store' && !sealed() ? storeBoard() : youBoard();
  return { ...face, buttons: [...youTabs(), ...face.buttons] };
}

/* ── the rig ──────────────────────────────────────────────────────────── */

export interface Wrap {
  /** Advance kit transitions (hover eases, press flashes, halo breath). */
  tick(delta: number): void;
}

declare global {
  interface Window {
    __ff2?: {
      wrap: {
        buttons: (id: string) => string[];
        live: (id: string) => string[];
        snap: (id: string) => string;
        act: (action: string) => void;
        redraw: () => void;
        nav: () => { center: CenterTab; play: PlayTab; town: TownTab; you: YouTab; club: boolean };
        visible: (id: string) => boolean;
      };
    };
  }
}

/**
 * Replace the legacy 'train' / 'duel' / 'info' plates with the wrap, in
 * place — same ids, same slots, same parent group — and hang THE PROFILE
 * chip + card above the right wing. Call once, right after `createMenu`.
 * `act` is MenuSystem.run — global ids go through it; the wrap's own
 * `wrap:*` tab navigation is handled here.
 */
export function installWrap(menu: Menu, act?: (action: MenuAction) => void): Wrap {
  /** Route one pressed id: local tab-nav, or the real dispatcher. */
  const dispatch = (id: string): void => {
    switch (id) {
      case 'wrap:tab-fight':
        wrapNav.center = 'fight';
        return;
      case 'wrap:tab-practice':
      case 'wrap:tab-club':
        if (sealed() || app.state === 'queueing') return;
        wrapNav.center = id === 'wrap:tab-practice' ? 'practice' : 'club';
        if (clubUp()) warmRoomServer();
        return;
      case 'wrap:tab-arcade': // legacy deep link: boss activities now live in PLAY
        if (sealed() || app.state === 'queueing') return;
        wrapNav.center = 'fight';
        wrapNav.play = 'titans';
        app.duelView = 'root';
        return;
      case 'wrap:play-duels':
      case 'wrap:play-titans':
      case 'wrap:play-rave':
        if (sealed() || app.state === 'queueing') return;
        wrapNav.play = id.slice('wrap:play-'.length) as PlayTab;
        return;
      case 'wrap:tab-store':
        if (sealed()) return;
        act?.('settings-close');
        wrapNav.you = 'store';
        return;
      case 'wrap:tab-town':
        wrapNav.town = 'town';
        return;
      case 'wrap:tab-ladder':
        wrapNav.town = 'ladder';
        // The ladder opens onto a board, never a blank profile.
        if (leaderboard.tab === 'profile') setLeaderboardTab('ranked');
        return;
      case 'wrap:tab-news':
        act?.('open-gazette');
        return;
      case 'wrap:tab-you':
        act?.('settings-close');
        return;
      case 'wrap:tab-settings':
        act?.('open-settings');
        return;
      case 'wrap:back':
        return;
      default:
        if (['private-open', 'ranked-match', 'quick-match'].includes(id)) {
          wrapNav.center = 'fight';
          wrapNav.play = 'duels';
        }
        act?.(id as MenuAction);
    }
  };

  const slab = new KitMenuPanel('train', 1.42, 0.95, CW, 1024, centerFace, dispatch);
  const town = new KitMenuPanel('duel', 0.74, 0.91, LW, 1024, townFace, dispatch);
  const you = new KitMenuPanel('info', 0.74, 0.91, LW, 1024, youFace, dispatch);
  const chip = new KitMenuPanel('profile', 0.62, (0.62 * CHIP_H) / CHIP_W, CHIP_W, CHIP_H, profileChipFace, dispatch, { bare: true });
  const card = new KitMenuPanel('profilecard', 0.62, (0.62 * CARD_H) / CARD_W, CARD_W, CARD_H, profileCardFace, dispatch, { bare: true });

  const y = 1.45;
  slab.mesh.position.set(0, y, -1.26);
  town.mesh.position.set(-1.02, y, -1.02);
  town.mesh.rotation.y = 0.58;
  you.mesh.position.set(1.02, y, -1.02);
  you.mesh.rotation.y = -0.58;
  // THE PROFILE: the chip rides just above the YOU wing's top edge; the
  // card drops out from under it, a hand's width in front of the wing.
  const yaw = -0.58;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  const chipH = (0.62 * CHIP_H) / CHIP_W;
  const cardH = (0.62 * CARD_H) / CARD_W;
  const wingTop = y + 0.455;
  chip.mesh.position.set(1.02, wingTop + 0.02 + chipH / 2, -1.02);
  chip.mesh.rotation.y = yaw;
  card.mesh.position.set(1.02 + nx * 0.05, wingTop + 0.01 - cardH / 2, -1.02 + nz * 0.05);
  card.mesh.rotation.y = yaw;
  card.mesh.renderOrder = 31; // over the wing, whatever the sort says
  card.mesh.visible = false;

  const panels = [slab, town, you, chip, card];
  for (const p of [slab, town, you]) {
    const i = menu.panels.findIndex((old) => old.id === p.id);
    if (i < 0) continue;
    const old = menu.panels[i];
    old.mesh.removeFromParent();
    menu.panels[i] = p;
    menu.group.add(p.mesh);
    p.redraw(null);
  }
  for (const p of [chip, card]) {
    menu.panels.push(p);
    menu.group.add(p.mesh);
    p.redraw(null);
  }

  const byId = (id: string): KitMenuPanel | undefined => panels.find((p) => p.id === id);
  window.__ff2 = {
    wrap: {
      buttons: (id) => byId(id)?.kit.buttonIds() ?? [],
      live: (id) => byId(id)?.kit.liveButtons() ?? [],
      snap: (id) => (byId(id)?.kit.ctx().canvas as HTMLCanvasElement | undefined)?.toDataURL('image/png') ?? '',
      act: (action) => {
        dispatch(action);
        for (const p of panels) p.redraw(null);
      },
      redraw: () => {
        for (const p of panels) p.redraw(null);
      },
      nav: () => ({ ...wrapNav, club: clubUp() }),
      visible: (id) => byId(id)?.mesh.visible ?? false,
    },
  };

  let clock = 0;
  return {
    tick(delta: number): void {
      clock += delta;
      const pulse = 0.5 + 0.5 * Math.sin((clock * 2 * Math.PI) / 6);
      for (const p of panels) p.tick(delta, pulse);
    },
  };
}
