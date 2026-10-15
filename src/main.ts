/**
 * FIRE FIGHT — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the two glowing platforms, the rim barrier and the iron boxer float in your
 * real room. If the device can't do AR, IWSDK falls back to VR.
 *
 * Run `npm run dev` and open the page: on a headset you'll get an "Enter AR"
 * offer; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse). For online 1v1s also run `npm run server`.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { installCrashTrap } from './debug/crashTrap.js';
import { installTownExperienceManager } from './experience/ClubExperienceManager.js';
import { requestArenaReturn, requestVenueEntry } from './experience/clubNavigation.js';
import { initLeaderboard, myName } from './net/leaderboard.js';
import { enter as enterRoom } from './net/presence.js';
import { myPackedLook } from './avatar/paint.js';
import { initGazette } from './net/gazette.js';
import { enterMenuMusic, preloadMenuMusic } from './audio/menuMusic.js';
import { runBootIntro } from './experience/BootIntro.js';
import { ensureAudio } from './audio/sfx.js';
import { preflightMic } from './audio/micPermission.js';
import { preloadTutorVoice } from './audio/tutorVoice.js';
import { app } from './menu/appState.js';
import { buildArena } from './arena/arena.js';
import { setupEnvironment } from './arena/environment.js';
import { setupCombatants } from './combat/setup.js';
import { PlayerBodySystem } from './systems/PlayerBodySystem.js';
import { OpponentSystem } from './systems/OpponentSystem.js';
import { BotSystem } from './systems/BotSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { MeshSystem } from './systems/MeshSystem.js';
import { TrainingSystem } from './systems/TrainingSystem.js';
import { TutorialSystem } from './systems/TutorialSystem.js';
import { CampaignSystem } from './systems/CampaignSystem.js';
import { FireballSystem } from './systems/FireballSystem.js';
import { CollisionSystem } from './systems/CollisionSystem.js';
import { BoundarySystem } from './systems/BoundarySystem.js';
import { GameStateSystem } from './systems/GameStateSystem.js';
import { BroadcastSystem } from './systems/BroadcastSystem.js';
import { CountdownSystem } from './systems/CountdownSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { PromotionSystem } from './systems/PromotionSystem.js';
import { PlayerFeedbackSystem } from './systems/PlayerFeedbackSystem.js';
import { CrowdSystem } from './systems/CrowdSystem.js';
import { AudienceSystem } from './systems/AudienceSystem.js';
import { PlayerGloveSystem } from './systems/PlayerGloveSystem.js';
import { PlayerGestureSystem } from './systems/PlayerGestureSystem.js';
import { FXSystem } from './systems/FXSystem.js';
import { DesertSystem } from './systems/DesertSystem.js';
import { PlatformFXSystem } from './systems/PlatformFXSystem.js';
import { PerfHudSystem } from './systems/PerfHudSystem.js';
import { FOVEATION, warmRoomServer } from './config.js';
import { claimPurchases } from './net/bank.js';
import { initWalletSync } from './net/walletSync.js';
import { initGifts } from './net/gifts.js';

installCrashTrap(); // headset playtests have no console — trap + persist crashes

// The stash is console-only by design, but the headset HAS no console: visit
// ?crashes=1 to read it on-device (flat browser), ?crashes=clear to wipe it.
const crashesParam = new URLSearchParams(location.search).get('crashes');
if (crashesParam) {
  const helpers = window as unknown as { ibbCrashes?: () => string[]; ibbClearCrashes?: () => void };
  const stash = helpers.ibbCrashes?.() ?? [];
  if (crashesParam === 'clear') helpers.ibbClearCrashes?.();
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;inset:12px;z-index:99999;overflow:auto;background:#0b0d12;' +
    'color:#8ef58e;font:13px/1.6 monospace;padding:14px;white-space:pre-wrap;border:1px solid #2a2f3a';
  pre.textContent =
    crashesParam === 'clear'
      ? 'crash stash cleared'
      : stash.length
        ? stash.join('\n\n')
        : 'no stored crashes';
  document.body.append(pre);
}

// A JOIN LINK (DESIGN §8.1): one scheme for every code. A four-digit code
// is a club room — the rave page's floor answers it; a five-digit arena
// code is picked up by the lobby once you're in (MenuSystem's boot join).
{
  const join = new URLSearchParams(location.search).get('join') ?? '';
  if (/^\d{4}$/.test(join)) location.replace(`rave.html?room=${join}`);
}

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterVrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

enterVrButton?.setAttribute('disabled', '');

const loadStatus = document.getElementById('status') as HTMLElement | null;
const loadBar = document.getElementById('bar-fill') as HTMLElement | null;

/**
 * The loading bar, 0 to 1, and it never goes back. index.html creeps it along
 * on its own until the code is in; from the first call here it's the real
 * thing: the code (to 0.3), the engine (to 0.45), the arena (to 0.9), then
 * the headset check (to 1).
 */
let loadShown = 0;
function loadProgress(f: number, text?: string): void {
  if (text && loadStatus) loadStatus.textContent = text;
  if (!loadBar) return;
  if (loadBar.style.animation !== 'none') {
    // take over from the creep where it's got to
    const t = getComputedStyle(loadBar).transform;
    loadShown = t.startsWith('matrix(') ? parseFloat(t.slice(7)) || 0 : 0;
    loadBar.style.animation = 'none';
  }
  loadShown = Math.max(loadShown, Math.min(1, f));
  loadBar.style.transform = `scaleX(${loadShown})`;
}
/** A build step's done: move the bar and let the page draw before the next
 *  (one long synchronous block would freeze the landing mid-bar). */
function loadStep(f: number, text?: string): Promise<void> {
  loadProgress(f, text);
  return new Promise((r) => window.setTimeout(r, 0));
}

loadProgress(0.3, 'Starting the engine…');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  if (enterVrButton) enterVrButton.textContent = app.environment === 'ar' ? 'Enter AR' : 'Enter VR';
  enterVrButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
  },
  // A stationary dodge game: no locomotion (you stay on your platform).
  // Grabbing stays registered for the lazily loaded club.
  features: {
    // Registered once for the shared app shell. The arena has no grabbable
    // entities, while the lazily mounted club uses it for pints and darts.
    grabbing: true,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves (see setupEnvironment) and let passthrough
    // provide the backdrop, so the default sky is off.
    defaultLighting: false,
    // Far enough to render the optional desert's horizon mesas + sun disc when
    // that backdrop is switched on; harmless in bare AR (nothing's out there).
    far: 1600,
    camera: { position: [0, 1.6, 0] },
  },
}).then(async (world) => {
  // IWSDK infrastructure already present before either experience is built.
  // The transition manager uses these baselines to hide arena-owned nodes
  // without ever hiding the camera, XR origin or controller spaces.
  const sceneBaseline = new Set(world.scene.children);
  const levelBaseline = new Set(world.getActiveRoot().children);
  // …and the same for the camera, the XR origin and the controller spaces:
  // anything either place hangs off those later (a glove, a glowstick, a
  // held glass, a head-locked card) is the place's, not the shell's.
  const bodyBaseline = new Set<import('three').Object3D>([...world.camera.children, ...world.player.children]);
  {
    const spaces = world.playerSpaceEntities as
      | { gripSpaces?: Record<string, { object3D?: import('three').Object3D }>; raySpaces?: Record<string, { object3D?: import('three').Object3D }> }
      | undefined;
    for (const table of [spaces?.gripSpaces, spaces?.raySpaces]) {
      for (const hand of ['left', 'right']) for (const c of table?.[hand]?.object3D?.children ?? []) bodyBaseline.add(c);
    }
  }

  world.renderer.xr.setFoveation(FOVEATION);
  await loadStep(0.45, 'Building the arena…');

  initLeaderboard(); // anonymous profile + first board fetch
  initGazette(); // pull the day's Gasket Gazette for the lobby paper button
  // THE CLOUD WALLET: merge the coins and the locker with the profile's copy,
  // then mirror every change. THE BANK: anything bought while this headset
  // was off lands now.
  initWalletSync();
  void claimPurchases();
  initGifts(); // THE NAME GIFT (config.ts RENAME_GIFT), once, from its hour
  // Check in. The doors (experience/clubNavigation.ts) hand presence on from
  // here as you move between the arena, the venue and the rave.
  enterRoom('arena', myName(), myPackedLook());
  // Knock on the room server now, whoever this is. It sleeps on a free tier
  // and takes most of a minute to wake; the lobby is the one place we have
  // a minute, and the CLUB door is the one that can't hide a cold host.
  warmRoomServer();
  setupEnvironment(world);
  await loadStep(0.55);
  buildArena(world);
  await loadStep(0.65);
  setupCombatants(world);
  await loadStep(0.75, 'Heating the gloves…');

  // Body pose first so hitboxes are current for everything downstream.
  world.registerSystem(PlayerBodySystem);
  // Opponent drivers: exactly one of these writes the bus per bout.
  world.registerSystem(BotSystem);
  world.registerSystem(NetworkSystem);
  world.registerSystem(MeshSystem);
  world.registerSystem(OpponentSystem);
  // Aim Training: targets, scoring, return fire.
  world.registerSystem(TrainingSystem);
  // ARCADE campaign: the five-titan gauntlet (its own boss rig, telegraphed
  // attacks and HUD — GameStateSystem stands down for these bouts).
  world.registerSystem(CampaignSystem);
  // The guided basics tutorial — rides a bot bout, paces it with pop-ups. Runs
  // before FireballSystem so its command-bus tweaks land before the balls sim.
  world.registerSystem(TutorialSystem);
  // The fireballs themselves, then collision (so it sees final positions).
  world.registerSystem(FireballSystem);
  world.registerSystem(CollisionSystem);
  // Rim barrier damage, then the match brain + scoreboards.
  world.registerSystem(BoundarySystem);
  world.registerSystem(GameStateSystem);
  // THE BROADCAST: THE CHANNEL's frames + THE TAPE, read off this frame's match state.
  world.registerSystem(BroadcastSystem);
  // The big in-world 3-2-1-FIGHT hanging between the platforms.
  world.registerSystem(CountdownSystem);
  // Lobby menu, promotion celebration, hit vignette, gloves, transient FX.
  world.registerSystem(MenuSystem);
  world.registerSystem(PromotionSystem);
  world.registerSystem(PlayerFeedbackSystem);
  world.registerSystem(CrowdSystem); // the crowd bed + the hands-up roar (phase 6)
  world.registerSystem(AudienceSystem); // watchers on the terrace (DESIGN §3.2)
  world.registerSystem(PlayerGloveSystem);
  world.registerSystem(PlayerGestureSystem);
  world.registerSystem(FXSystem);
  // Earned trophy pads stay alive: BLAZING burns and TIDEBREAKER surges.
  world.registerSystem(PlatformFXSystem);
  // Frame-time readout; builds nothing unless the page is opened with ?perf=1.
  world.registerSystem(PerfHudSystem);
  // The optional papercraft desert backdrop (off = bare AR passthrough).
  world.registerSystem(DesertSystem);

  const arenaSystems = [
    world.getSystem(PlayerBodySystem)!,
    world.getSystem(BotSystem)!,
    world.getSystem(NetworkSystem)!,
    world.getSystem(MeshSystem)!,
    world.getSystem(OpponentSystem)!,
    world.getSystem(TrainingSystem)!,
    world.getSystem(CampaignSystem)!,
    world.getSystem(TutorialSystem)!,
    world.getSystem(FireballSystem)!,
    world.getSystem(CollisionSystem)!,
    world.getSystem(BoundarySystem)!,
    world.getSystem(GameStateSystem)!,
    world.getSystem(BroadcastSystem)!,
    world.getSystem(CountdownSystem)!,
    world.getSystem(MenuSystem)!,
    world.getSystem(PromotionSystem)!,
    world.getSystem(PlayerFeedbackSystem)!,
    world.getSystem(PlayerGloveSystem)!,
    world.getSystem(PlayerGestureSystem)!,
    world.getSystem(PlatformFXSystem)!,
    world.getSystem(DesertSystem)!,
  ];
  installTownExperienceManager(world, arenaSystems, {
    scene: sceneBaseline,
    level: levelBaseline,
    body: bodyBaseline,
  });

  // Desktop-only transition harness for repeatable production-build smoke
  // tests. It is absent from normal URLs and never changes the headset UI.
  if (new URLSearchParams(location.search).get('clubtest') === '1') {
    const controls = document.createElement('aside');
    controls.setAttribute('aria-label', 'Club transition test');
    controls.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;gap:8px;' +
      'padding:10px;background:#090b10;color:white;font:700 14px system-ui;border:1px solid #ff7a18';
    const status = document.createElement('output');
    status.textContent = 'arena';
    const enter = document.createElement('button');
    enter.textContent = 'Test Enter Venue';
    enter.addEventListener('click', () => {
      document.body.classList.add('app-entered');
      requestVenueEntry(world);
    });
    const leave = document.createElement('button');
    leave.textContent = 'Test Return Arena';
    leave.addEventListener('click', () => requestArenaReturn(world));
    window.addEventListener('ibb:location', ((event: CustomEvent<string>) => {
      status.textContent = event.detail;
    }) as EventListener);
    controls.append(enter, leave, status);
    document.body.append(controls);
  }

  await loadStep(0.9, 'Checking for a headset…');

  // Opaque arenas launch in immersive VR. Running a painted-in world through
  // Quest's AR compositor exposes grey reprojection strips at the eye edges
  // during quick head turns. Immersive AR is reserved for the one setting
  // that actually needs it: real-room passthrough.
  const arSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveAR).catch(() => false)) === true;
  const vrSupported = (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveVR).catch(() => false)) === true;
  const xrSupported = arSupported || vrSupported;

  let introPlayed = false;
  let sessionPoll = 0;

  const startXR = () => {
    enterVrButton?.setAttribute('disabled', '');
    // Warm the audio engine NOW so the boot intro's music cue lands with a
    // live context instead of paying resume latency on the cut. On
    // autoplay-trusted headsets (and inside a browser click gesture) the
    // context starts running here; on fresh headsets this fails silently and
    // the first trigger pull unlocks it instead — same as before.
    ensureAudio();
    // Decode starts NOW; playback waits for the boot intro's music cue.
    preloadMenuMusic();
    // A boxer who hasn't run the tutorial is headed straight for it — warm
    // Ember's voice clips now (decode works while the context is young), so
    // her very first "Over here." speaks instead of falling back to caption.
    if (!app.tutorialDone) {
      preloadTutorVoice();
    }
    const sessionMode =
      app.environment === 'ar' && arSupported
        ? SessionMode.ImmersiveAR
        : vrSupported
          ? SessionMode.ImmersiveVR
          : SessionMode.ImmersiveAR;
    // No passthrough in a plain-VR fallback: a saved AR backdrop would render
    // as a black void, so promote it to the default arena, the cove.
    if (sessionMode === SessionMode.ImmersiveVR && app.environment === 'ar') app.environment = 'cove';
    launchXR(world, { sessionMode });

    // Poll for the session on a TIMER, not requestAnimationFrame: Quest
    // Browser suspends window rAF while an immersive session presents, so an
    // rAF poll is a race — if the session activates between ticks, the poll
    // never fires again and everything hung off it (landing hide, boot intro,
    // the music cue) silently never happens. Timers keep ticking in-session.
    window.clearInterval(sessionPoll);
    sessionPoll = window.setInterval(() => {
      if (!world.session) return;
      window.clearInterval(sessionPoll);
      hideLanding();
      world.session.addEventListener('end', showLanding, { once: true });
      // XR controller input counts as a user gesture: first press unlocks
      // the AudioContext on headsets that haven't earned autoplay yet, and
      // any music already started while suspended simply begins sounding.
      world.session.addEventListener('select', ensureAudio);
      world.session.addEventListener('selectstart', ensureAudio);
      world.session.addEventListener('squeezestart', ensureAudio);
      if (!introPlayed) {
        introPlayed = true; // once per page load — relaunches are a fresh page
        try {
          runBootIntro(world.camera, world.scene, enterMenuMusic);
        } catch {
          enterMenuMusic(); // curtain failed — never take the music down with it
        }
      } else {
        enterMenuMusic();
      }
    }, 50);
    window.setTimeout(() => {
      if (!world.session) enterVrButton?.removeAttribute('disabled');
    }, 4000);
  };

  loadProgress(1, xrSupported ? 'Ready.' : 'WebXR not available in this browser.');

  if (enterVrButton && xrSupported) {
    enterVrButton.textContent = app.environment === 'ar' ? 'Enter AR' : 'Enter VR';
    enterVrButton.removeAttribute('disabled');
    enterVrButton.addEventListener('click', startXR);
  } else if (enterVrButton) {
    enterVrButton.textContent = 'XR unavailable';
  }

  // Inside the packaged Horizon OS app there may be no visible 2D panel at
  // all: an immersive-mode PWA launches behind the system splash and the OS
  // waits for the CONTENT to start XR. Waiting for a button tap there means
  // waiting forever (Meta review: "stuck for an indefinite period after
  // launching"). The immersive PWA runtime permits a session request without
  // user activation at launch, so enter directly; in a regular browser this
  // path never runs and the landing button behaves exactly as before. If the
  // runtime does demand a gesture after all, the request rejects harmlessly
  // and the 4s re-arm above hands control back to the button.
  const packaged =
    document.referrer.startsWith('android-app://') ||
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  if (packaged && xrSupported) {
    // Settle the mic permission FIRST, in the one moment this app is still
    // flat. Once we're presenting, a permission prompt has nowhere to appear
    // and getUserMedia just resolves as a silent denial — which is why the
    // store build never asked, even carrying RECORD_AUDIO (see
    // audio/micPermission.ts). Asked once ever, bounded, and never allowed to
    // block the launch: whatever happens, we go straight into XR after.
    void preflightMic().then(startXR, startXR);
  }

  // eslint-disable-next-line no-console
  console.info('[FIRE FIGHT] World ready — platforms set, fists hot.');
});
