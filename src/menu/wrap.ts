/** FF2 lobby: ONE BOARD, back from the Meta Quest build (ff2meta
 * UI/Menu/Wrap.cs + UI/MenuSystem.cs; docs/menu-research.md has the
 * navigation contract). The three panels of the wrap — PLAY slab, TOWN and
 * YOU wings — became one board dead ahead in RAVE RAID's format
 * (menu/board.ts): the sheared wordmark, the status chip, the settings cog
 * and THE PROFILE in the header, an indexed rail down the left, and the
 * open page hosted in the content region beside it.
 *
 * THE RAIL: CAREER · VERSUS · RAVE RAID · CLUB, then RANKINGS · NEWS, then
 * LOCKER · STORE. CAREER takes the whole board (‹ BACK returns). VERSUS is
 * THE PLAY PAGE (menu/playPage.ts): every way to fight, AIM TRAINING and
 * the TUTORIAL replay included. RAVE RAID, CLUB, LOCKER and STORE are
 * doors: one press walks you into the foyer, knocks on the club (its face
 * reads out the wait), or opens the locker / the store. SETTINGS is the
 * header's cog. ACTIVITY is off the rail: the queue, the squads and the
 * club's head count ride the pages they belong to. The menus never say
 * "bots".
 */

import type { Menu, MenuAction, MenuPanel, PanelId } from './menu.js';
import { renderNewsPage } from './menu.js';
import { Panel, KIT, type PanelButton, type PanelOpts } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { leaderboard, setLeaderboardTab } from '../net/leaderboard.js';
import { gazette } from '../net/gazette.js';
import { FIREBASE_ENABLED } from '../net/firebase.js';
import { ladderFace } from './ladder.js';
import { settingsFace } from './settingsFace.js';
import { CARD_H, CARD_W, profileCardFace, profilePop } from './profilePop.js';
import { GAME_TITLE, warmRoomServer } from '../config.js';
import { prefetchVenue } from '../rave/club/venue.js';
import { CAMP_W, CAREER_BOTTOM, CAREER_TOP, careerFace } from './campaignFace.js';
import { BACK_ID, BOARD_H, BOARD_PANE, BOARD_W, CHIP, CONTENT, COG_ID, FULL, RailMarker, boardButtons, drawBoard, type BoardState, type RailTab } from './board.js';
import { PLAY_H, PLAY_W, playAction, playPageFace, selectMode } from './playPage.js';
import { roomPageFace, roomWanted } from './roomPage.js';

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
  /** THE BOARD's pages set this: whether the panel is up while the lobby
   *  is (MenuSystem ANDs it with the lobby's own visibility). */
  shown?: () => boolean;

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

/* ── the board's state ────────────────────────────────────────────────── */

/** The page in the content region (CAREER takes the whole board — `full`). */
export type BoardPage = 'versus' | 'club' | 'rankings' | 'news' | 'settings';
export type TownTab = 'ladder' | 'news';
export type YouTab = 'you' | 'store' | 'settings';

export const wrapNav = {
  // The board opens on VERSUS: QUICK MATCH is one press away.
  page: 'versus' as BoardPage,
  /** A page that has the whole board: the CAREER, or nothing. */
  full: null as 'career' | null,
  // RANKINGS and NEWS share the old TOWN wing's face host; its paper is
  // the default, so the first visit to the wing is the day's edition.
  town: 'news' as TownTab,
  you: 'you' as YouTab,
};

/** Put the board on the CAREER (campaign bouts return here, win or lose;
 *  the legacy open-campaign action lands here too). */
export function showCampaign(): void {
  wrapNav.full = 'career';
  app.duelView = 'root';
}

/* ── shared bits ──────────────────────────────────────────────────────── */

const sealed = (): boolean => !app.tutorialDone;
/** CAREER, RAVE RAID and CLUB are shut while sealed or while a search runs. */
const doorShut = (): boolean => sealed() || app.state === 'queueing';
/** The old tab strip's band: the hosted faces start under it. */
const STRIP = 124;

function note(text: string, y: number, W: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(500, 24);
    g.fillStyle = KIT.faint;
    g.fillText(text, W / 2, y);
  };
}

/** A face, moved up and left by (dx, dy): what a hosted panel shows of a
 *  face drawn for a bigger canvas (the strip above a wing face, the air
 *  above the career). Its tabs, and anything above the cut, are dropped. */
function crop(face: Face, dx: number, dy: number): Face {
  return {
    title: '',
    body: (g, hover) => {
      g.save();
      g.translate(-dx, -dy);
      face.body?.(g, hover);
      g.restore();
    },
    buttons: face.buttons.filter((b) => !b.tab && b.y + b.h > dy).map((b) => ({ ...b, x: b.x - dx, y: b.y - dy })),
  };
}

/* The club's door, on the wide host. */

const CW = 1536; // canvas
const COL = 656; // half column

/** THE CLUB: its tab is a door (one press knocks — see installWrap), and
 *  this face is what stands behind it while the house wakes, or for a
 *  second knock if you come home and want back in. */
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
        x: (CW - COL) / 2, y: 240, w: COL, h: 240,
        primary: !waiting,
        // While the door is held it is a live readout, not a dead button
        // (the kit's `disabled` grey reads as broken; `display` reads as
        // data) — and the kit already refuses presses on a display chip.
        display: waiting,
        tone: waiting ? KIT.accent : undefined,
      },
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

/* Wing faces: RANKINGS, NEWS and SETTINGS. */

const LW = 832;

function townFace(): Face {
  if (wrapNav.town === 'ladder' && !sealed()) return { title: '', ...ladderFace() };
  return newsFace();
}

/* ── the rail ─────────────────────────────────────────────────────────── */

function railTabs(): RailTab[] {
  const lock = sealed();
  const shut = doorShut();
  return [
    { id: 'board:career', label: 'CAREER', disabled: shut },
    { id: 'board:versus', label: 'VERSUS' },
    { id: 'board:rave', label: 'RAVE RAID', disabled: shut },
    { id: 'board:club', label: 'CLUB', disabled: shut, sub: !lock && app.pubCount > 0 ? `${app.pubCount} INSIDE` : undefined },
    { id: 'board:rankings', label: 'RANKINGS', disabled: lock, groupStart: true },
    // The pip says "a new edition you haven't seen".
    { id: 'board:news', label: 'NEWS', sub: gazette.unread && wrapNav.page !== 'news' ? 'NEW EDITION' : undefined },
    { id: 'board:locker', label: 'LOCKER', disabled: lock, groupStart: true },
    { id: 'board:store', label: 'STORE', disabled: lock },
  ];
}

/** The header's status chip: what the lobby is doing, else whether it's online. */
function boardStatus(): BoardState['status'] {
  if (app.state === 'queueing') return { text: 'SEARCHING', led: KIT.warn, lit: true };
  if (app.venueStatus !== '') return { text: 'OPENING THE CLUB', led: KIT.warn, lit: true };
  const online = FIREBASE_ENABLED && (typeof navigator === 'undefined' || navigator.onLine !== false);
  return online ? { text: 'ONLINE', led: KIT.positive, lit: true } : { text: 'OFFLINE', led: KIT.faint, lit: false };
}

function boardState(): BoardState {
  return {
    tabs: railTabs(),
    // SETTINGS is off the rail (the cog): it parks no marker.
    active: wrapNav.page === 'settings' ? null : `board:${wrapNav.page}`,
    full: wrapNav.full === 'career' ? 'CAMPAIGN' : null,
    status: boardStatus(),
    cogOpen: wrapNav.page === 'settings' && !wrapNav.full,
    profileOpen: profilePop.open,
  };
}

/* ── the rig ──────────────────────────────────────────────────────────── */

export interface Wrap {
  /** Advance kit transitions (hover eases, press flashes, the rail marker). */
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
        nav: () => { page: BoardPage; full: 'career' | null; town: TownTab; you: YouTab; club: boolean };
        visible: (id: string) => boolean;
      };
    };
  }
}

/** Where the board hangs: dead ahead, its width and its metres per px. */
const BOARD_POS = { x: 0, y: 1.45, z: -1.2 };
const BOARD_WIDTH_M = 1.56;
const MPP = BOARD_WIDTH_M / BOARD_W;

/**
 * Replace the legacy 'train' / 'duel' / 'info' plates with THE BOARD and
 * its hosted pages, and hang THE PROFILE's card under the header chip.
 * Call once, right after `createMenu`. `act` is MenuSystem.run — global
 * ids go through it; the board's own `board:*` navigation is settled here.
 */
export function installWrap(menu: Menu, act?: (action: MenuAction) => void): Wrap {
  /** Leaving a page backs out of a room screen, as its own ‹ BACK would
   *  (the arcade lobby's ‹ BACK / LEAVE, a custom game's ‹ BACK / CANCEL). */
  const leaveFlow = (): void => {
    if (app.lobbyMode) act?.('lobby-close');
    if (app.duelView === 'root') return;
    act?.(app.duelView === 'browser' ? 'ranked-back' : 'private-back');
    app.duelView = 'root';
  };

  /** Route one pressed id: the board's own navigation, or the real dispatcher. */
  const dispatch = (id: string): void => {
    if (id.startsWith('board:') && id !== BACK_ID) leaveFlow();
    switch (id) {
      case 'board:career':
        if (doorShut()) return;
        showCampaign();
        return;
      case 'board:versus':
        wrapNav.page = 'versus';
        return;
      case 'board:rave':
        // A door: one press and you're in RAVE RAID's foyer.
        if (doorShut()) return;
        act?.('open-rave');
        return;
      case 'board:club':
        // A door too. The page turns to the club's face, which reads out
        // the wait while the house wakes (ClubExperienceManager
        // holdForTheFloor); a second knock while it's held does nothing.
        if (doorShut() || app.venueStatus !== '') return;
        wrapNav.page = 'club';
        warmRoomServer();
        // The hall is the slow part of the door (sixteen megabytes).
        prefetchVenue();
        act?.('open-pub');
        return;
      case 'board:rankings':
        if (sealed()) return;
        wrapNav.page = 'rankings';
        wrapNav.town = 'ladder';
        // The ladder opens onto a board, never a blank profile.
        if (leaderboard.tab === 'profile') setLeaderboardTab('ranked');
        return;
      case 'board:news':
        wrapNav.page = 'news';
        act?.('open-gazette');
        return;
      case 'board:locker':
        // LOCKER and STORE open the customization plate on their own tab in
        // one press — no page in between.
        if (sealed()) return;
        act?.('open-custom');
        return;
      case 'board:store':
        if (sealed()) return;
        act?.('open-shop');
        return;
      case COG_ID:
        // The cog opens SETTINGS from anywhere, the whole-board CAREER included.
        wrapNav.full = null;
        act?.('open-settings');
        return;
      case BACK_ID:
        wrapNav.full = null;
        return;
      case 'wrap:back':
        return;
      default:
        if (['private-open', 'ranked-match', 'quick-match', 'arcade-2v2', 'arcade-ffa', 'open-raid'].includes(id)) {
          wrapNav.page = 'versus';
          wrapNav.full = null;
        }
        act?.(id as MenuAction);
    }
  };

  const marker = new RailMarker();
  // eslint-disable-next-line prefer-const
  let board: KitMenuPanel;
  const boardFace = (): Face => {
    const st = boardState();
    return { title: '', buttons: boardButtons(st), body: (g) => drawBoard(g, st, (id) => board.kit.hoverOf(id), marker) };
  };
  board = new KitMenuPanel('board', BOARD_WIDTH_M, BOARD_WIDTH_M * (BOARD_H / BOARD_W), BOARD_W, BOARD_H, boardFace, dispatch, { fill: BOARD_PANE });
  board.mesh.position.set(BOARD_POS.x, BOARD_POS.y, BOARD_POS.z);

  /** A page hung in a region of the board (board px), its pxW × pxH face
   *  scaled to fit, top-aligned and centred across, a hair in front. */
  const host = (
    id: PanelId,
    pxW: number,
    pxH: number,
    rect: { x: number; y: number; w: number; h: number },
    face: () => Face,
    shown: () => boolean,
    onClick: (id: string) => void = dispatch,
  ): KitMenuPanel => {
    const s = Math.min(rect.w / pxW, rect.h / pxH);
    const p = new KitMenuPanel(id, pxW * s * MPP, pxH * s * MPP, pxW, pxH, face, onClick, { bare: true });
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + (pxH * s) / 2;
    p.mesh.position.set(BOARD_POS.x + (cx - BOARD_W / 2) * MPP, BOARD_POS.y + (BOARD_H / 2 - cy) * MPP, BOARD_POS.z + 0.004);
    p.mesh.renderOrder = 31;
    p.shown = shown;
    return p;
  };

  const inPage = (page: BoardPage): boolean => !wrapNav.full && wrapNav.page === page;
  // eslint-disable-next-line prefer-const
  let play: KitMenuPanel;
  play = host(
    'play',
    PLAY_W,
    PLAY_H,
    CONTENT,
    () => playPageFace((id) => play.kit.hoverOf(id)),
    () => inPage('versus') && !roomWanted(true),
    (id) => {
      if (id.startsWith('mode:')) {
        selectMode(id.slice('mode:'.length));
        return;
      }
      if (id === 'play-go') {
        const a = playAction();
        if (a) dispatch(a);
        return;
      }
      dispatch(id);
    },
  );
  // THE ROOMS: the arcade lobby (anywhere) and the custom-game / ranked
  // flows (under VERSUS) take the content region, in the PLAY page's format.
  // eslint-disable-next-line prefer-const
  let room: KitMenuPanel;
  room = host('room', PLAY_W, PLAY_H, CONTENT, () => roomPageFace((id) => room.kit.hoverOf(id)), () => !wrapNav.full && roomWanted(wrapNav.page === 'versus'));
  const wide = host('train', CW, 1024 - STRIP, CONTENT, () => crop(clubFace(), 0, STRIP), () => inPage('club') && !app.lobbyMode);
  const career = host(
    'career',
    CAMP_W,
    CAREER_BOTTOM - CAREER_TOP,
    FULL,
    () => crop(careerFace(), 0, CAREER_TOP),
    () => wrapNav.full === 'career' && !sealed(),
  );
  const town = host('duel', LW, 1024 - STRIP, CONTENT, () => crop(townFace(), 0, STRIP), () => !app.lobbyMode && (inPage('news') || (inPage('rankings') && !sealed())));
  const you = host('info', LW, 1024 - STRIP, CONTENT, () => crop({ title: '', ...settingsFace() }, 0, STRIP), () => !app.lobbyMode && inPage('settings'));

  // THE PROFILE's card drops out under the header chip, in front of the board.
  const CARD_WM = 0.5;
  const cardH = (CARD_WM * CARD_H) / CARD_W;
  const card = new KitMenuPanel('profilecard', CARD_WM, cardH, CARD_W, CARD_H, profileCardFace, dispatch, { bare: true });
  card.mesh.position.set(
    BOARD_POS.x + (CHIP.x + CHIP.w / 2 - BOARD_W / 2) * MPP,
    BOARD_POS.y + (BOARD_H / 2 - (CHIP.y + CHIP.h + 8)) * MPP - cardH / 2,
    BOARD_POS.z + 0.03,
  );
  card.mesh.renderOrder = 32; // over the board and its pages, whatever the sort says
  card.mesh.visible = false;

  const panels = [board, play, room, wide, career, town, you, card];
  for (const id of ['train', 'duel', 'info'] as const) {
    const i = menu.panels.findIndex((old) => old.id === id);
    if (i < 0) continue;
    menu.panels[i].mesh.removeFromParent();
    menu.panels.splice(i, 1);
  }
  for (const p of panels) {
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
        // A probe's press goes where a pointer's would: the PLAY page's
        // rows and CTA settle on the page.
        if (action.startsWith('mode:')) selectMode(action.slice('mode:'.length));
        else if (action === 'play-go') {
          const a = playAction();
          if (a) dispatch(a);
        } else dispatch(action);
        for (const p of panels) p.redraw(null);
      },
      redraw: () => {
        for (const p of panels) p.redraw(null);
      },
      nav: () => ({ ...wrapNav, club: wrapNav.page === 'club' }),
      visible: (id) => byId(id)?.mesh.visible ?? false,
    },
  };

  let clock = 0;
  return {
    tick(delta: number): void {
      clock += delta;
      const pulse = 0.5 + 0.5 * Math.sin((clock * 2 * Math.PI) / 6);
      for (const p of panels) p.tick(delta, pulse);
      // The rail's marker slides on its own clock: repaint while it moves.
      if (marker.ease(delta) && board.mesh.visible) board.kit.repaint();
    },
  };
}
