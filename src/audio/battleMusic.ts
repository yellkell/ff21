/**
 * Battle music — quiet background score for a live bout. When a match starts we
 * pick ONE of the battle tracks at random and loop it under the fight; when the
 * match ends we stop it and ring a victory sting (both players hear it).
 *
 * The end-of-match handoff is the fiddly bit: the sting keeps playing as you
 * return to the lobby, rings out a few more seconds there (if it has more to
 * give), then FADES, a short PAUSE, and only THEN does the lobby music come up —
 * so the sting and the lobby music never overlap. Everything sits well under the
 * lobby music (it's background). MusicTracks (WebAudio) — see musicTrack.ts for
 * why music must not ride <audio> elements on Quest.
 */

import { fadeInMenuMusic, isMusicMuted, noteInLobby } from './menuMusic.js';
import { MusicTrack } from './musicTrack.js';
import { musicVolume } from './musicVolume.js';
import victoryUrl from '../assets/music/victory.mp3?url';
import brainEaterUrl from '../assets/music/brain-eater.mp3?url';

// Auto-discovered battle tracks — drop more .mp3/.m4a files in
// assets/music/battle and they join the random pool automatically.
const battleUrls = Object.values(
  import.meta.glob('../assets/music/battle/*.{mp3,m4a}', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

// ONE battle level for every score — duels, boss fights, the finale anthem —
// sitting clearly under the lobby music (0.5). Boss bouts used to run a far
// louder 0.42 "to carry over the titan SFX", which just made the battle
// scores wildly uneven: the fight's SFX are the foreground, the music is
// the floor, everywhere.
const BATTLE_VOLUME = 0.12;
export const BOSS_BATTLE_VOLUME = BATTLE_VOLUME;
/** The one exception to the floor: raid GOLIATH's resurrection anthem is a
 *  SET PIECE — the rise is scored to it — so it plays above the battle bed
 *  (though still well under the lobby's 0.5). */
const FINALE_VOLUME = 0.2;
const VICTORY_VOLUME = 0.12; // on the same floor as everything else

// Post-match handoff timings.
const VICTORY_LOBBY_MS = 6500; // extra airtime in the lobby if the sting has more
const VICTORY_FADE_MS = 1500; // fade the sting out over this
const VICTORY_PAUSE_MS = 1000; // silence between the sting and the lobby music

let battle: MusicTrack | null = null;
let victory: MusicTrack | null = null;
/** The bespoke final-section track (raid GOLIATH's second life). */
let finale: MusicTrack | null = null;
let timers: number[] = [];
let handoffActive = false;

/** Cancel any in-flight victory→lobby handoff (timers + the ended listener). */
function clearHandoff(): void {
  for (const t of timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  timers = [];
  handoffActive = false;
  if (victory) victory.onended = null;
}

/**
 * Start a random battle track. Call when a bout begins. `volume` defaults to
 * the quiet background level; boss fights pass a louder one
 * (BOSS_BATTLE_VOLUME) so the score carries over the titan's SFX.
 *
 * When a track RUNS OUT mid-battle the score doesn't loop it — the `ended`
 * hook rolls straight into a DIFFERENT track from the pool (any of the
 * others at random), so a long bout hears the rotation, not one song on
 * repeat. Stopping the battle track clears the hook, so nothing chains
 * after the bout ends.
 */
export function startBattleMusic(volume: number = BATTLE_VOLUME): void {
  clearHandoff(); // a new bout abandons any victory handoff
  victory?.pause();
  if (isMusicMuted() || battleUrls.length === 0) return;
  if (battle && !battle.paused) {
    battle.volume = volume * musicVolume(); // already scoring — just match the level
    return;
  }
  const url = battleUrls[Math.floor(Math.random() * battleUrls.length)];
  if (!battle) battle = new MusicTrack();
  battle.loop = false;
  battle.onended = () => rollNextTrack(volume);
  if (battle.src !== url) battle.src = url;
  battle.volume = volume * musicVolume();
  battle.currentTime = 0;
  void battle.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** A battle track ran dry mid-bout: chain a DIFFERENT one from the pool
 *  (same one only when the pool holds a single track). */
function rollNextTrack(volume: number): void {
  if (!battle || isMusicMuted()) return;
  const others = battleUrls.filter((u) => u !== battle!.src && !battle!.src.endsWith(u));
  const pool = others.length > 0 ? others : battleUrls;
  const url = pool[Math.floor(Math.random() * pool.length)];
  battle.src = url;
  battle.volume = volume * musicVolume();
  battle.currentTime = 0;
  void battle.play().catch(() => {
    /* decode failed — the bout goes unscored from here */
  });
}

/** Stop ONLY the looping battle track. The victory sting is handed off
 *  separately, so leaving a bout doesn't cut it short. */
export function stopBattleTrack(): void {
  battle?.pause();
  finale?.pause();
}

/**
 * The FINALE: raid GOLIATH's resurrection anthem ("BrAîN 3AtęŘ"). Kills the
 * regular battle loop and starts the bespoke track from the top — its intro
 * scores the shake + six-second rise, and the fight resumes on the drop. Loops
 * for the whole second life; stopBattleTrack / playVictory end it.
 */
export function startFinaleTrack(): void {
  battle?.pause();
  if (isMusicMuted()) return;
  if (!finale) {
    finale = new MusicTrack(brainEaterUrl);
    finale.loop = true;
  }
  finale.volume = FINALE_VOLUME * musicVolume();
  finale.currentTime = 0;
  void finale.play().catch(() => {
    /* autoplay blocked or decode failed — stay silent */
  });
}

/** Match over: duck the battle track and ring the victory sting once. */
export function playVictory(): void {
  battle?.pause();
  finale?.pause();
  if (isMusicMuted()) return;
  if (!victory) victory = new MusicTrack(victoryUrl);
  victory.onended = null;
  victory.volume = VICTORY_VOLUME * musicVolume();
  victory.currentTime = 0;
  void victory.play().catch(() => {
    /* blocked or decode failed — no sting */
  });
}

/**
 * Back in the lobby. Stop the battle track, then: if the victory sting still has
 * more to play, let it ring ~6–7 s more, fade it out, pause, and only then bring
 * the lobby music up. If the sting is already done, the lobby music comes up
 * straight away. Either way they never overlap.
 */
export function handoffToLobby(): void {
  clearHandoff();
  battle?.pause();
  finale?.pause();
  // We're in the lobby NOW — recorded so the delayed fade-in below can tell if
  // the player is still there when it finally fires (they may have launched
  // another bout during the sting's airtime; the fade must stay silent then).
  noteInLobby();

  const v = victory;
  if (!v || v.paused || v.ended) {
    fadeInMenuMusic(); // nothing ringing — bring the lobby music up
    return;
  }

  handoffActive = true;
  // Finish = pause the sting, wait a beat of silence, then fade the lobby in.
  const finish = (): void => {
    if (!handoffActive) return;
    handoffActive = false;
    v.onended = null;
    v.pause();
    v.volume = VICTORY_VOLUME * musicVolume(); // reset for next time
    timers.push(window.setTimeout(() => fadeInMenuMusic(), VICTORY_PAUSE_MS));
  };

  v.onended = finish; // sting ran out early → straight to pause + lobby music

  // Otherwise, after its lobby airtime, fade the sting out then finish.
  timers.push(
    window.setTimeout(() => {
      if (!handoffActive) return;
      const start = v.volume;
      const steps = Math.max(1, Math.round(VICTORY_FADE_MS / 50));
      let i = 0;
      const fade = window.setInterval(() => {
        i += 1;
        v.volume = Math.max(0, start * (1 - i / steps));
        if (i >= steps) {
          clearInterval(fade);
          finish();
        }
      }, 50);
      timers.push(fade);
    }, VICTORY_LOBBY_MS),
  );
}
